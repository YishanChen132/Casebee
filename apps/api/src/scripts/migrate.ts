import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {pool} from '../db/pool.js';
import {runSqlFile} from '../db/runSqlFile.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const migrationPath = resolve(currentDir, '../../../../database/migrations/001_initial_schema.sql');

try {
  await runSqlFile(migrationPath);
  console.log('Database migration completed');
} finally {
  await pool.end();
}
