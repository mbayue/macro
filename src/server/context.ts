import type { InferenceClient } from '../agents/inference.ts';
import type { PlanOutcome } from '../agents/planner.ts';
import type { DemoTrendsResponse, RunListItem } from '../api-types.ts';
import type { ResendMailer } from '../auth/magic-link.ts';
import type { SessionRow, UserRow } from '../auth/types.ts';
import type { FetchLike, ResolveNs, ResolveTxt } from '../auth/verify-origin.ts';
import type { Config } from '../config.ts';
import type { DiscoveredRoute } from '../plan/discover.ts';
import type { RunRow, RunVisibility, Store } from '../store/db.ts';
import type { RunKind, TestPlan } from '../types.ts';

/** What `createApp` needs from RunController and ProbeController. */
export interface RunStarter {
  start(runId: string): void;
  stop(runId: string): boolean;
  isRunning(runId: string): boolean;
  hasActive?(): boolean;
  whenDone?(runId: string): Promise<void>;
}

export type TurnstileVerifier = (token: string | undefined, ip: string) => Promise<{ ok: boolean }>;

export type PlannerFn = (
  trafficEvent: string,
  draftId: string,
  target?: Config['target'],
  discovered?: readonly DiscoveredRoute[],
  baselineNote?: string,
) => Promise<PlanOutcome>;

/** The part of `Bun.Server` this module uses. */
export interface ServerLike {
  timeout(req: Request, seconds: number): void;
}

export interface Clock {
  /** Runs `fn` every `ms`; returns the function that cancels it. */
  every(fn: () => void, ms: number): () => void;
}

export interface AppDeps {
  store: Store;
  /** The EFFECTIVE config (`sandbox.runtimeError` already set when the runtime is unusable). */
  config: Config;
  verifyTurnstile: TurnstileVerifier;
  client: InferenceClient;
  /** Defaults to `planTrafficEvent({ client, target: config.target }, ...)`. */
  planner?: PlannerFn;
  runController: RunStarter;
  probeController: RunStarter;
  now?: () => number;
  clock?: Clock;
  /** Directory served as the Web_UI. Defaults to `<repo>/web/dist`. */
  webDist?: string;
  sse?: {
    pollMs?: number;
    heartbeatMs?: number;
    terminalGraceMs?: number;
    maxLifetimeMs?: number;
    maxPerIp?: number;
    maxTotal?: number;
  };
  /** Receives one JSON line per internal error. Defaults to `console.error`. */
  log?: (line: string) => void;
  /** Optional Resend mailer for magic links. Required for magic-link routes when auth is configured. */
  mailer?: ResendMailer;
  /** Injectable fetch for GitHub OAuth (defaults to global fetch). */
  githubFetch?: typeof fetch;
  /** Injectable fetch for Google OAuth (defaults to global fetch). */
  googleFetch?: typeof fetch;
  /** Injectable DNS TXT resolver for origin verification (defaults to node:dns/promises). */
  resolveTxt?: ResolveTxt;
  /** Injectable DNS CNAME resolver for Domain Connect discovery (defaults to node:dns/promises). */
  resolveCname?: (hostname: string) => Promise<string[]>;
  /** Injectable DNS NS resolver for origin detection (defaults to node:dns/promises). */
  resolveNs?: ResolveNs;
  /** Injectable fetch for well-known origin checks (defaults to global fetch). */
  fetchImpl?: FetchLike;
  /** Optional TigerData 30-day demo baseline reader (`GET /api/trends/demo`). */
  getDemoTrends?: () => Promise<DemoTrendsResponse>;
}

export interface App {
  fetch(req: Request, server?: ServerLike): Promise<Response>;
}

export interface Ctx {
  req: Request;
  url: URL;
  ip: string;
  server: ServerLike | undefined;
  params: string[];
}

export type Handler = (c: Ctx) => Response | Promise<Response>;

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  re: RegExp;
  name: string;
  handler: Handler;
}

/** Shared runtime context passed to internal HTTP route and SSE modules. */
export interface ServerContext {
  readonly store: Store;
  readonly config: Config;
  readonly deps: AppDeps;
  readonly now: () => number;
  readonly clock: Clock;
  readonly cookieSecure: boolean;
  readonly planner: PlannerFn;
  controllerFor(kind: RunKind): RunStarter;
  logInternal(where: string, err: unknown): void;
  turnstileGate(token: unknown, ip: string): Promise<Response | null>;
  resolveSession(req: Request): { user: UserRow; session: SessionRow } | null;
  requireSession(req: Request): { user: UserRow; session: SessionRow } | Response;
  requireAuth(req: Request): { user: UserRow; session: SessionRow } | Response;
  turnstileUnlessSignedIn(
    req: Request,
    token: unknown,
    ip: string,
  ): Promise<{ denied: Response | null; subject: string; user: UserRow | null }>;
  resolvePlanTarget(
    mode: 'demo' | 'own' | undefined,
    targetOrigin: string | undefined,
    user: UserRow | null,
  ): { ok: true; target: Config['target'] } | { ok: false; res: Response };
  admitAndStart(
    kind: RunKind,
    planHash: string | undefined,
    subject: string,
    ownership?: { ownerUserId: string | null; visibility: RunVisibility },
  ): Response;
  canViewRun(run: { visibility: RunVisibility; ownerUserId: string | null }, req: Request): boolean;
  planFromStore(planHash: string | null): TestPlan | null;
  toRunListItem(r: RunRow): RunListItem;
}
