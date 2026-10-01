import {randomUUID} from 'node:crypto';
import type {BusinessProfile, BusinessRiskFactor, BusinessRiskScore, BusinessRiskSummary} from '@casebee/shared';
import {pool} from '../db/pool.js';

function parseFactors(value: unknown): BusinessRiskFactor[] {
  return Array.isArray(value) ? value.map((item) => item as BusinessRiskFactor) : [];
}

function mapBusinessProfile(row: Record<string, unknown>): BusinessProfile {
  return {
    id: String(row.id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    businessAccountingNo: row.business_accounting_no ? String(row.business_accounting_no) : null,
    businessName: String(row.business_name),
    businessType: row.business_type as BusinessProfile['businessType'],
    statusCode: row.status_code ? String(row.status_code) : null,
    statusDesc: row.status_desc ? String(row.status_desc) : null,
    capitalAmount: row.capital_amount === null ? null : Number(row.capital_amount),
    paidInCapitalAmount: row.paid_in_capital_amount === null ? null : Number(row.paid_in_capital_amount),
    responsibleName: row.responsible_name ? String(row.responsible_name) : null,
    registeredAddress: row.registered_address ? String(row.registered_address) : null,
    registerOrganization: row.register_organization ? String(row.register_organization) : null,
    setupDate: row.setup_date ? String(row.setup_date) : null,
    lastChangeDate: row.last_change_date ? String(row.last_change_date) : null,
    source: row.source as BusinessProfile['source'],
    fetchedAt: new Date(String(row.fetched_at)).toISOString(),
  };
}

function mapBusinessRiskScore(row: Record<string, unknown>): BusinessRiskScore {
  return {
    id: String(row.id),
    customerId: row.customer_id ? String(row.customer_id) : null,
    businessProfileId: row.business_profile_id ? String(row.business_profile_id) : null,
    score: Number(row.score),
    riskLevel: row.risk_level as BusinessRiskScore['riskLevel'],
    positiveFactors: parseFactors(row.positive_factors),
    negativeFactors: parseFactors(row.negative_factors),
    calculatedAt: new Date(String(row.calculated_at)).toISOString(),
  };
}

export async function upsertBusinessProfile(input: Omit<BusinessProfile, 'id' | 'fetchedAt'> & {rawPayload?: unknown}) {
  const existing = await pool.query('SELECT * FROM business_profiles WHERE customer_id = $1 LIMIT 1', [input.customerId]);
  const id = existing.rows[0]?.id ?? `business-profile-${randomUUID()}`;
  const result = await pool.query(
    `INSERT INTO business_profiles (id, customer_id, business_accounting_no, business_name, business_type, status_code, status_desc, capital_amount, paid_in_capital_amount, responsible_name, registered_address, register_organization, setup_date, last_change_date, source, raw_payload, fetched_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, now())
     ON CONFLICT (id) DO UPDATE SET
       business_accounting_no = EXCLUDED.business_accounting_no,
       business_name = EXCLUDED.business_name,
       business_type = EXCLUDED.business_type,
       status_code = EXCLUDED.status_code,
       status_desc = EXCLUDED.status_desc,
       capital_amount = EXCLUDED.capital_amount,
       paid_in_capital_amount = EXCLUDED.paid_in_capital_amount,
       responsible_name = EXCLUDED.responsible_name,
       registered_address = EXCLUDED.registered_address,
       register_organization = EXCLUDED.register_organization,
       setup_date = EXCLUDED.setup_date,
       last_change_date = EXCLUDED.last_change_date,
       source = EXCLUDED.source,
       raw_payload = EXCLUDED.raw_payload,
       fetched_at = now(),
       updated_at = now()
     RETURNING *`,
    [
      id,
      input.customerId,
      input.businessAccountingNo,
      input.businessName,
      input.businessType,
      input.statusCode,
      input.statusDesc,
      input.capitalAmount,
      input.paidInCapitalAmount,
      input.responsibleName,
      input.registeredAddress,
      input.registerOrganization,
      input.setupDate,
      input.lastChangeDate,
      input.source,
      input.rawPayload ? JSON.stringify(input.rawPayload) : null,
    ],
  );
  return mapBusinessProfile(result.rows[0]);
}

export async function createBusinessRiskScore(input: Omit<BusinessRiskScore, 'id' | 'calculatedAt'>) {
  const result = await pool.query(
    `INSERT INTO business_risk_scores (id, customer_id, business_profile_id, score, risk_level, positive_factors, negative_factors)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
     RETURNING *`,
    [`business-risk-${randomUUID()}`, input.customerId, input.businessProfileId, input.score, input.riskLevel, JSON.stringify(input.positiveFactors), JSON.stringify(input.negativeFactors)],
  );
  return mapBusinessRiskScore(result.rows[0]);
}

export async function findLatestBusinessProfileByCustomerId(customerId: string): Promise<BusinessProfile | null> {
  const result = await pool.query('SELECT * FROM business_profiles WHERE customer_id = $1 ORDER BY fetched_at DESC LIMIT 1', [customerId]);
  return result.rows[0] ? mapBusinessProfile(result.rows[0]) : null;
}

export async function findLatestBusinessRiskScoreByCustomerId(customerId: string): Promise<BusinessRiskScore | null> {
  const result = await pool.query('SELECT * FROM business_risk_scores WHERE customer_id = $1 ORDER BY calculated_at DESC LIMIT 1', [customerId]);
  return result.rows[0] ? mapBusinessRiskScore(result.rows[0]) : null;
}

export async function getBusinessRiskSummary(): Promise<BusinessRiskSummary> {
  const result = await pool.query(`
    SELECT DISTINCT ON (customer_id) *
    FROM business_risk_scores
    ORDER BY customer_id, calculated_at DESC
  `);
  const scores = result.rows.map(mapBusinessRiskScore);
  const averageScore = scores.length > 0 ? Math.round(scores.reduce((sum, item) => sum + item.score, 0) / scores.length) : null;

  return {
    low: scores.filter((item) => item.riskLevel === 'low').length,
    medium: scores.filter((item) => item.riskLevel === 'medium').length,
    high: scores.filter((item) => item.riskLevel === 'high').length,
    unverified: scores.filter((item) => item.riskLevel === 'unverified').length,
    averageScore,
  };
}
