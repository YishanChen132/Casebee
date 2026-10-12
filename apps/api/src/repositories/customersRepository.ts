import {randomUUID} from 'node:crypto';
import type {Customer, CustomerDetail, CustomerSummary, Platform} from '@casebee/shared';
import {pool} from '../db/pool.js';
import {findLatestBusinessProfileByCustomerId, findLatestBusinessRiskScoreByCustomerId} from './businessRepository.js';
import {mapCase, mapCustomer, mapMessage} from './mappers.js';
import {isMeaningfulDisplayText, sanitizeDisplayText} from '../services/emailBodyNormalizer.js';

function mapCustomerSummary(row: Record<string, unknown>): CustomerSummary {
  return {
    ...mapCustomer(row),
    caseCount: Number(row.case_count),
    activeCaseCount: Number(row.active_case_count),
    riskCaseCount: Number(row.risk_case_count),
    latestCaseUpdatedAt: row.latest_case_updated_at ? new Date(String(row.latest_case_updated_at)).toISOString() : null,
  };
}

export async function findCustomerSummaries(): Promise<CustomerSummary[]> {
  const result = await pool.query(`
    SELECT
      customers.*,
      COUNT(cases.id)::int AS case_count,
      COUNT(cases.id) FILTER (WHERE cases.status NOT IN ('已完成', '已流失'))::int AS active_case_count,
      COUNT(cases.id) FILTER (WHERE cases.risk_level <> 'normal')::int AS risk_case_count,
      MAX(cases.updated_at) AS latest_case_updated_at
    FROM customers
    LEFT JOIN cases ON cases.customer_id = customers.id AND cases.excluded_at IS NULL
    GROUP BY customers.id
    HAVING COUNT(cases.id) > 0
    ORDER BY customers.last_contact_at DESC
  `);
  return result.rows.map(mapCustomerSummary);
}

export async function findCustomerDetailById(customerId: string): Promise<CustomerDetail | null> {
  const customers = await pool.query(`
    SELECT
      customers.*,
      COUNT(cases.id)::int AS case_count,
      COUNT(cases.id) FILTER (WHERE cases.status NOT IN ('已完成', '已流失'))::int AS active_case_count,
      COUNT(cases.id) FILTER (WHERE cases.risk_level <> 'normal')::int AS risk_case_count,
      MAX(cases.updated_at) AS latest_case_updated_at
    FROM customers
    LEFT JOIN cases ON cases.customer_id = customers.id AND cases.excluded_at IS NULL
    WHERE customers.id = $1
    GROUP BY customers.id
    LIMIT 1
  `, [customerId]);

  if (!customers.rows[0]) {
    return null;
  }

  const [cases, messages, businessProfile, businessRiskScore] = await Promise.all([
    pool.query('SELECT * FROM cases WHERE customer_id = $1 AND excluded_at IS NULL ORDER BY updated_at DESC', [customerId]),
    pool.query(
      `SELECT messages.*
       FROM messages
       LEFT JOIN cases ON cases.id = messages.case_id
       WHERE messages.excluded_at IS NULL AND (cases.customer_id = $1 OR messages.sender_name = (SELECT name FROM customers WHERE id = $1))
       ORDER BY messages.timestamp DESC, messages.created_at DESC
       LIMIT 20`,
      [customerId],
    ),
    findLatestBusinessProfileByCustomerId(customerId),
    findLatestBusinessRiskScoreByCustomerId(customerId),
  ]);

  return {
    customer: mapCustomerSummary(customers.rows[0]),
    cases: cases.rows.map(mapCase),
    messages: messages.rows.map(mapMessage),
    businessProfile,
    businessRiskScore,
  };
}

export async function findOrCreateCustomer(input: {name: string; platform: Platform; contactHandle: string}): Promise<Customer> {
  const name = isMeaningfulDisplayText(input.name) ? sanitizeDisplayText(input.name) : sanitizeDisplayText(input.contactHandle) || '未命名客戶';
  const existing = await pool.query('SELECT * FROM customers WHERE name = $1 AND platform = $2 LIMIT 1', [name, input.platform]);

  if (existing.rows[0]) {
    const updated = await pool.query('UPDATE customers SET last_contact_at = now(), updated_at = now() WHERE id = $1 RETURNING *', [existing.rows[0].id]);
    return mapCustomer(updated.rows[0]);
  }

  const created = await pool.query(
    'INSERT INTO customers (id, name, platform, contact_handle, last_contact_at) VALUES ($1, $2, $3, $4, now()) RETURNING *',
    [`customer-${randomUUID()}`, name, input.platform, input.contactHandle],
  );
  return mapCustomer(created.rows[0]);
}
