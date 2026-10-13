import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {pool} from '../db/pool.js';
import {upsertGmailSkippedMessage, markGmailSkippedMessageError, markGmailSkippedMessageRestored} from '../repositories/gmailSkippedMessagesRepository.js';
import {createMessage, findLatestCaseIdByThreadId, findMessageByGmailMessageId} from '../repositories/messagesRepository.js';
import {normalizeEmailBody} from '../services/emailBodyNormalizer.js';
import {classifySkippedGmailRecovery} from '../services/gmailService.js';
import {importMessage} from '../services/messageImportService.js';

const fixturePath = fileURLToPath(new URL('../fixtures/gmail/p6b-e2e-fixtures.json', import.meta.url));
const runId = `p6b-${Date.now()}-${randomUUID()}`;

interface Fixture {
  id: string;
  title: string;
  gmailMessageId: string;
  threadId: string;
  from: string;
  subject: string;
  bodyType: string;
  body: string;
  expected: Record<string, unknown>;
}

interface ScenarioResult {
  id: string;
  title: string;
  status: 'PASS' | 'FAIL';
  assertions: number;
  checks: string[];
  error?: string;
}

function databaseNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

async function assertTestDatabaseGuard() {
  if (process.env.CASEBEE_TEST_MODE !== 'true') throw new Error('P6-B tests require CASEBEE_TEST_MODE=true. No writes were performed.');
  if (process.env.CASEBEE_GMAIL_TEST_MODE !== 'mock') throw new Error('P6-B automated tests require CASEBEE_GMAIL_TEST_MODE=mock. Real Gmail OAuth credentials are not allowed for automated reliability tests. No writes were performed.');
  const expectedDatabase = process.env.CASEBEE_TEST_DATABASE_ID?.trim();
  if (!expectedDatabase) throw new Error('P6-B tests require CASEBEE_TEST_DATABASE_ID to explicitly name the test database. No writes were performed.');
  const configuredDatabase = databaseNameFromUrl(process.env.DATABASE_URL ?? '');
  if (configuredDatabase !== expectedDatabase) throw new Error(`P6-B test database guard failed: DATABASE_URL database "${configuredDatabase || 'unknown'}" does not match CASEBEE_TEST_DATABASE_ID "${expectedDatabase}". No writes were performed.`);
  const current = await pool.query('SELECT current_database() AS database_name');
  const currentDatabase = String(current.rows[0]?.database_name ?? '');
  if (currentDatabase !== expectedDatabase) throw new Error(`P6-B test database guard failed: connected database "${currentDatabase}" does not match CASEBEE_TEST_DATABASE_ID "${expectedDatabase}". No writes were performed.`);
}

function senderEmail(from: string) {
  return from.match(/<(.+)>/)?.[1] ?? from;
}

function senderName(from: string) {
  return (from.match(/^(.+?)\s*<(.+)>$/)?.[1] ?? from).replace(/^"|"$/g, '').trim() || from;
}

function readableFixtureText(fixture: Fixture) {
  const normalized = fixture.bodyType === 'text/html'
    ? normalizeEmailBody({htmlText: fixture.body})
    : normalizeEmailBody({plainText: fixture.body});
  return [`Subject: ${fixture.subject}`, normalized.readableContent].filter(Boolean).join('\n\n').trim();
}

async function cleanup() {
  const messages = await pool.query("SELECT id, case_id FROM messages WHERE raw_payload->>'p6bRunId' = $1", [runId]);
  const messageIds = messages.rows.map((row) => String(row.id));
  const caseIds = Array.from(new Set(messages.rows.map((row) => row.case_id).filter(Boolean).map(String)));
  if (messageIds.length > 0) {
    await pool.query('DELETE FROM ai_review_history WHERE message_id = ANY($1::text[])', [messageIds]);
    await pool.query('DELETE FROM ai_review_items WHERE message_id = ANY($1::text[])', [messageIds]);
    await pool.query('DELETE FROM ai_extractions WHERE message_id = ANY($1::text[])', [messageIds]);
  }
  if (caseIds.length > 0) {
    await pool.query('DELETE FROM alerts WHERE case_id = ANY($1::text[])', [caseIds]);
  }
  await pool.query("DELETE FROM gmail_skipped_messages WHERE gmail_message_id LIKE 'mock-e%' OR gmail_message_id LIKE 'mock-p6b-%'");
  if (messageIds.length > 0) await pool.query('DELETE FROM messages WHERE id = ANY($1::text[])', [messageIds]);
  if (caseIds.length > 0) await pool.query('DELETE FROM cases WHERE id = ANY($1::text[])', [caseIds]);
  await pool.query("DELETE FROM customers WHERE contact_handle LIKE '%@example.test' AND NOT EXISTS (SELECT 1 FROM cases WHERE cases.customer_id = customers.id)");
}

async function importBusinessFixture(fixture: Fixture) {
  return importMessage({
    platform: 'Gmail',
    senderId: senderEmail(fixture.from),
    senderName: senderName(fixture.from),
    text: readableFixtureText(fixture),
    threadId: fixture.threadId,
    rawPayload: {p6bRunId: runId, gmailMessageId: fixture.gmailMessageId, threadId: fixture.threadId, subject: fixture.subject, mockGmail: true},
  });
}

async function reimportSkippedFixture(fixture: Fixture) {
  const existing = await findMessageByGmailMessageId(fixture.gmailMessageId);
  if (existing) return {messageId: existing.id, caseId: existing.caseId ?? null, duplicate: true};
  const text = readableFixtureText(fixture);
  const existingThreadCaseId = await findLatestCaseIdByThreadId(fixture.threadId);
  const recovery = classifySkippedGmailRecovery(text, Boolean(existingThreadCaseId));
  if (recovery.shouldImportAsCase) {
    const result = await importBusinessFixture(fixture);
    return {messageId: result.message.id, caseId: result.case.id, duplicate: false};
  }
  const message = await createMessage({
    platform: 'Gmail',
    senderId: senderEmail(fixture.from),
    senderName: senderName(fixture.from),
    text,
    threadId: fixture.threadId,
    rawPayload: {p6bRunId: runId, gmailMessageId: fixture.gmailMessageId, threadId: fixture.threadId, subject: fixture.subject, mockGmail: true, classificationBucket: recovery.classificationBucket, reviewStatus: recovery.shouldCreateReviewMessage ? 'pending' : 'none'},
  });
  return {messageId: message.id, caseId: null, duplicate: false};
}

async function countRows(table: string, where: string, params: unknown[]) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE ${where}`, params);
  return Number(result.rows[0]?.count ?? 0);
}

function scenario(id: string, title: string, fn: (assert: (condition: unknown, check: string) => void) => Promise<void>): Promise<ScenarioResult> {
  let assertions = 0;
  const checks: string[] = [];
  const assert = (condition: unknown, check: string) => {
    assertions += 1;
    if (!condition) throw new Error(check);
    checks.push(check);
  };
  return fn(assert)
    .then(() => ({id, title, status: 'PASS' as const, assertions, checks}))
    .catch((error) => ({id, title, status: 'FAIL' as const, assertions, checks, error: error instanceof Error ? error.message : String(error)}));
}

async function main() {
  await assertTestDatabaseGuard();
  const fixtures = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture[];
  const byId = Object.fromEntries(fixtures.map((fixture) => [fixture.id, fixture]));
  await cleanup();

  const results: ScenarioResult[] = [];

  results.push(await scenario('E01', byId.E01.title, async (assert) => {
    const result = await importBusinessFixture(byId.E01);
    const dbMessage = await pool.query("SELECT case_id, raw_payload FROM messages WHERE id = $1", [result.message.id]);
    assert(Boolean(result.case.id), 'created a case for business invite');
    assert(dbMessage.rows[0]?.case_id === result.case.id, 'message links to created case');
    assert(dbMessage.rows[0]?.raw_payload?.gmailMessageId === byId.E01.gmailMessageId, 'raw payload preserves Gmail message id');
    assert(result.case.projectItem !== '待釐清需求', 'extraction produced project item');
  }));

  results.push(await scenario('E02', byId.E02.title, async (assert) => {
    const recovery = classifySkippedGmailRecovery(readableFixtureText(byId.E02), false);
    await upsertGmailSkippedMessage({gmailMessageId: byId.E02.gmailMessageId, gmailThreadId: byId.E02.threadId, connectionScope: 'mock', sender: byId.E02.from, subject: byId.E02.subject, snippet: byId.E02.body, category: 'verification_code', reason: '驗證碼或安全通知，不建立案件', source: 'gmail_triage'});
    assert(recovery.classificationBucket === 'NON_CASE', 'classified as NON_CASE');
    assert(await countRows('messages', "raw_payload->>'gmailMessageId' = $1", [byId.E02.gmailMessageId]) === 0, 'did not create message');
    assert(await countRows('cases', "summary LIKE '%verification code%'", []) === 0, 'did not create business case');
    assert(await countRows('gmail_skipped_messages', 'gmail_message_id = $1', [byId.E02.gmailMessageId]) === 1, 'persisted skipped metadata');
  }));

  results.push(await scenario('E03', byId.E03.title, async (assert) => {
    const businessFixture = {...byId.E03, gmailMessageId: 'mock-p6b-e03-case', threadId: 'mock-thread-e03-case', subject: '包裝設計報價', body: '想詢問包裝設計報價，預算 30000，月底前完成。'};
    const nonCaseFixture = {...byId.E03, threadId: 'mock-thread-e03-noncase'};
    const caseImport = await reimportSkippedFixture(businessFixture);
    const nonCaseImport = await reimportSkippedFixture(nonCaseFixture);
    const uncertainFixture = {...byId.E03, gmailMessageId: 'mock-p6b-e03-uncertain', threadId: 'mock-thread-e03-uncertain', subject: '收到', body: '收到，謝謝。'};
    const uncertainImport = await reimportSkippedFixture(uncertainFixture);
    const duplicate = await reimportSkippedFixture(uncertainFixture);
    const uncertainMessage = await pool.query("SELECT case_id, raw_payload FROM messages WHERE id = $1", [uncertainImport.messageId]);
    assert(Boolean(caseImport.caseId), 'CASE_RELATED re-import creates case');
    assert(!nonCaseImport.caseId, 'NON_CASE re-import does not create case');
    assert(!uncertainImport.caseId, 'UNCERTAIN re-import does not create case');
    assert(uncertainMessage.rows[0]?.raw_payload?.reviewStatus === 'pending', 'UNCERTAIN message is pending review');
    assert(duplicate.messageId === uncertainImport.messageId && duplicate.duplicate, 'repeated re-import is idempotent');
  }));

  results.push(await scenario('E04', byId.E04.title, async (assert) => {
    const excluded = await createMessage({platform: 'Gmail', senderId: senderEmail(byId.E04.from), senderName: senderName(byId.E04.from), text: '單封排除測試', threadId: 'mock-thread-e04-excluded', rawPayload: {p6bRunId: runId, gmailMessageId: 'mock-e04-excluded'}});
    await pool.query("UPDATE messages SET excluded_at = now(), excluded_reason = 'single message only', exclusion_source = 'manual_message' WHERE id = $1", [excluded.id]);
    const ruleCount = await countRows('message_exclusion_rules', 'match_value = $1 AND is_active = true', [senderEmail(byId.E04.from)]);
    const result = await importBusinessFixture(byId.E04);
    assert(ruleCount === 0, 'single-message exclusion did not create sender rule');
    assert(Boolean(result.case.id), 'same sender business message still creates case');
    assert(result.message.senderId === senderEmail(byId.E04.from), 'sender identity preserved');
  }));

  results.push(await scenario('E05', byId.E05.title, async (assert) => {
    const initial = await importBusinessFixture({...byId.E05, gmailMessageId: 'mock-e05-initial', subject: 'Logo 設計報價', body: '想詢問 Logo 設計報價，預算 20000，9/10 前交初稿。'});
    const followUp = await importBusinessFixture(byId.E05);
    const extraction = await pool.query('SELECT changed_fields, field_sources, cleared_fields, conflicting_fields, needs_human_review FROM ai_extractions WHERE message_id = $1', [followUp.message.id]);
    assert(followUp.case.id === initial.case.id, 'follow-up message reuses existing thread case');
    assert(extraction.rows[0]?.changed_fields && Object.keys(extraction.rows[0].changed_fields).length > 0, 'changedFields persisted with field changes');
    assert(extraction.rows[0]?.field_sources && typeof extraction.rows[0].field_sources === 'object', 'fieldSources persisted');
    assert(Array.isArray(extraction.rows[0]?.conflicting_fields) && extraction.rows[0].conflicting_fields.length > 0, 'conflictingFields persisted with conflicts');
    assert(extraction.rows[0]?.needs_human_review === true, 'human review state persisted for conflicting thread update');
  }));

  results.push(await scenario('E06', byId.E06.title, async (assert) => {
    const htmlText = readableFixtureText(byId.E06);
    const multipartText = [`Subject: ${byId.E06.subject}`, normalizeEmailBody({plainText: '您好\n想詢問包裝設計報價 & 預算 30000', htmlText: byId.E06.body}).readableContent].join('\n\n');
    const htmlImport = await importMessage({platform: 'Gmail', senderId: senderEmail(byId.E06.from), senderName: senderName(byId.E06.from), text: htmlText, threadId: byId.E06.threadId, rawPayload: {p6bRunId: runId, gmailMessageId: byId.E06.gmailMessageId, subject: byId.E06.subject}});
    const multipartImport = await importMessage({platform: 'Gmail', senderId: 'multipart@example.test', senderName: 'Multipart Client', text: multipartText, threadId: 'mock-thread-e06-multipart', rawPayload: {p6bRunId: runId, gmailMessageId: 'mock-e06-multipart', subject: byId.E06.subject}});
    const summaries = await pool.query('SELECT c.summary AS case_summary, m.text AS message_text, a.summary AS extraction_summary FROM messages m JOIN cases c ON c.id = m.case_id JOIN ai_extractions a ON a.message_id = m.id WHERE m.id = ANY($1::text[])', [[htmlImport.message.id, multipartImport.message.id]]);
    const combined = summaries.rows.map((row) => `${row.case_summary}\n${row.message_text}\n${row.extraction_summary}`).join('\n');
    assert(!/<\/?(?:br|pre|b|font|html|body)\b/i.test(combined), 'message and summaries contain no visible HTML tags');
    assert(combined.includes('包裝設計'), 'reading order preserves core content');
    assert(summaries.rowCount === 2, 'HTML-only and multipart messages persisted');
  }));

  results.push(await scenario('E07', byId.E07.title, async (assert) => {
    const skipped = await upsertGmailSkippedMessage({gmailMessageId: byId.E07.gmailMessageId, gmailThreadId: byId.E07.threadId, connectionScope: 'mock', sender: byId.E07.from, subject: byId.E07.subject, snippet: byId.E07.body, category: 'mock_error', reason: 'mock setup', source: 'mock_gmail'});
    await markGmailSkippedMessageError(skipped.id, 'Mock Gmail API authorization failed');
    assert(await countRows('messages', "raw_payload->>'gmailMessageId' = $1", [byId.E07.gmailMessageId]) === 0, 'API failure did not create message');
    assert(await countRows('cases', "summary LIKE '%API failure fixture%'", []) === 0, 'API failure did not create case');
    assert(await countRows('gmail_skipped_messages', 'gmail_message_id = $1 AND last_error IS NOT NULL', [byId.E07.gmailMessageId]) === 1, 'API failure is traceable');
  }));

  results.push(await scenario('E08', byId.E08.title, async (assert) => {
    const first = await reimportSkippedFixture(byId.E08);
    const second = await reimportSkippedFixture(byId.E08);
    if (first.messageId) await markGmailSkippedMessageRestored((await upsertGmailSkippedMessage({gmailMessageId: byId.E08.gmailMessageId, gmailThreadId: byId.E08.threadId, connectionScope: 'mock', sender: byId.E08.from, subject: byId.E08.subject, snippet: byId.E08.body, category: 'case_candidate', reason: 'mock idempotency', source: 'mock_gmail'})).id, first.messageId);
    assert(first.messageId === second.messageId, 'repeated re-import returns same message');
    assert(await countRows('messages', "raw_payload->>'gmailMessageId' = $1", [byId.E08.gmailMessageId]) === 1, 'only one message for Gmail id');
    assert(await countRows('messages', "raw_payload->>'gmailMessageId' = $1 AND case_id IS NOT NULL", [byId.E08.gmailMessageId]) === 1, 'only one case-linked message for Gmail id');
    assert(await countRows('gmail_skipped_messages', 'gmail_message_id = $1', [byId.E08.gmailMessageId]) === 1, 'only one skipped record for Gmail id');
  }));

  const ok = results.every((result) => result.status === 'PASS');
  console.log(JSON.stringify({ok, runId, mode: 'mock-e2e', results}, null, 2));
  await cleanup();
  if (!ok) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await cleanup().catch(() => undefined);
  await pool.end();
});
