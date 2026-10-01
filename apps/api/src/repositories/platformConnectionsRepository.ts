import {randomUUID} from 'node:crypto';
import {pool} from '../db/pool.js';

export interface PlatformConnectionRecord {
  id: string;
  platform: string;
  accountEmail: string | null;
  accessToken: string | null;
  refreshToken: string | null;
  scope: string | null;
  tokenType: string | null;
  expiryDate: number | null;
  lastSyncedAt: string | null;
}

function mapConnection(row: Record<string, unknown>): PlatformConnectionRecord {
  return {
    id: String(row.id),
    platform: String(row.platform),
    accountEmail: row.account_email ? String(row.account_email) : null,
    accessToken: row.access_token ? String(row.access_token) : null,
    refreshToken: row.refresh_token ? String(row.refresh_token) : null,
    scope: row.scope ? String(row.scope) : null,
    tokenType: row.token_type ? String(row.token_type) : null,
    expiryDate: row.expiry_date === null ? null : Number(row.expiry_date),
    lastSyncedAt: row.last_synced_at ? new Date(String(row.last_synced_at)).toISOString() : null,
  };
}

export async function getPlatformConnection(platform: string): Promise<PlatformConnectionRecord | null> {
  const result = await pool.query('SELECT * FROM platform_connections WHERE platform = $1', [platform]);
  return result.rows[0] ? mapConnection(result.rows[0]) : null;
}

export async function upsertPlatformConnection(input: {
  platform: string;
  accountEmail?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  scope?: string | null;
  tokenType?: string | null;
  expiryDate?: number | null;
}) {
  const result = await pool.query(
    `INSERT INTO platform_connections (id, platform, account_email, access_token, refresh_token, scope, token_type, expiry_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (platform) DO UPDATE SET
       account_email = COALESCE(EXCLUDED.account_email, platform_connections.account_email),
       access_token = COALESCE(EXCLUDED.access_token, platform_connections.access_token),
       refresh_token = COALESCE(EXCLUDED.refresh_token, platform_connections.refresh_token),
       scope = COALESCE(EXCLUDED.scope, platform_connections.scope),
       token_type = COALESCE(EXCLUDED.token_type, platform_connections.token_type),
       expiry_date = COALESCE(EXCLUDED.expiry_date, platform_connections.expiry_date),
       updated_at = now()
     RETURNING *`,
    [
      `connection-${randomUUID()}`,
      input.platform,
      input.accountEmail ?? null,
      input.accessToken ?? null,
      input.refreshToken ?? null,
      input.scope ?? null,
      input.tokenType ?? null,
      input.expiryDate ?? null,
    ],
  );

  return mapConnection(result.rows[0]);
}

export async function markPlatformSynced(platform: string) {
  const result = await pool.query('UPDATE platform_connections SET last_synced_at = now(), updated_at = now() WHERE platform = $1 RETURNING *', [platform]);
  return result.rows[0] ? mapConnection(result.rows[0]) : null;
}
