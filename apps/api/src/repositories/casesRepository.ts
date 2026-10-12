import {randomUUID} from 'node:crypto';
import {normalizeMissingFields} from '@casebee/shared';
import type {AiExtraction, Alert, CaseDetail, CaseRecord, Customer, Platform} from '@casebee/shared';
import {pool} from '../db/pool.js';
import {findSimilarCases} from '../services/ragService.js';
import {computeStageAwareMissingFields, extractionFromCase as stageExtractionFromCase} from '../services/missingFieldService.js';
import {isMeaningfulDisplayText, sanitizeDisplayText} from '../services/emailBodyNormalizer.js';
import {syncMissingFieldAlerts} from './alertsRepository.js';
import {findLatestBusinessProfileByCustomerId, findLatestBusinessRiskScoreByCustomerId} from './businessRepository.js';
import {mapAlert, mapCase, mapMessage} from './mappers.js';

const validCaseStatuses: CaseRecord['status'][] = [
  '潛在詢問',
  '需求確認中',
  '已報價',
  '等待回覆',
  '已確認合作',
  '進行中',
  '等待素材',
  '待修改',
  '待交付',
  '已完成',
  '已流失',
];

function mapAiExtraction(row: Record<string, unknown>): AiExtraction {
  return {
    clientName: row.client_name ? String(row.client_name) : null,
    projectItem: row.project_item ? String(row.project_item) : null,
    quoteAmount: row.quote_amount === null ? null : Number(row.quote_amount),
    expectedDeadline: row.expected_deadline ? String(row.expected_deadline) : null,
    submissionDeadline: row.submission_deadline ? String(row.submission_deadline) : null,
    publishDeadline: row.publish_deadline ? String(row.publish_deadline) : null,
    nextAction: row.next_action ? String(row.next_action) : null,
    nextActionSource: row.next_action_source ? row.next_action_source as AiExtraction['nextActionSource'] : null,
    requiredMaterials: Array.isArray(row.required_materials) ? row.required_materials.map(String) : [],
    providedMaterials: Array.isArray(row.provided_materials) ? row.provided_materials.map(String) : [],
    intent: String(row.intent),
    caseStatus: row.case_status as AiExtraction['caseStatus'],
    missingFields: normalizeMissingFields(Array.isArray(row.missing_fields) ? row.missing_fields.map(String) : []),
    summary: String(row.summary),
    suggestedReply: String(row.suggested_reply),
  };
}

function extractionFromCase(item: CaseRecord): AiExtraction {
  return {
    clientName: item.customerName,
    projectItem: item.projectItem,
    quoteAmount: item.quoteAmount,
    expectedDeadline: item.expectedDeadline,
    submissionDeadline: item.submissionDeadline,
    publishDeadline: item.publishDeadline,
    nextAction: item.nextAction,
    nextActionSource: item.nextActionSource,
    requiredMaterials: item.requiredMaterials,
    providedMaterials: item.providedMaterials,
    intent: item.summary,
    caseStatus: item.status,
    missingFields: item.missingFields,
    summary: item.summary,
    suggestedReply: '',
  };
}

export async function findAllCases(): Promise<CaseRecord[]> {
  const result = await pool.query('SELECT * FROM cases WHERE excluded_at IS NULL ORDER BY updated_at DESC');
  return result.rows.map(mapCase);
}

export async function findCaseById(id: string): Promise<CaseRecord | null> {
  const result = await pool.query('SELECT * FROM cases WHERE id = $1 AND excluded_at IS NULL', [id]);
  return result.rows[0] ? mapCase(result.rows[0]) : null;
}

export async function findCaseDetailById(id: string): Promise<CaseDetail | null> {
  const item = await findCaseById(id);
  if (!item) {
    return null;
  }

  const [messagesResult, alertsResult, aiExtractionsResult, businessProfile, businessRiskScore] = await Promise.all([
    pool.query('SELECT * FROM messages WHERE case_id = $1 AND excluded_at IS NULL ORDER BY timestamp DESC, created_at DESC', [id]),
    pool.query('SELECT * FROM alerts WHERE case_id = $1 ORDER BY created_at DESC', [id]),
    pool.query(
      `SELECT ai_extractions.*
       FROM ai_extractions
       INNER JOIN messages ON messages.id = ai_extractions.message_id
       WHERE messages.case_id = $1 AND messages.excluded_at IS NULL
       ORDER BY ai_extractions.created_at DESC`,
      [id],
    ),
    findLatestBusinessProfileByCustomerId(item.customerId),
    findLatestBusinessRiskScoreByCustomerId(item.customerId),
  ]);
  const aiExtractions = aiExtractionsResult.rows.map(mapAiExtraction);
  const similarCases = await findSimilarCases(aiExtractions[0] ?? extractionFromCase(item));

  return {
    case: item,
    messages: messagesResult.rows.map(mapMessage),
    alerts: alertsResult.rows.map((row) => mapAlert(row) as Alert),
    aiExtractions,
    businessProfile,
    businessRiskScore,
    similarCases,
  };
}

export async function createCaseFromExtraction(input: {customer: Customer; platform: Platform; extraction: AiExtraction}): Promise<CaseRecord> {
  const id = `case-${randomUUID()}`;
  const code = `#CB-${Date.now().toString().slice(-6)}`;
  const projectItem = input.extraction.projectItem ?? '待釐清需求';
  const title = isMeaningfulDisplayText(input.customer.name) ? sanitizeDisplayText(input.customer.name) : sanitizeDisplayText(input.extraction.clientName) || '未命名案件';
  const customerName = isMeaningfulDisplayText(input.customer.name) ? sanitizeDisplayText(input.customer.name) : title;
  const riskLevel = input.extraction.missingFields.length > 0 ? 'warning' : 'normal';

  const result = await pool.query(
    `INSERT INTO cases (id, code, customer_id, customer_name, title, platform, status, project_item, quote_amount, expected_deadline, submission_deadline, publish_deadline, next_action, next_action_source, required_materials, provided_materials, summary, risk_level, missing_fields)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb, $17, $18, $19::jsonb)
      RETURNING *`,
    [
      id,
      code,
      input.customer.id,
      customerName,
      title,
      input.platform,
      input.extraction.caseStatus,
      projectItem,
      input.extraction.quoteAmount,
      input.extraction.expectedDeadline,
      input.extraction.submissionDeadline,
      input.extraction.publishDeadline,
      input.extraction.nextAction,
      input.extraction.nextActionSource,
      JSON.stringify(input.extraction.requiredMaterials),
      JSON.stringify(input.extraction.providedMaterials),
      input.extraction.summary,
      riskLevel,
      JSON.stringify(normalizeMissingFields(input.extraction.missingFields)),
    ],
  );

  return mapCase(result.rows[0]);
}

export async function updateCaseRisk(caseId: string, riskLevel: CaseRecord['riskLevel']) {
  const result = await pool.query('UPDATE cases SET risk_level = $2, updated_at = now() WHERE id = $1 RETURNING *', [caseId, riskLevel]);
  return result.rows[0] ? mapCase(result.rows[0]) : null;
}

export async function updateCaseStatus(caseId: string, status: CaseRecord['status']) {
  if (!validCaseStatuses.includes(status)) {
    throw new Error('Invalid case status');
  }

  const result = await pool.query('UPDATE cases SET status = $2, next_action = CASE WHEN $2 IN (\'已完成\', \'已流失\') THEN NULL ELSE next_action END, next_action_source = CASE WHEN $2 IN (\'已完成\', \'已流失\') THEN NULL ELSE next_action_source END, updated_at = now() WHERE id = $1 RETURNING *', [caseId, status]);
  return result.rows[0] ? syncCaseMissingFields(mapCase(result.rows[0])) : null;
}

async function syncCaseMissingFields(caseRecord: CaseRecord) {
  const missingFields = computeStageAwareMissingFields({extraction: stageExtractionFromCase(caseRecord), caseRecord});
  await syncMissingFieldAlerts(caseRecord.id, missingFields);
  return updateCaseMissingFields(caseRecord.id, missingFields);
}

export async function updateCaseFields(caseId: string, input: {status?: CaseRecord['status']; quoteAmount?: number | null; expectedDeadline?: string | null; summary?: string}) {
  if (input.status && !validCaseStatuses.includes(input.status)) {
    throw new Error('Invalid case status');
  }

  const updates: string[] = [];
  const values: unknown[] = [caseId];

  const addUpdate = (column: string, value: unknown) => {
    values.push(value);
    updates.push(`${column} = $${values.length}`);
  };

  if (input.status !== undefined) {
    addUpdate('status', input.status);
    if (input.status === '已完成' || input.status === '已流失') {
      addUpdate('next_action', null);
      addUpdate('next_action_source', null);
    }
  }
  if (input.quoteAmount !== undefined) {
    addUpdate('quote_amount', input.quoteAmount);
  }
  if (input.expectedDeadline !== undefined) {
    addUpdate('expected_deadline', input.expectedDeadline);
  }
  if (input.summary !== undefined) {
    addUpdate('summary', input.summary);
  }

  if (updates.length === 0) {
    const existing = await findCaseById(caseId);
    return existing ? syncCaseMissingFields(existing) : null;
  }

  const result = await pool.query(`UPDATE cases SET ${updates.join(', ')}, updated_at = now() WHERE id = $1 RETURNING *`, values);
  return result.rows[0] ? syncCaseMissingFields(mapCase(result.rows[0])) : null;
}

export async function updateCaseMissingFields(caseId: string, missingFields: string[]): Promise<CaseRecord | null> {
  const riskLevel = missingFields.length > 0 ? 'warning' : 'normal';
  const result = await pool.query(
    `UPDATE cases
     SET missing_fields = $2::jsonb,
         risk_level = CASE WHEN risk_level = 'danger' THEN risk_level ELSE $3 END,
         updated_at = now()
     WHERE id = $1 AND excluded_at IS NULL
     RETURNING *`,
    [caseId, JSON.stringify(normalizeMissingFields(missingFields)), riskLevel],
  );
  return result.rows[0] ? mapCase(result.rows[0]) : null;
}

export async function updateCaseFromThreadExtraction(caseId: string, extraction: AiExtraction): Promise<CaseRecord | null> {
  const projectItem = extraction.projectItem ?? '待釐清需求';
  const riskLevel = extraction.missingFields.length > 0 ? 'warning' : 'normal';
  const result = await pool.query(
    `UPDATE cases
     SET project_item = $2,
          quote_amount = $3,
          expected_deadline = $4,
          submission_deadline = $5,
          publish_deadline = $6,
          next_action = $7,
          next_action_source = $8,
          required_materials = $9::jsonb,
          provided_materials = $10::jsonb,
          summary = $11,
          risk_level = $12,
          missing_fields = $13::jsonb,
          status = $14,
          updated_at = now()
      WHERE id = $1 AND excluded_at IS NULL
      RETURNING *`,
    [caseId, projectItem, extraction.quoteAmount, extraction.expectedDeadline, extraction.submissionDeadline, extraction.publishDeadline, extraction.nextAction, extraction.nextActionSource, JSON.stringify(extraction.requiredMaterials), JSON.stringify(extraction.providedMaterials), extraction.summary, riskLevel, JSON.stringify(normalizeMissingFields(extraction.missingFields)), extraction.caseStatus],
  );
  return result.rows[0] ? mapCase(result.rows[0]) : null;
}

export async function updateCaseFromReanalysis(caseId: string, extraction: AiExtraction) {
  const existing = await findCaseById(caseId);
  const submissionDeadline = existing?.submissionDeadline && extraction.submissionDeadline !== existing.submissionDeadline ? existing.submissionDeadline : extraction.submissionDeadline;
  const publishDeadline = existing?.publishDeadline && extraction.publishDeadline !== existing.publishDeadline ? existing.publishDeadline : extraction.publishDeadline;
  const expectedDeadline = existing?.expectedDeadline && extraction.expectedDeadline !== existing.expectedDeadline ? existing.expectedDeadline : extraction.expectedDeadline;
  const projectItem = extraction.projectItem ?? '待釐清需求';
  const riskLevel = extraction.missingFields.length > 0 ? 'warning' : 'normal';
  const result = await pool.query(
    `UPDATE cases
     SET title = customer_name,
         project_item = $2,
          quote_amount = $3,
          expected_deadline = $4,
          submission_deadline = $5,
          publish_deadline = $6,
          next_action = $7,
          next_action_source = $8,
          required_materials = $9::jsonb,
          provided_materials = $10::jsonb,
          summary = $11,
          risk_level = $12,
          missing_fields = $13::jsonb,
          status = $14,
          updated_at = now()
     WHERE id = $1 AND excluded_at IS NULL
     RETURNING *`,
    [caseId, projectItem, extraction.quoteAmount, expectedDeadline, submissionDeadline, publishDeadline, extraction.nextAction, extraction.nextActionSource, JSON.stringify(extraction.requiredMaterials), JSON.stringify(extraction.providedMaterials), extraction.summary, riskLevel, JSON.stringify(normalizeMissingFields(extraction.missingFields)), extraction.caseStatus],
  );
  return result.rows[0] ? mapCase(result.rows[0]) : null;
}
