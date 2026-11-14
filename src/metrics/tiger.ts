/**
 * TigerData (Tiger Cloud) mirror: the optional best-effort copy of public-run
 * stage samples into a Tiger Cloud hypertable of the same shape.
 *
 * SQLite (`stage_samples`) stays the source of truth; losing the mirror costs
 * nothing. Every failure is swallowed here or by the controller's catch, so a
 * mirror problem never affects the run, the report, or the exit status. The
 * client is Bun's built-in SQL over `TIGERDATA_URL`; `TIGERDATA_URL` unset
 * means the mirror is disabled (the controller seam stays undefined).
 *
 * Public (demo) runs only in v1: mirroring a private run would add a data copy
 * the owner did not opt into. Stage samples are batched in one UNNEST insert
 * per stage, compressed after 1 day, aggregated hourly via continuous
 * aggregates, and expired after 30 days via a TimescaleDB retention policy.
 */

import { SQL } from 'bun';
import type { StageSample } from '../types.ts';

/** The one Bun SQL method the mirror uses, shaped so tests can stub it. */
export interface TigerClient {
  unsafe(text: string, params?: unknown[]): Promise<unknown>;
}

export interface MirrorStageInput {
  runId: string;
  stageIdx: number;
  /** Stage start epoch ms; each sample's timestamp is startedAt + second * 1000. Null skips the mirror. */
  startedAt: number | null;
  samples: readonly StageSample[];
  /** Plan hash carried on each sample for cross-run regression queries. */
  planHash: string | null;
  visibility: 'public' | 'private';
}

const SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS stage_samples (
  sample_ts TIMESTAMPTZ NOT NULL,
  run_id TEXT NOT NULL,
  stage_idx INTEGER NOT NULL,
  second INTEGER NOT NULL,
  route TEXT NOT NULL,
  requests INTEGER NOT NULL,
  errors INTEGER NOT NULL,
  latency_sum_ms REAL NOT NULL,
  latency_max_ms REAL NOT NULL,
  plan_hash TEXT
)`;

const ADD_PLAN_HASH_SQL = 'ALTER TABLE stage_samples ADD COLUMN IF NOT EXISTS plan_hash TEXT';

// if_not_exists keeps a second start harmless; migrate_data covers rows written
// before the hypertable conversion if the table predates the mirror.
const HYPERTABLE_SQL =
  "SELECT create_hypertable('stage_samples', 'sample_ts', if_not_exists => TRUE, migrate_data => TRUE)";

const INDEX_STATEMENTS = [
  'CREATE INDEX IF NOT EXISTS stage_samples_route_ts_idx ON stage_samples (route, sample_ts DESC)',
  'CREATE INDEX IF NOT EXISTS stage_samples_run_idx ON stage_samples (run_id, stage_idx)',
];

const POLICY_STATEMENTS = [
  `ALTER TABLE stage_samples SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'run_id, route, stage_idx',
    timescaledb.compress_orderby = 'sample_ts DESC, second DESC'
  )`,
  "SELECT add_compression_policy('stage_samples', INTERVAL '1 day', if_not_exists => TRUE)",
  "SELECT add_retention_policy('stage_samples', INTERVAL '30 days', if_not_exists => TRUE)",
  `CREATE MATERIALIZED VIEW IF NOT EXISTS stage_samples_hourly
   WITH (timescaledb.continuous) AS
   SELECT time_bucket('1 hour', sample_ts) AS bucket,
          route,
          plan_hash,
          SUM(requests)::bigint AS requests,
          SUM(errors)::bigint AS errors,
          SUM(latency_sum_ms)::double precision AS latency_sum_ms,
          MAX(latency_max_ms)::double precision AS latency_max_ms
   FROM stage_samples
   GROUP BY bucket, route, plan_hash
   WITH NO DATA`,
  `SELECT add_continuous_aggregate_policy('stage_samples_hourly',
     start_offset => INTERVAL '7 days',
     end_offset => INTERVAL '1 hour',
     schedule_interval => INTERVAL '1 hour',
     if_not_exists => TRUE)`,
];

const BATCH_INSERT_SQL = `INSERT INTO stage_samples
  (sample_ts, run_id, stage_idx, second, route, requests, errors, latency_sum_ms, latency_max_ms, plan_hash)
  SELECT * FROM UNNEST(
    $1::timestamptz[],
    $2::text[],
    $3::int[],
    $4::int[],
    $5::text[],
    $6::int[],
    $7::int[],
    $8::real[],
    $9::real[],
    $10::text[]
  )`;

/** Creates the table, hypertable, indexes, and best-effort TimescaleDB policies. False on core DDL failure. */
export async function ensureTigerSchema(_url: string, client: TigerClient): Promise<boolean> {
  try {
    await client.unsafe(SCHEMA_SQL);
    await client.unsafe(ADD_PLAN_HASH_SQL);
    await client.unsafe(HYPERTABLE_SQL);
    for (const stmt of INDEX_STATEMENTS) {
      await client.unsafe(stmt);
    }
  } catch {
    return false;
  }

  for (const stmt of POLICY_STATEMENTS) {
    try {
      await client.unsafe(stmt);
    } catch {
      // Policies/caggs are best-effort (e.g. if already configured or tier-restricted).
    }
  }
  return true;
}

export function createTigerMirror(opts: {
  url: string;
  client?: TigerClient;
}): (input: MirrorStageInput) => Promise<void> {
  const client = opts.client ?? bunClient(opts.url);
  let schemaChecked = false;

  return async (input) => {
    try {
      if (input.visibility !== 'public') return;
      if (input.startedAt === null || input.samples.length === 0) return;
      if (!schemaChecked) {
        // A failed ensure still allows the insert: the table may already exist
        // from an earlier process, and the batch insert fails loudly either way.
        schemaChecked = await ensureTigerSchema(opts.url, client);
      }

      const n = input.samples.length;
      const sampleTs = new Array<string>(n);
      const runIds = new Array<string>(n);
      const stageIdxs = new Array<number>(n);
      const seconds = new Array<number>(n);
      const routes = new Array<string>(n);
      const requests = new Array<number>(n);
      const errors = new Array<number>(n);
      const latencySums = new Array<number>(n);
      const latencyMaxs = new Array<number>(n);
      const planHashes = new Array<string | null>(n);

      for (let i = 0; i < n; i++) {
        const s = input.samples[i]!;
        sampleTs[i] = new Date(input.startedAt + s.second * 1000).toISOString();
        runIds[i] = input.runId;
        stageIdxs[i] = input.stageIdx;
        seconds[i] = s.second;
        routes[i] = s.route;
        requests[i] = s.requests;
        errors[i] = s.errors;
        latencySums[i] = s.latencySumMs;
        latencyMaxs[i] = s.latencyMaxMs;
        planHashes[i] = input.planHash;
      }

      await client.unsafe(BATCH_INSERT_SQL, [
        sampleTs,
        runIds,
        stageIdxs,
        seconds,
        routes,
        requests,
        errors,
        latencySums,
        latencyMaxs,
        planHashes,
      ]);
    } catch {
      // Best effort by design: a mirror failure never affects the run.
    }
  };
}

/** The real client: Bun's SQL, connected lazily on the first query. */
function bunClient(url: string): TigerClient {
  const sql = new SQL(url);
  return {
    unsafe: (text, params) => sql.unsafe(text, params as Parameters<typeof sql.unsafe>[1]),
  };
}
