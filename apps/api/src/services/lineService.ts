import {createHmac, timingSafeEqual} from 'node:crypto';
import {importMessage} from './messageImportService.js';

interface LineTextMessage {
  type: 'message';
  replyToken: string;
  source: {type: string; userId?: string; groupId?: string; roomId?: string};
  timestamp: number;
  message: {type: string; id: string; text?: string};
  deliveryContext?: {isRedelivery?: boolean};
}

type LineEvent = LineTextMessage | {type: string; [key: string]: unknown};

export function isLineConfigured() {
  return Boolean(process.env.LINE_CHANNEL_SECRET);
}

export function verifyLineSignature(rawBody: Buffer, signature: string | undefined): boolean {
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  if (!channelSecret) {
    // No secret configured: skip verification so local/demo testing still works,
    // but this must never be the case in production.
    return true;
  }
  if (!signature) return false;

  const expected = createHmac('sha256', channelSecret).update(rawBody).digest('base64');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(signature, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

async function getLineDisplayName(userId: string): Promise<string> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return userId;

  try {
    const response = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
      headers: {Authorization: `Bearer ${accessToken}`},
    });
    if (!response.ok) return userId;
    const profile = (await response.json()) as {displayName?: string};
    return profile.displayName ?? userId;
  } catch {
    return userId;
  }
}

function isTextMessageEvent(event: LineEvent): event is LineTextMessage {
  return event.type === 'message' && (event as LineTextMessage).message?.type === 'text';
}

export async function handleLineWebhookEvents(events: LineEvent[]) {
  const results: Array<{eventId: string | null; status: 'imported' | 'skipped'; reason?: string}> = [];

  for (const event of events) {
    if (!isTextMessageEvent(event)) {
      results.push({eventId: null, status: 'skipped', reason: `unsupported event type: ${event.type}`});
      continue;
    }

    if (event.deliveryContext?.isRedelivery) {
      results.push({eventId: event.message.id, status: 'skipped', reason: 'redelivery'});
      continue;
    }

    const text = event.message.text?.trim();
    const userId = event.source.userId;
    if (!text || !userId) {
      results.push({eventId: event.message.id, status: 'skipped', reason: 'missing text or userId'});
      continue;
    }

    try {
      const senderName = await getLineDisplayName(userId);
      const imported = await importMessage({
        platform: 'LINE',
        senderId: userId,
        senderName,
        text,
        timestamp: new Date(event.timestamp).toISOString(),
        threadId: userId,
        rawPayload: {lineMessageId: event.message.id, replyToken: event.replyToken, sourceType: event.source.type},
      });
      results.push({eventId: event.message.id, status: 'imported'});
      void imported;
    } catch (error) {
      results.push({eventId: event.message.id, status: 'skipped', reason: error instanceof Error ? error.message : 'import failed'});
    }
  }

  return results;
}
