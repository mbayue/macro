# Domain Connect 1-Click DNS Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable automated, 1-click DNS TXT verification for own-site origins by integrating client-side Domain Connect v2 discovery, cryptographic request signing, and UI flow into Macro.

**Architecture:** Extend the site verification pipeline with a Domain Connect discovery engine in `src/auth/domain-connect.ts` that queries `_domainconnect.<apex>` via DNS TXT/CNAME, fetches the provider's `/v2/<domain>/settings` endpoint, and signs the synchronous template apply URL using RSA-SHA256. Return the resulting `domainConnectUrl` alongside provider metadata from `/api/verify/start`, and render a prominent 1-click auto-configuration button in `VerifyPanel.tsx` with automatic verification polling upon redirect return.

**Tech Stack:** Bun, TypeScript, Node `dns/promises`, Node `crypto`, React 19, CSS variables (Test Bench theme).

**Spec:** [`deploy/domainconnect/macro.my.id.verify.json`](deploy/domainconnect/macro.my.id.verify.json), [`src/auth/verify-origin.ts`](src/auth/verify-origin.ts), [`web/landing/src/app/components/VerifyPanel.tsx`](web/landing/src/app/components/VerifyPanel.tsx).

## Global Constraints

- Never break existing verification paths: manual DNS TXT check and `/.well-known/macro-site-verification` must continue to work without modification.
- Zero external runtime npm dependencies: use native Bun/Node standard libraries (`node:dns/promises`, `node:crypto`).
- Design must follow [`DESIGN.md`](DESIGN.md) tokens: flat surfaces, `--surface-2`, `--ink`, `--accent`, no glows or gradients.
- Non-blocking network queries: DNS and HTTP calls to `_domainconnect` endpoints must use an explicit timeout (e.g. 2000 ms) and gracefully degrade to manual verification on failure or timeout.
- Cryptographic signatures: when a private key is configured, sign query strings conforming to Domain Connect v2 spec (RSA-SHA256 over standardized query parameter order, base64-encoded, then URL-encoded).

## Review Focus

1. **Subdomain vs Apex Parameter Normalization**: When verifying `shop.example.com`, Domain Connect discovery must query `_domainconnect.example.com`, pass `domain=example.com` and `host=shop`. When verifying `example.com`, `host` must be empty string `""` to prevent malformed DNS records (`_macro-verify.@`).
2. **Graceful DNS & HTTP Timeouts**: If a target domain does not implement Domain Connect, if the DNS TXT query returns ENOTFOUND, or if the provider's settings endpoint hangs or returns 500/404, the verification start API must still return successfully within 2 seconds with `domainConnectUrl: undefined`.
3. **Query String Canonical Ordering & Signature Integrity**: Signature verification by DNS providers (GoDaddy, IONOS, etc.) strictly fails if query parameters are not ordered in canonical sequence (`domain`, `host`, `token`, `redirect_uri`, `state`) prior to signing.
4. **Key Configuration Degradation**: If `DOMAIN_CONNECT_PRIVATE_KEY` is not configured in `.env`, the system must not crash; it can emit an unsigned apply URL or omit the URL depending on provider requirements.
5. **UI Accessibility & Fallback Visibility**: Even when Domain Connect is detected, the manual DNS TXT name/value and well-known verification boxes must remain accessible through a simple toggle so users with custom DNS configurations can always proceed manually.

---

### Task 1: Domain Connect URL Builder and Query Signer

**Files:**
- Create: `src/auth/domain-connect.ts`
- Test: `test/domain-connect.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface BuildApplyUrlOptions {
    syncUxUrl: string;
    domain: string;
    host?: string;
    token: string;
    redirectUri?: string;
    state?: string;
    privateKeyPem?: string;
    keyId?: string;
  }

  export function buildDomainConnectApplyUrl(opts: BuildApplyUrlOptions): string;
  export function signDomainConnectQuery(queryString: string, privateKeyPem: string): string;
  ```

- [ ] **Step 1: Write the failing tests in `test/domain-connect.test.ts`**
  - Verify query string generation with parameters in standard order: `domain`, `host`, `token`, `redirect_uri`, `state`.
  - Verify RSA-SHA256 signature calculation using a generated test RSA key pair.
  - Verify signature verification using the corresponding public key.
  - Verify omission of `host` when host is empty.
  - Verify behavior when no private key is provided.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test test/domain-connect.test.ts`
  - Expected: FAIL (`Cannot find module '../src/auth/domain-connect.ts'`)

- [ ] **Step 3: Implement `src/auth/domain-connect.ts`**
  - Implement `signDomainConnectQuery(queryString, privateKeyPem)` using `crypto.createSign('RSA-SHA256')`.
  - Implement `buildDomainConnectApplyUrl(opts)` constructing the path:
    `{syncUxUrl}/v2/domainTemplates/providers/macro.my.id/services/verify/apply?{query}&sig={sig}&key={keyId}`.

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test test/domain-connect.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - Run: `git add src/auth/domain-connect.ts test/domain-connect.test.ts && git commit -m "feat(domainconnect): implement domain connect query signer and apply url builder"`

---

### Task 2: Discovery Engine & Provider Settings Resolver

**Files:**
- Modify: `src/auth/domain-connect.ts`
- Test: `test/domain-connect.test.ts`

**Interfaces:**
- Produces:
  ```typescript
  export interface DomainConnectSettings {
    providerId: string;
    providerName: string;
    urlSyncUX: string;
    urlAPI?: string;
  }

  export type ResolveTxt = (hostname: string) => Promise<string[][]>;
  export type ResolveCname = (hostname: string) => Promise<string[]>;
  export type FetchFn = typeof fetch;

  export async function discoverDomainConnectApi(
    apexDomain: string,
    resolveTxt?: ResolveTxt,
    resolveCname?: ResolveCname,
  ): Promise<string | null>;

  export async function fetchDomainConnectSettings(
    apiHost: string,
    apexDomain: string,
    fetchFn?: FetchFn,
  ): Promise<DomainConnectSettings | null>;
  ```

- [ ] **Step 1: Write failing tests in `test/domain-connect.test.ts`**
  - Test TXT lookup for `_domainconnect.<domain>` returning API host (e.g. `domainconnect.godaddy.com`).
  - Test CNAME fallback lookup for `_domainconnect.<domain>`.
  - Test handling of `ENOTFOUND` or DNS timeout returning `null`.
  - Test `fetchDomainConnectSettings` fetching `https://{apiHost}/v2/{apexDomain}/settings` and parsing JSON response.
  - Test HTTP 404/500/timeout handling returning `null`.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test test/domain-connect.test.ts`
  - Expected: FAIL (`discoverDomainConnectApi is not a function`)

- [ ] **Step 3: Implement discovery and settings fetch in `src/auth/domain-connect.ts`**
  - Implement `discoverDomainConnectApi`: query TXT `_domainconnect.${apexDomain}` with a 1500 ms timeout; fallback to CNAME.
  - Implement `fetchDomainConnectSettings`: `fetch(`https://${apiHost}/v2/${apexDomain}/settings`, { signal: AbortSignal.timeout(1500) })`.

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test test/domain-connect.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - Run: `git add src/auth/domain-connect.ts test/domain-connect.test.ts && git commit -m "feat(domainconnect): add dns discovery and settings fetcher"`

---

### Task 3: Integrate Domain Connect Discovery into Verify API

**Files:**
- Modify: `src/config.ts`
- Modify: `src/api-types.ts`
- Modify: `src/auth/verify-origin.ts`
- Modify: `src/server.ts`
- Test: `test/verify-origin.test.ts`

**Interfaces:**
- Consumes:
  - `discoverDomainConnectApi`, `fetchDomainConnectSettings`, `buildDomainConnectApplyUrl` from `src/auth/domain-connect.ts`
- Produces:
  - `DnsProviderDetection` and `VerifyStartResponse` include:
    ```typescript
    domainConnectUrl?: string | undefined;
    domainConnectProviderName?: string | undefined;
    ```

- [ ] **Step 1: Write failing tests in `test/verify-origin.test.ts`**
  - Test `detectDnsProvider` returns `domainConnectUrl` and `domainConnectProviderName` when `_domainconnect` record is present.
  - Test subdomain verification passes `domain` as apex and `host` as subdomain.
  - Test apex domain verification passes empty `host`.
  - Test that failure in Domain Connect discovery does not fail verification start.

- [ ] **Step 2: Run test to verify it fails**
  - Run: `bun test test/verify-origin.test.ts`
  - Expected: FAIL

- [ ] **Step 3: Update `src/config.ts`, `src/auth/verify-origin.ts`, and `src/server.ts`**
  - Add optional `DOMAIN_CONNECT_KEY_ID` (default `p1`) and `DOMAIN_CONNECT_PRIVATE_KEY` to config.
  - In `detectDnsProvider`: after checking nameservers, attempt `discoverDomainConnectApi(apexHost)`.
  - If discovered, fetch settings and call `buildDomainConnectApplyUrl(...)`.
  - Pass `domainConnectUrl` and `domainConnectProviderName` in `VerifyStartResponse`.

- [ ] **Step 4: Run test to verify it passes**
  - Run: `bun test test/verify-origin.test.ts`
  - Expected: PASS

- [ ] **Step 5: Commit**
  - Run: `git add src/config.ts src/api-types.ts src/auth/verify-origin.ts src/server.ts test/verify-origin.test.ts && git commit -m "feat(verify): wire domain connect detection into verify start api"`

---

### Task 4: UI Support in `VerifyPanel.tsx` & Style Updates

**Files:**
- Modify: `web/landing/src/app/lib/auth-api.ts`
- Modify: `web/landing/src/app/components/VerifyPanel.tsx`
- Modify: `web/landing/src/app/app.css`

- [ ] **Step 1: Update API types in `web/landing/src/app/lib/auth-api.ts`**
  - Add `domainConnectUrl?: string` and `domainConnectProviderName?: string` to `VerifyStartResponse`.

- [ ] **Step 2: Update `VerifyPanel.tsx`**
  - When `pending.domainConnectUrl` is present:
    - Display an auto-configuration banner:
      - Title: `⚡ 1-Click DNS Configuration available`
      - Provider name badge: e.g. "Supported by {providerName}"
      - Primary action button: `[⚡ Auto-configure DNS ↗]` linking to `pending.domainConnectUrl` with `target="_blank" rel="noopener noreferrer"`.
      - Toggle for manual records: `[Show manual records]` / `[Hide manual records]`.
  - When returning from redirect (e.g. hash parameter or storage), auto-trigger `onCheck()`.

- [ ] **Step 3: Update `web/landing/src/app/app.css`**
  - Add styling for `.dc-banner`, `.dc-banner__header`, `.dc-badge`, and `.btn--dc` matching the "Test Bench" design tokens (flat, crisp 1.5px borders, Evergreen & Spring Green palette).

- [ ] **Step 4: Typecheck and build verification**
  - Run: `bun x tsc --noEmit && bun run build:web`
  - Expected: Clean compilation, exit code 0.

- [ ] **Step 5: Commit**
  - Run: `git add web/landing/src/app/lib/auth-api.ts web/landing/src/app/components/VerifyPanel.tsx web/landing/src/app/app.css && git commit -m "feat(ui): add domain connect 1-click configure banner to verify panel"`

---

### Task 5: End-to-End Suite Verification & Documentation

**Files:**
- Modify: `README.md`
- Test: full suite `bun test`

- [ ] **Step 1: Run full test suite and type check**
  - Run: `bun test`
  - Run: `bun x tsc --noEmit`
  - Expected: All tests pass, 0 type errors.

- [ ] **Step 2: Update `README.md` with final test count and Domain Connect details**
  - Document Domain Connect auto-configuration in the Accounts and Verification section.

- [ ] **Step 3: Commit**
  - Run: `git add README.md && git commit -m "docs: finalize domain connect implementation and test count"`
