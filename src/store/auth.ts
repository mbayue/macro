import type { Database } from 'bun:sqlite';
import type { SessionRow, UserRow } from '../auth/types.ts';

interface RawUser {
  id: string;
  primary_email: string;
  github_login: string | null;
  created_at: number;
}

interface RawSession {
  id: string;
  user_id: string;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toUser(r: RawUser): UserRow {
  return {
    id: r.id,
    primaryEmail: r.primary_email,
    githubLogin: r.github_login,
    createdAt: r.created_at,
  };
}

function toSession(r: RawSession): SessionRow {
  return {
    id: r.id,
    userId: r.user_id,
    createdAt: r.created_at,
    lastSeenAt: r.last_seen_at,
    expiresAt: r.expires_at,
  };
}

/** Persistence operations for users, auth identities, sessions, and magic-link tokens. */
export class AuthStore {
  constructor(private readonly db: Database) {}

  createUser(email: string, now: number): UserRow {
    const primaryEmail = normalizeEmail(email);
    const id = crypto.randomUUID();
    this.db
      .prepare('INSERT INTO users (id, primary_email, github_login, created_at) VALUES (?, ?, NULL, ?)')
      .run(id, primaryEmail, now);
    return { id, primaryEmail, githubLogin: null, createdAt: now };
  }

  findUserByEmail(email: string): UserRow | null {
    const r = this.db
      .prepare<RawUser, [string]>(
        'SELECT id, primary_email, github_login, created_at FROM users WHERE primary_email = ?',
      )
      .get(normalizeEmail(email));
    return r ? toUser(r) : null;
  }

  getUser(id: string): UserRow | null {
    const r = this.db
      .prepare<RawUser, [string]>('SELECT id, primary_email, github_login, created_at FROM users WHERE id = ?')
      .get(id);
    return r ? toUser(r) : null;
  }

  /**
   * Deletes a user account, its sessions/identities/verifications/drafts (via CASCADE),
   * and all private runs owned by the user; public demo runs are unlinked.
   */
  deleteUser(userId: string): boolean {
    return this.db
      .transaction(() => {
        const priv = this.db
          .prepare<{ id: string }, [string]>(
            "SELECT id FROM runs WHERE owner_user_id = ? AND visibility = 'private'",
          )
          .all(userId);
        for (const { id } of priv) {
          this.db.prepare('DELETE FROM stage_samples WHERE run_id = ?').run(id);
          this.db.prepare('DELETE FROM stages WHERE run_id = ?').run(id);
          this.db.prepare('DELETE FROM decisions WHERE run_id = ?').run(id);
          this.db.prepare('DELETE FROM events WHERE run_id = ?').run(id);
          this.db.prepare('DELETE FROM reports WHERE run_id = ?').run(id);
          this.db.prepare('DELETE FROM model_calls WHERE run_id = ?').run(id);
          this.db.prepare('DELETE FROM runs WHERE id = ?').run(id);
        }
        this.db.prepare('UPDATE runs SET owner_user_id = NULL WHERE owner_user_id = ?').run(userId);
        const subject = `user:${userId}`;
        this.db.prepare('DELETE FROM planning_requests WHERE ip = ?').run(subject);
        this.db.prepare('DELETE FROM client_starts WHERE ip = ?').run(subject);
        return this.db.prepare('DELETE FROM users WHERE id = ?').run(userId).changes > 0;
      })
      .immediate();
  }

  linkIdentity(userId: string, provider: 'email' | 'github' | 'google', providerSubject: string): void {
    const subject = provider === 'email' ? normalizeEmail(providerSubject) : providerSubject;
    this.db
      .prepare(
        `INSERT INTO auth_identities (provider, provider_subject, user_id) VALUES (?, ?, ?)
         ON CONFLICT(provider, provider_subject) DO UPDATE SET user_id = excluded.user_id`,
      )
      .run(provider, subject, userId);
  }

  findUserByIdentity(provider: 'email' | 'github' | 'google', providerSubject: string): UserRow | null {
    const subject = provider === 'email' ? normalizeEmail(providerSubject) : providerSubject;
    const r = this.db
      .prepare<RawUser, [string, string]>(
        `SELECT u.id, u.primary_email, u.github_login, u.created_at
         FROM auth_identities i
         JOIN users u ON u.id = i.user_id
         WHERE i.provider = ? AND i.provider_subject = ?`,
      )
      .get(provider, subject);
    return r ? toUser(r) : null;
  }

  createSession(userId: string, now: number, ttlMs: number): SessionRow {
    const id = crypto.randomUUID();
    const expiresAt = now + ttlMs;
    this.db
      .prepare(
        'INSERT INTO sessions (id, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
      )
      .run(id, userId, now, now, expiresAt);
    return { id, userId, createdAt: now, lastSeenAt: now, expiresAt };
  }

  getSession(id: string): SessionRow | null {
    const r = this.db
      .prepare<RawSession, [string]>(
        'SELECT id, user_id, created_at, last_seen_at, expires_at FROM sessions WHERE id = ?',
      )
      .get(id);
    return r ? toSession(r) : null;
  }

  touchSession(id: string, now: number, ttlMs: number): SessionRow | null {
    const expiresAt = now + ttlMs;
    const res = this.db
      .prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
      .run(now, expiresAt, id);
    if (res.changes === 0) return null;
    return this.getSession(id);
  }

  deleteSession(id: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  createMagicLinkToken(
    userId: string | null,
    email: string,
    tokenHash: string,
    now: number,
    ttlMs: number,
  ): void {
    this.db
      .prepare(
        `INSERT INTO magic_link_tokens (token_hash, email, user_id, created_at, expires_at, used_at)
         VALUES (?, ?, ?, ?, ?, NULL)`,
      )
      .run(tokenHash, normalizeEmail(email), userId, now, now + ttlMs);
  }

  consumeMagicLinkToken(
    tokenHash: string,
    now: number,
  ): { email: string; userId: string | null } | null {
    return this.db
      .transaction(() => {
        const row = this.db
          .prepare<{ email: string; user_id: string | null; expires_at: number; used_at: number | null }, [string]>(
            'SELECT email, user_id, expires_at, used_at FROM magic_link_tokens WHERE token_hash = ?',
          )
          .get(tokenHash);
        if (row === null) return null;
        if (row.used_at !== null) return null;
        if (row.expires_at < now) return null;
        this.db.prepare('UPDATE magic_link_tokens SET used_at = ? WHERE token_hash = ?').run(now, tokenHash);
        return { email: row.email, userId: row.user_id };
      })
      .immediate();
  }

  setUserGithubLogin(userId: string, login: string | null): void {
    this.db.prepare('UPDATE users SET github_login = ? WHERE id = ?').run(login, userId);
  }
}
