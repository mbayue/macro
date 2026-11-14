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
 * the owner did not opt into. Rows older than 30 days are pruned alongside the
 * inserts to keep the always-free tier's storage budget safe.
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
  /** Carried for future annotations; the mirrored table keeps the SQLite shape. */
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
  latency_max_ms REAL NOT NULL
)`;

// if_not_exists keeps a second start harmless; migrate_data covers rows written
// before the hypertable conversion if the table predates the mirror.
const HYPERTABLE_SQL =
  "SELECT create_hypertable('stage_samples', 'sample_ts', if_not_exists => TRUE, migrate_data => TRUE)";

const INSERT_SQL = `INSERT INTO stage_samples
  (sample_ts, run_id, stage_idx, second, route, requests, errors, latency_sum_ms, latency_max_ms)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;

const PRUNE_SQL = "DELETE FROM stage_samples WHERE sample_ts < now() - interval '30 days'";

/** Creates the table and the hypertable. False on failure (the caller decides what to do). */
export async function ensureTigerSchema(url: string, client: TigerClient): Promise<boolean> {
  try {
    await client.unsafe(SCHEMA_SQL);
    await client.unsafe(HYPERTABLE_SQL);
    return true;
  } catch {
    return false;
  }
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
        // A failed ensure still allows the inserts: the table may already exist
        // from an earlier process, and the first insert fails loudly either way.
        schemaChecked = await ensureTigerSchema(opts.url, client);
      }
      for (const s of input.samples) {
        const sampleTs = new Date(input.startedAt + s.second * 1000).toISOString();
        await client.unsafe(INSERT_SQL, [
          sampleTs,
          input.runId,
          input.stageIdx,
          s.second,
          s.route,
          s.requests,
          s.errors,
          s.latencySumMs,
          s.latencyMaxMs,
        ]);
      }
      await client.unsafe(PRUNE_SQL);
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
