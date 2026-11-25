import type { Database } from 'bun:sqlite';
import { ContestedOriginError } from '../auth/types.ts';
import type {
  AccountDraftRow,
  PendingOriginVerificationRow,
  VerifiedOriginRow,
} from '../auth/types.ts';

interface RawVerifiedOrigin {
  user_id: string;
  origin: string;
  host: string;
  verified_at: number;
  token: string;
}

interface RawPendingOriginVerification {
  user_id: string;
  origin: string;
  host: string;
  token: string;
  created_at: number;
}

interface RawAccountDraft {
  user_id: string;
  traffic_event: string;
  target_mode: 'demo' | 'own';
  target_origin: string | null;
  last_edited_at: number;
}

function toVerifiedOrigin(r: RawVerifiedOrigin): VerifiedOriginRow {
  return {
    userId: r.user_id,
    origin: r.origin,
    host: r.host,
    verifiedAt: r.verified_at,
    token: r.token,
  };
}

function toPendingOriginVerification(r: RawPendingOriginVerification): PendingOriginVerificationRow {
  return {
    userId: r.user_id,
    origin: r.origin,
    host: r.host,
    token: r.token,
    createdAt: r.created_at,
  };
}

function toAccountDraft(r: RawAccountDraft): AccountDraftRow {
  return {
    userId: r.user_id,
    trafficEvent: r.traffic_event,
    targetMode: r.target_mode,
    targetOrigin: r.target_origin,
    lastEditedAt: r.last_edited_at,
  };
}

/** Persistence operations for verified Own Site origins, pending verifications, and account drafts. */
export class VerifyStore {
  constructor(private readonly db: Database) {}

  setVerifiedOrigin(userId: string, origin: string, host: string, token: string, now: number): void {
    this.db
      .transaction(() => {
        const owner = this.db
          .prepare<{ user_id: string }, [string]>('SELECT user_id FROM verified_origins WHERE host = ?')
          .get(host);
        if (owner !== null && owner.user_id !== userId) {
          throw new ContestedOriginError(host);
        }
        this.db.prepare('DELETE FROM verified_origins WHERE user_id = ?').run(userId);
        this.db
          .prepare(
            'INSERT INTO verified_origins (user_id, origin, host, verified_at, token) VALUES (?, ?, ?, ?, ?)',
          )
          .run(userId, origin, host, now, token);
      })
      .immediate();
  }

  clearVerifiedOrigin(userId: string): void {
    this.db.prepare('DELETE FROM verified_origins WHERE user_id = ?').run(userId);
  }

  getVerifiedOrigin(userId: string): VerifiedOriginRow | null {
    const r = this.db
      .prepare<RawVerifiedOrigin, [string]>(
        'SELECT user_id, origin, host, verified_at, token FROM verified_origins WHERE user_id = ?',
      )
      .get(userId);
    return r ? toVerifiedOrigin(r) : null;
  }

  findVerifiedOriginByHost(host: string): VerifiedOriginRow | null {
    const r = this.db
      .prepare<RawVerifiedOrigin, [string]>(
        'SELECT user_id, origin, host, verified_at, token FROM verified_origins WHERE host = ?',
      )
      .get(host);
    return r ? toVerifiedOrigin(r) : null;
  }

  setPendingOriginVerification(
    userId: string,
    origin: string,
    host: string,
    token: string,
    now: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO pending_origin_verifications (user_id, origin, host, token, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           origin = excluded.origin,
           host = excluded.host,
           token = excluded.token,
           created_at = excluded.created_at`,
      )
      .run(userId, origin, host, token, now);
  }

  getPendingOriginVerification(userId: string): PendingOriginVerificationRow | null {
    const r = this.db
      .prepare<RawPendingOriginVerification, [string]>(
        'SELECT user_id, origin, host, token, created_at FROM pending_origin_verifications WHERE user_id = ?',
      )
      .get(userId);
    return r ? toPendingOriginVerification(r) : null;
  }

  clearPendingOriginVerification(userId: string): void {
    this.db.prepare('DELETE FROM pending_origin_verifications WHERE user_id = ?').run(userId);
  }

  getAccountDraft(userId: string): AccountDraftRow | null {
    const r = this.db
      .prepare<RawAccountDraft, [string]>(
        `SELECT user_id, traffic_event, target_mode, target_origin, last_edited_at
         FROM account_drafts WHERE user_id = ?`,
      )
      .get(userId);
    return r ? toAccountDraft(r) : null;
  }

  /**
   * Store the draft when client lastEditedAt is >= stored (equal → body wins).
   * Returns `{ stored }` on accept, or `{ conflict: existing }` when the server draft is newer.
   */
  putAccountDraft(
    userId: string,
    draft: Omit<AccountDraftRow, 'userId'>,
  ): { stored: AccountDraftRow } | { conflict: AccountDraftRow } {
    return this.db
      .transaction(() => {
        const existing = this.getAccountDraft(userId);
        if (existing !== null && existing.lastEditedAt > draft.lastEditedAt) {
          return { conflict: existing };
        }
        this.db
          .prepare(
            `INSERT INTO account_drafts (user_id, traffic_event, target_mode, target_origin, last_edited_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(user_id) DO UPDATE SET
               traffic_event = excluded.traffic_event,
               target_mode = excluded.target_mode,
               target_origin = excluded.target_origin,
               last_edited_at = excluded.last_edited_at`,
          )
          .run(userId, draft.trafficEvent, draft.targetMode, draft.targetOrigin, draft.lastEditedAt);
        return {
          stored: {
            userId,
            trafficEvent: draft.trafficEvent,
            targetMode: draft.targetMode,
            targetOrigin: draft.targetOrigin,
            lastEditedAt: draft.lastEditedAt,
          },
        };
      })
      .immediate();
  }
}
