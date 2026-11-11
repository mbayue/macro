# Own-site journey discovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An own-site plan sends GET requests for files the server read from the verified origin, and the run keeps that origin through start.

**Architecture:** `discoverOwnSite` reads `/`, its script and stylesheet URLs, and static paths quoted in those scripts. The planner may only size those ids. The route table stays off the plan text, on the draft and then on `plan_targets`. The controller, k6 script, summary, and proxy use that row. Demo plans write no row and stay on the Yue catalog.

**Tech Stack:** Bun, bun:sqlite, zod, React 19 planner. Discovery uses the injectable `FetchLike` already in `src/auth/verify-origin.ts`.

**Spec:** `docs/superpowers/specs/2026-11-11-own-site-journey-design.md`

## Global Constraints

- Demo (`targetMode` omitted or `demo`) and the containment probe keep the Yue catalog, Yue origins, and current tests.
- The model has no fetch tool. Discovery runs in the API process before `planTrafficEvent`.
- Discovery never follows redirects, never requests another origin, and never executes script text.
- Public discovery failure is only `Could not read ${origin}/. Nothing was sent to the planner.` Do not return the response body.
- Own-site routes are GET. No `order_create`, no `{productId}` replacement.
- User-facing copy is the sentence in the spec. No em dash.
- Commit each task locally. Do not push.

## Review Focus

- A document or script response of 301/302 must not be followed and its `Location` must not be recorded. Task 1.
- A script literal containing `..`, a scheme, or `//` must not become a route. Task 1.
- Approve of plan text whose journey id was not discovered must 422, even if the rest of the plan is valid. Task 3.
- Replacing or clearing the verified origin after approve must fail the run with `The verified origin changed before the run started.` and must not open a Yue script. Task 4.
- An own-site run's proxy allow-hosts must be the verified hostname only. Task 4.

---

### Task 1: Discovery

**Files:**
- Create: `src/plan/discover.ts`
- Test: `test/discover.test.ts`

**Interfaces:**
- Consumes: `FetchLike` from `src/auth/verify-origin.ts`.
- Produces:
  - `DISCOVER_TIMEOUT_MS = 5000`, `DISCOVER_DOC_MAX_BYTES = 262144`, `DISCOVER_SCRIPT_MAX_BYTES = 524288`, `DISCOVER_MAX_SCRIPTS = 4`, `DISCOVER_MAX_ROUTES = 32`, `DISCOVER_PATH_MAX = 200`
  - `DiscoveredKind = 'document' | 'script' | 'style' | 'asset'`
  - `DiscoveredRoute = { id: string; kind: DiscoveredKind; method: 'GET'; path: string }`
  - `isStaticAssetPath(path: string): boolean`
  - `extractDocumentRefs(html: string, origin: string): { scripts: string[]; styles: string[] }`
  - `extractAssetPaths(source: string): string[]`
  - `discoverOwnSite(origin: string, fetchImpl: FetchLike): Promise<{ ok: true; routes: DiscoveredRoute[] } | { ok: false; reason: 'document_unreachable' | 'document_not_html' | 'document_too_large' }>`

- [ ] **Step 1: Write the failing tests**

`test/discover.test.ts`, fake `FetchLike`, no network:

- HTML with `<script src="/assets/app.js">` and `<link rel="stylesheet" href="/assets/app.css">`, and that script containing `"/assets/a.webp"`, `"/assets/../secret.webp"`, `"https://evil.example/x.webp"`, and `"//cdn.example/x.webp"`, returns `r1` `/` document, `r2` `/assets/app.js` script, `r3` `/assets/app.css` style, `r4` `/assets/a.webp` asset. The other three strings are absent.
- A script `src` of `https://evil.example/a.js` is not fetched. Assert the fake fetch saw only the origin's `/` and `/assets/app.js`.
- Document status 302 does not fetch the `Location` path. Result `{ ok: false, reason: 'document_unreachable' }`.
- Document body of `DISCOVER_DOC_MAX_BYTES + 1` returns `document_too_large`.
- A fifth script tag is not fetched. A script over `DISCOVER_SCRIPT_MAX_BYTES` is skipped and does not fail discovery.
- 33 asset literals keep `/` and drop the last asset. Ids stay `r1`…`r32` with no gaps.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test test/discover.test.ts`

Expected: FAIL, `discoverOwnSite` is not defined.

- [ ] **Step 3: Implement the spec's Discovery section**

`extractDocumentRefs` and `extractAssetPaths` are pure. `discoverOwnSite` uses those, the caps, and `redirect: 'manual'`. Cancel a body that exceeds its cap. Do not parse a truncated document.

- [ ] **Step 4: Run the tests**

Run: `bun test test/discover.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/plan/discover.ts test/discover.test.ts
git commit -m "feat(plan): discover own-site routes from the document and its scripts"
```

### Task 2: Draft routes, plan targets, policy route set

**Files:**
- Modify: `src/store/db.ts` (draft row and a new table)
- Modify: `src/plan/policy.ts` (`evaluatePlan`)
- Modify: `src/types.ts` (`StageMetrics.routes`)
- Modify: `src/k6/metrics.ts` (`readSummary`)
- Modify: `src/run/verdict.ts` (`firstDegradedRoute`)
- Modify: `src/report/build.ts` and `src/report/compare.ts` (headline field type)
- Test: `test/policy-model.test.ts`, `test/discover-store.test.ts` (new)

**Interfaces:**
- Consumes: `DiscoveredRoute` from Task 1.
- Produces:
  - `DraftRow` gains `origin: string | null` and `routes: DiscoveredRoute[] | null`.
  - `Store.setDraftDiscovery(id: string, origin: string, routes: readonly DiscoveredRoute[]): void`
  - `PlanTargetRow = { planHash: string; webOrigin: string; apiOrigin: string; routes: DiscoveredRoute[] }`
  - `Store.storePlanTarget(row: PlanTargetRow): void` (insert or ignore by hash)
  - `Store.getPlanTarget(planHash: string): PlanTargetRow | null`
  - `evaluatePlan(plan: TestPlan, allowlist: readonly string[], routes?: readonly { id: string; method: 'GET' | 'POST'; path: string }[]): GateResult`
  - `readSummary(summaryJson: string, routeIds?: readonly string[]): ReadSummaryResult`
  - `firstDegradedRoute(stages, t, routeOrder?: readonly string[]): string | undefined`
  - `Headline.firstDegradedRoute: string | null`

- [ ] **Step 1: Write the failing tests**

Policy, in `test/policy-model.test.ts`: a plan whose journey route is `r2` is rejected with rule 4.3 and message `route "r2" is not in the Route_Catalog` when the third argument is omitted, and accepted when the third argument is `[{ id: 'r2', method: 'GET', path: '/assets/a.webp' }]`. A third id `r9` with that same set is rejected with `route "r9" is not in the discovered routes`.

Store, in `test/discover-store.test.ts`: `setDraftDiscovery` round-trips origin and routes through `getDraft`. `storePlanTarget` plus `getPlanTarget` round-trips. A second `storePlanTarget` for the same hash does not change the row. A database opened from a file created without `plan_targets` gains the table (create the old schema, close, open `Store`).

`readSummary`: a fixture metric `http_reqs{route:r2}` is omitted when `routeIds` is omitted, and present when `routeIds` is `['r2']`. Existing catalog fixture still populates `store_home` with the default argument.

- [ ] **Step 2: Run the new tests and confirm they fail**

Run: `bun test test/policy-model.test.ts test/discover-store.test.ts`

Expected: FAIL on the new assertions. Do not change existing passing cases.

- [ ] **Step 3: Implement storage and the optional route set**

Table, created in `SCHEMA` and ignored when it already exists:

```sql
CREATE TABLE IF NOT EXISTS plan_targets (
  plan_hash TEXT PRIMARY KEY REFERENCES plans(hash),
  web_origin TEXT NOT NULL,
  api_origin TEXT NOT NULL,
  routes_json TEXT NOT NULL
);
```

Draft columns `origin TEXT` and `routes_json TEXT`, added with `PRAGMA table_info` the same way `migrateRunsOwnership` adds columns. `routes_json` is a JSON array of `DiscoveredRoute`. Invalid JSON reads back as `null`.

`evaluatePlan` third argument: when omitted, `checkRoutes` stays catalog-only. When passed, membership is that id set and the rejection message is `route "<id>" is not in the discovered routes`. Do not add a policy rule.

`StageMetrics.routes` becomes `Partial<Record<string, Metrics>>`. `readSummary` defaults `routeIds` to `ROUTE_CATALOG` ids. `firstDegradedRoute` defaults `routeOrder` to that same id list and returns `string | undefined`. Widen `Headline.firstDegradedRoute` and the compare-view field to `string | null`. Catalog ids still assign to `string`.

- [ ] **Step 4: Run the tests**

Run: `bun test test/policy-model.test.ts test/discover-store.test.ts test/policy-bounds.test.ts test/policy-determinism.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts src/plan/policy.ts src/types.ts src/k6/metrics.ts src/run/verdict.ts src/report/build.ts src/report/compare.ts test/policy-model.test.ts test/discover-store.test.ts
git commit -m "feat(plan): store discovered routes and gate own-site ids"
```

### Task 3: Plan and approve

**Files:**
- Modify: `src/agents/planner.ts`
- Modify: `src/server.ts` (`postPlan`, `postApprove`, `PlannerFn`)
- Modify: `src/api-types.ts` (`PlanResponse`, `ApproveRequest`)
- Test: `test/planner.test.ts`, `test/own-site-plan.test.ts` (new, `createApp`)

**Interfaces:**
- Consumes: `discoverOwnSite`, `DiscoveredRoute` (Task 1); `setDraftDiscovery`, `getDraft`, `storePlanTarget`, `evaluatePlan` third argument (Task 2).
- Produces:
  - `PlannerDeps.discovered?: readonly DiscoveredRoute[]`
  - `plannerSystemPrompt(target, discovered?: readonly DiscoveredRoute[]): string`
  - `proposePlanTool(discovered?: readonly DiscoveredRoute[]): ToolDefinition`
  - `PlannerFn` gains a fourth argument `discovered?: readonly DiscoveredRoute[]`.
  - `PlanResponse.routes: { id: string; path: string; method: 'GET'; kind: DiscoveredKind }[]` (`[]` for demo)
  - `ApiErrorCode` gains `'discover_failed'`.
  - `ApproveRequest.draftId?: string`
  - Own-site approve requires `draftId`. Mismatch message: `This plan's routes do not match the routes read from the site.`

- [ ] **Step 1: Write the failing tests**

Planner: with `discovered` of one document `/` (`r1`) and one asset (`r4`, `/assets/a.webp`), `plannerSystemPrompt` contains both paths, contains `Include the document, each script, and each style. For routes whose kind is asset, use at most two steps and a probability from 5 to 20.`, and does not contain `order_create` or `this shop`. Without `discovered`, the prompt still contains `order_create` and `store_home`. `proposePlanTool(discovered).parameters` restricts `journey` route to those ids (assert the enum lists `r1` and `r4` and not `store_home`).

HTTP, `test/own-site-plan.test.ts`:

- `targetMode: 'own'` uses `AppDeps.fetchImpl`. The planner spy's fourth argument is the discovered rows, and the spy is not called when discovery returns `document_unreachable`. That response is 422 `discover_failed` and the message is `Could not read https://sketch.my.id/. Nothing was sent to the planner.`
- A successful own-site plan response has `routes` equal to the discovery rows. `plan.journey` ids are a subset. `plan.target` is the verified origin.
- Approve without `draftId` on own-site is 400. Approve with `draftId` and a journey id outside the draft routes is 422 and the message is `This plan's routes do not match the routes read from the site.` No `plans` row and no `plan_targets` row.
- Approve of the unmodified plan text inserts `plan_targets` with both origins equal to the verified origin.
- Demo `POST /api/plan` does not call the fetch spy and returns `routes: []`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test test/planner.test.ts test/own-site-plan.test.ts`

Expected: FAIL on the new cases. Existing planner tests still pass after the prompt assertion is added only for the discovered call.

- [ ] **Step 3: Wire discovery in front of the model**

`postPlan` for own-site: resolve the target, take the planning rate-limit slot, call `discoverOwnSite` with `deps.fetchImpl ?? fetch`. On failure, `apiError(422, 'discover_failed', message)` and `logInternal` the reason. Do not create a draft and do not call the planner. Pass the rows as the planner's fourth argument.

On success, `createDraft`, `setDraftDiscovery`, then the planner with `discovered`. `checkResponse` passes those routes into `evaluatePlan`. `PlanResponse.routes` is the discovered rows. Demo sets `routes` to `[]` and does not discover.

`postApprove` for own-site: require `draftId`. Load the draft. Reject unless `plan.target` equals `draft.origin` and the caller's verified origin, and every `journey[].route` is in `draft.routes`. Then `storeApprovedPlan` and `storePlanTarget` with `webOrigin` and `apiOrigin` both `draft.origin`.

- [ ] **Step 4: Run the tests**

Run: `bun test test/planner.test.ts test/own-site-plan.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/agents/planner.ts src/server.ts src/api-types.ts test/planner.test.ts test/own-site-plan.test.ts
git commit -m "feat(api): plan own-site journeys from discovered routes"
```

### Task 4: Script, start, and egress

**Files:**
- Modify: `src/k6/script.ts`
- Modify: `src/run/controller.ts`
- Modify: `src/sandbox/runner.ts` (`openRunNetwork`, `DockerStageExecutor.openRun`)
- Modify: `src/api-types.ts` (`RunSnapshot.routes`)
- Modify: `src/server.ts` (snapshot builder) and `src/report/build.ts` (`ReportInput.routeOrder`, `RouteRowView.route: string`)
- Test: `test/script.test.ts`, `test/controller.test.ts`

**Interfaces:**
- Consumes: `getPlanTarget`, `getVerifiedOrigin`, `readSummary(routeIds)`, `firstDegradedRoute(routeOrder)`, `DiscoveredRoute`.
- Produces:
  - `StageScriptInput.routes?: readonly { id: string; role: 'web' | 'api'; method: 'GET' | 'POST'; path: string }[]`
  - When `routes` is set, `buildStageScriptCfg` uses it and does not read `ROUTE_CATALOG`. No `{productId}` replace unless the path contains that token.
  - `RunExecutor.openRun?(runId: string, allowHosts?: readonly string[])`
  - `SandboxRunner.openRunNetwork(runId: string, allowHosts?: readonly string[])`. When `allowHosts` is set, the proxy uses that list instead of `allowHostsFromConfig`.
  - `RunSnapshot.routes` is the same shape as `PlanResponse.routes`, `[]` when there is no `plan_targets` row.

- [ ] **Step 1: Write the failing tests**

Script: `generateStageScript` with `routes: [{ id: 'r4', role: 'web', method: 'GET', path: '/assets/a.webp' }]`, journey `r4`, and both origins `https://sketch.my.id` embeds that path and that origin, and does not embed `yue.macro.my.id`, `{productId}`, or `order_create`.

Controller: a run whose plan hash has `plan_targets` for `https://sketch.my.id` and route `r4` calls `generateStageScript` with those origins and routes, and `openRun(runId, ['sketch.my.id'])`. The same run after `getVerifiedOrigin` returns null finishes `failed` with reason containing `The verified origin changed before the run started.` and does not call `openRun`. A run with no `plan_targets` row still uses `config.target` and does not pass `allowHosts`.

Proxy: `openRunNetwork(runId, ['sketch.my.id'])` sets `ALLOW_HOSTS=sketch.my.id` and does not include `yue.macro.my.id`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `bun test test/script.test.ts test/controller.test.ts`

Expected: FAIL on the new cases.

- [ ] **Step 3: Use the stored target at start**

`loadApprovedPlan` returns the plan and `{ webOrigin, apiOrigin, routes }`. Missing `plan_targets`: web and API from `config.target`, `routes` null (catalog path). Present: if `run.ownerUserId` is null, or `getVerifiedOrigin` is null, or `verified.origin !== webOrigin`, fail with `The verified origin changed before the run started.` Otherwise `evaluatePlan(plan, [webOrigin], routes)`.

`generateStageScript` receives the stored origins. When `routes` is non-null, pass them with `role: 'web'`. `readSummary` receives the stored ids. `ReportInput.routeOrder`, when set, is the id order for `buildReport` route rows and for `firstDegradedRoute`. When omitted, both stay on `ROUTE_CATALOG`. `RouteRowView.route` is `string`.

`openRun` receives `[new URL(webOrigin).hostname]` only when `routes` is non-null.

Fill `RunSnapshot.routes` from `getPlanTarget`. Demo snapshots use `[]`.

- [ ] **Step 4: Run the tests**

Run: `bun test test/script.test.ts test/controller.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/k6/script.ts src/run/controller.ts src/sandbox/runner.ts src/api-types.ts src/server.ts src/report/build.ts test/script.test.ts test/controller.test.ts
git commit -m "feat(run): execute own-site plans against the stored origin"
```

### Task 5: Show the paths

**Files:**
- Modify: `web/landing/src/app/pages/NewTest.tsx`
- Modify: `web/landing/src/app/pages/Run.tsx`

`web/landing/src/app/lib/api.ts` already sends `ApproveRequest` through. Do not edit it.

**Interfaces:**
- Consumes: `PlanResponse.routes`, `ApproveRequest.draftId`, `RunSnapshot.routes`.

`web/` has no component tests. Do not add one for this wiring.

- [ ] **Step 1: Render paths and send draftId**

Under the My site control, when `targetMode === 'own'`, show: `Macro reads / on your site, then the scripts that page links, and uses those files as the journey. It does not run the page.`

Journey rows: when `review.routes.length > 0`, method and path come from `review.routes`. Otherwise keep `config.catalog`. An id in neither stays `Not in the route catalog`.

`ApprovePanel` takes `draftId: string` and sends it on `postApprove` when `targetMode === 'own'`.

`Run.tsx`: when `snapshot.routes` has the headline route id, show its `path` next to the id in the headline sentence and use `path` as the chart label. When `routes` is empty, keep today's catalog id text.

- [ ] **Step 2: Verify**

Run: `bun x tsc --noEmit` and `bun run build:web`

Expected: both exit 0.

- [ ] **Step 3: Commit**

```bash
git add web/landing/src/app/pages/NewTest.tsx web/landing/src/app/pages/Run.tsx
git commit -m "feat(app): show discovered own-site paths"
```

### Task 6: Whole-suite check

**Files:** none.

- [ ] **Step 1: Run the suite**

Run: `bun test` and `bun x tsc --noEmit`

Expected: 0 failures. Demo planner, policy, script, and controller tests still pass without a `plan_targets` row.

- [ ] **Step 2: Do not push**

Stop for review. Push only after an explicit `ship`.
