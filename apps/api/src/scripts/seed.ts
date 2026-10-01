import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {pool} from '../db/pool.js';
import {runSqlFile} from '../db/runSqlFile.js';

const currentDir = dirname(fileURLToPath(import.meta.url));
const seedPath = resolve(currentDir, '../../../../database/seed/001_demo_data.sql');

try {
  await runSqlFile(seedPath);
  console.log('Database seed completed');
} finally {
  await pool.end();
}
