import {randomUUID} from 'node:crypto';
import type {MessageEvent, MessageReplyStatusHistoryItem, Platform, ReplyStatus, ReplyStatusSource} from '@casebee/shared';
import {pool} from '../db/pool.js';
import {upsertSenderEmailExclusionRule} from './messageExclusionRulesRepository.js';
import {mapMessage} from './mappers.js';

export async function findAllMessages(): Promise<MessageEvent[]> {
  const result = await pool.query(
    `SELECT messages.*,
            CASE WHEN EXISTS (SELECT 1 FROM ai_review_items WHERE ai_review_items.message_id = messages.id AND ai_review_items.status = 'pending') THEN 'pending'
                 WHEN EXISTS (SELECT 1 FROM ai_review_items WHERE ai_review_items.message_id = messages.id) THEN 'resolved'
                 ELSE 'none'
            END AS review_status,
            EXISTS (SELECT 1 FROM ai_review_items WHERE ai_review_items.message_id = messages.id AND ai_review_items.status = 'pending') AS needs_human_review
     FROM messages
     WHERE excluded_at IS NULL
     ORDER BY timestamp DESC, created_at DESC`,
  );
  return result.rows.map(mapMessage);
}

export async function findMessageById(messageId: string): Promise<MessageEvent | null> {
  const result = await pool.query('SELECT * FROM messages WHERE id = $1 AND excluded_at IS NULL LIMIT 1', [messageId]);
  return result.rows[0] ? mapMessage(result.rows[0]) : null;
}

export async function findLatestMessageByCaseId(caseId: string): Promise<MessageEvent | null> {
  const result = await pool.query('SELECT * FROM messages WHERE case_id = $1 AND excluded_at IS NULL ORDER BY timestamp DESC, created_at DESC LIMIT 1', [caseId]);
  return result.rows[0] ? mapMessage(result.rows[0]) : null;
}

export async function findMessageByGmailMessageId(gmailMessageId: string): Promise<MessageEvent | null> {
  const result = await pool.query("SELECT * FROM messages WHERE platform = 'Gmail' AND raw_payload->>'gmailMessageId' = $1 LIMIT 1", [gmailMessageId]);
  return result.rows[0] ? mapMessage(result.rows[0]) : null;
}

export async function findMessageByDemoMessageId(demoMessageId: string): Promise<MessageEvent | null> {
  const result = await pool.query("SELECT * FROM messages WHERE raw_payload->>'demoMessageId' = $1 LIMIT 1", [demoMessageId]);
  return result.rows[0] ? mapMessage(result.rows[0]) : null;
}

export async function findMessagesByThreadId(threadId: string): Promise<MessageEvent[]> {
  const result = await pool.query('SELECT * FROM messages WHERE thread_id = $1 AND excluded_at IS NULL ORDER BY timestamp ASC, created_at ASC', [threadId]);
  return result.rows.map(mapMessage);
}

export async function findLatestCaseIdByThreadId(threadId: string): Promise<string | null> {
  const result = await pool.query(
    `SELECT messages.case_id
     FROM messages
     INNER JOIN cases ON cases.id = messages.case_id
     WHERE messages.thread_id = $1
       AND messages.excluded_at IS NULL
       AND cases.excluded_at IS NULL
       AND cases.status NOT IN ('已完成', '已流失')
     ORDER BY messages.timestamp DESC, messages.created_at DESC
     LIMIT 1`,
    [threadId],
  );
  return result.rows[0]?.case_id ? String(result.rows[0].case_id) : null;
}

export async function createMessage(input: {platform: Platform; senderId: string; senderName: string; text: string; timestamp?: string; threadId?: string; caseId?: string; rawPayload?: unknown}): Promise<MessageEvent> {
  const result = await pool.query(
    `INSERT INTO messages (id, platform, sender_id, sender_name, text, timestamp, thread_id, case_id, raw_payload)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
     RETURNING *`,
    [
      `msg-${randomUUID()}`,
      input.platform,
      input.senderId,
      input.senderName,
      input.text,
      input.timestamp ?? new Date().toISOString(),
      input.threadId ?? `thread-${randomUUID()}`,
      input.caseId ?? null,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
    ],
  );

  return mapMessage(result.rows[0]);
}

export async function attachMessageToCase(messageId: string, caseId: string): Promise<MessageEvent> {
  const result = await pool.query('UPDATE messages SET case_id = $2 WHERE id = $1 RETURNING *', [messageId, caseId]);
  return mapMessage(result.rows[0]);
}

export async function setReplyStatus(messageId: string, replyStatus: ReplyStatus, source: ReplyStatusSource): Promise<MessageEvent | null> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query('SELECT * FROM messages WHERE id = $1 AND excluded_at IS NULL FOR UPDATE', [messageId]);
    const row = current.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    if (row.reply_status === replyStatus) {
      await client.query('COMMIT');
      return mapMessage(row);
    }

    const result = await client.query(
      `UPDATE messages
       SET reply_status = $2,
           reply_status_source = $3,
           reply_status_updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [messageId, replyStatus, source],
    );
    await client.query(
      `INSERT INTO message_reply_status_history (id, message_id, previous_status, new_status, source)
       VALUES ($1, $2, $3, $4, $5)`,
      [`reply-history-${randomUUID()}`, messageId, row.reply_status, replyStatus, source],
    );
    await client.query('COMMIT');
    return mapMessage(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setSystemPendingReplyIfUnset(messageId: string): Promise<MessageEvent | null> {
  const current = await findMessageById(messageId);
  if (!current) return null;
  if (current.replyStatusSource !== 'system' || current.replyStatus !== 'no_reply_needed') {
    return current;
  }
  return setReplyStatus(messageId, 'pending_reply', 'system');
}

function mapReplyStatusHistory(row: Record<string, unknown>): MessageReplyStatusHistoryItem {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    previousStatus: row.previous_status ? row.previous_status as ReplyStatus : null,
    newStatus: row.new_status as ReplyStatus,
    source: row.source as ReplyStatusSource,
    changedAt: new Date(String(row.changed_at)).toISOString(),
  };
}

export async function findReplyStatusHistoryByMessageId(messageId: string): Promise<MessageReplyStatusHistoryItem[]> {
  const result = await pool.query('SELECT * FROM message_reply_status_history WHERE message_id = $1 ORDER BY changed_at DESC, id DESC', [messageId]);
  return result.rows.map(mapReplyStatusHistory);
}

export async function excludeMessage(messageId: string, reason: string) {
  const message = await pool.query('UPDATE messages SET excluded_at = COALESCE(excluded_at, now()), excluded_reason = $2 WHERE id = $1 RETURNING *', [messageId, reason]);
  if (!message.rows[0]) {
    return null;
  }

  const caseId = message.rows[0].case_id ? String(message.rows[0].case_id) : null;
  let excludedCaseId: string | null = null;
  let learnedRule = null;

  if (message.rows[0].platform === 'Gmail') {
    learnedRule = await upsertSenderEmailExclusionRule({
      platform: 'Gmail',
      senderEmail: String(message.rows[0].sender_id),
      reason,
      sourceMessageId: String(message.rows[0].id),
    });
  }

  if (caseId) {
    const activeMessages = await pool.query('SELECT COUNT(*)::int AS count FROM messages WHERE case_id = $1 AND excluded_at IS NULL', [caseId]);
    if (Number(activeMessages.rows[0]?.count ?? 0) === 0) {
      const updatedCase = await pool.query(
        'UPDATE cases SET excluded_at = COALESCE(excluded_at, now()), excluded_reason = $2, updated_at = now() WHERE id = $1 RETURNING id',
        [caseId, reason],
      );
      excludedCaseId = updatedCase.rows[0]?.id ? String(updatedCase.rows[0].id) : null;
    }
  }

  return {message: mapMessage(message.rows[0]), excludedCaseId, learnedRule};
}
