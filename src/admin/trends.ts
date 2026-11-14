/**
 * TigerData trends admin, run on the VM inside the API container (needs
 * TIGERDATA_URL in the environment; the mirror writes per-second samples of
 * public runs there — SQLite stays the source of truth):
 *
 *   docker exec macro-api bun src/admin/trends.ts runs              # one row per mirrored run
 *   docker exec macro-api bun src/admin/trends.ts route <routeId>   # per-run stats for one route
 *   docker exec macro-api bun src/admin/trends.ts worst [n]         # worst per-second averages (default 10)
 *
 * All queries are read-only. `avg ms` is the per-request average derived from
 * the mirrored latency sums; `max ms` is the worst single second's max.
 */
import { SQL } from 'bun';

/** The Tiger Cloud connection string, or exits with a fixed message. */
function tigerUrl(): string {
  const url = process.env['TIGERDATA_URL'];
  if (url === undefined || url === '') {
    console.error('Trends needs TIGERDATA_URL in the environment (the Tiger Cloud mirror target).');
    process.exit(2);
  }
  return url;
}

const url = tigerUrl();
const args = process.argv.slice(2);
const [command, ...rest] = args;

function usage(): never {
  console.error('Usage: bun src/admin/trends.ts runs | route <routeId> | worst [n]');
  process.exit(2);
}

function csv(...cells: (string | number)[]): string {
  return cells
    .map((c) => {
      const s = String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    })
    .join(',');
}

function day(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 16).replace('T', ' ');
  if (typeof value === 'string') return value.slice(0, 16).replace('T', ' ');
  return '?';
}

async function main(): Promise<void> {
  const sql = new SQL(url);

  if (command === 'runs') {
    const rows = await sql`
      SELECT run_id,
             COUNT(DISTINCT stage_idx)::int AS stages,
             COUNT(*)::int AS seconds,
             SUM(requests)::int AS requests,
             SUM(errors)::int AS errors,
             MIN(sample_ts) AS first_ts,
             MAX(sample_ts) AS last_ts
      FROM stage_samples
      GROUP BY run_id
      ORDER BY MIN(sample_ts) DESC`;
    console.log(csv('run', 'stages', 'seconds', 'requests', 'errors', 'window (UTC)'));
    for (const r of rows) {
      console.log(
        csv(r.run_id, r.stages, r.seconds, r.requests, r.errors, `${day(r.first_ts)} → ${day(r.last_ts)}`),
      );
    }
    return;
  }

  if (command === 'route') {
    const routeId = rest[0];
    if (routeId === undefined || routeId === '') usage();
    const rows = await sql`
      SELECT run_id, stage_idx,
             SUM(requests)::int AS requests,
             SUM(errors)::int AS errors,
             ROUND(SUM(latency_sum_ms)::numeric / NULLIF(SUM(requests), 0), 1) AS avg_ms,
             MAX(latency_max_ms) AS max_ms,
             MIN(sample_ts) AS first_ts
      FROM stage_samples
      WHERE route = ${routeId}
      GROUP BY run_id, stage_idx
      ORDER BY MIN(sample_ts), stage_idx`;
    console.log(csv('run', 'stage', 'requests', 'errors', 'avg ms', 'max ms', 'first sample (UTC)'));
    for (const r of rows) {
      console.log(csv(r.run_id, r.stage_idx, r.requests, r.errors, r.avg_ms ?? 'n/a', r.max_ms, day(r.first_ts)));
    }
    return;
  }

  if (command === 'worst') {
    const n = /^\d+$/.test(rest[0] ?? '') ? Number(rest[0]) : 10;
    const rows = await sql`
      SELECT run_id, stage_idx, second, route, requests, errors,
             ROUND(latency_sum_ms::numeric / NULLIF(requests, 0), 1) AS avg_ms,
             latency_max_ms AS max_ms
      FROM stage_samples
      WHERE requests > 0
      ORDER BY (latency_sum_ms / NULLIF(requests, 1)) DESC
      LIMIT ${n}`;
    console.log(csv('run', 'stage', 'second', 'route', 'requests', 'errors', 'avg ms', 'max ms'));
    for (const r of rows) {
      console.log(csv(r.run_id, r.stage_idx, r.second, r.route, r.requests, r.errors, r.avg_ms, r.max_ms));
    }
    return;
  }

  usage();
}

await main().then(
  () => process.exit(0),
  (e) => {
    const msg = e instanceof Error ? e.message : String(e);
    if (/relation .* does not exist/.test(msg)) {
      console.error('No stage_samples table on this TigerData service yet — no public run has been mirrored.');
    } else {
      console.error(`trends failed: ${msg.slice(0, 300)}`);
    }
    process.exit(1);
  },
);
