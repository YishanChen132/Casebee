import {randomUUID} from 'node:crypto';
import type {Platform} from '@casebee/shared';
import {pool} from '../db/pool.js';

export interface MessageExclusionRule {
  id: string;
  platform: Platform;
  matchType: 'sender_email';
  matchValue: string;
  reason: string;
  sourceMessageId: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

function normalizeSenderEmail(value: string) {
  return value.trim().toLowerCase();
}

function mapRule(row: Record<string, unknown>): MessageExclusionRule {
  return {
    id: String(row.id),
    platform: row.platform as Platform,
    matchType: row.match_type as MessageExclusionRule['matchType'],
    matchValue: String(row.match_value),
    reason: String(row.reason),
    sourceMessageId: row.source_message_id ? String(row.source_message_id) : null,
    isActive: row.is_active !== false,
    createdAt: new Date(String(row.created_at)).toISOString(),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  };
}

export async function findAllMessageExclusionRules() {
  const result = await pool.query('SELECT * FROM message_exclusion_rules ORDER BY is_active DESC, updated_at DESC, created_at DESC');
  return result.rows.map(mapRule);
}

export async function upsertSenderEmailExclusionRule(input: {platform: Platform; senderEmail: string; reason: string; sourceMessageId?: string}) {
  const matchValue = normalizeSenderEmail(input.senderEmail);
  if (!matchValue) {
    return null;
  }

  const result = await pool.query(
    `INSERT INTO message_exclusion_rules (id, platform, match_type, match_value, reason, source_message_id, is_active)
     VALUES ($1, $2, 'sender_email', $3, $4, $5, true)
     ON CONFLICT (platform, match_type, match_value)
     DO UPDATE SET reason = EXCLUDED.reason, source_message_id = EXCLUDED.source_message_id, is_active = true, updated_at = now()
     RETURNING *`,
    [`rule-${randomUUID()}`, input.platform, matchValue, input.reason, input.sourceMessageId ?? null],
  );

  return mapRule(result.rows[0]);
}

export async function findSenderEmailExclusionRule(platform: Platform, senderEmail: string) {
  const result = await pool.query(
    `SELECT * FROM message_exclusion_rules
     WHERE platform = $1 AND match_type = 'sender_email' AND match_value = $2 AND is_active = true
     LIMIT 1`,
    [platform, normalizeSenderEmail(senderEmail)],
  );

  return result.rows[0] ? mapRule(result.rows[0]) : null;
}

export async function setMessageExclusionRuleActive(id: string, isActive: boolean) {
  const result = await pool.query('UPDATE message_exclusion_rules SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *', [id, isActive]);
  return result.rows[0] ? mapRule(result.rows[0]) : null;
}
