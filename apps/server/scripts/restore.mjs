#!/usr/bin/env node
/**
 * Turn a backup snapshot into SQL you can apply with wrangler.
 *
 *   node scripts/restore.mjs backup.json > restore.sql
 *   npx wrangler d1 execute macromiser-prod --remote --env prod --file=restore.sql
 *
 * Prints SQL to stdout and never touches a database itself. Restoring is rare,
 * high-stakes, and irreversible — you should read the statements before running
 * them, and a script that helpfully applied them for you removes that step.
 *
 * By default the output only INSERTs. Pass --replace to wipe each table first,
 * which is what you want after a bad write and emphatically not what you want
 * if the live database has good rows the snapshot predates.
 */

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = args.find((a) => !a.startsWith('--'));

if (!file) {
  console.error('usage: node scripts/restore.mjs <backup.json> [--replace] > restore.sql');
  process.exit(1);
}

const snap = JSON.parse(readFileSync(file, 'utf8'));
if (!snap.data || !Array.isArray(snap.tables)) {
  console.error('That file is not a macromiser snapshot (no .data / .tables).');
  process.exit(1);
}

const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  // D1/SQLite has no boolean type; the schema stores these as 0/1.
  if (typeof v === 'boolean') return v ? '1' : '0';
  return `'${String(v).replace(/'/g, "''")}'`;
};

const out = [];
out.push(`-- macromiser restore`);
out.push(`-- snapshot taken ${snap.taken_at}`);
out.push(`-- schema ${snap.schema_migration}`);
out.push(`-- mode: ${replace ? 'REPLACE (tables are emptied first)' : 'INSERT ONLY'}`);
out.push('');

// Children before parents on delete, parents before children on insert — the
// schema has real foreign keys and will reject the wrong order.
const DELETE_ORDER = ['sets', 'workouts', 'meals', 'bodyweight', 'goals', 'portion_memory', 'users'];
const INSERT_ORDER = ['users', 'meals', 'workouts', 'sets', 'bodyweight', 'goals', 'portion_memory'];

if (replace) {
  for (const t of DELETE_ORDER) {
    if (snap.data[t]) out.push(`DELETE FROM ${t};`);
  }
  out.push('');
}

let total = 0;
for (const table of INSERT_ORDER) {
  const rows = snap.data[table];
  if (!Array.isArray(rows) || rows.length === 0) continue;

  const cols = Object.keys(rows[0]);
  out.push(`-- ${table}: ${rows.length} row(s)`);
  for (const r of rows) {
    const values = cols.map((c) => lit(r[c])).join(',');
    out.push(`INSERT OR REPLACE INTO ${table} (${cols.join(',')}) VALUES (${values});`);
    total++;
  }
  out.push('');
}

out.push(`-- ${total} row(s) total`);
console.log(out.join('\n'));
console.error(`${total} row(s) across ${INSERT_ORDER.filter((t) => snap.data[t]?.length).length} table(s).`);
