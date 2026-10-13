import {pool} from '../db/pool.js';

function databaseNameFromUrl(value: string) {
  try {
    const url = new URL(value);
    return url.pathname.replace(/^\//, '');
  } catch {
    return '';
  }
}

async function assertTestDatabaseGuard() {
  if (process.env.CASEBEE_TEST_MODE !== 'true') {
    throw new Error('P6-B tests require CASEBEE_TEST_MODE=true. No writes were performed.');
  }

  const expectedDatabase = process.env.CASEBEE_TEST_DATABASE_ID?.trim();
  if (!expectedDatabase) {
    throw new Error('P6-B tests require CASEBEE_TEST_DATABASE_ID to explicitly name the test database. No writes were performed.');
  }

  const configuredDatabase = databaseNameFromUrl(process.env.DATABASE_URL ?? '');
  if (configuredDatabase !== expectedDatabase) {
    throw new Error(`P6-B test database guard failed: DATABASE_URL database "${configuredDatabase || 'unknown'}" does not match CASEBEE_TEST_DATABASE_ID "${expectedDatabase}". No writes were performed.`);
  }

  const current = await pool.query('SELECT current_database() AS database_name');
  const currentDatabase = String(current.rows[0]?.database_name ?? '');
  if (currentDatabase !== expectedDatabase) {
    throw new Error(`P6-B test database guard failed: connected database "${currentDatabase}" does not match CASEBEE_TEST_DATABASE_ID "${expectedDatabase}". No writes were performed.`);
  }
}

async function main() {
  await assertTestDatabaseGuard();
  console.log(JSON.stringify({ok: true, mode: 'guard-only', message: 'P6-B test database guard passed. E01-E08 are not implemented in this precondition script.'}, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}).finally(async () => {
  await pool.end();
});
