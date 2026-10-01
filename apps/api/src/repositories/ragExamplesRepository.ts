import {randomUUID} from 'node:crypto';
import {normalizeMissingFields} from '@casebee/shared';
import type {CreateRagExampleInput, RagExample} from '@casebee/shared';
import {pool} from '../db/pool.js';

function mapRagExample(row: Record<string, unknown>, score = 0): RagExample {
  const parseStringArray = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
  return {
    id: String(row.id),
    title: String(row.title),
    platform: row.platform as RagExample['platform'],
    projectItem: String(row.project_item),
    quoteAmount: row.quote_amount === null ? null : Number(row.quote_amount),
    outcome: String(row.outcome),
    summary: String(row.summary),
    replyExample: String(row.reply_example),
    isActive: row.is_active !== false,
    caseType: row.case_type ? String(row.case_type) : null,
    projectAliases: parseStringArray(row.project_aliases),
    typicalMissingFields: normalizeMissingFields(parseStringArray(row.typical_missing_fields)),
    quoteRangeMin: row.quote_range_min === null ? null : Number(row.quote_range_min),
    quoteRangeMax: row.quote_range_max === null ? null : Number(row.quote_range_max),
    successPattern: row.success_pattern ? String(row.success_pattern) : null,
    score,
  };
}

export async function findAllRagExamples(): Promise<RagExample[]> {
  const result = await pool.query('SELECT * FROM rag_examples ORDER BY is_active DESC, created_at DESC');
  return result.rows.map((row) => mapRagExample(row));
}

export async function findActiveRagExamples(): Promise<RagExample[]> {
  const result = await pool.query('SELECT * FROM rag_examples WHERE is_active = true ORDER BY created_at DESC');
  return result.rows.map((row) => mapRagExample(row));
}

export async function createRagExample(input: CreateRagExampleInput): Promise<RagExample> {
  const result = await pool.query(
    `INSERT INTO rag_examples (id, title, platform, project_item, quote_amount, outcome, summary, reply_example, is_active, case_type, project_aliases, typical_missing_fields, quote_range_min, quote_range_max, success_pattern)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10::jsonb, $11::jsonb, $12, $13, $14)
     RETURNING *`,
    [`rag-${randomUUID()}`, input.title, input.platform, input.projectItem, input.quoteAmount, input.outcome, input.summary, input.replyExample, input.caseType ?? null, JSON.stringify(input.projectAliases ?? []), JSON.stringify(normalizeMissingFields(input.typicalMissingFields ?? [])), input.quoteRangeMin ?? null, input.quoteRangeMax ?? null, input.successPattern ?? null],
  );

  return mapRagExample(result.rows[0]);
}

export async function deactivateRagExample(id: string): Promise<RagExample | null> {
  const result = await pool.query('UPDATE rag_examples SET is_active = false WHERE id = $1 RETURNING *', [id]);
  return result.rows[0] ? mapRagExample(result.rows[0]) : null;
}
