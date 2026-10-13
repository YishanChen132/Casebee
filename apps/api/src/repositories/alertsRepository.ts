import {randomUUID} from 'node:crypto';
import type {Alert} from '@casebee/shared';
import {pool} from '../db/pool.js';
import {mapAlert} from './mappers.js';

export async function createAlert(input: Omit<Alert, 'id' | 'createdAt' | 'resolvedAt'>): Promise<Alert> {
  const result = await pool.query(
    `INSERT INTO alerts (id, case_id, type, title, message, severity, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
      RETURNING *`,
    [`alert-${randomUUID()}`, input.caseId, input.type, input.title, input.message, input.severity, JSON.stringify(input.metadata ?? {})],
  );

  return mapAlert(result.rows[0]);
}

export async function syncMissingFieldAlerts(caseId: string, missingFields: string[]): Promise<Alert[]> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const active = await client.query("SELECT * FROM alerts WHERE case_id = $1 AND type = 'missing_fields' AND resolved_at IS NULL FOR UPDATE", [caseId]);
    const desired = new Set(missingFields);
    const existingByField = new Map<string, Record<string, unknown>>();
    const duplicateAlertIds: string[] = [];
    for (const row of active.rows) {
      const field = row.metadata?.field ? String(row.metadata.field) : '';
      if (!field) continue;
      if (existingByField.has(field)) {
        duplicateAlertIds.push(String(row.id));
      } else {
        existingByField.set(field, row);
      }
    }

    for (const row of active.rows) {
      const field = row.metadata?.field ? String(row.metadata.field) : '';
      if (!field || !desired.has(field) || duplicateAlertIds.includes(String(row.id))) {
        await client.query('UPDATE alerts SET resolved_at = COALESCE(resolved_at, now()) WHERE id = $1', [row.id]);
      }
    }

    const created: Alert[] = [];
    const labels: Record<string, string> = {
      client_name: '客戶名稱',
      project_item: '專案項目',
      deliverables: '交付項目',
      scope: '工作範圍',
      quote_amount: '預算 / 報價金額',
      expected_deadline: '預期到期時間',
      usage_rights: '授權期間與使用範圍',
      revision_scope: '修改次數 / 修改範圍',
      contract: '合約確認',
      payment_terms: '付款條件',
      required_materials: '必要素材',
      submission_deadline: '交稿期限',
      publish_deadline: '發布 / 上線期限',
      next_action: '下一步',
    };
    for (const field of missingFields) {
      if (existingByField.has(field)) continue;
      const label = labels[field] ?? field;
      const result = await client.query(
        `INSERT INTO alerts (id, case_id, type, title, message, severity, metadata)
         VALUES ($1, $2, 'missing_fields', $3, $4, 'warning', $5::jsonb)
         RETURNING *`,
        [`alert-${randomUUID()}`, caseId, `缺少欄位：${label}`, `缺少欄位：${label}。建議先追問後再報價或排程。`, JSON.stringify({field})],
      );
      created.push(mapAlert(result.rows[0]));
    }
    await client.query('COMMIT');
    return created;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function findOpenAlertByCaseAndType(caseId: string, type: Alert['type']): Promise<Alert | null> {
  const result = await pool.query('SELECT * FROM alerts WHERE case_id = $1 AND type = $2 AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 1', [caseId, type]);
  return result.rows[0] ? mapAlert(result.rows[0]) : null;
}

export async function resolveOpenAlertsByCaseAndType(caseId: string, type: Alert['type']): Promise<void> {
  await pool.query('UPDATE alerts SET resolved_at = COALESCE(resolved_at, now()) WHERE case_id = $1 AND type = $2 AND resolved_at IS NULL', [caseId, type]);
}

export async function resolveAlert(alertId: string): Promise<Alert | null> {
  const result = await pool.query(
    `UPDATE alerts
     SET resolved_at = COALESCE(resolved_at, now())
     WHERE id = $1
     RETURNING *`,
    [alertId],
  );

  return result.rows[0] ? mapAlert(result.rows[0]) : null;
}
