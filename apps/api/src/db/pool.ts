import pg from 'pg';
import '../config/env.js';

const {Pool} = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL ?? 'postgresql://casebee:casebee@localhost:5432/casebee',
});

export async function checkDatabase() {
  const startedAt = Date.now();
  await pool.query('SELECT 1');
  return {status: 'connected', latencyMs: Date.now() - startedAt};
}
