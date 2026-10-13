import {randomUUID} from 'node:crypto';
import type {GmailSkippedMessage} from '@casebee/shared';
import {pool} from '../db/pool.js';

function mapSkipped(row: Record<string, unknown>): GmailSkippedMessage {
  return {
    id: String(row.id),
    gmailMessageId: String(row.gmail_message_id),
    gmailThreadId: row.gmail_thread_id ? String(row.gmail_thread_id) : null,
    connectionScope: row.connection_scope ? String(row.connection_scope) : null,
    sender: String(row.sender ?? ''),
    subject: String(row.subject ?? ''),
    snippet: String(row.snippet ?? ''),
    category: String(row.category),
    reason: String(row.reason),
    source: String(row.source),
    skippedAt: new Date(String(row.skipped_at)).toISOString(),
    lastRetryAt: row.last_retry_at ? new Date(String(row.last_retry_at)).toISOString() : null,
    restoredAt: row.restored_at ? new Date(String(row.restored_at)).toISOString() : null,
    restoredMessageId: row.restored_message_id ? String(row.restored_message_id) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function upsertGmailSkippedMessage(input: {
  gmailMessageId: string;
  gmailThreadId?: string | null;
  connectionScope?: string | null;
  sender?: string;
  subject?: string;
  snippet?: string;
  category: string;
  reason: string;
  source: string;
}) {
  const result = await pool.query(
    `INSERT INTO gmail_skipped_messages (id, gmail_message_id, gmail_thread_id, connection_scope, sender, subject, snippet, category, reason, source, skipped_at, last_error, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), NULL, now())
     ON CONFLICT (gmail_message_id) DO UPDATE SET
       gmail_thread_id = EXCLUDED.gmail_thread_id,
       connection_scope = EXCLUDED.connection_scope,
       sender = EXCLUDED.sender,
       subject = EXCLUDED.subject,
       snippet = EXCLUDED.snippet,
       category = EXCLUDED.category,
       reason = EXCLUDED.reason,
       source = EXCLUDED.source,
       skipped_at = now(),
       last_error = NULL,
       updated_at = now()
     RETURNING *`,
    [`gmail-skip-${randomUUID()}`, input.gmailMessageId, input.gmailThreadId ?? null, input.connectionScope ?? null, input.sender ?? '', input.subject ?? '', input.snippet ?? '', input.category, input.reason, input.source],
  );
  return mapSkipped(result.rows[0]);
}

export async function findGmailSkippedMessages(status: 'pending' | 'restored' | 'all' = 'pending') {
  const where = status === 'pending' ? 'WHERE restored_at IS NULL' : status === 'restored' ? 'WHERE restored_at IS NOT NULL' : '';
  const result = await pool.query(`SELECT * FROM gmail_skipped_messages ${where} ORDER BY skipped_at DESC, updated_at DESC`);
  return result.rows.map(mapSkipped);
}

export async function findGmailSkippedMessageById(id: string) {
  const result = await pool.query('SELECT * FROM gmail_skipped_messages WHERE id = $1 LIMIT 1', [id]);
  return result.rows[0] ? mapSkipped(result.rows[0]) : null;
}

export async function markGmailSkippedMessageRetry(id: string) {
  const result = await pool.query('UPDATE gmail_skipped_messages SET last_retry_at = now(), last_error = NULL, updated_at = now() WHERE id = $1 RETURNING *', [id]);
  return result.rows[0] ? mapSkipped(result.rows[0]) : null;
}

export async function markGmailSkippedMessageRestored(id: string, restoredMessageId: string) {
  const result = await pool.query('UPDATE gmail_skipped_messages SET restored_at = COALESCE(restored_at, now()), restored_message_id = COALESCE(restored_message_id, $2), last_error = NULL, updated_at = now() WHERE id = $1 RETURNING *', [id, restoredMessageId]);
  return result.rows[0] ? mapSkipped(result.rows[0]) : null;
}

export async function markGmailSkippedMessageError(id: string, error: string) {
  const result = await pool.query('UPDATE gmail_skipped_messages SET last_retry_at = now(), last_error = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, error]);
  return result.rows[0] ? mapSkipped(result.rows[0]) : null;
}
