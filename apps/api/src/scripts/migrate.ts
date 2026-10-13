import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {pool} from '../db/pool.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(currentDir, '../../../../database/migrations');

function checksum(sql: string) {
  return createHash('sha256').update(sql).digest('hex');
}

try {
  await pool.query('SELECT pg_advisory_lock($1)', [6202406]);
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    ran_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const migrationFiles = (await readdir(migrationsDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of migrationFiles) {
    const sql = await readFile(resolve(migrationsDir, file), 'utf8');
    const hash = checksum(sql);
    const existing = await pool.query('SELECT checksum FROM schema_migrations WHERE filename = $1', [file]);
    if (existing.rows[0]) {
      if (existing.rows[0].checksum !== hash) {
        throw new Error(`Migration checksum mismatch for ${file}`);
      }
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)', [file, hash]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  console.log('Database migration completed');
} finally {
  await pool.query('SELECT pg_advisory_unlock($1)', [6202406]).catch(() => undefined);
  await pool.end();
}
