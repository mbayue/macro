# Domain Connect & Cloudflare DNS Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect whether a target host's DNS is managed by Cloudflare / Domain Connect upon starting site verification, generate the standardized Domain Connect template for Macro, and provide an auto-configuration button with a fallback direct Cloudflare DNS link.

**Architecture:** Extend `/api/verify/start` with apex-aware DNS nameserver resolution (`NS`) and Domain Connect discovery (`_domainconnect.<domain>`). Return `isCloudflare` and `domainConnect` metadata to the frontend. In `VerifyPanel.tsx`, conditionally render a Resend-style `[☁️ Auto configure / Open Cloudflare]` button with `Manual setup` toggle when Cloudflare is detected. Provide the official `deploy/domainconnect/macro.my.id.verify.json` template ready for submission to the `Domain-Connect/Templates` open-source registry.

**Tech Stack:** Bun, TypeScript, Node.js `dns/promises`, React 19, CSS variables (flat, no gradient AI slop).

**Spec:** [`src/auth/verify-origin.ts`](file:///C:/Users/bayue/Documents/projects/macro/src/auth/verify-origin.ts), [`src/server.ts`](file:///C:/Users/bayue/Documents/projects/macro/src/server.ts), [`web/landing/src/app/components/VerifyPanel.tsx`](file:///C:/Users/bayue/Documents/projects/macro/web/landing/src/app/components/VerifyPanel.tsx).

## Global Constraints

- Never break existing verification paths: DNS TXT manual check and `.well-known` HTTP fallback must continue to work unconditionally.
- Never add external npm dependencies; use native Bun / Node standard libraries (`node:dns/promises`, `node:crypto`).
- Design must follow [`DESIGN.md`](file:///C:/Users/bayue/Documents/projects/macro/DESIGN.md) tokens: flat surfaces, `--surface-2`, `--ink`, `--accent`, no glowing borders or neon box-shadows.
- Keep responses within frame budget and sub-100ms: DNS NS queries should have a strict timeout (e.g. 1500ms) and gracefully default to `isCloudflare: false` if DNS is slow or unavailable.
- Commit locally after each task; no pushing to remote.

## Review Focus

1. **Subdomains vs Apex**: `shop.sub.example.co.uk` or `api.micron.my.id` must properly resolve the authoritative apex NS without failing on multi-level prefixes.
2. **DNS Timeout / Failure Resilience**: If the DNS server hangs or errors during NS lookup, `/api/verify/start` must still succeed and return the token with `isCloudflare: false`.
3. **Domain Connect Template Schema Compliance**: The template must strictly pass the Domain Connect v2 JSON schema specifications.
4. **Popup vs New Tab Safety**: The Cloudflare action button should open safely with `rel="noopener noreferrer"`.
5. **Light / Dark Mode Fidelity**: The Cloudflare button and setup tabs must look native and crisp in both light and dark themes.

---

### Task 1: Domain Connect Template & Schema

**Files:**
- Create: `deploy/domainconnect/macro.my.id.verify.json`
- Test: `test/domain-connect-template.test.ts`

- [x] **Step 1.1**: Write the failing test for the Domain Connect template JSON structure in `test/domain-connect-template.test.ts` verifying required fields: `providerId`, `providerName`, `serviceId`, `serviceName`, `version`, `syncPubKeyDomain`, and `records` containing the `_macro-verify` TXT entry with `%token%`.
- [x] **Step 1.2**: Run `bun test test/domain-connect-template.test.ts` to confirm failure.
- [x] **Step 1.3**: Create `deploy/domainconnect/macro.my.id.verify.json` adhering to the official Domain Connect v2 specification.
- [x] **Step 1.4**: Run `bun test test/domain-connect-template.test.ts` and verify it passes.
- [x] **Step 1.5**: Commit locally: `git commit -m "feat(domainconnect): add official domain connect template for macro verification"`.

---

### Task 2: Apex Resolution & Cloudflare / Domain Connect Detection

**Files:**
- Modify: `src/auth/verify-origin.ts`
- Modify: `src/server.ts`
- Test: `test/verify-origin.test.ts`

- [x] **Step 2.1**: Write failing tests in `test/verify-origin.test.ts` for `detectDnsProvider(host, resolveNs)`:
  - Returns `{ isCloudflare: true }` when nameservers contain `*.ns.cloudflare.com`.
  - Returns `{ isCloudflare: false }` for generic nameservers (e.g. `ns1.digitalocean.com`).
  - Handles subdomains by walking up labels to find authoritative NS.
  - Recovers gracefully on DNS timeout/error by returning `{ isCloudflare: false }`.
- [x] **Step 2.2**: Run `bun test test/verify-origin.test.ts` to confirm test failures.
- [x] **Step 2.3**: Implement `getApexDomain(host: string): string` and `detectDnsProvider(host: string, resolveNs?: ResolveNs)` in `src/auth/verify-origin.ts`.
- [x] **Step 2.4**: Wire `detectDnsProvider` into `postVerifyStart` in `src/server.ts` and include `isCloudflare: boolean` and `cloudFlareDirectUrl?: string` in `VerifyStartResponse`.
- [x] **Step 2.5**: Run `bun test` to ensure all existing and new tests pass.
- [x] **Step 2.6**: Commit locally: `git commit -m "feat(verify): detect cloudflare dns host in verify start api"`.

---

### Task 3: UI Enhancement in `VerifyPanel.tsx` & `app.css`

**Files:**
- Modify: `web/landing/src/app/components/VerifyPanel.tsx`
- Modify: `web/landing/src/app/app.css`
- Modify: `web/landing/src/app/lib/auth-api.ts`

- [x] **Step 3.1**: Update `VerifyStartResponse` type in `web/landing/src/app/lib/auth-api.ts` to include optional `isCloudflare?: boolean` and `cloudFlareDirectUrl?: string`.
- [x] **Step 3.2**: In `web/landing/src/app/components/VerifyPanel.tsx`:
  - When `isCloudflare` is true, render a top action section matching Resend's UX:
    - Branded Cloudflare badge / icon.
    - Title: "Domain host detected: Cloudflare".
    - `[☁️ Open Cloudflare DNS ↗]` quick action button opening the user's dashboard with 1 click.
    - Segmented toggle or clear separation for manual instructions with the 1-click copy boxes.
- [x] **Step 3.3**: Style `.cf-banner`, `.cf-btn`, and tabs in `web/landing/src/app/app.css` using theme variables (`--surface-2`, `--border`, `--ink`, `--accent`).
- [x] **Step 3.4**: Run `bun x tsc --noEmit` and `bun run build:web` to verify build integrity.
- [x] **Step 3.5**: Verify visually with headless CDP screenshot in light and dark mode.
- [x] **Step 3.6**: Commit locally: `git commit -m "feat(ui): add cloudflare auto-configure and detection banner to verify panel"`.

---

### Task 4: Documentation & Visual Artifacts

**Files:**
- Modify: `docs/superpowers/plans/2026-11-10-domain-connect-and-cloudflare-detection.md` (track checkboxes)
- Create: artifact `domain-connect-and-cloudflare-detection.md` with visual before/after and Domain Connect setup instructions.

- [x] **Step 4.1**: Create design artifact documenting the Domain Connect template and Cloudflare UI.
