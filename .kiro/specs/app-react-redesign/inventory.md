# Current app inventory (input to the rebuild)

Produced by reading web/*.ts on 2026-11-07. Line numbers refer to that revision.



Line numbers come from `Select-String` and are exact for function and constant starts. Numbers marked "~" are block ranges estimated from the reads.

## 1. Routes (web/app.ts)

The app shell is served at `/app/` (`src/server.ts:1022-1023`). All views are hash routes. `parseRoute` is at `app.ts:28-42`, and `ID_PATTERN = /^[A-Za-z0-9._~-]{1,100}$/` is at `app.ts:26`.

| Hash | Params | View | document.title |
|---|---|---|---|
| `''`, `#`, `#/` | none | `renderDescribeView` (describe.ts:65) | "Macro: describe your traffic" |
| `#/run/<id>` | `id` (decodeURIComponent, then ID_PATTERN) | `renderRunView` (run-view.ts:592) | "Macro: run" |
| `#/probe/<id>` | `id` | `renderProbeView` (probe-view.ts:318) | "Macro: containment probe" |
| anything else, a bad id, a decode error, or extra segments | none | inline "Page not found" panel with link "Back to the planner" (`#/`) | "Macro: page not found" |

There is no compare route: compare is embedded in the report.

**Router behaviour** (`main`, app.ts:60-152):
- **Boot**: shows `role=status` "Loading" (app.ts:150), then calls `GET /api/config`. If that fails, `errorPanel` shows h1 "Something went wrong" and an alert: "Macro could not load its settings from the server. Check your connection and try again." It also shows a "Try again" button that re-runs `start()`. Config is loaded once, and no view renders before it arrives.
- **Each render**: runs the previous view's cleanup inside a try/catch so a failing cleanup never blocks navigation. It then empties `#app` and renders the view. A throw during render shows `errorPanel('This page failed to load. Reload the page to try again.')`.
- **Non-initial navigation**: calls `scrollTo(0,0)`, `root.focus({preventScroll:true})` (app.ts:136), then `announce(document.title)`.
- **`navigate(path)`**: normalises to `#/...`. If the hash is already that value, it re-renders anyway, because no `hashchange` event would fire.
- **Redirects**:
  - The run view sends probe runs to `/probe/<id>` (run-view.ts ~908).
  - The probe view sends non-probe runs to `/run/<id>` (probe-view.ts ~610).
  - Approve and re-run navigate to `/run/<runId>`. Starting a probe navigates to `/probe/<runId>`.
- **Skip link** `.skip-link` (index.html): the click handler calls `preventDefault` and then focuses `#app` (app.ts:141-144), because a bare `#app` href would otherwise change the route.
- **`announce`**: clears `#live-region`, then sets the text after 50 ms so a repeated message is re-read (app.ts ~66-73).
- **AppContext** (context.ts:15-24) has `config`, `navigate(path)` and `announce(msg)`. `ReportViewHelpers` (context.ts:30-35) has `{runId, run?, plan?, modelCalls?}`.

**Shell** (web/index.html):
- Skip link "Skip to main content".
- Header: brand link `#/` "Macro" and tagline "Know your breaking point before your users do."
- `<main id="app" tabindex="-1">` with a noscript message: "Macro needs JavaScript to run."
- `#live-region` (`visually-hidden`, `aria-live="polite"`, `aria-atomic="true"`).
- Footer: "This demo tests only the demo store. Your own sites will be testable after domain verification.", with links `/` "About Macro", `/privacy`, `/terms`.
- `meta color-scheme dark`; preloaded IBM Plex Sans 400/600 fonts.

## 2. Views

### 2a. Describe / planner (describe.ts:65-~670)

**Layout, in order** (~208-222): h1 "Plan a load test", intro, runtime notice, form, review host, recent runs, probe panel, gate demo.

**Intro** (`introSection`, 25-~63):
- Lead: "Describe a traffic spike in plain words. Macro plans a load test, you approve it, and k6 runs it inside throwaway sandboxes that can only reach the site under test. You get the point where it breaks."
- Steps 1 to 3 (the numbers are `aria-hidden`): "Describe", "Review and approve", "Watch it run and read the report".
- "Safe by design" list:
  - "Only verified targets can be tested. This demo allows one: the demo store."
  - "The AI proposes; fixed rules approve."
  - "Every stage runs in its own gVisor sandbox with no secrets and an egress allowlist."
  - "Every number in the report is measured by k6. AI text is checked against those numbers."

**Runtime notice** (only if `config.runtimeError` is set): badge "Runtime problem" plus "Runs cannot start until this is fixed: ${runtimeError}".

**Form** (`novalidate`; submit calls preventDefault, then `startPlanning(value.trim())`):
- Label "Describe the traffic you expect" (`for=traffic-event`).
- Hint `#traffic-event-hint`: "Say who arrives, when, and what they do. ${min} to ${max} characters." (max is en-US formatted).
- Textarea `#traffic-event`, rows 7, `autocomplete=off`, `aria-describedby="traffic-event-hint traffic-event-count traffic-event-problem"`.
- Counter `#traffic-event-count` shows "n / max". It gets class `counter--bad` when n>0 and the length is out of range.
- Problem `#traffic-event-problem` shows "Needs at least ${min} characters." or "${n-max} over the limit.".
- Example buttons (group `aria-label="Examples"`, caption "Examples (fill the text box only):"). A click fills the textarea, calls refresh and focuses the textarea. It never submits, and it is ignored while busy.
- Target `dl` showing `config.webOrigin`, then "Demo target. Testing your own site will need domain verification (coming soon)."
- Turnstile box, "Draft a plan" (primary submit), the hidden "Retry planning" button, a progress span with spinner "Drafting a plan. This can take up to a minute.", and an alert region (`role=alert`).

**State**:
- `busy: 'planning'|'approving'|'probing'|null`.
- `lastSubmitted`.
- `refresh()` (228-253) does all of the following:
  - Submit is disabled unless the length is in range and nothing is busy.
  - Examples, retry, approve, cancel and the probe button are disabled while busy.
  - The textarea is `readOnly` while busy.
  - Each progress span is shown only for its own busy kind.
  - Retry is hidden once the text differs from `lastSubmitted`.
  - `staleNote` is shown when the text differs from `lastSubmitted`.
- The length is counted in code points of the trimmed text (`countCodePoints`, 20).

**`startPlanning`** (261-299):
- Guard: not busy, not disposed, length in range.
- Clears the review and the alert, then announces "Drafting a plan."
- Calls `getToken` and then `postPlan`. Any throw becomes `VERIFICATION_ERROR`. `finally` calls `resetWidget()`.
- On success: `renderReview`.
- On error: `renderApiError` into the alert. "Retry planning" is shown only when the code is `planning_failed`. The error message is announced.

**`renderReview`** (374-439):
- Heading h2 "Draft plan" (`tabindex=-1`); it is focused at the end of every branch.
- Stale note: "The text above changed after this plan was drafted. The plan below is for the earlier text."
- The branches are:

| Case | What is shown | Announcement |
|---|---|---|
| `parseError` | badge "Not approvable", "The plan could not be read, so it cannot be approved.", mono `parseErrorText`, then model calls | "The drafted plan could not be read. It cannot be approved." |
| `plan === null` | "No plan was returned." and model calls | none |
| Gate rejected | badge "Rejected by the policy gate", "This plan breaks the rules below, so it cannot be approved.", violations table, then the plan section and model calls | "The plan was rejected by the policy gate." |
| Gate accepted and `planText` present | plan section, model calls, approval panel | "Plan ready for review." |
| Otherwise (gate null) | "This plan has no policy result, so it cannot be approved." | none |

**Plan section** (441):
- h3 "Plan" and the plan name.
- "Why this plan" (AI rationale, class `prose`).
- Stages table (468), caption "Stages", columns "Stage | Virtual users | Duration (s)".
- Journey table (503), columns "Route | Method | Path | Probability (%) | Think time (ms)". A route not in the catalog shows "Not in the route catalog" (colspan 2).
- "Stop thresholds": "p95 latency limit" in ms and "Error rate limit" in %.

**Model calls** (543): h3 "Model calls".
- Empty state: "No model calls were recorded."
- Table caption "Model calls in request order", columns "# | Agent | Model | Outcome | Latency (ms) | Tokens".
- Outcome badge: ok, warn (timeout) or bad.
- Tokens: "not reported", or "prompt X, completion Y" with each missing part shown as "not reported".

**Approval panel** (608-~660):
- h3 "Approve this plan" and "Nothing is sent until you approve. Approving starts the run right away."
- Target, "Maximum virtual users" (max of stage VUs), "Total stage duration" (sum, shown as "N s").
- Turnstile box, "Approve and run" (primary), "Cancel", progress "Starting the run.", alert region.
- **`approve`** (301-329):
  - Announces "Starting the run."
  - Calls `getToken` and then `postApprove({planText})`.
  - On success it stays busy and navigates.
  - On error it renders the error and announces it.
- **`cancelPlan`** (331-342): clears the review, keeps the text, focuses the textarea and announces "Plan discarded. Nothing was sent."

**Probe panel** (174-~200):
- h2 "See containment work: run the sandbox probe".
- "The probe tries to escape the sandbox with five attempts, such as reaching the internet and the cloud metadata address, and the sandbox blocks each one."
- Its own Turnstile box, "Run containment probe", progress "Starting the probe.", alert region.
- **`startProbe`** (344-372) announces "Starting the containment probe." and then calls `postProbe`. On success it navigates to `/probe/<id>`.

**Cleanup**: `disposed=true`, `disposeRecent()`, `disposeWidget()`.

### 2b. Gate demo (gate-demo.ts:21-84)

- h2 "See the policy gate block a hostile plan" and "The agent only proposes plans. Fixed code decides. Pick a hostile plan and watch the gate reject it before anything runs."
- Button group (`aria-label="Hostile plans"`) built from SCENARIOS (~15-19): `other_host` "Another website", `too_big` "Far too much load", `unknown_route` "A route outside the catalog".
- **Busy**: all buttons are disabled and a progress span shows "Asking the gate.". There is no Turnstile and no abort, and nothing is cleaned up on unmount.
- **Result** (`role=status`):
  - h3 title, then the description.
  - h4 "Plan as proposed" over `<pre class=code tabindex=0>` holding planText.
  - Violations table.
  - "Rejected by the policy gate. 0 requests were sent. No approve button exists for this plan."
- **Error**: `renderApiError` into an alert.

### 2c. Recent runs (recent-runs.ts)

- **Storage**: key `macro.recentRuns.v1`. At most 10 entries are stored (MAX_STORED) and 5 are shown (MAX_SHOWN). Each entry's id must match `ID_RE = /^[A-Za-z0-9-]{1,64}$/` (13-16).
- **Validation and writes**: `isRecentRun` (25) validates the id, `kind` run|probe, name of at most 200 characters, and a finite startedAt. `loadRecentRuns` (39) and `save` (51) swallow storage errors. `rememberRun` (60) dedupes by id and sorts newest first. `forgetRun` (67).
- **Panel** (`renderRecentRuns`, 91-123): hidden when the list is empty. It is a section `aria-label` and h2 "Recent runs in this browser".
- **Each item**: a link (`#/probe/<id>` or `#/run/<id>`) with text "Containment probe" or the plan name, a badge initially "checking", and "started ${fmtUtc}".
- **Status lookup**: `getRun` per entry, with an abort signal.
  - On success the badge shows the status ("running now" when running, otherwise `status.replace('_',' ')`).
  - `not_found` removes the entry from storage and from the DOM, and removes the panel when it becomes empty.
  - Any other error shows "status unknown".
- **Badge classes** (`statusClass`, 71): completed is ok; halted, stopped and timed_out are warn; failed and interrupted are bad.
- **Writers**: run-view `load` (`name: plan?.name ?? 'Load test'`) and probe-view `load` (name "Containment probe").

### 2d. Run view (run-view.ts:592-~942)

**States**:
- **Loading**: `role=status` "Loading the run" (904).
- **Load error** (`showLoadError`, 574): h1 "Run", alert with `renderApiError`, a "Try again" button and a "Back to the planner" link.
- **Mounted** (`mount`, 856-900):
  - **Header panel**:
    - h1 "Run", the status badge (`statusWords` replaces `_` with a space) and the stale badge "Progress may be out of date".
    - The plan name, hidden when there is no plan.
    - `dl` with "Sandbox runtime".
    - While running only: "Stage" ("Stage X of Y", "Stage X", or "Starting") and "VUs" (shown as "–" before the first stage).
    - "Elapsed", which switches to "Total time" once the run is terminal, formatted `mm:ss`.
    - Stop button and its error alert.
    - Reason box, and a "Back to the planner" link.
  - **Stages panel** (`fillStages`, 434):
    - Empty: "No Stage has started yet."
    - Columns: "Stage | VUs | Duration | Result | Requests | Requests/s | Error rate | HTTP 429 | p50 (ms) | p95 (ms) | p99 (ms)".
    - Result cell: badge "running", a pass/fail verdict badge, or "–".
    - Error row: badge "error" plus `errorReason`, or "No reason was recorded." (colspan 7, class `stage-error`).
    - Plan stages that have not started show "pending" while running and "not run" afterwards (row class `is-pending`).
  - **Decisions panel** (`fillDecisions`, 509):
    - Empty: "No decision has been made yet."
    - Each item: "Stage N", a continue (ok) or stop (warn) badge, "source: agent|fallback", the badge "AI explanation withheld: unverified number" when `reasonWithheld` is set, and the reason as prose.
  - **Containment timeline** (`fillTimeline`, 538):
    - Note: "Oldest first. Times are UTC."
    - Empty: "No containment event has been recorded yet."
    - Each item: `<time datetime=iso>HH:MM:SS</time>`, an SVG warning icon for egress_blocked, memory_cap_hit and time_cap_hit, the label, " · Stage N" (or "Stage –" with visually-hidden "none"), then " · host:port" or " · port N".
  - **Report host**: `renderReportView` is called once, when the report exists and the status is terminal (706). If it throws, the alert says "The report could not be shown. Reload the page to try again."
- **Reason box** (674): shown when the run is terminal and a reason exists. If the status is failed or interrupted and there is no report, it is an alert "Run ${status}" plus the reason. Otherwise the reason is muted text.
- **Stop** (`onStop`, 806):
  - Only while running and no stop is pending.
  - The button is disabled and reads "Stopping…".
  - `stopRun` is called with **no abort signal**, deliberately.
  - On error: `renderApiError` into `stopErr`.
  - On success: `applyLocalStatus` if the returned status is terminal, then `update` and `refetch`.
  - The button is re-enabled ("Stop run") if the run is still running.
  - The stop block is removed from the DOM once the run is no longer running.
  - The button has class `btn--danger`.
- **Announcements**:
  - On the running-to-terminal transition: "Run ${status}." (`update`, 728).
  - On stale toggles while running: "Progress may be out of date." or "Progress updates resumed." (`setStale`, 764).

### 2e. Report (report-view.ts:529-~835)

The report is embedded in the run view and rendered as `<article aria-labelledby=report-heading>`. Sections, in order:

1. **Header**: h2#report-heading "Capacity report", the plan name, and a `dl` with "Target", "Run ID", "Plan hash", and "Stop thresholds" ("p95 X ms, error rate Y%").
2. **Headline values** (`aria-labelledby=report-headline-heading`), from `headlineItems` (90):
   - "Safe capacity (VUs)": "none" when null, tone bad, otherwise ok.
   - "Breaking point (VUs)": "not reached" when null (neutral), otherwise bad.
   - "First degraded route": neutral or warn.
   - "Run status": shown as a badge.
   - "Sandbox runtime".
   - The first three get the `headline__item--key` class. Then the `reportNotices` list (117) with the server's fixed texts: noStageMetrics, noSafeCapacity, breakingPointNotReached, noRouteExceeded.
3. **Chart section** (509), only when at least one stage has metrics:
   - h3 "p95 latency and error rate per Stage"; the chart sits in a scroll region labelled "Chart of p95 latency and error rate per Stage".
   - Legend: "p95 latency (left axis), limit X ms (dashed line)" and "Error rate (right axis), limit Y% (dotted line)".
   - "The Stage table below holds the same numbers. Stages without metrics are not drawn."
4. **Stages table** (273):
   - Columns: "Stage | VUs | Duration (s) | Verdict | Requests | Requests/s | Error rate | HTTP 429 | p50/p95/p99 (ms)".
   - Verdict: error, pass, fail or "no metrics".
   - Rows without metrics: "Stage failed: reason" or "This Stage has no metrics."
   - "Routes per Stage" tables (326): caption "Stage N routes (V VUs)". The last column is the badge "Exceeded thresholds" (row class `is-exceeded`) or "Within".
   - Values come from the server-preformatted `display.*` strings.
5. **Decisions** (364):
   - Empty: "No decisions were made."
   - Caption "Decision after each Stage", columns "After Stage | Decision | Source | Reason"; withheld rows add the note "AI explanation withheld: unverified number".
6. **Containment events** (402):
   - Empty: "No containment events were recorded."
   - Ordered list: fmtUtc time, then for warning events "⚠" (`aria-hidden`) plus visually-hidden "Warning: ", then "Label: host:port" and " (Stage N|Run)".
7. **AI-generated** (428; `aria-labelledby=report-ai-heading`):
   - Note: "Written by an AI model. The headline values and tables on this page come from the stored metrics, not from the AI."
   - Notes list (`role=status` unless pending), from `aiModel` (175). The notes are "AI explanation pending", "AI explanation withheld: unverified number", "AI explanation unavailable", or "No AI explanation was requested because no Stage produced metrics.", plus server notes.
   - h4 "Explanation" and h4 "Suggestions" (ordered list).
   - AI text appears **only** in this section.
8. **Model calls** (460): only if `helpers.modelCalls` is provided. Same table as the describe view.
9. **"Run again and compare"** (`buildRunsPanel`, 631):
   - **Re-run block** (657), only when `canRerun` (56): completed, halted, stopped or timed_out.
     - Text: "Start a new run of this same approved plan. The plan is not changed."
     - Turnstile box, "Run this plan again", progress "Starting the run.", alert region.
     - `rerun` (689) first shows `window.confirm('Run "${planName}" again against ${target}? This starts a new run of the same approved plan.')`. Cancel sends nothing, not even a Turnstile request.
     - It then announces "Starting the run." and calls `getToken` and then `postRun({planHash})`. On success it stays busy and navigates.
   - **"Runs of this plan"** list (`loadRuns`, 726):
     - Loading: "Loading runs." (`role=status`).
     - Error: alert. Empty: "No runs of this plan were found."
     - Table caption "Most recent runs of this plan, newest first (up to 20)".
     - Columns: a checkbox (header is visually-hidden "Select"; each box has `aria-label` "Select run <id>"), "Run ID" (a link, plus " (this run)"), "Started (UTC)", "Status" badge, "Safe capacity (VUs)", "Breaking point (VUs)".
   - **Compare picker** (`updatePicker`, 793):
     - At most 2 checkboxes can be ticked; the others are disabled once two are ticked.
     - "Compare selected runs" is enabled only with exactly 2 ticked, next to the hint "Select two runs to compare them side by side."
     - `compareSelected` (799) shows "Comparing runs." (`role=status`) in `compareHost` (`aria-live=polite`, 633). It uses `compareSeq` so a late reply is ignored.
     - Error: alert. A malformed payload shows "The comparison could not be read. Please try again."

**Cleanup**: abort, `disposeWidget`.

### 2f. Compare (compare-view.ts:229-261)

- **`different_plan`**: a warn panel (`role=status`) with h3 "These Runs cannot be compared" and the server message.
- **`ok`**:
  - h3 "Comparison".
  - Two run headings: "Baseline (earlier Run)" and "Later Run", each with the mono run id and "Started ${fmtUtc}".
  - Headline table, caption "Headline values", columns "Value | Baseline | Later", rows from `headlineCompareRows`.
  - Per-stage tables, caption "Stage N (V VUs)", columns "Scope | Metric | Baseline | Later | Difference | Change". Rows come from `stageCompareRows`: Overall first, then each route, with three metrics each ("p95 latency (ms)", "Error rate", "Requests per second").
  - A null difference or change gives an empty cell. The value "not run" gets class `compare__notrun`.
  - With no stages: "Neither Run has Stage metrics to compare."

### 2g. Probe view (probe-view.ts:318-~625)

**Layout**:
- h1 "Containment probe" (`tabindex=-1`; it is never focused explicitly).
- Intro: "The probe runs inside the sandbox and tries to escape it. Each attempt should be blocked."
- Info `dl`: "Probe" id, "Sandbox runtime", "Status" (`statusText`, 197), "Started", and "Ended" when ended.
- Note alert, progress, result, actions table, events.
- `<details>` with summary "What each action does", listing PROBE_ACTIONS and ACTION_EXPLANATIONS (43-70).
- "Back to the planner" link.

**`statusText` strings**:

| Status | Text |
|---|---|
| running | "The probe is running." |
| completed | "The probe finished." |
| stopped | "The probe was stopped." |
| timed_out | "The probe hit its 60 second time cap and was killed." |
| failed | "The probe could not finish." |
| interrupted | "The probe was interrupted by a server restart." |
| halted | "The probe was halted." |

The reason is appended when present.

**Running**: progress "The probe is running. Results appear when it ends, usually within a minute.". If a poll fails while running, the note alert says "Could not refresh the probe. Trying again."

**Ended** (`renderResult`, 411):
- Panel `probe-summary--${verdict}` with h2 "Result", score "${contained}/5" and "actions contained", a badge (Passed, Failed or Incomplete) and the headline ("Probe passed", "Probe failed" or "Probe incomplete").
- Details lines from `resultWording` (171):
  - passed: "All five actions were contained. The sandbox could not reach the outside, read secrets, or use more memory than its cap."
  - failed: "This action|These actions escaped the sandbox: (x) label; …."
  - "No result was reported for: …."
  - incomplete: "The probe did not store a usable result." and "No action escaped, but the probe cannot be called passed until every action reports."
- Actions table, caption "The five probe actions, in the order they run", columns "Action | What it tried | Result". Result badges: contained (ok), escaped (bad), "no result" (warn).

**Events** (`renderEvents`, 469):
- h2 "Containment events".
- Empty while running: "No containment events yet."; empty after the end: "No containment events were recorded."
- Ordered list `aria-label` "Containment events, oldest first", sorted by id. Each item: fmtUtc time, "⚠" plus visually-hidden "Warning: " for warning events, then the text.

**Other states**:
- Loading: "Loading the probe." (600).
- Fatal (`showFatal`, 586): `renderApiError` and an announcement. The view adds a "Try again" button unless the code is `not_found`.
- On end, `finish` (525) announces "${headline}. ${details[0]}" once.

## 3. Data flow

### Endpoints (web/api.ts; all calls go through `request`, 106)

`request` never rejects:
- It uses `cache:'no-store'`, `credentials:'same-origin'` and `accept: application/json`.
- A network error becomes `NETWORK_ERROR` ("Could not reach the server. Check your connection and try again.").
- A non-JSON body, or a non-2xx response without the uniform error body, becomes `INTERNAL_ERROR` ("Something went wrong on the server. Please try again.").
- An empty 2xx body is also `INTERNAL_ERROR`.
- `parseErrorBody` (90) copies only known fields, maps unknown codes to `internal`, and validates violation rules 4.2 to 4.6.

| Function | Method and path | Request → Response type | Caller and when |
|---|---|---|---|
| getConfig (149) | GET /api/config | → ConfigResponse | app boot |
| postPlan (153) | POST /api/plan | PlanRequest → PlanResponse | describe submit or retry (Turnstile) |
| postApprove (157) | POST /api/approve | ApproveRequest → StartResponse | "Approve and run" (Turnstile) |
| postRun (162) | POST /api/runs | RerunRequest → StartResponse | report re-run (confirm, then Turnstile) |
| stopRun (166) | POST /api/runs/:id/stop | none → StopResponse | Stop button (no abort) |
| getRun (170) | GET /api/runs/:id | → RunSnapshot | run view load, refetch and poll; probe load and poll; each recent-runs entry |
| getRunsForPlan (174) | GET /api/plans/:hash/runs | → RunListResponse | report mount |
| getCompare (179) | GET /api/compare?a=&b= | → `unknown`, which is `{result: Comparison}`, validated by parseComparison | Compare button |
| postProbe (183) | POST /api/probe | ProbeRequest → StartResponse | "Run containment probe" (Turnstile) |
| postGateDemo (188) | POST /api/gate-demo | GateDemoRequest → GateDemoResponse | gate scenario buttons (no Turnstile) |

`POST /api/waitlist` (WaitlistRequest/Response) belongs to the landing site, not this app. Every path segment is wrapped in `encodeURIComponent`.

### Error extras (`renderApiError`, dom.ts:159)

- `rate_limited`: "You can try again after ${fmtUtc(retryAt)}."
- `daily_limit`: "The daily limit resets at ${fmtUtc(resetAt)}."
- `run_active`: a link "Open the active run" to `#/run/<activeRunId>`.
- `parseError`: "Plan could not be read: …".
- `violations`: the violations table (caption "Policy violations", columns "Rule | Field | Problem"; an empty path shows "(whole plan)").
- `fmtUtc` gives "YYYY-MM-DD HH:MM:SS UTC", or "an unknown time".

### SSE

**URL**: `/api/runs/<id>/events`.

**Server side** (server.ts:905-1004):
- It first sends `retry: 3000`.
- Each event is framed as `id: <id>`, `event: <EventType>`, `data: <EventView JSON>`.
- A heartbeat comment `: hb` goes out every 3 s (SSE_HEARTBEAT_MS, server.ts:68). The heartbeat does not fire `onmessage`, so it does **not** count as client liveness.
- It honours `Last-Event-ID`. A reconnect after a finished run gets a 204, which stops the reconnects.

**Event names** (EVENT_TYPES, run-view ~46): `stage_start`, `stage_end`, `decision`, `status`, `containment`, `report`. Payloads:
- stage_*: StageView.
- decision: DecisionView.
- status: `{status, reason?}`.
- containment: ContainmentEventPayload `{type, host?, port?}`.
- report: `{ready:true}`.

**Run view** (`openStream`, 785):
- Opened only if the status is `running` at mount.
- Listens to `onmessage` plus all six named events.
- On `open`, when `esOpens > 1` (a reconnect), it calls `refetch()`.
- `onMessage` (773) marks activity, clears stale, parses (`parseEventView`), drops events from other runs, then `applyEvent`. A `report` event triggers a refetch.

**Probe view** (`openSource`, 543):
- Listens only to `containment` (merged and deduped by id). `status` and `report` trigger an immediate poll (`schedulePoll(0)`).
- It has a `typeof EventSource` guard.

### Polling and timers

**Run view**:
- `tick` (831) runs every 1000 ms (`setInterval`, 899).
- Each tick updates elapsed time and sets stale via `isStale(lastActivity, now, status)`, with STALE_AFTER_MS = 10 000.
- If `shouldPoll(status, hasReport, sinceTerminal, liveTransition)` (366) is true and at least POLL_MS = 5000 has passed since the last poll, it calls `refetch`.
- Otherwise:
  - If a stream is open, it closes the stream and calls `refetch` once.
  - Else, if the run is terminal, it clears the interval.
- `shouldPoll` returns:
  - true while running;
  - true within END_GRACE_MS = 15 000 after a live transition;
  - true while a report is expected, missing, and less than REPORT_WAIT_MS = 60 000 has passed.
- `refetch` (752) uses `fetchSeq`/`appliedSeq` to drop out-of-order snapshots. A successful refetch counts as liveness.

**Probe view**:
- POLL_MS = 1000 (316), a separate constant with the same name.
- Polling uses chained `setTimeout`. Each poll aborts the previous controller.
- A poll error re-polls after 1 s, except `not_found`, which is fatal.
- Polling stops when the status is anything other than running (`stopLive`, 534).
- The initial `load` uses `getRun(id)` with **no abort signal**.

There are no other timeouts or retries. The only retry buttons are "Try again" and "Retry planning".

### Turnstile (web/turnstile.ts)

- **Script**: `https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit`, loaded once. A load failure clears the cached promise so a later call can retry.
- **Widget**: a module-level singleton, one widget at a time. It renders with `execution:'execute'` and `appearance:'interaction-only'`, so it is invisible unless a challenge is needed. The error, expired, timeout and unsupported callbacks all reject the in-flight token.
- **`getToken(siteKey, container)`** (130): a second call while one is in flight returns the same promise. If the container or site key changed, or the container was detached, the widget is removed and re-rendered. Otherwise it does reset plus execute.
- **`resetWidget()`** (151): called in `finally` after every use so a token is never reused.
- **`disposeWidget()`** (161): rejects any pending token and removes the widget. Called in the describe and report cleanups.
- **Required for**: plan, approve, re-run and probe. Not for gate-demo, getRun, stop or compare.
- **Containers**: describe `turnstileBox`, approval `box`, `probeBox`, report re-run `box`, all `div.turnstile`.
- Any thrown error is shown as `VERIFICATION_ERROR`: "Human verification did not complete. Please try again."

### localStorage

Only `macro.recentRuns.v1` is used (recent-runs.ts:13).

## 4. Pure logic to port unchanged vs DOM code to rewrite

**Port as plain TS**:
- **app.ts**: `parseRoute` (28), `ID_PATTERN` (26).
- **api.ts**: the whole file (`request`, `parseErrorBody` 90, `parseViolations` 64, `parseParseError` 81, `KNOWN_CODES`, the three error constants). It is framework-free.
- **dom.ts**: `fmtUtc` (106), `parseErrorText` (113).
- **describe.ts**:
  - `countCodePoints` (20).
  - The range check and problem-text logic inside `refresh` (228-~240).
  - maxVus and totalSec in `approvalPanel` (609-610).
  - `tokensText` (602).
- **run-view.ts**:
  - Constants (35-58): STALE_AFTER_MS, POLL_MS, END_GRACE_MS, REPORT_WAIT_MS, TERMINAL, REPORT_STATUSES, RUN_STATUSES, EVENT_TYPES, CONTAINMENT_LABELS, WARN_CONTAINMENT.
  - `isTerminal` (97), `reportExpected` (102).
  - `parseEventView` (143) and its guards (106-141).
  - `toContainmentEntry` (169), `upsertStage` (177; a replayed stage_start never undoes an ended stage), `upsertDecision` (190).
  - `modelFromSnapshot` (201), `applyEvent` (231; dedupe by id; a terminal status is final), `mergeSnapshot` (276; re-applies `extras` and never rolls back a terminal status), `applyLocalStatus` (295).
  - `currentStage` (311), `elapsedMs` (324), `formatElapsed` (330), `formatClock` (338).
  - `containmentLabel` (344), `isWarnContainment` (348), `statusWords` (352), `isStale` (357), `shouldPoll` (366), `statusBadgeClass` (382).
  - These suit a `useReducer` model.
- **report-view.ts**:
  - Note constants (47-51).
  - `canRerun` (56), `statusBadgeKind` (62), `headlineItems` (90), `reportNotices` (117), `isWarningEvent` (138), `eventText` (143), `eventTime` (150), `eventScope` (157), `aiModel` (175), `tokensText` (209), `modelCallRows` (216), `runListRows` (236).
  - The "at most 2 ticked" rule in `updatePicker` (793).
- **compare-view.ts**: `parseComparison` (104) with its parsers (30-102), `METRIC_LABELS` (137), `stageCompareRows` (144), `headlineCompareRows` (162).
- **chart.ts**: `chartInputFromReport` (37), `niceScale` (109), `buildChartGeometry` (124), `chartDescription` (179), and the constants (53-55, 195-196).
- **probe-view.ts**:
  - `PROBE_ACTIONS` (43), `ACTION_TARGETS`, `ACTION_EXPLANATIONS` (63).
  - `deriveVerdict` (74), `readProbeResult` (90), `effectiveProbeResult` (114), `probeRows` (139), `labelOf` (153), `resultWording` (171), `isProbeEnded` (192), `statusText` (197).
  - `describeContainment` (256), `parseEventData` (269), `mergeEvents` (286), `eventLines` (298).
- **recent-runs.ts**: `isRecentRun` (25), `loadRecentRuns` (39), `save` (51), `rememberRun` (60), `forgetRun` (67), `statusClass` (71).
- **turnstile.ts**: keep the whole module and wrap it in a hook or component.
- **Shared from `src/`**:
  - `src/run/format.ts`: `roundHalfAway` (20), `fmtMs` (34), `fmtPct` (39), `fmtRps` (44), `fmtCount` (49).
  - `src/report/compare.ts`: `displaySafeCapacity`, `displayBreakingPoint`, `displayFirstDegradedRoute` (20-30), `NOT_RUN` and the related constants (13-17).

**DOM-bound code to rewrite**:
- dom.ts `el`/`svg`/`clear`/`scrollRegion`/`violationsTable`/`renderApiError`. Keep their output shape and copy.
- `app.ts main`.
- All `render*` and `fill*` functions.
- Section builders: describe `planSection`, `stagesTable`, `journeyTable`, `modelCallsSection`, `approvalPanel`, `introSection`; report `stageTable`, `routeTable` and the section builders; compare `stageTable`/`renderCompareView`; probe `renderInfo`/`Progress`/`Result`/`Events`; `renderGateDemoPanel`; `renderRecentRuns`; `renderStageChart`.
- Imperative state: busy flags, key-string memoisation (`keys` in run-view `renderSections` 687, `renderedKey` in probe `render` 497), timers, and EventSource lifecycles.

## 5. Chart (web/chart.ts)

- **Technology**: SVG, not canvas. It is built with `svg()` and `viewBox="0 0 640 340"`, with margins top 28, right 64, bottom 72, left 64, and scales to its container through CSS `.chart`.
- **Input**: only report stages with `overall !== null`. p95 is rounded to whole ms and error rate to one decimal (`roundHalfAway`), so the chart matches the tables. The thresholds come from `report.thresholds`. No AI text is drawn.
- **Scales**: the left axis is p95, the right axis is error %. Each axis is `niceScale(max(threshold, values)*1.05)` with steps of 1, 2, 2.5, 5 or 10 times a power of ten, at most 5 ticks, and a 0..1 axis when max ≤ 0.
- **Drawing order**:
  1. Grid lines and left labels.
  2. Right labels.
  3. Baseline axis.
  4. Axis titles "p95 (ms)" and "Errors (%)".
  5. Error bars (width `min(band*0.4, 56)`).
  6. Limit lines (`chart__limit--p95` dashed, `--err` dotted, both via CSS).
  7. p95 path.
  8. Circles (r=4).
  9. X labels "Stage N" and "N VUs".
- **Returns** `null` when no stage has metrics, and the section is then omitted.
- **Accessibility**:
  - `role="img"`, `aria-labelledby="report-chart-title report-chart-desc"`, `focusable="false"`.
  - `<title>`: "p95 latency and error rate per Stage".
  - `<desc>` from `chartDescription`, a full text dump: "p95 latency line on the left axis in milliseconds, error rate bars on the right axis in percent. The p95 limit is X ms and the error rate limit is Y. Stage N (V VUs): p95 latency … ms, error rate …".
  - Wrapped in a focusable scroll region, with a text legend whose swatches are `aria-hidden`, and the note that the table holds the same numbers.
  - Colours are set only by CSS classes (`.chart__grid/axis/text/bar/limit/line/point`).
  - The ids are fixed, so only one chart can exist per page.

## 6. Accessibility behaviours to keep

- A single polite atomic live region with the clear-then-50-ms-set trick (app.ts ~66-73).
- **Announcements**:
  - The route title on navigation.
  - Describe: "Drafting a plan.", "Starting the run.", "Plan discarded. Nothing was sent.", "Starting the containment probe.", "Plan ready for review.", "The plan was rejected by the policy gate.", "The drafted plan could not be read. It cannot be approved.", and error messages.
  - Run view: "Run <status>." and the two stale messages.
  - Probe view: the verdict.
- **Focus**:
  - `#app` is `tabindex=-1` and focused on route change with `preventScroll`.
  - The skip link focuses `#app` without changing the hash.
  - The "Draft plan" h2 (`tabindex=-1`) is focused after review renders (describe.ts 397, 407, 438).
  - The textarea is focused after an example fill or a cancel (117, 339).
- **Regions and roles**:
  - `role=alert` on every error region.
  - `role=status` on progress spans and loading text. Spinners are `aria-hidden`.
  - The compare host is `aria-live=polite`.
  - The gate-demo result is `role=status`.
  - Labelled sections: `aria-label` for "About Macro" and "Recent runs in this browser"; `aria-labelledby` for the report, headline, AI section and runs panel.
  - Button groups use `role=group` with `aria-label` ("Examples", "Hostile plans").
- **Forms and tables**:
  - The textarea has a `label for` and three `aria-describedby` ids.
  - Wide tables sit in `scrollRegion`: `role=region`, `aria-label`, `tabindex=0` (dom.ts:101).
  - Tables have `<caption>`, `th scope=col` and `scope=row`.
  - Checkboxes have `aria-label` "Select run <id>", and their column header is visually hidden.
  - The `<pre>` in gate-demo is `tabindex=0`.
- **Non-visual and non-colour cues**:
  - Badges always carry text, never colour alone (probe-view.ts ~128 comment).
  - Warnings use an SVG with `role=img aria-label="Warning"` in the run view, and `aria-hidden` "⚠" plus visually-hidden "Warning: " in the report and probe views.
  - "–" is paired with visually-hidden "none" (`stagePosition`, 419).
  - `<time datetime>` in the run timeline.
- **CSS**: `:focus-visible` (style.css:73), `.visually-hidden` (82), skip link (95-106), and `prefers-reduced-motion` (408).

## 7. Security constraints

- **CSP** (server.ts:64-65, set at 192): `default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; frame-src https://challenges.cloudflare.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`.
- **Consequences for React and Vite**:
  - No inline `<script>`, and no inline `style=` attributes or style elements. React `style={{}}` props and many CSS-in-JS libraries would break under `style-src 'self'`.
  - `connect-src` allows only self plus Cloudflare Insights, so the SSE stream and the API must stay same-origin.
  - The Vite dev client and HMR inject styles, so this needs care in dev and must produce external CSS in build.
- **dom.ts enforcement** (17-44):
  - Throws on `style`, `innerhtml`, `outerhtml` and `srcdoc`.
  - `on*` attributes must be functions and are attached with `addEventListener`.
  - URL attributes (href, src, action, formaction, xlink:href) must match `^(#|/(?!/)|https://)`.
  - All string and number children become text nodes (46-63).
- **Untrusted text**: there is no `innerHTML` anywhere. AI output (rationale, decision reasons, AI explanation and suggestions) and server strings (plan names, error messages, violation messages, statusReason, errorReason, hosts) are rendered as text. In React, keep JSX text and never use `dangerouslySetInnerHTML`. Also keep the href validation for constructed links (`#/run/${encodeURIComponent(id)}`).
- **Client-side checks**:
  - Recent-runs localStorage entries are treated as untrusted and validated.
  - SSE payloads are validated (`parseEventView`) and filtered by `runId`.
  - `probeResult` is validated, and the verdict is recomputed rather than trusted (`readProbeResult`).
  - The compare payload is shape-checked.
- **AI-text isolation**: AI text appears only in the report's "AI-generated" section, plus the rationale and decision reasons. The chart and headline use stored metrics only.

## 8. Surprising, fragile or duplicated

- **Duplication**:
  - Status-to-badge mapping appears three times: `recent-runs.ts:71`, `run-view.ts:382`, `report-view.ts:62`.
  - Containment labels appear three times: run-view `CONTAINMENT_LABELS` (~47), report-view `EVENT_LABELS` (~127), probe-view `EVENT_WORDING` (~232). The probe wording differs: "Sandbox runner created" and "Sandbox runner removed" versus "Runner created" and "Runner deleted".
  - The warning-type set appears three times.
  - `tokensText` and the model-calls table appear twice (describe.ts:543/602, report-view.ts:209/460).
  - `isRecord` is copied in api, run-view, compare-view and probe-view.
  - The SSE parsers differ: `parseEventView` checks the event type, while probe `parseEventData` does not.
  - `POLL_MS` means 5000 in the run view and 1000 in the probe view.
  - `PROBE_ACTIONS` is hand-copied from `src/k6/probe-result.ts` to keep zod out of the bundle, so it must stay in sync.
- **ID regex mismatch**: the router allows `[A-Za-z0-9._~-]{1,100}` while recent-runs allows `[A-Za-z0-9-]{1,64}`. The server uses its own `ID_RE`.
- **Report renders once** (`reportRendered`, run-view 706). If `report.ai` arrives after the first snapshot with a report, the "AI explanation pending" note never updates, because `shouldPoll` also stops once `hasReport` is true. Verify whether the server ever sends a report before its AI part.
- **Run view opens SSE only if running at mount**. Heartbeats don't fire `onmessage`, so a quiet stream still trips the 10 s stale badge unless the 5 s polls succeed (each successful refetch resets activity).
- **Stop and probe load have no abort signal**. Stop omits it on purpose. The probe's initial load relies on the `disposed` flag instead.
- **Busy stays set after a successful approve, probe or re-run** until navigation. Single-submit depends on that.
- **Turnstile is a module singleton**. Containers switch between the describe, approval, probe and re-run boxes. A React StrictMode double mount or unmount will call `disposeWidget` and reject an in-flight token.
- **Native `window.confirm`** gates the re-run.
- **`navigate` to the current hash** re-renders manually.
- **Recent-runs badge** uses `replace('_',' ')`, which replaces only the first underscore. That is fine for `timed_out`.
- **The gate demo has no cleanup or abort**, and its result can arrive after unmount.
- **Time formats differ**: the run timeline uses `HH:MM:SS` (UTC), while the report and probe use the full `fmtUtc`.
- **Fixed SVG and AI ids** (`report-chart-title`, `report-ai-heading`, …) assume one report per page.
- **The probe heading** is `tabindex=-1` but nothing ever focuses it.
- **Build** (scripts/build-web.ts:30-45): Bun bundles `web/app.ts` to `dist/app.js`. `index.html` is copied to `dist/app/index.html`, `style.css` to `/style.css`, and fonts to `/fonts`. The landing site is a separate Vite and React app in `web/landing`. The build check at line 77 expects `app.js` and `app/index.html`, so the Vite output paths must match or the check must change.

RELEVANT FILES (ranked by importance):
  1. web/run-view.ts — Holds the pure run-model reducer (modelFromSnapshot, applyEvent, mergeSnapshot, shouldPoll, isStale), the poll and SSE lifecycle constants, and the live run UI, stop flow and announcements.
  2. web/describe.ts — Contains the planner form, the busy-state machine, plan review branches (parse error, rejected, accepted), the approval panel, the probe start, Turnstile usage and focus management.
  3. web/report-view.ts — Contains the report sections, AI isolation notes, the re-run confirm and Turnstile flow, the run list and the two-run compare picker, plus pure view-model helpers.
  4. web/probe-view.ts — Contains probe verdict logic, wording, the 1 s polling and SSE handling, and the full probe UI copy.
  5. web/api.ts — The typed client for every endpoint, with error normalisation and the fixed error messages. It can be ported unchanged.

NOTE: Line ranges have been extended by ~50 lines to provide additional surrounding context.
