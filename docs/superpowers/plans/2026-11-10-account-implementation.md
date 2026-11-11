# Account + Own-Site Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add personal accounts (GitHub + Resend magic link), one verified origin per account, and gate own-site load tests while keeping the demo shop usable signed out.

**Architecture:** Extend the existing Bun SQLite `Store` and injectable `createApp` HTTP surface with auth, sessions, verification, and ownership. The React planner at `/app/` gains an explicit Demo/My site control, rail identity, sign-in route, and inline verify panel. Policy allowlisting stays fixed code (`evaluatePlan`); the planner receives a per-request allowlist that may include the account's verified origin.

**Tech Stack:** Bun, bun:sqlite, zod, React 19 + Vite planner, Resend HTTP API, GitHub OAuth (fetch), Cloudflare Turnstile (signed-out only).

**Spec:** `docs/superpowers/specs/2026-11-10-account-design.md`

## Global Constraints

- Copy: plain, specific, measured; no hype; no em dashes in user-facing strings.
- Strict CSP already in `src/server.ts` (`CSP` constant): no inline scripts, no style attributes; untrusted text as text.
- Demo shop origin remains the first `TARGET_ORIGINS` entry (`config.target.webOrigin`); demo never spends the verified-origin slot.
- Containment probe stays demo-shop only in this plan (no own-site probe).
- Personal accounts only; no teams.
- Own-site reports are owner-only; demo reports stay public even after claim.
- Turnstile required only when there is no valid session.
- Do not invent paid-plan UI.
- WCAG 2.2 AA; status never by colour alone; reduced motion respected.
- Local commits after each task; do not push or deploy unless the user says `ship`.
- Never read or print `macro/.env`.

## Review Focus

- Signed-out caller posts `/api/plan` with a non-demo `targetOrigin` → 401/403, never plans against that host.
- Session cookie stolen on an own-site run URL while signed out elsewhere → GET `/api/runs/:id` and SSE return 404/403, never the private report body.
- Second account verifies an origin the first still holds → check fails; first keeps it.
- GitHub OAuth returns a user with no usable email → sign-in refused; no orphan GitHub-only user row.
- Magic-link token reused after success → second consume fails; session from first consume still works until Sign out.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `src/auth/types.ts` | Shared auth/verification TypeScript types |
| `src/auth/session.ts` | Cookie parse/serialize, session id generation, sliding expiry helpers (pure) |
| `src/auth/magic-link.ts` | Token hash/issue helpers; Resend mailer interface |
| `src/auth/github.ts` | OAuth URL + code exchange + email resolution (injectable fetch) |
| `src/auth/verify-origin.ts` | Normalize host, TXT / well-known check (injectable DNS + fetch) |
| `src/auth/passwords.ts` | N/A — unused (magic link + OAuth only) |
| `src/store/db.ts` | Schema + store methods for users, identities, sessions, magic tokens, verified origins, account drafts, run ownership |
| `src/config.ts` | Optional auth env: `SESSION_SECRET`, `RESEND_API_KEY`, `RESEND_FROM`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`, `PUBLIC_BASE_URL` |
| `src/api-types.ts` | Me/draft/verify/claim request + response types; extend plan/approve bodies with `targetMode` / `targetOrigin`; optional `turnstileToken` |
| `src/server.ts` | Auth routes, session gate, Turnstile skip, per-account limits, privacy on run GET/SSE, allowlist selection |
| `src/main.ts` | Wire Resend/GitHub/DNS deps from config |
| `src/agents/planner.ts` | Already takes `deps.target.allowlist` — callers pass the per-request allowlist |
| `src/plan/policy.ts` | Unchanged API; callers pass expanded allowlist |
| `web/landing/src/app/lib/auth-api.ts` | Client fetch helpers for me/sign-in/sign-out/verify/draft/claim |
| `web/landing/src/app/lib/session.ts` | Hold me-state helpers if needed |
| `web/landing/src/app/pages/SignIn.tsx` | GitHub + email magic link |
| `web/landing/src/app/pages/NewTest.tsx` | Demo/My site control, gates, inline verify |
| `web/landing/src/app/components/Shell.tsx` | Rail foot identity / Sign in |
| `web/landing/src/app/components/VerifyPanel.tsx` | Inline DNS + well-known instructions |
| `web/landing/src/app/router.ts` | `#/sign-in` |
| `web/landing/src/app/context.tsx` / `App.tsx` | Load `/api/me`, expose session |
| `web/landing/src/app/lib/api.ts` | Plan/approve bodies + optional Turnstile |
| `test/auth-*.test.ts`, `test/verify-origin.test.ts`, `test/account-draft.test.ts`, `test/run-privacy.test.ts` | Server/store tests |
| `PRODUCT.md` / `README.md` | Phase 2 account/verify status — update only in the final docs task |

Builder defaults pinned by this plan (spec left them open):

- Session cookie name: `macro_session`; value = opaque session id; `HttpOnly; Secure; SameSite=Lax; Path=/`; idle TTL 30 days; slide on each authenticated request.
- Magic link TTL: 15 minutes; one-time; hashed at rest (SHA-256 of token).
- GitHub callback path: `/api/auth/github/callback`.
- Magic consume path: `GET /api/auth/magic-link/consume?token=…` then redirect to `/app/#/` or returnTo.
- Verification TXT name: `_macro.<hostname>`; TXT value: `macro-site-verification=<token>`.
- Well-known URL: `https://<hostname>/.well-known/macro-site-verification` (HTTPS only); body must equal the raw token (trim trailing newline allowed).
- Account rolling/daily budgets: reuse `PLANNING_LIMIT`, `START_LIMIT`, and `DAILY_MAX` from `src/run/limits.ts`, keyed by `user:<id>` instead of IP when signed in.
- `SESSION_SECRET` required when any auth provider env is set; if no auth env is set, auth routes return 503 with a fixed message (local demo without accounts still works).

---

### Task 1: Auth schema and store primitives

**Files:**
- Modify: `src/store/db.ts`
- Create: `src/auth/types.ts`
- Test: `test/auth-store.test.ts`

**Interfaces:**
- Produces:
  - `UserRow { id: string; primaryEmail: string; githubLogin: string | null; createdAt: number }`
  - `SessionRow { id: string; userId: string; createdAt: number; lastSeenAt: number; expiresAt: number }`
  - `VerifiedOriginRow { userId: string; origin: string; host: string; verifiedAt: number; token: string }`
  - `Store.createUser(email: string, now: number): UserRow`
  - `Store.findUserByEmail(email: string): UserRow | null`
  - `Store.linkIdentity(userId: string, provider: 'email' | 'github', providerSubject: string): void`
  - `Store.findUserByIdentity(provider: 'email' | 'github', providerSubject: string): UserRow | null`
  - `Store.createSession(userId: string, now: number, ttlMs: number): SessionRow`
  - `Store.getSession(id: string): SessionRow | null`
  - `Store.touchSession(id: string, now: number, ttlMs: number): SessionRow | null`
  - `Store.deleteSession(id: string): void`
  - `Store.setVerifiedOrigin(userId: string, origin: string, host: string, token: string, now: number): void` (replaces any prior row for that user; enforces unique active `host` across users — throw typed conflict)
  - `Store.clearVerifiedOrigin(userId: string): void`
  - `Store.getVerifiedOrigin(userId: string): VerifiedOriginRow | null`
  - `Store.findVerifiedOriginByHost(host: string): VerifiedOriginRow | null`

- [x] **Step 1: Write the failing test**

```ts
test('createSession + touchSession slides expiresAt', () => {
  const store = new Store(':memory:');
  const user = store.createUser('a@example.com', 1_000);
  const s = store.createSession(user.id, 1_000, 60_000);
  expect(s.expiresAt).toBe(61_000);
  const touched = store.touchSession(s.id, 20_000, 60_000);
  expect(touched?.expiresAt).toBe(80_000);
});

test('setVerifiedOrigin refuses host owned by another user', () => {
  const store = new Store(':memory:');
  const a = store.createUser('a@example.com', 1);
  const b = store.createUser('b@example.com', 1);
  store.setVerifiedOrigin(a.id, 'https://shop.example', 'shop.example', 'tok', 1);
  expect(() => store.setVerifiedOrigin(b.id, 'https://shop.example', 'shop.example', 'tok2', 2)).toThrow(/contested|owned/i);
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `bun test test/auth-store.test.ts`
Expected: FAIL (methods missing)

- [x] **Step 3: Implement schema + methods in `src/store/db.ts` and types in `src/auth/types.ts`**

Add tables: `users`, `auth_identities`, `sessions`, `verified_origins` (UNIQUE on `host`). Normalize emails to lowercase trim on write. Session ids: `crypto.randomUUID()` or 32+ random bytes hex.

- [x] **Step 4: Run test to verify it passes**

Run: `bun test test/auth-store.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/store/db.ts src/auth/types.ts test/auth-store.test.ts
git commit -m "feat(auth): add user session and verified-origin store"
```

---

### Task 2: Session cookie helpers + config auth block

**Files:**
- Create: `src/auth/session.ts`
- Modify: `src/config.ts`, `test/config.test.ts`
- Test: `test/session-cookie.test.ts`

**Interfaces:**
- Consumes: none from Task 1 beyond types if needed
- Produces:
  - `SESSION_COOKIE = 'macro_session'`
  - `SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000`
  - `parseSessionId(cookieHeader: string | null): string | null`
  - `serializeSessionCookie(sessionId: string, expiresAt: number): string`
  - `serializeClearSessionCookie(): string`
  - `Config.auth?: { sessionSecret: string; publicBaseUrl: string; resendApiKey: string; resendFrom: string; githubClientId: string; githubClientSecret: string; githubRedirectUri: string }` — present only when all auth env vars are set; otherwise `auth` omitted and auth routes stay disabled

- [x] **Step 1: Write failing tests for cookie round-trip and config all-or-nothing auth**

Assert `parseSessionId` reads `macro_session`; `serializeSessionCookie` includes `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. Assert partial auth env fails config; complete auth env freezes `config.auth`.

- [x] **Step 2: Run tests — expect FAIL**

Run: `bun test test/session-cookie.test.ts test/config.test.ts`

- [x] **Step 3: Implement `src/auth/session.ts` and extend `parseConfig`**

- [x] **Step 4: Run tests — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/auth/session.ts src/config.ts test/session-cookie.test.ts test/config.test.ts
git commit -m "feat(auth): session cookie helpers and auth config"
```

---

### Task 3: Magic link issue + consume (Resend injectable)

**Files:**
- Create: `src/auth/magic-link.ts`
- Modify: `src/store/db.ts` (magic_link_tokens table), `src/server.ts`, `src/api-types.ts`, `src/main.ts`
- Test: `test/auth-magic-link.test.ts`

**Interfaces:**
- Produces:
  - `hashMagicToken(token: string): string` (sha256 hex)
  - `ResendMailer { sendMagicLink(input: { to: string; url: string }): Promise<{ ok: true } | { ok: false }> }`
  - `Store.createMagicLinkToken(userId: string | null, email: string, tokenHash: string, now: number, ttlMs: number): void`
  - `Store.consumeMagicLinkToken(tokenHash: string, now: number): { email: string; userId: string | null } | null` (null if missing/expired/used; marks used)
  - Routes:
    - `POST /api/auth/magic-link` body `{ email: string }` → always `{ ok: true }` (no email enumeration); sends link when auth configured
    - `GET /api/auth/magic-link/consume?token=` → creates/merges user by email, creates session, Set-Cookie, redirect `303` to `/app/#/` (or safe relative `returnTo` if provided and same-origin path)

- [x] **Step 1: Write failing tests**

```ts
test('consume creates session cookie and cannot be reused', async () => {
  // harness with fake Resend capturing URL
  // POST magic-link for a@example.com
  // extract token from captured URL
  // GET consume → 303 + Set-Cookie macro_session
  // GET consume again → 400/401 fixed message, no second cookie
});
```

Also: invalid email → 400; auth unset → 503 fixed message.

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/auth-magic-link.test.ts`

- [x] **Step 3: Implement mailer + routes; inject mailer on `AppDeps`**

TTL 15 minutes. Create user on first consume if needed; `linkIdentity(..., 'email', email)`.

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/auth/magic-link.ts src/store/db.ts src/server.ts src/api-types.ts src/main.ts test/auth-magic-link.test.ts
git commit -m "feat(auth): Resend magic link sign-in"
```

---

### Task 4: GitHub OAuth start + callback (refuse no email)

**Files:**
- Create: `src/auth/github.ts`
- Modify: `src/server.ts`, `src/main.ts`, `src/api-types.ts`
- Test: `test/auth-github.test.ts`

**Interfaces:**
- Produces:
  - `githubAuthorizeUrl(cfg, state: string): string`
  - `exchangeGithubCode(cfg, code, fetchImpl): Promise<{ accessToken: string } | { error: 'oauth_failed' }>`
  - `fetchGithubIdentity(accessToken, fetchImpl): Promise<{ subject: string; login: string; email: string } | { error: 'no_email' | 'oauth_failed' }>` — must use GitHub user + emails endpoints; require a verified email; prefer primary
  - `GET /api/auth/github/start` → 302 to GitHub with state stored in short-lived httpOnly cookie or server table
  - `GET /api/auth/github/callback?code&state` → on success merge by email / link github identity / Set-Cookie session / redirect `/app/#/`; on `no_email` redirect `/app/#/sign-in?error=github_email`

- [x] **Step 1: Write failing tests** with injectable fetch: success path sets session; `no_email` creates no user; bad state rejected.

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/auth-github.test.ts`

- [x] **Step 3: Implement**

Same-email merge: if GitHub email matches existing user, link `github` identity to that user; if GitHub subject already linked, sign that user in.

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/auth/github.ts src/server.ts src/main.ts src/api-types.ts test/auth-github.test.ts
git commit -m "feat(auth): GitHub OAuth sign-in with email required"
```

---

### Task 5: `/api/me`, sign-out, session gate, Turnstile skip, account caps

**Files:**
- Modify: `src/server.ts`, `src/api-types.ts`, `src/run/limits.ts` (only if helper extraction needed), `src/store/db.ts` (limit rows by subject key)
- Test: `test/auth-session-gate.test.ts`

**Interfaces:**
- Produces:
  - `MeResponse { user: { id: string; email: string; githubLogin: string | null }; verifiedOrigin: { origin: string; host: string } | null }`
  - `GET /api/me` → 200 `MeResponse` or 401
  - `POST /api/auth/sign-out` → clear cookie 204/200
  - Internal `requireSession(req): { user: UserRow; session: SessionRow } | Response`
  - For `/api/plan`, `/api/approve`, `/api/runs`, `/api/probe`: if valid session, skip Turnstile; rate-limit using subject `user:<id>` via store helpers that accept a `subject: string` instead of only IP (keep IP path for signed-out)
  - Sliding: every successful session resolution calls `touchSession`

- [x] **Step 1: Write failing tests**

```ts
test('signed-in plan skips Turnstile and records planning under user subject', async () => {
  // session cookie present; verifyTurnstile must not be called
  // planning_requests / subject row uses user:<id>
});
test('signed-out plan still requires Turnstile', async () => { /* turnstileOk=false → 403 */ });
test('sign-out clears cookie and /api/me becomes 401', async () => { /* ... */ });
```

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/auth-session-gate.test.ts`

- [x] **Step 3: Implement gate + limit subject keys**

Keep existing IP tables working: either add `subject TEXT` column (migrate) or store `user:<id>` in the existing `ip` column for signed-in traffic (document that choice in code comment). Prefer renaming conceptually to `subject` via new columns `planning_requests.subject` / `client_starts.subject` with migration copy — if migration risk is high in this codebase's `CREATE IF NOT EXISTS` style, storing `user:<id>` in `ip` is acceptable for v1.

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/api-types.ts src/store/db.ts test/auth-session-gate.test.ts
git commit -m "feat(auth): me endpoint, sign-out, Turnstile skip, account caps"
```

---

### Task 6: Planner UI — Sign in page + rail identity

**Files:**
- Create: `web/landing/src/app/pages/SignIn.tsx`, `web/landing/src/app/lib/auth-api.ts`
- Modify: `web/landing/src/app/router.ts`, `web/landing/src/app/App.tsx`, `web/landing/src/app/context.tsx`, `web/landing/src/app/components/Shell.tsx`, `web/landing/src/app/app.css`
- Test: `bun x tsc --noEmit` (no component test harness required); manual check list in step 4

**Interfaces:**
- Consumes: `GET /api/me`, `POST /api/auth/magic-link`, `GET /api/auth/github/start`, `POST /api/auth/sign-out`
- Produces: route `{ view: 'sign-in' }` for `#/sign-in`; context `me: MeResponse | null` + `refreshMe()`; Shell foot shows Sign in or email/github + verified host/`none` + Sign out

- [x] **Step 1: Add router + SignIn page wiring (fail typecheck if Me types missing — already added)**

- [x] **Step 2: Implement SignIn (GitHub button → `/api/auth/github/start`; email form → magic link; copy: "Check your email for a sign-in link.") and Shell identity**

Sign out: call API, `refreshMe()`, `navigate('/')`.

- [x] **Step 3: Typecheck**

Run: `bun x tsc --noEmit`
Expected: PASS

- [x] **Step 4: Commit**

```bash
git add web/landing/src/app/pages/SignIn.tsx web/landing/src/app/lib/auth-api.ts web/landing/src/app/router.ts web/landing/src/app/App.tsx web/landing/src/app/context.tsx web/landing/src/app/components/Shell.tsx web/landing/src/app/app.css
git commit -m "feat(app): sign-in page and rail identity slot"
```

---

### Task 7: Verification issue / check / clear

**Files:**
- Create: `src/auth/verify-origin.ts`, `web/landing/src/app/components/VerifyPanel.tsx`
- Modify: `src/server.ts`, `src/api-types.ts`, `src/main.ts`, `src/store/db.ts` (pending token fields if needed)
- Test: `test/verify-origin.test.ts`

**Interfaces:**
- Produces:
  - `normalizeVerifyHost(input: string): { ok: true; host: string; origin: string } | { ok: false; reason: string }` — HTTPS origin only; reject IP literals / denylist hosts via existing `isDenylistedHost` / `parseOrigin`
  - `checkDnsTxt(host, expectedValue, resolveTxt): Promise<boolean>`
  - `checkWellKnown(origin, token, fetchImpl): Promise<boolean>`
  - `POST /api/verify/start` auth required body `{ host: string }` → `{ token: string; txtName: string; txtValue: string; wellKnownUrl: string }` (creates pending token on user; does not set verified yet)
  - `POST /api/verify/check` auth required → tries DNS then well-known; on success `setVerifiedOrigin`; on contested host → 409 fixed message
  - `POST /api/verify/clear` auth required → `clearVerifiedOrigin`

- [x] **Step 1: Write failing tests** for normalize, DNS success, well-known success, contested 409, clear to none.

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/verify-origin.test.ts`

- [x] **Step 3: Implement pure checks + routes; inject `resolveTxt` and `fetchImpl` on `AppDeps`**

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/auth/verify-origin.ts src/server.ts src/api-types.ts src/main.ts src/store/db.ts web/landing/src/app/components/VerifyPanel.tsx test/verify-origin.test.ts
git commit -m "feat(auth): DNS and well-known origin verification"
```

---

### Task 8: Own-site gate on plan/approve + per-request allowlist

**Files:**
- Modify: `src/server.ts`, `src/api-types.ts`, `src/agents/planner.ts` (only if target wiring must change), `web/landing/src/app/pages/NewTest.tsx`, `web/landing/src/app/lib/api.ts`
- Test: `test/own-site-gate.test.ts`

**Interfaces:**
- Consumes: session + verified origin from Tasks 5–7
- Produces:
  - `PlanRequest` / approve body extend with `targetMode: 'demo' | 'own'` and `targetOrigin?: string` (required when `own`)
  - Allowlist selection:
    - `demo` → `config.target.allowlist` (unchanged)
    - `own` → require session; require `getVerifiedOrigin(user).origin === normalized targetOrigin`; allowlist = `[verifiedOrigin, ...config.target.allowlist]` **or** `[verifiedOrigin]` only — **pin: allowlist is `[verifiedOrigin]` for own-site plans** (demo shop not mixed into an own-site plan). Demo mode unchanged.
  - Signed-out `own` → `401` code `auth_required`
  - Signed-in `own` without verify → `403` code `verification_required`
  - Probe ignores own-site (unchanged demo)

- [x] **Step 1: Write failing tests** covering auth_required, verification_required, demo still works signed-out, own accepted only for verified origin, approve rejects plan targeting some other host

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/own-site-gate.test.ts`

- [x] **Step 3: Implement server gates; pass selected allowlist into `evaluatePlan` and planner deps for that request; update NewTest UI with Demo/My site control and VerifyPanel interrupt before Draft/Approve**

Signed-out My site → `navigate('/sign-in')` after stashing draft locally (Task 9 finishes persistence).

- [x] **Step 4: Run — expect PASS** + `bun x tsc --noEmit`

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/api-types.ts src/agents/planner.ts web/landing/src/app/pages/NewTest.tsx web/landing/src/app/lib/api.ts test/own-site-gate.test.ts
git commit -m "feat: gate own-site plan and approve on verified origin"
```

---

### Task 9: Account draft persist + conflict (newer last-edited)

**Files:**
- Modify: `src/store/db.ts`, `src/server.ts`, `src/api-types.ts`, `web/landing/src/app/pages/NewTest.tsx`, `web/landing/src/app/pages/SignIn.tsx`, `web/landing/src/app/lib/auth-api.ts`
- Test: `test/account-draft.test.ts`

**Interfaces:**
- Produces:
  - `AccountDraft { trafficEvent: string; targetMode: 'demo' | 'own'; targetOrigin: string | null; lastEditedAt: number }`
  - `GET /api/draft` auth → draft or empty default
  - `PUT /api/draft` auth body draft → stores; on conflict with older `lastEditedAt` than stored, return stored winner with 409 `{ draft }` **or** accept client only when `client.lastEditedAt >= server.lastEditedAt` — **pin: server keeps the newer `lastEditedAt`; if equal, request body wins**
  - Sign-in returnTo restores New test with server draft after consume/callback

- [x] **Step 1: Write failing tests** for newer-wins and GET after PUT

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/account-draft.test.ts`

- [x] **Step 3: Implement store table `account_drafts` + routes + client sync on sign-in and while signed in (debounce optional; at least on blur/Draft click / before navigate to sign-in)**

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/store/db.ts src/server.ts src/api-types.ts web/landing/src/app/pages/NewTest.tsx web/landing/src/app/pages/SignIn.tsx web/landing/src/app/lib/auth-api.ts test/account-draft.test.ts
git commit -m "feat: persist account drafts with newer-last-edited wins"
```

---

### Task 10: Run ownership, privacy, claim-on-signin

**Files:**
- Modify: `src/store/db.ts`, `src/server.ts`, `src/api-types.ts`, `web/landing/src/app/lib/recent-runs.ts`, `web/landing/src/app/App.tsx` (or SignIn success path)
- Test: `test/run-privacy.test.ts`

**Interfaces:**
- Produces:
  - Columns on `runs`: `owner_user_id TEXT NULL`, `visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private'))`
  - On approve/start: if session and targetMode own → set owner + `private`; demo (signed in or out) → `public` and set owner when session present
  - `GET /api/runs/:id`, events SSE, report endpoints: if `private` and (no session or session.userId !== owner) → same 404 as missing (`MSG.notFound`) — do not reveal existence
  - `POST /api/auth/claim` auth body `{ runIds: string[] }` (max 10) → for each public demo run with null/other owner, set `owner_user_id` to claimant; never flip visibility to private
  - Client: after sign-in, call claim with `loadRecentRuns().map(r => r.id)`

- [x] **Step 1: Write failing tests** for private 404, owner can read, claim keeps public, stop still works for owner

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/run-privacy.test.ts`

- [x] **Step 3: Implement migration + gates + claim**

Live sandbox on sign-out: no change to controller stop behavior (already only Stop endpoint).

- [x] **Step 4: Run — expect PASS**

- [x] **Step 5: Commit**

```bash
git add src/store/db.ts src/server.ts src/api-types.ts web/landing/src/app/lib/recent-runs.ts web/landing/src/app/App.tsx web/landing/src/app/lib/auth-api.ts test/run-privacy.test.ts
git commit -m "feat: private own-site runs and claim demo runs on sign-in"
```

---

### Task 11: Account recent-runs list + footer copy

**Files:**
- Modify: `src/server.ts`, `src/api-types.ts`, `web/landing/src/app/pages/RecentRuns.tsx`, `web/landing/src/app/components/Shell.tsx`, `PRODUCT.md`
- Test: `test/account-runs-list.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/account/runs` auth → `{ runs: RunListItem[] }` owned by user (newest first, limit 50)
  - Recent runs page: when signed in, prefer account list; when signed out, browser localStorage list
  - Shell rail heading: signed-in `"Your runs"`; signed-out keep `"In this browser"`
  - Footer copy when signed in with verified origin: say they can test that host; otherwise keep honest demo-only / verification coming language without claiming unpaid features

- [x] **Step 1: Write failing API test for account runs list**

- [x] **Step 2: Run — expect FAIL**

Run: `bun test test/account-runs-list.test.ts`

- [x] **Step 3: Implement + UI + PRODUCT.md Phase 2 note that accounts/verification are the next build (or in progress once this ships)**

- [x] **Step 4: Run tests + `bun x tsc --noEmit` + `bun test` (full suite) + `bun run build:web`

Expected: all PASS / build OK

- [x] **Step 5: Commit**

```bash
git add src/server.ts src/api-types.ts web/landing/src/app/pages/RecentRuns.tsx web/landing/src/app/components/Shell.tsx PRODUCT.md test/account-runs-list.test.ts
git commit -m "feat: account run list and honest own-site footer copy"
```

---

### Task 12: README env + smoke checklist (docs only)

**Files:**
- Modify: `README.md`
- Optional: `.env.example` if present (do not create secrets)

- [x] **Step 1: Document auth env vars and the Demo vs My site flow without claiming production OAuth is configured**

- [x] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: account and verification env and flow"
```

---

## Self-review notes (author)

- Spec coverage: auth methods, merge-by-email, refuse GitHub without email, session until sign-out sliding, Turnstile signed-out only, caps by account, explicit Demo/My site, verify inline, DNS+well-known, clear/replace, contested first-wins, trust-until-replace, draft persist + newer-wins, claim demo public, own-site private, probe demo-only, rail identity, sign-out land New test — each mapped to tasks 1–11.
- Account deletion intentionally omitted (spec open/deferred).
- Numeric budgets reused from existing IP limits (builder default).
