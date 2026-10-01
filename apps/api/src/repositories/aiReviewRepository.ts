import {randomUUID} from 'node:crypto';
import type {AiReviewHistoryItem, AiReviewItem, ThreadAwareField} from '@casebee/shared';
import {pool} from '../db/pool.js';

function jsonValue(value: unknown) {
  return value === undefined ? null : JSON.stringify(value);
}

function mapReviewItem(row: Record<string, unknown>): AiReviewItem {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    caseId: String(row.case_id),
    alertId: row.alert_id ? String(row.alert_id) : null,
    field: row.field as ThreadAwareField,
    existingValue: row.existing_value,
    suggestedValue: row.suggested_value,
    source: row.source as AiReviewItem['source'],
    isConflict: row.is_conflict === true,
    status: row.status as AiReviewItem['status'],
    resolvedAt: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

function mapHistory(row: Record<string, unknown>): AiReviewHistoryItem {
  return {
    id: String(row.id),
    reviewItemId: String(row.review_item_id),
    messageId: String(row.message_id),
    caseId: String(row.case_id),
    field: row.field as ThreadAwareField,
    action: row.action as AiReviewHistoryItem['action'],
    previousValue: row.previous_value,
    suggestedValue: row.suggested_value,
    finalValue: row.final_value,
    actor: String(row.actor),
    createdAt: new Date(String(row.created_at)).toISOString(),
  };
}

export async function createReviewItems(items: Array<{messageId: string; caseId: string; alertId?: string | null; field: ThreadAwareField; existingValue: unknown; suggestedValue: unknown; source: AiReviewItem['source']; isConflict: boolean}>): Promise<AiReviewItem[]> {
  const created: AiReviewItem[] = [];
  for (const item of items) {
    const result = await pool.query(
      `INSERT INTO ai_review_items (id, message_id, case_id, alert_id, field, existing_value, suggested_value, source, is_conflict, status)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, 'pending')
       RETURNING *`,
      [`review-${randomUUID()}`, item.messageId, item.caseId, item.alertId ?? null, item.field, jsonValue(item.existingValue), jsonValue(item.suggestedValue), item.source, item.isConflict],
    );
    created.push(mapReviewItem(result.rows[0]));
  }
  return created;
}

export async function findReviewItemsByMessageId(messageId: string): Promise<AiReviewItem[]> {
  const result = await pool.query('SELECT * FROM ai_review_items WHERE message_id = $1 ORDER BY created_at ASC', [messageId]);
  return result.rows.map(mapReviewItem);
}

export async function findReviewHistoryByMessageId(messageId: string): Promise<AiReviewHistoryItem[]> {
  const result = await pool.query('SELECT * FROM ai_review_history WHERE message_id = $1 ORDER BY created_at DESC', [messageId]);
  return result.rows.map(mapHistory);
}

function columnForField(field: ThreadAwareField) {
  const mapping: Partial<Record<ThreadAwareField, string>> = {
    projectItem: 'project_item',
    quoteAmount: 'quote_amount',
    expectedDeadline: 'expected_deadline',
    submissionDeadline: 'submission_deadline',
    publishDeadline: 'publish_deadline',
    nextAction: 'next_action',
    caseStatus: 'status',
    missingFields: 'missing_fields',
  };
  return mapping[field] ?? null;
}

export async function resolveReviewItem(id: string, action: 'apply' | 'keep' | 'edit', manualValue?: unknown): Promise<{item: AiReviewItem; history: AiReviewHistoryItem} | null> {
  const current = await pool.query('SELECT * FROM ai_review_items WHERE id = $1 AND status = $2 LIMIT 1', [id, 'pending']);
  const row = current.rows[0];
  if (!row) return null;

  const field = row.field as ThreadAwareField;
  const caseId = String(row.case_id);
  const previousValue = row.existing_value;
  const suggestedValue = row.suggested_value;
  const finalValue = action === 'apply' ? suggestedValue : action === 'edit' ? manualValue : previousValue;
  const column = action === 'keep' ? null : columnForField(field);

  if (column) {
    if (field === 'missingFields') {
      await pool.query(`UPDATE cases SET ${column} = $2::jsonb, updated_at = now() WHERE id = $1`, [caseId, jsonValue(finalValue)]);
    } else {
      await pool.query(`UPDATE cases SET ${column} = $2, updated_at = now() WHERE id = $1`, [caseId, finalValue]);
    }
  }

  const status = action === 'apply' ? 'applied' : action === 'keep' ? 'kept' : 'edited';
  const updated = await pool.query('UPDATE ai_review_items SET status = $2, resolved_at = now() WHERE id = $1 RETURNING *', [id, status]);
  const history = await pool.query(
    `INSERT INTO ai_review_history (id, review_item_id, message_id, case_id, field, action, previous_value, suggested_value, final_value)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
     RETURNING *`,
    [`review-history-${randomUUID()}`, id, row.message_id, caseId, field, action, jsonValue(previousValue), jsonValue(suggestedValue), jsonValue(finalValue)],
  );

  const pending = await pool.query('SELECT COUNT(*)::int AS count FROM ai_review_items WHERE case_id = $1 AND status = $2', [caseId, 'pending']);
  if (Number(pending.rows[0]?.count ?? 0) === 0) {
    await pool.query("UPDATE alerts SET resolved_at = COALESCE(resolved_at, now()) WHERE case_id = $1 AND type = 'needs_human_review' AND resolved_at IS NULL", [caseId]);
    await pool.query("UPDATE ai_extractions SET review_status = 'resolved', needs_human_review = false WHERE message_id = $1", [row.message_id]);
  }

  return {item: mapReviewItem(updated.rows[0]), history: mapHistory(history.rows[0])};
}
