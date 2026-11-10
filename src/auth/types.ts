/** Shared auth / verification row shapes for Store and HTTP handlers. */

export interface UserRow {
  id: string;
  primaryEmail: string;
  githubLogin: string | null;
  createdAt: number;
}

export interface SessionRow {
  id: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
}

export interface VerifiedOriginRow {
  userId: string;
  origin: string;
  host: string;
  verifiedAt: number;
  token: string;
}

/** Thrown when setVerifiedOrigin hits a host another account already holds. */
export class ContestedOriginError extends Error {
  readonly code = 'contested_origin' as const;
  constructor(host: string) {
    super(`origin host is owned by another account: ${host}`);
    this.name = 'ContestedOriginError';
  }
}
