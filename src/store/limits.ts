import type { Database } from 'bun:sqlite';

export const LIMIT_ROW_TTL_MS = 24 * 3_600_000;
export const PURGE_INTERVAL_MS = 3_600_000;

interface RawWaitlist {
  email: string;
  created_at: number;
  invited_at: number | null;
  joined_at: number | null;
}

interface TsRow {
  ts: number;
}

export interface WaitlistRow {
  email: string;
  createdAt: number;
  invitedAt: number | null;
  joinedAt: number | null;
}

function toWaitlist(r: RawWaitlist): WaitlistRow {
  return {
    email: r.email,
    createdAt: r.created_at,
    invitedAt: r.invited_at,
    joinedAt: r.joined_at,
  };
}

/** Persistence operations for rate-limit windows, waitlist entries, and TTL purges. */
export class LimitsStore {
  constructor(private readonly db: Database) {}

  /** Adds a normalised email. Returns true when it was new, false when it was already on the list. */
  addWaitlistEmail(email: string, ts: number): boolean {
    return this.db.prepare('INSERT OR IGNORE INTO waitlist (email, created_at) VALUES (?, ?)').run(email, ts).changes > 0;
  }

  /** Every waitlist entry, oldest first, with the invite funnel times. */
  listWaitlist(): WaitlistRow[] {
    return this.db
      .prepare<RawWaitlist, []>('SELECT email, created_at, invited_at, joined_at FROM waitlist ORDER BY created_at, email')
      .all()
      .map(toWaitlist);
  }

  /** One waitlist row, or null. */
  getWaitlist(email: string): WaitlistRow | null {
    const r = this.db
      .prepare<RawWaitlist, [string]>(
        'SELECT email, created_at, invited_at, joined_at FROM waitlist WHERE email = ?',
      )
      .get(email);
    return r === null ? null : toWaitlist(r);
  }

  /** Marks the invite as sent. Overwrites the time, so a forced re-send moves it. */
  markWaitlistInvited(email: string, ts: number): void {
    this.db.prepare('UPDATE waitlist SET invited_at = ? WHERE email = ?').run(ts, email);
  }

  /**
   * Stamps the first sign-in after an invite. True only when the row exists, is
   * invited, and had no joined time yet.
   */
  markWaitlistJoined(email: string, ts: number): boolean {
    return (
      this.db
        .prepare('UPDATE waitlist SET joined_at = ? WHERE email = ? AND invited_at IS NOT NULL AND joined_at IS NULL')
        .run(ts, email).changes > 0
    );
  }

  /** Removes one email (a deletion request). Returns true when a row was deleted. */
  removeWaitlistEmail(email: string): boolean {
    return this.db.prepare('DELETE FROM waitlist WHERE email = ?').run(email).changes > 0;
  }

  recordPlanningRequest(ip: string, ts: number): void {
    this.db.prepare('INSERT INTO planning_requests (ip, ts) VALUES (?, ?)').run(ip, ts);
  }

  /** Timestamps for `ip` with ts > sinceMs, ascending. */
  planningRequestTimestamps(ip: string, sinceMs: number): number[] {
    return this.db
      .prepare<TsRow, [string, number]>('SELECT ts FROM planning_requests WHERE ip = ? AND ts > ? ORDER BY ts')
      .all(ip, sinceMs)
      .map((r) => r.ts);
  }

  recordClientStart(ip: string, ts: number): void {
    this.db.prepare('INSERT INTO client_starts (ip, ts) VALUES (?, ?)').run(ip, ts);
  }

  /** Timestamps for `ip` with ts > sinceMs, ascending. */
  clientStartTimestamps(ip: string, sinceMs: number): number[] {
    return this.db
      .prepare<TsRow, [string, number]>('SELECT ts FROM client_starts WHERE ip = ? AND ts > ? ORDER BY ts')
      .all(ip, sinceMs)
      .map((r) => r.ts);
  }

  /** Deletes planning_requests and client_starts rows older than 24 h. Returns rows deleted. */
  purgeOldLimitRows(now: number): number {
    const cutoff = now - LIMIT_ROW_TTL_MS;
    return this.db
      .transaction(() => {
        const a = this.db.prepare('DELETE FROM planning_requests WHERE ts < ?').run(cutoff).changes;
        const b = this.db.prepare('DELETE FROM client_starts WHERE ts < ?').run(cutoff).changes;
        return a + b;
      })
      .immediate();
  }

  /**
   * Runs `purgeOldLimitRows` every hour (timer does not keep the process alive).
   * Returns a function that stops the timer.
   */
  startPurgeTimer(opts: { intervalMs?: number; clock?: () => number } = {}): () => void {
    const clock = opts.clock ?? Date.now;
    const timer = setInterval(() => {
      try {
        this.purgeOldLimitRows(clock());
      } catch (err) {
        console.error('limit-row purge failed:', err instanceof Error ? err.message : 'unknown error');
      }
    }, opts.intervalMs ?? PURGE_INTERVAL_MS);
    timer.unref();
    return () => clearInterval(timer);
  }
}
