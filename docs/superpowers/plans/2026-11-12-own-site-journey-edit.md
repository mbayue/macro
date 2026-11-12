# Own-site journey edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After the first own-site plan, show the homepage scan as checkboxes and let Revise the plan send a new plan that uses only the rows left on.

**Architecture:** `discoverOwnSite` records homepage anchors plus the existing script, style, and asset rows, with `defaultOn`. The draft stores the full list (up to 128) and `selectedIds`. The planner and approve see only the selection (at most 32). The plan screen groups the returned rows and posts `routeIds` on revise.

**Tech Stack:** TypeScript, Bun test, existing `src/plan/discover.ts`, `src/store/db.ts`, `src/server.ts`, `web/landing` React.

**Spec:** `docs/superpowers/specs/2026-11-12-own-site-journey-edit-design.md`

## Global Constraints

- Demo shop and the containment probe stay on the Yue catalog. Demo requests ignore `routeIds`.
- No new fetch. Page URLs are not requested. Stylesheets are not fetched. Scripts are not executed.
- Same discovery limits as the 2026-11-11 spec: timeout 5000 ms, document 262144 bytes, script 524288 bytes, 4 scripts, path rules, manual redirect, verified origin only.
- Checkbox list holds at most 128 rows. A plan holds at most 32 routes. Never drop `/`.
- Action last segments, case-insensitive: `logout`, `log-out`, `signout`, `sign-out`, `unsubscribe`.
- Own-site sizing sentence, exact: `Use only the routes in the table. Include the document and each page, script, and style in that table.`
- Bad `routeIds` public sentence, exact: `Those routes do not match the pages read from the site.`
- Approve mismatch sentence stays: `This plan's routes do not match the routes read from the site.`
- Button label, exact: `Revise the plan`. Unrevised checks: `Revise the plan to use these checks.` Overflow: `Some pages were left off because a plan holds 32 routes.`
- Action row extra text, exact: `A repeated visit would hit this link.`
- No em dashes in user-facing copy. Commit locally. Do not push.

## Review Focus

- An anchor to `/account/logout` starts off, while `/cart` and `/account` start on. Task 1.
- An anchor whose path is `/app.js` is a script and starts on; an image anchor starts off. Task 1.
- More than 32 default-on rows: extras are stored with `defaultOn` false and `/` stays on. Task 1.
- `routeIds` that omit `/`, repeat an id, or name an id the scan did not store is rejected and does not call the planner. Task 2.
- Approve of a plan whose journey still lists a row the user turned off is rejected, and `plan_targets` stores only the selected rows. Task 3.

---

### Task 1: Homepage links and default selection

**Files:**
- Modify: `src/plan/discover.ts`
- Test: `test/discover.test.ts`

**Interfaces:**
- Consumes: `acceptPath`, `extractDocumentRefs`, `discoverOwnSite`.
- Produces:
  - `DiscoveredKind` adds `'page'`.
  - `DiscoveredRoute` gains `defaultOn: boolean`.
  - `export const DISCOVER_LIST_MAX = 128`
  - `export const ACTION_SEGMENTS = ['logout', 'log-out', 'signout', 'sign-out', 'unsubscribe'] as const`
  - `export function isActionPath(path: string): boolean`
  - `extractDocumentRefs` also returns `pages: string[]` in document order.
  - `discoverOwnSite` still returns `{ ok: true, routes: DiscoveredRoute[] } | { ok: false, reason }`. `routes` is the stored list, each with `defaultOn` already forced false past the 32-route selection.
  - `export function selectedRoutes(routes: readonly DiscoveredRoute[]): DiscoveredRoute[]` returns rows with `defaultOn === true`, in array order.

- [ ] **Step 1: Write the failing tests**

In `test/discover.test.ts`, assert:

- HTML `<a href="/about">` then `<a href="/product">` yields `page` paths `/about`, `/product` in that order, both `defaultOn: true`, after `r1` `/`.
- `<a href="/account/logout">` and `<a href="/Cart/Log-Out">` are `page`, `defaultOn: false`. `<a href="/cart">` and `<a href="/account">` are `defaultOn: true`.
- `<a href="/assets/app.js">` is `script`, `defaultOn: true`. `<a href="/logo.webp">` is `asset`, `defaultOn: false`.
- `<a href="https://other.example/x">`, `<a href="/out?x=1">`, and `<button>` text are absent.
- 40 default-on pages: stored length 41 (`/` plus pages, under 128), exactly 32 have `defaultOn: true`, `r1` is `/` and true, and `selectedRoutes` returns those 32.
- 200 asset-only anchors: stored length 128, `/` kept, assets dropped from the end.

- [ ] **Step 2: Run `bun test test/discover.test.ts`**

Expected: FAIL because `page` and `defaultOn` do not exist.

- [ ] **Step 3: Implement the scan**

Extend `extractDocumentRefs` to collect `<a href>` with the same URL resolution as script and style refs. Classify each new path: action `page` if `isActionPath`; else `.js` script, `.css` style, image/font suffix `asset`, else `page`. Dedupe by path, earlier row wins. Order: `/` document, pages in document order, scripts sorted, styles sorted, assets sorted. Apply the 128 drop order (assets, styles, scripts, pages, never `/`). Set `defaultOn` true for document, non-action page, script, and style, then false for every such row after the 32nd. `isActionPath` compares the last segment case-insensitively to `ACTION_SEGMENTS`.

Update existing discover fixtures so every `DiscoveredRoute` includes `defaultOn`.

- [ ] **Step 4: Run `bun test test/discover.test.ts test/discover-store.test.ts`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/plan/discover.ts test/discover.test.ts test/discover-store.test.ts
git commit -m "feat: record homepage links and which routes start on"
```

### Task 2: Replan from checked route ids

**Files:**
- Modify: `src/store/db.ts` (`DraftRow`, `setDraftDiscovery`, draft read)
- Modify: `src/api-types.ts` (`PlanRequest.routeIds?`, `PlanRouteView.kind` adds `'page'`, `PlanRouteView.defaultOn`)
- Modify: `src/agents/planner.ts` (replace the asset sizing sentence)
- Modify: `src/server.ts` plan handler
- Test: `test/own-site-plan.test.ts`, `test/discover-store.test.ts`

**Interfaces:**
- Consumes: `selectedRoutes`, `DiscoveredRoute.defaultOn` from Task 1. `store.setDraftDiscovery(id, origin, routes)`.
- Produces: `DraftRow.selectedIds: string[] | null`. `setDraftDiscovery` also stores `selectedIds` (the ids of `selectedRoutes(routes)`). `POST /api/plan` body may include `routeIds: string[]` only for `targetMode: "own"` when that origin's draft already has routes. The planner receives `selectedRoutes` on the first plan, or the stored rows named by a valid `routeIds` (stored id order) on revise. Response `routes` is the full stored list, each with `defaultOn`. A successful plan overwrites `selectedIds` with the ids actually sent to the planner.

- [ ] **Step 1: Write the failing tests**

- First own-site plan stores `selectedIds` equal to the default-on ids and the planner tool enum is only those ids. Response `routes` still includes an asset with `defaultOn: false`.
- System prompt contains the new sizing sentence and does not contain `at most two steps`.
- `routeIds` equal to `['r1']` plans with only `/` and does not fetch the origin again.
- `routeIds` of `[]`, `['r2']` (missing `/`), a duplicate, or an unknown id returns 400 `Those routes do not match the pages read from the site.` and the planner is not called.
- A demo plan with `routeIds` ignores them and does not 400.

- [ ] **Step 2: Run `bun test test/own-site-plan.test.ts test/discover-store.test.ts`**

Expected: FAIL on `routeIds` and `selectedIds`.

- [ ] **Step 3: Implement replan**

Add `selected_ids_json` on the draft row (migrate like the existing draft columns). On own-site plan, if `routeIds` is omitted, discover, store routes and default `selectedIds`, and pass `selectedRoutes` to the planner. If `routeIds` is present, load the draft for this user and origin that already has routes. Reject unless every id is in that list, `r1` is present, length is 1 to 32, and there are no duplicates. Do not call `discoverOwnSite` in that branch. Pass the matching rows in stored order. Replace the planner sizing bullet with the spec sentence.

- [ ] **Step 4: Run the same test command**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/db.ts src/api-types.ts src/agents/planner.ts src/server.ts test/own-site-plan.test.ts test/discover-store.test.ts
git commit -m "feat: replan an own-site journey from the checked routes"
```

### Task 3: Approve only the checked routes

**Files:**
- Modify: `src/server.ts` (`postApprove`)
- Test: `test/own-site-gate.test.ts`

**Interfaces:**
- Consumes: `DraftRow.selectedIds` and `DraftRow.routes` from Task 2.
- Produces: own-site approve checks journey ids against `selectedIds`, not the full stored list. `storePlanTarget` receives only the selected rows, in stored order.

- [ ] **Step 1: Write the failing test**

Draft routes are `/` (`r1`, on) and `/logo.webp` (`r2`, off). `selectedIds` is `['r1']`. A plan whose journey is only `r1` approves, and `plan_targets.routes` is only `r1`. A plan that also names `r2` returns 422 with the existing mismatch sentence and stores nothing.

- [ ] **Step 2: Run `bun test test/own-site-gate.test.ts`**

Expected: FAIL because approve still accepts every stored id.

- [ ] **Step 3: Change the approve check**

`ids` comes from `draft.selectedIds`. `ownRoutes` is `draft.routes` filtered to those ids. Keep the origin checks already in `postApprove`.

- [ ] **Step 4: Run `bun test test/own-site-gate.test.ts`**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server.ts test/own-site-gate.test.ts
git commit -m "fix: approve own-site plans against the checked routes only"
```

### Task 4: Plan screen checkboxes

**Files:**
- Create: `src/plan/journey-edit.ts`
- Modify: `web/landing/src/app/pages/NewTest.tsx`
- Test: `test/journey-edit.test.ts`

**Interfaces:**
- Consumes: `PlanRouteView` with `kind: 'page'` and `defaultOn`.
- Produces: `export function journeyGroups(routes: readonly { id: string; path: string; kind: string; defaultOn: boolean }[]): { locked: Row[]; on: Row[]; off: Row[]; overflow: boolean }` where `locked` is `/`, `on` is other `defaultOn` rows, and `off` is the rest. `overflow` is true when any `page` that is not an action path, or any `script` or `style`, has `defaultOn: false`. The component does not compute that itself.

- [ ] **Step 1: Write the failing test**

`/` is locked. A default-on `/about` is in `on`. A default-off `/logo.webp` and `/account/logout` are in `off`, and `overflow` is false for that list. `overflow` is true when a non-action page, a script, or a style has `defaultOn: false`.

- [ ] **Step 2: Run `bun test test/journey-edit.test.ts`**

Expected: FAIL, module missing.

- [ ] **Step 3: Implement the groups and the screen**

`journeyGroups` as specified. In `NewTest`, under an own-site plan with `routes.length > 0`, render the three groups in id order. `/` checkbox checked and disabled. Other rows use a checkbox initialized from `defaultOn`. Labels: `page` Page, `script` Script, `style` Stylesheet, asset ending `.woff2` Font, other asset Image. Action paths add `A repeated visit would hit this link.` Show the overflow sentence when `overflow` is true. Button `Revise the plan` calls the existing plan request with the same description and `routeIds` of `/` plus the checked ids. If the checked set differs from the `defaultOn` rows on the current response, disable Approve and show `Revise the plan to use these checks.` Demo plans render no checklist.

- [ ] **Step 4: Run `bun test test/journey-edit.test.ts` and `bun x tsc --noEmit`**

Expected: PASS and no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/plan/journey-edit.ts web/landing/src/app/pages/NewTest.tsx test/journey-edit.test.ts
git commit -m "feat: edit the own-site journey before approve"
```

## Self-review

- Spec scan, defaults, 128/32, replan, approve, and the plan screen each have a task.
- `defaultOn` and `selectedIds` keep the same names from Task 1 through Task 4.
- Demo behavior is a test in Task 2, not a new feature.
