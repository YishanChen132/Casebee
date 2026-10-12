import {writeFile} from 'node:fs/promises';
import {pool} from '../db/pool.js';

const targetCodes = ['#CB-909255', '#CB-907527'];
const replacementName = '國立清華大學教務處招生策略中心';
const apply = process.argv.includes('--apply');

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query(
      `SELECT c.id AS case_id, c.code, c.title, c.customer_name, c.project_item, c.customer_id,
              cu.name AS customer_name_table,
              jsonb_agg(jsonb_build_object('id', m.id, 'senderName', m.sender_name, 'textPrefix', left(m.text, 160)) ORDER BY m.created_at) AS messages
       FROM cases c
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN messages m ON m.case_id = c.id
       WHERE c.code = ANY($1::text[])
       GROUP BY c.id, cu.id
       ORDER BY c.code`,
      [targetCodes],
    );

    if (apply) {
      await client.query(`UPDATE cases SET title = $2, customer_name = $2, updated_at = now() WHERE code = ANY($1::text[])`, [targetCodes, replacementName]);
      await client.query(`UPDATE customers SET name = $2, updated_at = now() WHERE id IN (SELECT customer_id FROM cases WHERE code = ANY($1::text[]))`, [targetCodes, replacementName]);
      await client.query(`UPDATE messages SET sender_name = $2 WHERE case_id IN (SELECT id FROM cases WHERE code = ANY($1::text[]))`, [targetCodes, replacementName]);
      await client.query(`UPDATE ai_extractions SET client_name = $2 WHERE message_id IN (SELECT id FROM messages WHERE case_id IN (SELECT id FROM cases WHERE code = ANY($1::text[])))`, [targetCodes, replacementName]);
    }

    const after = await client.query(
      `SELECT c.id AS case_id, c.code, c.title, c.customer_name, c.project_item, c.customer_id,
              cu.name AS customer_name_table,
              jsonb_agg(jsonb_build_object('id', m.id, 'senderName', m.sender_name, 'textPrefix', left(m.text, 160)) ORDER BY m.created_at) AS messages
       FROM cases c
       JOIN customers cu ON cu.id = c.customer_id
       LEFT JOIN messages m ON m.case_id = c.id
       WHERE c.code = ANY($1::text[])
       GROUP BY c.id, cu.id
       ORDER BY c.code`,
      [targetCodes],
    );

    const report = {mode: apply ? 'apply' : 'dry-run', replacementName, before: before.rows, after: after.rows};
    const path = `repair-html-polluted-cases-${Date.now()}.json`;
    await writeFile(path, JSON.stringify(report, null, 2));
    if (apply) await client.query('COMMIT');
    else await client.query('ROLLBACK');
    console.log(JSON.stringify({ok: true, mode: report.mode, reportPath: path, replacementName, cases: targetCodes}, null, 2));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
