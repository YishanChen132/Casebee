import {Buffer} from 'node:buffer';
import {google} from 'googleapis';
import {findGmailSkippedMessageById, markGmailSkippedMessageError, markGmailSkippedMessageRestored, markGmailSkippedMessageRetry, upsertGmailSkippedMessage} from '../repositories/gmailSkippedMessagesRepository.js';
import {findSenderEmailExclusionRule} from '../repositories/messageExclusionRulesRepository.js';
import {createMessage, findLatestCaseIdByThreadId, findMessageByGmailMessageId} from '../repositories/messagesRepository.js';
import {getPlatformConnection, markPlatformSynced, upsertPlatformConnection} from '../repositories/platformConnectionsRepository.js';
import {inferCustomerName} from './customerNameInference.js';
import {normalizeEmailBody} from './emailBodyNormalizer.js';
import {preprocessEmail} from './emailPreprocessor.js';
import {importMessage} from './messageImportService.js';
import {classifyPreparedMessage, type MessageType} from './messageClassifier.js';

const gmailScopes = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

type GmailTriageCategory = 'case_candidate' | 'learned_exclusion' | 'calendar_invite' | 'verification_code' | 'newsletter' | 'automated_notification' | 'announcement';
type ClassificationBucket = 'NON_CASE' | 'CASE_RELATED' | 'UNCERTAIN';

const nonCaseTypes = new Set<MessageType>(['announcement', 'calendar_invite', 'newsletter', 'system_notification']);
const caseRelatedTypes = new Set<MessageType>(['collaboration_invite', 'quote_inquiry', 'revision_request', 'deadline_or_material_risk', 'confirmation_or_contract']);

function bucketFor(type: MessageType): ClassificationBucket {
  if (nonCaseTypes.has(type)) return 'NON_CASE';
  if (caseRelatedTypes.has(type)) return 'CASE_RELATED';
  return 'UNCERTAIN';
}

export function classifySkippedGmailRecovery(text: string, hasExistingThreadCase: boolean) {
  const prepared = preprocessEmail(text);
  const classification = classifyPreparedMessage(prepared);
  const classificationBucket = bucketFor(classification.type);
  return {
    classification,
    classificationBucket,
    shouldImportAsCase: hasExistingThreadCase || classificationBucket === 'CASE_RELATED',
    shouldCreateReviewMessage: !hasExistingThreadCase && classificationBucket === 'UNCERTAIN',
  };
}

interface GmailTriageResult {
  shouldImport: boolean;
  category: GmailTriageCategory;
  reason: string;
}

function getGmailConfigStatus() {
  return {
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/integrations/gmail/callback',
  };
}

function getGmailAutoPollStatus() {
  const intervalSeconds = Number(process.env.GMAIL_AUTO_POLL_INTERVAL_SECONDS ?? 60);
  return {
    autoPollEnabled: (process.env.GMAIL_AUTO_POLL_ENABLED ?? 'true').toLowerCase() !== 'false',
    autoPollIntervalSeconds: Number.isFinite(intervalSeconds) && intervalSeconds >= 30 ? intervalSeconds : 60,
  };
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/integrations/gmail/callback';

  if (!clientId || !clientSecret) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are required');
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
}

function decodeBase64Url(data?: string | null) {
  if (!data) {
    return '';
  }
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

type GmailPayloadPart = {mimeType?: string | null; body?: {data?: string | null}; parts?: GmailPayloadPart[]};

function collectBodyParts(payload?: GmailPayloadPart): {plainText: string[]; htmlText: string[]} {
  const collected = {plainText: [] as string[], htmlText: [] as string[]};
  if (!payload) {
    return collected;
  }
  const mimeType = payload.mimeType?.toLowerCase() ?? '';
  if (payload.body?.data) {
    const decoded = decodeBase64Url(payload.body.data);
    if (mimeType === 'text/plain') collected.plainText.push(decoded);
    else if (mimeType === 'text/html') collected.htmlText.push(decoded);
    else if (!payload.parts?.length) collected.plainText.push(decoded);
  }
  for (const part of payload.parts ?? []) {
    const nested = collectBodyParts(part);
    collected.plainText.push(...nested.plainText);
    collected.htmlText.push(...nested.htmlText);
  }
  return collected;
}

export function extractGmailBodyText(payload?: GmailPayloadPart) {
  const parts = collectBodyParts(payload);
  return normalizeEmailBody({plainText: parts.plainText.join('\n\n'), htmlText: parts.htmlText.join('\n\n')});
}

function headerValue(headers: Array<{name?: string | null; value?: string | null}> | undefined, name: string) {
  return headers?.find((header) => header.name?.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function parseSenderName(from: string) {
  const match = from.match(/^(.+?)\s*<(.+)>$/);
  return (match?.[1] ?? from).replace(/^"|"$/g, '').trim() || from;
}

function parseSenderEmail(from: string) {
  return from.match(/<(.+)>/)?.[1] ?? from;
}

function snippetFromText(text: string) {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function includesAny(text: string, keywords: string[]) {
  return keywords.some((keyword) => text.includes(keyword));
}

function triageGmailMessage(input: {from: string; subject: string; text: string}): GmailTriageResult {
  const senderEmail = parseSenderEmail(input.from).toLowerCase();
  const senderName = parseSenderName(input.from).toLowerCase();
  const subject = input.subject.toLowerCase();
  const text = input.text.toLowerCase();
  const combined = `${senderEmail} ${senderName} ${subject} ${text}`;

  if (/(驗證碼|verification code|security code|one-time|otp|密碼重設|登入代碼|認證碼|two-factor|2fa|authentication)/i.test(combined)) {
    return {shouldImport: false, category: 'verification_code', reason: '驗證碼或安全通知，不建立案件'};
  }

  if (/(訂單|出貨|配送|收件資料|會員中心|付款完成|交易明細|發票|物流|tracking number|order confirmation)/i.test(combined)) {
    return {shouldImport: false, category: 'automated_notification', reason: '訂單或交易通知，不建立案件'};
  }

  if (/(推薦信|申請資料|申請文件|補件|教務處|招生|研究所申請|入學申請|admission|application portal)/i.test(combined)) {
    return {shouldImport: false, category: 'announcement', reason: '學校申請或行政通知，不建立案件'};
  }

  if (senderEmail.includes('calendar-notification@google.com') || includesAny(combined, ['google calendar', 'google 日曆', '邀請：', 'invitation to', 'calendar event'])) {
    return {shouldImport: false, category: 'calendar_invite', reason: '行事曆邀請或會議通知，不建立案件'};
  }

  if (/(^|[<\s])(no-?reply|do-?not-?reply|noreply|notification|mailer-daemon|postmaster)@/i.test(input.from)) {
    return {shouldImport: false, category: 'automated_notification', reason: '系統自動通知，不建立案件'};
  }

  if (includesAny(combined, ['unsubscribe', '取消訂閱', 'newsletter', '電子報', 'edm']) || senderEmail.includes('bhuntr.com')) {
    return {shouldImport: false, category: 'newsletter', reason: '電子報或行銷郵件，不建立案件'};
  }

  if (includesAny(combined, ['競賽', '徵件', '報名', '入圍', '公告', '活動通知', '賽務', '獎金獵人'])) {
    return {shouldImport: false, category: 'announcement', reason: '活動公告或賽務通知，不建立案件'};
  }

  return {shouldImport: true, category: 'case_candidate', reason: '可能是客戶或案件相關訊息'};
}

export function createGmailAuthUrl() {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: gmailScopes,
  });
}

export async function handleGmailCallback(code: string) {
  const oauth2Client = getOAuthClient();
  const {tokens} = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokens);

  const oauth2 = google.oauth2({auth: oauth2Client, version: 'v2'});
  const profile = await oauth2.userinfo.get();

  return upsertPlatformConnection({
    platform: 'Gmail',
    accountEmail: profile.data.email ?? null,
    accessToken: tokens.access_token ?? null,
    refreshToken: tokens.refresh_token ?? null,
    scope: tokens.scope ?? null,
    tokenType: tokens.token_type ?? null,
    expiryDate: tokens.expiry_date ?? null,
  });
}

export async function getGmailStatus() {
  const connection = await getPlatformConnection('Gmail');
  const config = getGmailConfigStatus();
  const autoPoll = getGmailAutoPollStatus();
  return {
    configured: config.configured,
    connected: Boolean(connection?.refreshToken || connection?.accessToken),
    accountEmail: connection?.accountEmail ?? null,
    lastSyncedAt: connection?.lastSyncedAt ?? null,
    redirectUri: config.redirectUri,
    ...autoPoll,
  };
}

async function getAuthorizedGmailContext() {
  const connection = await getPlatformConnection('Gmail');
  const config = getGmailConfigStatus();
  if (!config.configured) {
    throw new Error('Gmail OAuth environment variables are not configured');
  }
  if (!connection?.refreshToken && !connection?.accessToken) {
    throw new Error('Gmail is not connected');
  }

  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: connection.accessToken ?? undefined,
    refresh_token: connection.refreshToken ?? undefined,
    expiry_date: connection.expiryDate ?? undefined,
  });

  return {gmail: google.gmail({version: 'v1', auth: oauth2Client}), connection};
}

async function persistSkipped(input: {gmailMessageId: string; gmailThreadId?: string | null; connectionScope?: string | null; sender?: string; subject?: string; snippet?: string; category: string; reason: string; source: string}) {
  await upsertGmailSkippedMessage(input);
}

async function importFetchedGmailMessage(input: {gmailMessageId: string; overrideExclusion?: boolean}) {
  const {gmail, connection} = await getAuthorizedGmailContext();
  const existingMessage = await findMessageByGmailMessageId(input.gmailMessageId);
  if (existingMessage) {
    return {result: null, existingMessage};
  }

  const message = await gmail.users.messages.get({userId: 'me', id: input.gmailMessageId, format: 'full'});
  const headers = message.data.payload?.headers ?? [];
  const from = headerValue(headers, 'from') || 'Unknown Sender';
  const subject = headerValue(headers, 'subject');
  const senderEmail = parseSenderEmail(from);
  const body = extractGmailBodyText(message.data.payload as GmailPayloadPart | undefined);
  const text = [subject ? `Subject: ${subject}` : '', body.readableContent].filter(Boolean).join('\n\n').trim();

  if (!text) {
    throw new Error('Gmail message has no readable content');
  }

  const existingThreadCaseId = message.data.threadId ? await findLatestCaseIdByThreadId(message.data.threadId) : null;
  const recovery = classifySkippedGmailRecovery(text, Boolean(existingThreadCaseId));
  const {classification, classificationBucket} = recovery;

  if (!input.overrideExclusion) {
    const learnedRule = await findSenderEmailExclusionRule('Gmail', senderEmail);
    if (learnedRule) {
      await persistSkipped({gmailMessageId: input.gmailMessageId, gmailThreadId: message.data.threadId ?? null, connectionScope: connection.accountEmail, sender: from, subject, snippet: message.data.snippet ?? snippetFromText(text), category: 'learned_exclusion', reason: `符合使用者排除規則：${learnedRule.reason}`, source: 'sender_rule'});
      return {result: null, existingMessage: null};
    }

    const triage = triageGmailMessage({from, subject, text});
    if (!triage.shouldImport) {
      await persistSkipped({gmailMessageId: input.gmailMessageId, gmailThreadId: message.data.threadId ?? null, connectionScope: connection.accountEmail, sender: from, subject, snippet: message.data.snippet ?? snippetFromText(text), category: triage.category, reason: triage.reason, source: 'gmail_triage'});
      return {result: null, existingMessage: null};
    }
  }

  if (input.overrideExclusion && !recovery.shouldImportAsCase) {
    const restoredMessage = await createMessage({
      platform: 'Gmail',
      senderId: senderEmail,
      senderName: inferCustomerName({from, senderName: parseSenderName(from), senderEmail, subject, text}),
      text,
      timestamp: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : undefined,
      threadId: message.data.threadId ?? undefined,
      rawPayload: {
        gmailMessageId: input.gmailMessageId,
        threadId: message.data.threadId ?? null,
        subject,
        originalSenderName: parseSenderName(from),
        bodySource: body.source,
        bodyWasHtml: body.wasHtml,
        quoteRemoved: body.quoteRemoved,
        signatureDetected: body.signatureDetected,
        originalBody: body.original,
        normalizedText: body.text,
        readableContent: body.readableContent,
        quotedText: body.quotedText || null,
        signatureText: body.signatureText || null,
        exclusionOverride: 'user_requested_once',
        classificationType: classification.type,
        classificationBucket,
        classificationConfidence: classification.confidence,
        classificationReasons: classification.reasons,
        reviewStatus: classificationBucket === 'UNCERTAIN' ? 'pending' : 'none',
        reviewReason: classificationBucket === 'UNCERTAIN' ? '使用者恢復的 Gmail 分類為 UNCERTAIN，需人工確認是否建案。' : null,
      },
    });
    return {result: null, existingMessage: restoredMessage};
  }

  const result = await importMessage({
    platform: 'Gmail',
    senderId: senderEmail,
    senderName: inferCustomerName({from, senderName: parseSenderName(from), senderEmail, subject, text}),
    text,
    timestamp: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : undefined,
    threadId: message.data.threadId ?? undefined,
    rawPayload: {
      gmailMessageId: input.gmailMessageId,
      threadId: message.data.threadId ?? null,
      subject,
      originalSenderName: parseSenderName(from),
      bodySource: body.source,
      bodyWasHtml: body.wasHtml,
      quoteRemoved: body.quoteRemoved,
      signatureDetected: body.signatureDetected,
      originalBody: body.original,
      normalizedText: body.text,
      readableContent: body.readableContent,
      quotedText: body.quotedText || null,
      signatureText: body.signatureText || null,
      exclusionOverride: input.overrideExclusion ? 'user_requested_once' : null,
    },
  });
  return {result, existingMessage: null};
}

export async function pollGmailMessages() {
  const {gmail, connection} = await getAuthorizedGmailContext();
  const maxResults = Number(process.env.GMAIL_POLL_MAX_RESULTS ?? 10);
  const query = process.env.GMAIL_POLL_QUERY ?? 'newer_than:30d';
  const list = await gmail.users.messages.list({userId: 'me', maxResults: Number.isFinite(maxResults) ? maxResults : 10, q: query});
  const imported = [];
  const skipped: Array<{gmailMessageId: string; messageId?: string; category: string; reason: string}> = [];
  const failed: Array<{gmailMessageId: string; reason: string}> = [];
  let emptyCount = 0;

  for (const item of list.data.messages ?? []) {
    if (!item.id) {
      continue;
    }

    const existingMessage = await findMessageByGmailMessageId(item.id);
    if (existingMessage) {
      skipped.push({gmailMessageId: item.id, messageId: existingMessage.id, category: 'duplicate', reason: '已匯入過，略過重複 Gmail message id'});
      continue;
    }

    try {
      const message = await gmail.users.messages.get({userId: 'me', id: item.id, format: 'full'});
      const headers = message.data.payload?.headers ?? [];
      const from = headerValue(headers, 'from') || 'Unknown Sender';
      const subject = headerValue(headers, 'subject');
      const senderEmail = parseSenderEmail(from);
      const body = extractGmailBodyText(message.data.payload as GmailPayloadPart | undefined);
      const text = [subject ? `Subject: ${subject}` : '', body.readableContent].filter(Boolean).join('\n\n').trim();

      if (!text) {
        emptyCount += 1;
        continue;
      }

      const learnedRule = await findSenderEmailExclusionRule('Gmail', senderEmail);
      if (learnedRule) {
        await persistSkipped({gmailMessageId: item.id, gmailThreadId: message.data.threadId ?? null, connectionScope: connection.accountEmail, sender: from, subject, snippet: message.data.snippet ?? snippetFromText(text), category: 'learned_exclusion', reason: `符合使用者排除規則：${learnedRule.reason}`, source: 'sender_rule'});
        skipped.push({gmailMessageId: item.id, category: 'learned_exclusion', reason: `符合使用者排除規則：${learnedRule.reason}`});
        continue;
      }

      const triage = triageGmailMessage({from, subject, text});
      if (!triage.shouldImport) {
        await persistSkipped({gmailMessageId: item.id, gmailThreadId: message.data.threadId ?? null, connectionScope: connection.accountEmail, sender: from, subject, snippet: message.data.snippet ?? snippetFromText(text), category: triage.category, reason: triage.reason, source: 'gmail_triage'});
        skipped.push({gmailMessageId: item.id, category: triage.category, reason: triage.reason});
        continue;
      }

      imported.push(
        await importMessage({
          platform: 'Gmail',
          senderId: senderEmail,
          senderName: inferCustomerName({from, senderName: parseSenderName(from), senderEmail, subject, text}),
          text,
          timestamp: message.data.internalDate ? new Date(Number(message.data.internalDate)).toISOString() : undefined,
          threadId: message.data.threadId ?? undefined,
          rawPayload: {
            gmailMessageId: item.id,
            threadId: message.data.threadId ?? null,
            subject,
            originalSenderName: parseSenderName(from),
            bodySource: body.source,
            bodyWasHtml: body.wasHtml,
            quoteRemoved: body.quoteRemoved,
            signatureDetected: body.signatureDetected,
            originalBody: body.original,
            normalizedText: body.text,
            readableContent: body.readableContent,
            quotedText: body.quotedText || null,
            signatureText: body.signatureText || null,
          },
        }),
      );
    } catch (error) {
      failed.push({gmailMessageId: item.id, reason: error instanceof Error ? error.message : 'Failed to import Gmail message'});
    }
  }

  await markPlatformSynced('Gmail');
  return {
    checkedCount: list.data.messages?.length ?? 0,
    importedCount: imported.length,
    skippedCount: skipped.length,
    emptyCount,
    failedCount: failed.length,
    query,
    imported,
    skipped,
    failed,
  };
}

export async function importSkippedGmailMessage(skippedId: string) {
  const skipped = await findGmailSkippedMessageById(skippedId);
  if (!skipped) {
    return null;
  }
  if (skipped.restoredMessageId) {
    const existingMessage = await findMessageByGmailMessageId(skipped.gmailMessageId);
    return {skipped, result: null, existingMessage, alreadyRestored: true};
  }

  await markGmailSkippedMessageRetry(skipped.id);
  try {
    const imported = await importFetchedGmailMessage({gmailMessageId: skipped.gmailMessageId, overrideExclusion: true});
    const messageId = imported.result?.message.id ?? imported.existingMessage?.id;
    if (!messageId) {
      throw new Error('Gmail message was not imported and no duplicate message exists');
    }
    const restored = await markGmailSkippedMessageRestored(skipped.id, messageId);
    return {skipped: restored ?? skipped, result: imported.result, existingMessage: imported.existingMessage, alreadyRestored: Boolean(imported.existingMessage)};
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to re-import skipped Gmail message';
    await markGmailSkippedMessageError(skipped.id, message);
    throw new Error(message);
  }
}
