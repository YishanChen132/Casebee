import {writeFile} from 'node:fs/promises';
import {pool} from '../db/pool.js';
import {normalizeEmailBody} from '../services/emailBodyNormalizer.js';

const targetCodes = ['#CB-909255', '#CB-907527'];

function cleanSummary(value: string, customerName: string) {
  const normalized = normalizeEmailBody({plainText: value}).readableContent;
  return (normalized || value).replace(/^的訊息判斷為/, `${customerName} 的訊息判斷為`);
}

function needsHumanReview(before: string, after: string) {
  return /<[^>]*$|<[^>]*\.\.\.|<[^>]+>/.test(before) || /[「『（(]$/.test(after.trim());
}

async function main() {
  const rows = await pool.query(
    `SELECT c.id AS case_id, c.code, c.title, c.customer_name, c.summary AS case_summary,
            m.id AS message_id, m.text AS message_text,
            a.id AS extraction_id, a.summary AS extraction_summary
     FROM cases c
     LEFT JOIN messages m ON m.case_id = c.id
     LEFT JOIN ai_extractions a ON a.message_id = m.id
     WHERE c.code = ANY($1::text[])
     ORDER BY c.code, m.created_at, a.created_at`,
    [targetCodes],
  );

  const changes = rows.rows.map((row) => {
    const customerName = String(row.customer_name ?? row.title ?? '未命名客戶');
    const beforeMessageText = String(row.message_text ?? '');
    const beforeCaseSummary = String(row.case_summary ?? '');
    const beforeExtractionSummary = String(row.extraction_summary ?? '');
    const normalizedMessage = normalizeEmailBody({plainText: beforeMessageText}).readableContent || beforeMessageText;
    const normalizedCaseSummary = cleanSummary(beforeCaseSummary, customerName);
    const normalizedExtractionSummary = cleanSummary(beforeExtractionSummary, customerName);
    return {
      code: String(row.code),
      caseId: String(row.case_id),
      messageId: row.message_id ? String(row.message_id) : null,
      extractionId: row.extraction_id ? String(row.extraction_id) : null,
      before: {
        messageText: beforeMessageText,
        caseSummary: beforeCaseSummary,
        extractionSummary: beforeExtractionSummary,
      },
      after: {
        messageText: normalizedMessage,
        caseSummary: normalizedCaseSummary,
        extractionSummary: normalizedExtractionSummary,
      },
      needsHumanReview:
        (normalizedMessage === beforeMessageText && /<[^>]+>/.test(beforeMessageText)) ||
        needsHumanReview(beforeCaseSummary, normalizedCaseSummary) ||
        needsHumanReview(beforeExtractionSummary, normalizedExtractionSummary),
      rollbackSql: {
        messages: row.message_id ? 'UPDATE messages SET text = $1 WHERE id = $2;' : null,
        cases: 'UPDATE cases SET summary = $1 WHERE id = $2;',
        aiExtractions: row.extraction_id ? 'UPDATE ai_extractions SET summary = $1 WHERE id = $2;' : null,
      },
    };
  });

  const report = {mode: 'dry-run', appliesChanges: false, targetCodes, generatedAt: new Date().toISOString(), changes};
  const reportPath = `p6a-html-content-repair-dry-run-${Date.now()}.json`;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await pool.end();
  console.log(JSON.stringify({ok: true, mode: 'dry-run', reportPath, rows: changes.length, targetCodes}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
