import {readFile} from 'node:fs/promises';
import {pool} from './pool.js';

export async function runSqlFile(filePath: string) {
  const sql = await readFile(filePath, 'utf8');
  await pool.query(sql);
}
