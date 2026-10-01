import {Buffer} from 'node:buffer';
import {google} from 'googleapis';
import {findSenderEmailExclusionRule} from '../repositories/messageExclusionRulesRepository.js';
import {findMessageByGmailMessageId} from '../repositories/messagesRepository.js';
import {getPlatformConnection, markPlatformSynced, upsertPlatformConnection} from '../repositories/platformConnectionsRepository.js';
import {inferCustomerName} from './customerNameInference.js';
import {importMessage} from './messageImportService.js';

const gmailScopes = ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/userinfo.email'];

type GmailTriageCategory = 'case_candidate' | 'learned_exclusion' | 'calendar_invite' | 'verification_code' | 'newsletter' | 'automated_notification' | 'announcement';

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

function extractPlainText(payload?: {body?: {data?: string | null}; parts?: Array<{mimeType?: string | null; body?: {data?: string | null}; parts?: unknown[]}>}): string {
  if (!payload) {
    return '';
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  for (const part of payload.parts ?? []) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
  }
  for (const part of payload.parts ?? []) {
    const nested: string = extractPlainText(part as Parameters<typeof extractPlainText>[0]);
    if (nested) {
      return nested;
    }
  }
  return '';
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

export async function pollGmailMessages() {
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

  const gmail = google.gmail({version: 'v1', auth: oauth2Client});
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
      const text = [subject ? `Subject: ${subject}` : '', extractPlainText(message.data.payload)].filter(Boolean).join('\n\n').trim();

      if (!text) {
        emptyCount += 1;
        continue;
      }

      const learnedRule = await findSenderEmailExclusionRule('Gmail', senderEmail);
      if (learnedRule) {
        skipped.push({gmailMessageId: item.id, category: 'learned_exclusion', reason: `符合使用者排除規則：${learnedRule.reason}`});
        continue;
      }

      const triage = triageGmailMessage({from, subject, text});
      if (!triage.shouldImport) {
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
          rawPayload: {gmailMessageId: item.id, threadId: message.data.threadId ?? null, subject, originalSenderName: parseSenderName(from)},
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
