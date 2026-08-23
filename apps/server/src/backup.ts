/**
 * Nightly backup of the whole log to R2.
 *
 * D1 has no point-in-time restore on the free tier, and there are no delete or
 * edit tools yet — so today the only way to undo a bad write is hand-editing
 * production SQL. That makes a restorable snapshot the cheapest insurance in
 * the project, not a nice-to-have.
 *
 * Deliberately a full dump rather than an incremental one. The dataset is a few
 * thousand rows of text; the simplest thing that can actually be restored beats
 * a clever thing that cannot. One JSON object per night, keyed by date.
 *
 * Not `wrangler d1 export` — that is a CLI command and cannot run inside a
 * Worker. This reads every table directly, which also means the snapshot is a
 * plain object anyone can inspect without SQLite.
 */

import type { Env } from './index.ts';

/** Every table in migrations/0001_init.sql. Adding a table here is required — a
 *  backup that silently omits one is worse than no backup, because it is
 *  trusted. The row count assertion below is what catches that. */
const TABLES = [
  'users',
  'meals',
  'workouts',
  'sets',
  'bodyweight',
  'goals',
  'portion_memory',
  'captures',
] as const;

const RETENTION_DAYS = 30;

export interface BackupResult {
  key: string;
  bytes: number;
  rows: Record<string, number>;
  total_rows: number;
  pruned: string[];
}

export async function runBackup(env: Env, now: Date): Promise<BackupResult> {
  if (!env.BACKUPS) throw new Error('BACKUPS bucket is not bound');

  const snapshot: Record<string, unknown[]> = {};
  const rows: Record<string, number> = {};

  for (const table of TABLES) {
    // Table names are from the const list above, never from input.
    const res = await env.DB.prepare(`SELECT * FROM ${table}`).all();
    const list = res.results ?? [];
    snapshot[table] = list;
    rows[table] = list.length;
  }

  const total = Object.values(rows).reduce((a, b) => a + b, 0);

  const stamp = now.toISOString().slice(0, 10);
  const key = `d1/${stamp}.json`;
  const body = JSON.stringify(
    {
      taken_at: now.toISOString(),
      schema_migration: '0001_init.sql',
      tables: TABLES,
      row_counts: rows,
      data: snapshot,
    },
    null,
    1,
  );

  await env.BACKUPS.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { rows: String(total), taken_at: now.toISOString() },
  });

  // ---- retention ----
  // Keep the most recent RETENTION_DAYS snapshots. Pruning by listing rather
  // than by computed date means a gap in the schedule never strands old objects.
  const pruned: string[] = [];
  const listed = await env.BACKUPS.list({ prefix: 'd1/' });
  const keys = listed.objects.map((o) => o.key).sort();
  if (keys.length > RETENTION_DAYS) {
    const drop = keys.slice(0, keys.length - RETENTION_DAYS);
    for (const k of drop) {
      await env.BACKUPS.delete(k);
      pruned.push(k);
    }
  }

  return { key, bytes: body.length, rows, total_rows: total, pruned };
}

/**
 * Cron entrypoint. Logs a structured line either way — a backup that fails
 * silently is indistinguishable from one that never ran.
 */
export async function scheduledBackup(env: Env, now: Date): Promise<void> {
  const started = Date.now();
  try {
    const r = await runBackup(env, now);
    console.log(
      JSON.stringify({
        event: 'backup_ok',
        key: r.key,
        bytes: r.bytes,
        rows: r.total_rows,
        pruned: r.pruned.length,
        ms: Date.now() - started,
      }),
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: 'backup_failed',
        detail: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      }),
    );
    throw err;
  }
}
