import type { Database } from 'bun:sqlite';

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS drafts (
  id TEXT PRIMARY KEY, traffic_event TEXT NOT NULL, created_at INTEGER NOT NULL,
  origin TEXT, routes_json TEXT, selected_ids_json TEXT
);
CREATE TABLE IF NOT EXISTS waitlist (email TEXT PRIMARY KEY, created_at INTEGER NOT NULL, invited_at INTEGER, joined_at INTEGER);
CREATE TABLE IF NOT EXISTS plans (hash TEXT PRIMARY KEY, text TEXT NOT NULL, approved_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS plan_targets (
  plan_hash TEXT PRIMARY KEY REFERENCES plans(hash),
  web_origin TEXT NOT NULL,
  api_origin TEXT NOT NULL,
  routes_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('run','probe')),
  plan_hash TEXT REFERENCES plans(hash), status TEXT NOT NULL, status_reason TEXT,
  runtime TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
  probe_result TEXT,
  owner_user_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  title TEXT
);
CREATE INDEX IF NOT EXISTS runs_plan ON runs(plan_hash, started_at DESC);
CREATE INDEX IF NOT EXISTS runs_started ON runs(started_at);
CREATE TABLE IF NOT EXISTS stages (
  run_id TEXT NOT NULL, idx INTEGER NOT NULL, vus INTEGER NOT NULL, duration_sec INTEGER NOT NULL,
  status TEXT NOT NULL, error_reason TEXT, metrics TEXT, verdict TEXT,
  generator_saturated INTEGER, started_at INTEGER, ended_at INTEGER,
  PRIMARY KEY (run_id, idx)
);
CREATE TABLE IF NOT EXISTS decisions (
  run_id TEXT NOT NULL, stage_idx INTEGER NOT NULL, decision TEXT NOT NULL,
  source TEXT NOT NULL, reason TEXT NOT NULL, reason_withheld INTEGER NOT NULL,
  PRIMARY KEY (run_id, stage_idx)
);
CREATE TABLE IF NOT EXISTS stage_samples (
  run_id TEXT NOT NULL, stage_idx INTEGER NOT NULL, second INTEGER NOT NULL, route TEXT NOT NULL,
  requests INTEGER NOT NULL, errors INTEGER NOT NULL, latency_sum_ms REAL NOT NULL, latency_max_ms REAL NOT NULL,
  PRIMARY KEY (run_id, stage_idx, second, route)
);
CREATE INDEX IF NOT EXISTS stage_samples_run ON stage_samples(run_id, stage_idx);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, type TEXT NOT NULL,
  stage_idx INTEGER, payload TEXT, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, id);
CREATE TABLE IF NOT EXISTS reports (run_id TEXT PRIMARY KEY, body TEXT NOT NULL, ai TEXT, ai_status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, draft_id TEXT, run_id TEXT, agent TEXT NOT NULL,
  model TEXT NOT NULL, outcome TEXT NOT NULL, latency_ms INTEGER NOT NULL,
  prompt_tokens INTEGER, completion_tokens INTEGER, ts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS planning_requests (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS client_starts (ip TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  primary_email TEXT NOT NULL UNIQUE,
  github_login TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS auth_identities (
  provider TEXT NOT NULL CHECK (provider IN ('email','github','google')),
  provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (provider, provider_subject)
);
CREATE INDEX IF NOT EXISTS auth_identities_user ON auth_identities(user_id);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS verified_origins (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  host TEXT NOT NULL UNIQUE,
  verified_at INTEGER NOT NULL,
  token TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_origin_verifications (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  host TEXT NOT NULL,
  token TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS account_drafts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  traffic_event TEXT NOT NULL,
  target_mode TEXT NOT NULL CHECK (target_mode IN ('demo','own')),
  target_origin TEXT,
  last_edited_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);
`;

/** Configures WAL journaling, sync mode, busy timeout, and foreign keys on the shared connection. */
export function configureDatabase(db: Database): void {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
}

function tableColumns(db: Database, table: string): string[] {
  return db
    .prepare<{ name: string }, []>(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => c.name);
}

function ensureColumns(db: Database, table: string, columns: readonly [name: string, definition: string][]): void {
  const existing = tableColumns(db, table);
  for (const [name, definition] of columns) {
    if (!existing.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
    }
  }
}

/** Add ownership columns on DBs created before account privacy. */
function migrateRunsOwnership(db: Database): void {
  ensureColumns(db, 'runs', [
    ['owner_user_id', 'TEXT'],
    ['visibility', "TEXT NOT NULL DEFAULT 'public'"],
    ['title', 'TEXT'],
  ]);
}

/** Add discovery columns on drafts created before own-site journeys. */
function migrateDraftDiscovery(db: Database): void {
  ensureColumns(db, 'drafts', [
    ['origin', 'TEXT'],
    ['routes_json', 'TEXT'],
    ['selected_ids_json', 'TEXT'],
  ]);
}

/** Add invite-tracking columns on waitlist rows created before activation. */
function migrateWaitlistActivation(db: Database): void {
  ensureColumns(db, 'waitlist', [
    ['invited_at', 'INTEGER'],
    ['joined_at', 'INTEGER'],
  ]);
}

function migrateAuthIdentitiesProvider(db: Database): void {
  const row = db
    .prepare<{ sql: string | null }, []>(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'auth_identities'",
    )
    .get();
  if (!row?.sql || row.sql.includes("'google'")) return;
  db.exec(`
    BEGIN IMMEDIATE;
    CREATE TABLE auth_identities_next (
      provider TEXT NOT NULL CHECK (provider IN ('email','github','google')),
      provider_subject TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      PRIMARY KEY (provider, provider_subject)
    );
    INSERT INTO auth_identities_next (provider, provider_subject, user_id)
    SELECT provider, provider_subject, user_id FROM auth_identities;
    DROP TABLE auth_identities;
    ALTER TABLE auth_identities_next RENAME TO auth_identities;
    CREATE INDEX IF NOT EXISTS auth_identities_user ON auth_identities(user_id);
    COMMIT;
  `);
}

/** Creates missing tables/indexes and runs idempotent forward schema migrations. */
export function initializeSchema(db: Database): void {
  db.exec(SCHEMA);
  migrateRunsOwnership(db);
  migrateDraftDiscovery(db);
  migrateWaitlistActivation(db);
  migrateAuthIdentitiesProvider(db);
}
