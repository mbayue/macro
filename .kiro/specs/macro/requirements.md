# Requirements Document

## Introduction

Macro ("Know your breaking point before your users do.") is a web app at `https://macro.my.id` built for the lablab.ai "Vultr: Agent Rush" hackathon, Challenge 1 "Blast Radius Zero". The submission deadline is 4:00 AM UTC+7 on November 9, 2026, and the project is built by one person in one night.

A user describes a traffic event in plain language, for example: "A new Uma Musume banner drops tonight; 500 players open the store, browse the catalog, check the ledger, 10% place an order." An AI agent turns the description into a Test_Plan. A deterministic Policy_Gate validates the Test_Plan, and the user approves it. Macro then runs k6 stage by stage, each Stage inside a throwaway Sandbox container that can reach only the Demo_Target. After each Stage, an AI agent reads the measured k6 metrics and decides to continue or stop. The Capacity_Report gives the Safe_Capacity, the Breaking_Point, the First_Degraded_Route, and suggestions. Every number shown to the user comes from k6 measurements. The AI plans and explains but never produces numbers. The user can re-run the same approved Test_Plan after a fix and compare the two Runs side by side.

Hackathon constraints that shape these requirements:

- The backend runs on a Vultr VM, and every agent LLM call goes through Vultr Serverless Inference.
- Agent actions run in Docker containers with process isolation, no secrets inside the container, time and memory caps, and destruction of the environment after each task.
- Deliverables: a public GitHub repository whose README explains how Vultr is used, the backend on a Vultr VM, a public demo URL, and a video showing one containment moment (Requirement 12 exists for that video).

The only authorized target is the Demo_Target: a demo copy of the YUE store (Next.js 15 storefront, NestJS 10 on Fastify API under the `/api/v1` prefix, Postgres, Redis) on a separate Vultr VM, with web origin `https://yue.macro.my.id` and API origin `https://api.yue.macro.my.id`. Both hosts share one registrable domain because YUE's admin cookie requires it. The YUE production deployment (`yueshop.xyz`, `api.yueshop.xyz`, Supabase database) is never a target. YUE existed before the hackathon and is only the test target; Macro is built during the hackathon.

Infrastructure already provisioned:

- Vultr VM `macro` (45.77.37.116) and Vultr VM `yue-demo` (45.32.113.74): both Ubuntu 24.04, 1 vCPU / 2 GB, Singapore region, Docker 29 with Compose, SSH key-only login.
- `macro.my.id` is proxied through Cloudflare. `yue.macro.my.id` and `api.yue.macro.my.id` are Cloudflare DNS-only records, so Cloudflare does not throttle load tests.
- YUE is cloned from GitHub to `/opt/yue` on `yue-demo` with a read-only deploy key.

Priority levels used in this document:

- **Core**: required for the demo. Requirements 1–15 are Core. Suggested build order: 3, 4, 6, 7, 9 with a hand-written Test_Plan first, then 2, 8, 10, 11, 12, 5, 13, then 14 and 15 in parallel with deployment.
- **Optional**: built only if time allows. Requirements 16 and 17 are Optional.

Non-goals: user-supplied or arbitrary targets, user accounts, authenticated or admin YUE routes, browser-level (k6 browser) tests, distributed load generation across several machines, and k6 scripts written by an LLM.

## Glossary

- **Macro**: The whole system: Web_UI, Macro_API, agents, and Sandbox_Runner.
- **Web_UI**: The single-page browser interface served at `https://macro.my.id`.
- **Macro_API**: The backend HTTP service on the Macro Vultr VM that the Web_UI calls and that runs all components below.
- **Inference_Client**: The component that sends chat-completion requests with tool definitions to Vultr Serverless Inference (OpenAI-compatible API, base URL `https://api.vultrinference.com/v1`). The primary model is set by `VULTR_INFERENCE_MODEL` (default `minimax-m3.1-flash`) and the fallback model by `VULTR_INFERENCE_FALLBACK_MODEL` (default `mimo-v2.6-flash`).
- **Tool_Call**: A function call returned by the model in an Inference_Client response, with a tool name and JSON arguments. Tool_Call arguments are Untrusted_Data.
- **Planner_Agent**: The agent that turns a Traffic_Event into a draft Test_Plan through a `propose_plan` Tool_Call whose arguments are the Test_Plan JSON.
- **Supervisor_Agent**: The agent that reads Stage_Metrics after each Stage and returns a `decide_next_stage` Tool_Call with `decision` (`continue` or `stop`) and `reason`.
- **Report_Writer**: The agent that writes the explanation and suggestions in the Capacity_Report through a `write_report` Tool_Call with `explanation` and `suggestions` (at most 5).
- **Plan_Parser**: The component that parses Test_Plan JSON text into a Test_Plan structure.
- **Plan_Printer**: The component that formats a Test_Plan structure into canonical JSON text (sorted keys, no insignificant whitespace).
- **Policy_Gate**: The deterministic, rule-based component that accepts or rejects a Test_Plan. The Policy_Gate makes no LLM calls.
- **Script_Generator**: The deterministic component that turns one Stage of an approved Test_Plan into a k6 script from a fixed template.
- **Sandbox**: A Docker container that runs one k6 process for one Stage (or for the Containment_Probe) under the limits in Requirement 6.
- **Sandbox_Runtime**: The Docker container runtime used for Sandboxes, set by `SANDBOX_RUNTIME`: `runsc` (gVisor, the default) or `runc` (the standard Docker runtime, used only when set explicitly).
- **Egress_Proxy**: A proxy container that is a Sandbox's only route out of the per-Run internal Docker network. The Egress_Proxy allows only HTTPS CONNECT requests to Target_Allowlist hosts on port 443 and logs every denied request. Egress control runs on the Macro VM because Vultr Firewall groups filter only inbound traffic.
- **Sandbox_Runner**: The component that creates, monitors, kills, and removes Sandboxes, the Egress_Proxy, and the per-Run Docker network.
- **Metrics_Reader**: The component that parses the k6 end-of-test summary from a Sandbox into Stage_Metrics.
- **Run_Controller**: The component that executes a Run stage by stage, applies Stop_Thresholds, calls the Supervisor_Agent, and enforces the Run limits.
- **Number_Guard**: The deterministic component that checks AI-written text against the Allowed_Numbers of a Run.
- **Run_Store**: The component that persists Test_Plans, Runs, Stage_Metrics, decisions, Containment_Events, and Capacity_Reports on the Macro VM.
- **Containment_Probe**: A fixed, hand-written k6 script that deliberately tries to break out of a Sandbox, used to demonstrate containment.
- **Demo_Target**: The demo copy of YUE on its own Vultr VM, with its own Postgres and Redis.
- **Target_Allowlist**: The Demo_Target web origin `https://yue.macro.my.id` and API origin `https://api.yue.macro.my.id`, read from the `TARGET_ORIGINS` setting at Macro_API startup. Origins compare exactly on scheme, host, and port.
- **Target_Denylist**: A fixed, built-in list of hosts that the Policy_Gate always rejects: `yueshop.xyz`, `api.yueshop.xyz`, any subdomain of `yueshop.xyz`, `macro.my.id`, and any host that is an IP literal.
- **Route_Catalog**: The fixed, built-in list of routes a Test_Plan may use. Each entry has a route ID, an origin role (web or api), an HTTP method, a path, and, for POST, a fixed request body template. Entries: `store_home` (GET `/`, web), `catalog_list` (GET `/api/v1/products`, api), `product_detail` (GET `/api/v1/products/{productId}`, api), `ledger` (GET `/api/v1/orders/public?page=1`, api), `order_create` (POST `/api/v1/orders`, api), and `health` (GET `/api/v1/health`, api).
- **Traffic_Event**: The user's plain-language description of expected traffic.
- **Test_Plan**: A structure with a name, a target (the Demo_Target), a list of Stages, a Journey, and Stop_Thresholds.
- **Stage**: One step of a Test_Plan: a fixed number of virtual users (VUs) running the Journey in a loop for a fixed duration in seconds.
- **Journey**: The ordered list of steps each VU performs per iteration. Each step has a Route_Catalog route ID, an inclusion probability (integer percent, 1–100), and a think time in milliseconds after the step.
- **Stop_Thresholds**: The p95 latency limit in milliseconds and the Request_Error rate limit in percent that decide a Stage_Verdict.
- **Plan_Hash**: The SHA-256 hash of the Plan_Printer output for a Test_Plan.
- **Run**: One execution of an approved Test_Plan, identified by a Run ID and linked to a Plan_Hash.
- **Request_Error**: A k6 request that ends with an HTTP status of 400 or higher, a transport error, or no response within 10 seconds.
- **Stage_Metrics**: Measured k6 values for one Stage, overall and per route: request count, requests per second, Request_Error rate, count of HTTP 429 responses, and p50, p95, and p99 latency.
- **Stage_Verdict**: `pass` when overall p95 latency is at or below the Stop_Thresholds latency limit and the overall Request_Error rate is at or below the Stop_Thresholds error limit; otherwise `fail`.
- **Safe_Capacity**: The VU count of the last Stage in a Run whose Stage_Verdict is `pass` and is preceded only by Stages with Stage_Verdict `pass`.
- **Breaking_Point**: The VU count of the first Stage in a Run whose Stage_Verdict is `fail`.
- **First_Degraded_Route**: The route ID that first exceeded either Stop_Thresholds value in its per-route Stage_Metrics, taking the earliest Stage first and, within that Stage, the highest per-route p95 latency. The First_Degraded_Route is the first route observed to degrade, not a proven root cause.
- **Capacity_Report**: The result page for a Run.
- **Containment_Event**: A recorded fact about containment: Sandbox created, egress blocked, memory cap hit, time cap hit, Sandbox killed, Sandbox removed, or (Requirement 17) Ephemeral_Runner created or deleted, with Run ID, Stage index, and timestamp.
- **Allowed_Numbers**: The set of values a Run may display: every Stage_Metrics value as formatted by Requirement 7 criterion 4, every Stage VU count, duration, and index, the Stop_Thresholds values, the Safe_Capacity, the Breaking_Point, and the integers 0 through 10.
- **Untrusted_Data**: Data that Macro's own code did not produce: the Traffic_Event text, LLM output including Tool_Call arguments, k6 output, and Demo_Target responses.
- **Turnstile_Token**: A Cloudflare Turnstile response token sent by the Web_UI and verified server-side through Cloudflare Siteverify with the secret in `TURNSTILE_SECRET_KEY`.
- **Ephemeral_Runner**: A throwaway Vultr VM tagged `macro-ephemeral`, created through the Vultr API to run one Stage from another Vultr region (Requirement 17).

## Requirements

### Requirement 1: Describe a Traffic_Event (Core)

**User Story:** As a developer, I want to describe expected traffic in plain words, so that I can plan a load test without writing a k6 script.

#### Acceptance Criteria

1. THE Web_UI SHALL provide a text input for a Traffic_Event, a submit control, and a character count that updates on every edit and shows the current length out of 1,000. Length is the number of Unicode code points after leading and trailing whitespace is removed.
2. THE Web_UI SHALL display the Demo_Target web origin from the Target_Allowlist as the only target and SHALL provide no control for entering or changing the target.
3. WHEN the Macro_API receives a planning request that passes Turnstile_Token verification and contains a Traffic_Event 10 to 1,000 characters long after leading and trailing whitespace is removed, THE Macro_API SHALL pass the trimmed Traffic_Event to the Planner_Agent and SHALL return to the Web_UI either the draft Test_Plan with the Policy_Gate result or the error from Requirement 2.
4. IF a planning request has no Traffic_Event, has a Traffic_Event that is not text, or has a Traffic_Event shorter than 10 or longer than 1,000 characters after leading and trailing whitespace is removed, THEN THE Macro_API SHALL reject the request with an error stating the 10 to 1,000 character limit and SHALL make no Inference_Client call.
5. WHEN the user selects one of the example Traffic_Events the Web_UI offers (at least the Uma Musume banner example from the Introduction, each 10 to 1,000 characters long), THE Web_UI SHALL replace the text input content with the example text and SHALL NOT submit it.
6. WHILE the Traffic_Event in the text input is shorter than 10 or longer than 1,000 characters after leading and trailing whitespace is removed, THE Web_UI SHALL keep the submit control disabled.
7. WHILE a planning request is waiting for a Macro_API response, THE Web_UI SHALL disable the submit control and the example selection and SHALL show a progress indicator.
8. IF the Macro_API returns an error for a planning request, THEN THE Web_UI SHALL display the error, SHALL keep the submitted text in the text input, and SHALL re-enable the submit control.

### Requirement 2: Draft a Test_Plan with the Planner_Agent (Core)

**User Story:** As a developer, I want an AI agent to translate my description into stages and a user journey, so that the test matches the traffic I described.

#### Acceptance Criteria

1. WHEN the Planner_Agent receives a Traffic_Event, THE Planner_Agent SHALL send one Inference_Client request that contains the Traffic_Event as Untrusted_Data in a message separate from the agent instructions, the Route_Catalog, the Target_Allowlist, and the Policy_Gate limits from Requirement 4 criteria 4 to 6. The request SHALL define `propose_plan` as its only tool, with two parameters: `plan`, whose schema is the Test_Plan JSON schema, and `rationale`, a string of 1 to 300 characters. THE Planner_Agent SHALL pass the `plan` argument of the first `propose_plan` Tool_Call in the response to the Plan_Parser, SHALL pass the resulting Test_Plan structure to the Policy_Gate, and SHALL ignore Tool_Calls with any other name.
2. IF the first response contains no `propose_plan` Tool_Call, the `rationale` argument is missing or longer than 300 characters, the Plan_Parser returns a parse error, or the Policy_Gate rejects the Test_Plan, THEN THE Planner_Agent SHALL send exactly one more Inference_Client request. That request SHALL contain the original request content plus the missing-tool error, the rationale error, the parse errors, or the complete Policy_Gate violation list. THE Planner_Agent SHALL make no third request for the same Traffic_Event, so one Traffic_Event causes at most 4 model attempts in total, counting fallback attempts.
3. IF both the primary-model attempt and the fallback-model attempt of a Planner_Agent Inference_Client request fail, where a failed attempt is an error response, a transport error, or no complete response within 45 seconds, THEN THE Planner_Agent SHALL return an error stating that planning failed and SHALL make no further Inference_Client request for that Traffic_Event. THE Web_UI SHALL show the error with a retry control that resubmits the same Traffic_Event, and SHALL keep the Traffic_Event text in the input.
4. THE Inference_Client SHALL send every LLM request to the Vultr Serverless Inference endpoint configured in `VULTR_INFERENCE_BASE_URL` (default `https://api.vultrinference.com/v1`), authenticated with the key in `VULTR_INFERENCE_API_KEY`. THE Inference_Client SHALL make no LLM request to any other host and SHALL include the key in no Web_UI response and no Run_Store record.
5. WHEN the Policy_Gate accepts the Test_Plan returned by the Planner_Agent, THE Web_UI SHALL display a Stages table with one row per Stage in Test_Plan order showing the Stage index, VU count, and duration in seconds. THE Web_UI SHALL also display a Journey table with one row per step in Journey order showing the route ID, the method and path from the Route_Catalog, the inclusion probability in percent, and the think time in milliseconds. THE Web_UI SHALL show the Stop_Thresholds latency limit in milliseconds and error limit in percent, and SHALL render the `rationale` argument as plain text, never as markup.
6. THE Run_Store SHALL record one entry for every model attempt the Inference_Client makes, primary and fallback alike. Each entry SHALL contain the agent name, model name, outcome (`success`, `error`, or `timeout`), latency in milliseconds, and the prompt and completion token counts reported by Vultr Serverless Inference, or "not reported" when the response omits them. THE Web_UI SHALL list the entries linked to the displayed Test_Plan or Run in request order.
7. IF a primary-model attempt returns an error response, a transport error, or no complete response within the calling agent's per-attempt timeout, THEN THE Inference_Client SHALL send the identical request once to the fallback model with the same per-attempt timeout and SHALL make no further attempt for that request.
8. IF the second Planner_Agent request from criterion 2 also yields no `propose_plan` Tool_Call, an invalid `rationale`, a parse error, or a Policy_Gate rejection, THEN THE Planner_Agent SHALL return that second attempt's errors or complete violation list. THE Web_UI SHALL show each error or violation with no approval control and SHALL keep the Traffic_Event text in the input.
9. IF `VULTR_INFERENCE_API_KEY` is empty or unset at Macro_API startup, THEN THE Macro_API SHALL reject every Traffic_Event submission with an error stating that inference is not configured, and SHALL make no Inference_Client request.

### Requirement 3: Parse and print Test_Plans (Core)

**User Story:** As a developer, I want one strict Test_Plan format, so that what I approve is exactly what runs.

#### Acceptance Criteria

1. WHEN Test_Plan JSON text that matches the Test_Plan schema is provided, THE Plan_Parser SHALL produce a Test_Plan structure containing the name (string), the target origin (string), the Stages in input order (each with an integer VU count and an integer duration in seconds), the Journey steps in input order (each with a Route_Catalog route ID string, an integer inclusion probability, and an integer think time in milliseconds), and the Stop_Thresholds (an integer p95 latency limit in milliseconds and a numeric Request_Error rate limit in percent).
2. WHEN Test_Plan JSON text has correct types but values outside the Policy_Gate rules of Requirement 4 (for example, a route ID not in the Route_Catalog, an origin not in the Target_Allowlist, or 0 VUs), THE Plan_Parser SHALL still produce a Test_Plan structure, so that the Policy_Gate is the only component that reports those rejections.
3. IF the Test_Plan JSON text is not valid JSON, is larger than 16 KiB (16,384 bytes in UTF-8, measured on the full input text including any code fence), lacks a required field, contains a field not in the schema, contains the same key twice in one object, or contains a value of the wrong type (including a number with a fractional part or an exponent where an integer is required), THEN THE Plan_Parser SHALL return a parse error and no structure. The parse error SHALL name the reason and the field path from the root, with array indexes included. For text that is not valid JSON, the parse error SHALL give the character offset instead of a field path.
4. WHEN LLM response text wraps the JSON object in a Markdown code fence (three backticks, with or without a `json` language tag), THE Plan_Parser SHALL parse only the content between the first opening fence and its closing fence and SHALL ignore all text outside that fence.
5. IF LLM response text contains an opening Markdown code fence with no matching closing fence, THEN THE Plan_Parser SHALL return a parse error stating that the code fence is unclosed and SHALL return no structure.
6. THE Plan_Printer SHALL format a Test_Plan structure as UTF-8 canonical JSON text with these properties: object keys sorted by Unicode code point at every nesting level, no whitespace outside string values, integer values printed without a decimal point or exponent, and Stage and Journey order preserved.
7. THE Plan_Parser and THE Plan_Printer SHALL satisfy the round-trip property for every valid Test_Plan structure: parsing the Plan_Printer output produces a structure equal to the original, and printing that parsed structure again produces byte-identical text.

### Requirement 4: Validate Test_Plans with the Policy_Gate (Core)

**User Story:** As the owner of the target, I want a fixed rule set to check every plan, so that no AI output or prompt injection can aim load at the wrong place or exceed safe limits.

#### Acceptance Criteria

1. WHEN a Test_Plan structure is passed to the Policy_Gate, THE Policy_Gate SHALL evaluate every rule in criteria 2 through 6 without stopping at the first violation, and SHALL return `accepted` if no rule is violated, otherwise `rejected` with the complete list of violations, each naming the criterion number of the broken rule and the field path of the offending value (including the Stage index or Journey step index where one applies).
2. IF the Test_Plan target origin does not exactly match (scheme, host, and port) an origin in the Target_Allowlist, or the target host, compared case-insensitively, is on the Target_Denylist, THEN THE Policy_Gate SHALL reject the Test_Plan, applying the Target_Denylist even when the origin is also in the Target_Allowlist.
3. IF a Journey step uses a route ID that is not in the Route_Catalog, THEN THE Policy_Gate SHALL reject the Test_Plan with one violation per such step.
4. IF the Test_Plan has fewer than 1 or more than 6 Stages, a Stage VU count that is not a whole number from 1 to 500, a Stage duration that is not a whole number of seconds from 30 to 180, a sum of all Stage durations above 600 seconds, or a Stage whose VU count is not greater than the VU count of the Stage before it, THEN THE Policy_Gate SHALL reject the Test_Plan (all bounds in this criterion are inclusive).
5. IF the Journey has fewer than 1 or more than 8 steps, a step probability that is not a whole number from 1 to 100, a think time that is not a whole number of milliseconds from 0 to 10,000, more than one `order_create` step, or an `order_create` step with a probability above 25, THEN THE Policy_Gate SHALL reject the Test_Plan (all bounds in this criterion are inclusive).
6. IF the Stop_Thresholds latency limit is outside 100 to 5,000 milliseconds inclusive, or the Stop_Thresholds error limit is outside 0.1 to 20 percent inclusive, THEN THE Policy_Gate SHALL reject the Test_Plan.
7. THE Policy_Gate SHALL return an identical result, including the same violations in the same order, for the same Test_Plan structure on every evaluation, and SHALL make no network request during evaluation.
8. WHEN the Policy_Gate rejects a Test_Plan, THE Web_UI SHALL list every violation with its rule and offending field, and SHALL show no approval control for that Test_Plan.
9. IF the Macro_API receives an approval request for a Test_Plan that the Policy_Gate rejects, THEN THE Macro_API SHALL reject the request with an error listing the violations, SHALL store no approved Test_Plan, and SHALL start no Run.

### Requirement 5: Approve a Test_Plan (Core)

**User Story:** As a developer, I want to approve a plan before any traffic is sent, so that nothing runs without my consent.

#### Acceptance Criteria

1. WHEN the Policy_Gate accepts a draft Test_Plan, THE Web_UI SHALL show an approval control that states the Test_Plan target origin, the maximum VU count (the highest Stage VU count in the Test_Plan), and the total Stage duration (the sum of all Stage durations, in seconds).
2. WHEN the user activates the approval control, THE Macro_API SHALL parse the displayed Test_Plan with the Plan_Parser, evaluate it with the Policy_Gate, store the Plan_Printer output and its Plan_Hash in the Run_Store as an approved Test_Plan (keeping a single record when that Plan_Hash is already stored), start a Run for that Plan_Hash subject to Requirement 9, and return the Run ID and Plan_Hash to the Web_UI.
3. THE Run_Controller SHALL start a Run only for a Plan_Hash stored as approved, and SHALL execute only the Test_Plan text stored under that Plan_Hash, ignoring any Test_Plan content sent in the start request.
4. WHEN a Run starts, THE Run_Controller SHALL, before creating the first Sandbox, check that the SHA-256 hash of the stored Test_Plan text equals the Plan_Hash and evaluate the stored Test_Plan with the Policy_Gate again, and SHALL start the first Stage only if both checks pass.
5. IF a start request names a Plan_Hash that is not 64 lowercase hexadecimal characters or is not stored as approved, THEN THE Macro_API SHALL reject the request with an error stating that the Test_Plan is not approved, create no Run, and start no Sandbox.
6. IF the Test_Plan in an approval request fails the Plan_Parser or is rejected by the Policy_Gate, THEN THE Macro_API SHALL reject the request with the parse error or the complete list of violations, store no approved Test_Plan, and start no Sandbox.
7. IF, at Run start, the stored Test_Plan text fails the Plan_Parser, its SHA-256 hash differs from the Plan_Hash, or the Policy_Gate rejects it, THEN THE Run_Controller SHALL set the Run status to `failed` with the reason or the violations and start no Sandbox, and THE Web_UI SHALL show that reason.

### Requirement 6: Run each Stage in a Sandbox (Core)

**User Story:** As a judge of "Blast Radius Zero", I want every agent action contained, so that a bad plan or a compromised tool cannot touch anything except the authorized target.

#### Acceptance Criteria

1. WHEN a Stage starts, THE Script_Generator SHALL produce the k6 script for that Stage from a fixed template filled only with values from the approved Test_Plan and the Route_Catalog, using the `constant-vus` executor with the Stage VU count and duration, a 10-second request timeout, and a route ID tag on every request, so that the script contains no text taken from the Traffic_Event or from any Tool_Call argument other than the approved Test_Plan values.
2. WHEN a Stage starts, THE Sandbox_Runner SHALL create a new Sandbox for that Stage from a k6 image pinned by digest, label the Sandbox with the Run ID and Stage index, and record a "Sandbox created" Containment_Event.
3. THE Sandbox_Runner SHALL run every Sandbox, including the Containment_Probe Sandbox, as a user with a UID other than 0, with a read-only root filesystem, all Linux capabilities dropped, `no-new-privileges` set, a process limit of 256, a memory limit of 1 GiB with no swap, a CPU limit of 1 core, no Docker socket, and no host mount other than the read-only k6 script and one per-Stage output directory.
4. THE Sandbox_Runner SHALL pass into the Sandbox only the k6 script, the per-Stage output directory, and the Egress_Proxy address as an environment variable, and SHALL pass no other environment variable set by Macro and no Macro secret, including the Vultr Serverless Inference key and `TURNSTILE_SECRET_KEY`.
5. THE Sandbox_Runner SHALL attach every Sandbox only to a per-Run internal Docker network that has no route out of the Macro VM, whose only exit is the Egress_Proxy.
6. WHEN the Egress_Proxy denies a request from a Sandbox, THE Sandbox_Runner SHALL record an "egress blocked" Containment_Event from the Egress_Proxy denial log, carrying the Run ID, the Stage index, and the denied destination host and port.
7. IF a Sandbox is still running when the Stage duration plus 30 seconds have passed since the Sandbox started, THEN THE Sandbox_Runner SHALL kill the Sandbox, mark the Stage as `error`, record a "time cap hit" Containment_Event, and record a "Sandbox killed" Containment_Event.
8. IF Docker reports that a Sandbox was terminated for exceeding its memory limit, THEN THE Sandbox_Runner SHALL mark the Stage as `error` and record a "memory cap hit" Containment_Event.
9. WHEN a Sandbox exits for any reason, including a kill under criterion 7 or 8, THE Sandbox_Runner SHALL read the output directory, remove the Sandbox and its output directory, and record the "Sandbox removed" Containment_Event only after Docker reports that no container with that Sandbox's ID exists.
10. WHEN a Run ends for any reason, THE Sandbox_Runner SHALL remove, within 30 seconds, every Sandbox labeled with that Run ID, the Run's Egress_Proxy, and the Run's Docker network.
11. WHEN the Macro_API starts, THE Sandbox_Runner SHALL remove every Sandbox, Egress_Proxy, and Run network carrying a Macro label before accepting any Run or Containment_Probe start, and THE Run_Controller SHALL mark every Run still recorded as `running` as `interrupted`.
12. THE Sandbox_Runner SHALL run every Sandbox with the Sandbox_Runtime set in `SANDBOX_RUNTIME`, and SHALL use `runsc` when `SANDBOX_RUNTIME` is unset.
13. IF `SANDBOX_RUNTIME` is set to a value other than `runsc` or `runc`, or `SANDBOX_RUNTIME` is `runsc` and the `runsc` runtime is not registered with Docker, THEN THE Sandbox_Runner SHALL refuse every Run and Containment_Probe start, create no Sandbox, and return an error that either names the invalid value or states that gVisor is missing and that `SANDBOX_RUNTIME=runc` must be set explicitly to run without gVisor.
14. THE Run_Store SHALL record the Sandbox_Runtime used for each Run and Containment_Probe, and THE Web_UI SHALL show the Sandbox_Runtime in the live progress view, the Containment_Probe result, and the Capacity_Report.
15. THE Egress_Proxy SHALL allow only HTTPS CONNECT requests to Target_Allowlist hosts on port 443 and SHALL deny every other request, including requests to the Vultr instance metadata address `169.254.169.254`, the Macro_API, Target_Denylist hosts, loopback addresses (`127.0.0.0/8`), link-local addresses (`169.254.0.0/16`), and private address ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`).
16. IF the Sandbox_Runner cannot create the per-Run Docker network, the Egress_Proxy, or a Stage's Sandbox, THEN THE Sandbox_Runner SHALL start no k6 process for that Stage, mark the Stage as `error`, and remove any of those resources it did create for that Stage.

### Requirement 7: Collect Stage_Metrics from k6 (Core)

**User Story:** As a developer, I want measured numbers for every Stage and route, so that decisions and reports rest on real data.

#### Acceptance Criteria

1. WHEN a Sandbox exits and its output directory contains a k6 end-of-test summary, THE Metrics_Reader SHALL parse the summary into one overall Stage_Metrics and one per-route Stage_Metrics for each Route_Catalog route ID that has at least 1 request in that Stage. Per-route values come only from requests tagged with that route ID. Requests per second equals the request count divided by the test duration in seconds that k6 measured.
2. IF the k6 summary is missing, is not valid JSON, lacks the overall request count, the p50, p95 or p99 request duration, or the failed-request rate, reports an overall request count of 0, or contains a required value that is not a finite number greater than or equal to 0, THEN THE Metrics_Reader SHALL mark the Stage as `error`, record the reason, and store no Stage_Metrics for that Stage.
3. THE Metrics_Reader SHALL count a request as a Request_Error when the response status is 400 or higher, a transport error occurred, or no response arrived within 10 seconds. A request with HTTP status 429 counts both as a Request_Error and in the HTTP 429 count. The Request_Error rate is the Request_Error count divided by the request count, multiplied by 100.
4. THE Web_UI SHALL round half away from zero and display every Stage_Metrics latency as whole milliseconds, every Request_Error rate as a percent with exactly one decimal (for example 12.3%), and every requests-per-second value with exactly one decimal.
5. WHEN the Metrics_Reader has parsed Stage_Metrics for a Stage, THE Run_Controller SHALL compute the Stage_Verdict by comparing the overall p95 latency and the overall Request_Error rate, each rounded as in criterion 4, against the Test_Plan Stop_Thresholds. THE Run_Controller SHALL store the Stage_Metrics and the Stage_Verdict in the Run_Store before it calls the Supervisor_Agent for that Stage.
6. IF a Stage is marked `error`, THEN THE Run_Controller SHALL end the Run with status `failed`, record no Stage_Verdict for that Stage, start no further Stages, and keep the Stage_Metrics and Stage_Verdicts already stored for earlier Stages in the Run_Store.

### Requirement 8: Decide to continue or stop after each Stage (Core)

**User Story:** As a developer, I want an agent to judge each Stage before adding more load, so that the test stops at the first sign of breaking.

#### Acceptance Criteria

1. WHEN a Stage other than the last one ends with Stage_Metrics, THE Run_Controller SHALL send one Inference_Client request to the Supervisor_Agent containing the Stage_Metrics of all completed Stages, the Stop_Thresholds, the next Stage's VU count, and a `decide_next_stage` tool definition, and SHALL start no further Stage until the decision for the ended Stage is recorded under criterion 8.
2. IF a Stage's Stage_Verdict is `fail`, THEN THE Run_Controller SHALL end the Run with status `halted` and start no further Stage, whatever decision the Supervisor_Agent returns.
3. WHEN the Stage_Verdict is `pass` and the Supervisor_Agent returns a valid decision `stop`, THE Run_Controller SHALL end the Run with status `halted` and start no further Stage. A valid decision is a `decide_next_stage` Tool_Call, received within 30 seconds of the request, whose `decision` is exactly `continue` or `stop` and whose `reason` is a string of 1 to 500 characters.
4. WHILE the Run has status `running`, WHEN the Stage_Verdict is `pass` and the Supervisor_Agent returns a valid decision `continue`, THE Run_Controller SHALL start the next Stage with the VU count, duration, Journey, and Stop_Thresholds of the approved Test_Plan, with the same Plan_Hash.
5. IF the Supervisor_Agent request fails on both the primary and the fallback model (an error or no response within 15 seconds per model attempt, as in Requirement 2 criterion 7), returns no `decide_next_stage` Tool_Call, returns a `decision` that is not exactly `continue` or `stop`, returns a `reason` that is missing, empty, or longer than 500 characters, or returns no valid decision within 30 seconds of the request, THEN THE Run_Controller SHALL apply the Stage_Verdict alone: `pass` starts the next Stage and `fail` ends the Run with status `halted`.
6. THE Run_Controller SHALL accept from the Supervisor_Agent only the `decision` and `reason` arguments of the first `decide_next_stage` Tool_Call in the response. It SHALL ignore all other content, including later `decide_next_stage` Tool_Calls, other Tool_Calls, and any change to Stages, routes, targets, or Stop_Thresholds.
7. WHEN the last Stage ends with Stage_Metrics and its Stage_Verdict is `pass`, THE Run_Controller SHALL send no Supervisor_Agent request and SHALL end the Run with status `completed`.
8. WHEN the Run_Controller applies a decision for a Stage other than the last one, THE Run_Store SHALL record, before the next Stage starts or the Run ends, the following values:
   - the Stage index
   - the applied decision (`continue` or `stop`)
   - the source: `agent` when the applied decision equals the Supervisor_Agent's valid decision, otherwise `fallback`
   - the reason: for source `agent`, the Supervisor_Agent's `reason` after the Number_Guard check in Requirement 10 criteria 7 and 8; for source `fallback`, a fixed reason stating either that no valid Supervisor_Agent decision was received or that a Stage_Verdict of `fail` overrode a `continue` decision
9. IF the Run status becomes `stopped` or `timed_out` (Requirement 9) while the Run_Controller is waiting for a Supervisor_Agent decision, THEN THE Run_Controller SHALL keep that status, start no further Stage, and discard the Supervisor_Agent's response.

### Requirement 9: Enforce Run limits and manual stop (Core)

**User Story:** As the owner of the target and the Macro VM, I want hard limits and a stop button, so that a Run can never get out of hand.

#### Acceptance Criteria

1. WHILE a Run has status `running` or a Containment_Probe is in progress (from acceptance of its start request until its Sandbox is removed), THE Macro_API SHALL reject every Run start and Containment_Probe start with an error that names the Run ID of the active Run or states that a Containment_Probe is in progress, and SHALL start no Sandbox for the rejected request.
2. WHEN the user activates the stop control of a Run with status `running`, THE Run_Controller SHALL, within 10 seconds of the Macro_API receiving the stop request, kill the current Sandbox if one exists, start no further Stage, ignore any Supervisor_Agent decision that arrives after the stop request, set the Run status to `stopped`, and keep in the Run_Store the Stage_Metrics and decisions of every Stage that ended before the stop request. The stop request requires no Turnstile_Token.
3. IF a Run still has status `running` 15 minutes after the Run_Controller set it to `running`, THEN THE Run_Controller SHALL, within 10 seconds, kill the current Sandbox if one exists, start no further Stage, set the Run status to `timed_out`, and keep in the Run_Store the Stage_Metrics and decisions of every Stage that ended before the timeout.
4. IF a client IP address has made 10 planning requests that passed Turnstile_Token verification in the past 60 minutes, measured as a rolling window, THEN THE Macro_API SHALL reject each further planning request from that IP address with an error stating the UTC time at which the oldest counted request leaves the 60-minute window, and SHALL make no Inference_Client call for it.
5. IF a client IP address has had 6 Run or Containment_Probe start requests accepted in the past 60 minutes, measured as a rolling window and counting re-runs of the same Test_Plan and Runs that later ended with any status, THEN THE Macro_API SHALL reject each further Run start and Containment_Probe start from that IP address with an error stating the UTC time at which the oldest counted start leaves the 60-minute window, and SHALL start no Sandbox for it.
6. IF 50 Runs and Containment_Probe runs together have started since 00:00 UTC of the current day, as recorded in the Run_Store, THEN THE Macro_API SHALL reject each further Run start and Containment_Probe start with an error stating that the daily demo limit is reached and that the limit resets at 00:00 UTC of the next day, and SHALL start no Sandbox for it. A Macro_API restart SHALL NOT reset this count.
7. WHEN the Macro_API receives a planning request, a Run start, or a Containment_Probe start, THE Macro_API SHALL verify the request's Turnstile_Token through Cloudflare Siteverify before any Inference_Client call or Sandbox start.
8. IF the Turnstile_Token is missing, Siteverify rejects the Turnstile_Token, Siteverify returns an error, or Siteverify gives no response within 10 seconds, THEN THE Macro_API SHALL reject the request with an error asking the user to repeat the verification, SHALL make no Inference_Client call and start no Sandbox, and SHALL NOT count the request toward the limits in criteria 4, 5, and 6.
9. THE Macro_API SHALL allow at most one Run with status `running` or one Containment_Probe in progress at any time, including when several start requests arrive at the same moment, and SHALL reject every start request other than the one it accepts as described in criterion 1.
10. THE Macro_API SHALL use as the client IP address of a request the visitor address that Cloudflare reports for that request, not the address of the Cloudflare proxy that forwarded it.

### Requirement 10: Produce the Capacity_Report (Core)

**User Story:** As a developer, I want a clear report of where my app breaks and why, so that I know what to fix before real users arrive.

#### Acceptance Criteria

1. WHEN a Run ends with status `completed`, `halted`, `stopped`, or `timed_out`, THE Macro_API SHALL build a Capacity_Report from the Stage_Metrics of every Stage of that Run that has Stage_Metrics, and THE Run_Store SHALL store the Capacity_Report under the Run ID.
2. THE Capacity_Report SHALL show the Safe_Capacity, the Breaking_Point, the First_Degraded_Route, and the Run status as headline values. It SHALL also show a per-Stage table with each Stage's index, VU count, duration, overall Stage_Metrics, and Stage_Verdict; a per-route Stage_Metrics table for each Stage; each Supervisor_Agent decision with its source (agent or fallback) and reason; and every Containment_Event of the Run with its timestamp. Every Stage_Metrics value SHALL be formatted as in Requirement 7 criterion 4.
3. IF no Stage in the Run has Stage_Verdict `fail`, THEN THE Capacity_Report SHALL show no Breaking_Point value and SHALL state that the Breaking_Point was not reached up to the highest VU count among the Stages that have Stage_Metrics.
4. IF the first Stage has Stage_Verdict `fail`, THEN THE Capacity_Report SHALL show no Safe_Capacity value and SHALL state that no Safe_Capacity was found at or above the first Stage's VU count.
5. WHEN the Capacity_Report is built and at least one Stage has Stage_Metrics, THE Macro_API SHALL send the Report_Writer one Inference_Client request. The request SHALL contain the Stage_Metrics, the Safe_Capacity, the Breaking_Point, the First_Degraded_Route, the Route_Catalog, and a `write_report` tool definition. From the response, THE Macro_API SHALL accept only the `explanation` and `suggestions` arguments of the first `write_report` Tool_Call and SHALL ignore all other content.
6. THE Macro_API SHALL compute every number in the Capacity_Report headline values and tables from Stage_Metrics and the approved Test_Plan, and SHALL use no number produced by an LLM.
7. WHEN the Report_Writer returns an `explanation` or a suggestion, or the Supervisor_Agent returns a `reason`, THE Number_Guard SHALL extract every numeric token from that text. A numeric token is a maximal run of digits that may contain comma thousands separators and one decimal part, and that does not directly follow a letter, so the digits in "p95" or "v1" are not tokens. THE Number_Guard SHALL pass the text only if every token's numeric value equals the numeric value of a member of the Run's Allowed_Numbers.
8. IF the Number_Guard finds a numeric token that is not in the Allowed_Numbers, THEN THE Macro_API SHALL handle the failing text as follows and SHALL show "AI explanation withheld: unverified number" in place of each replaced or removed text:
   - A failing `explanation` is replaced with a fixed template sentence that states the Safe_Capacity, the Breaking_Point, and the First_Degraded_Route.
   - A failing suggestion is removed.
   - A failing Supervisor_Agent `reason` is replaced with a fixed template sentence that states the decision and the Stage_Verdict.
9. IF the Report_Writer request returns an error or gives no response within 45 seconds on both the primary and the fallback model, or the accepted response contains no `write_report` Tool_Call, THEN THE Capacity_Report SHALL show all headline values and metrics tables, SHALL show no AI explanation or suggestions, and SHALL show a note that the AI explanation is unavailable.
10. THE Capacity_Report SHALL show the AI explanation and suggestions only in a section labeled as AI-generated, kept separate from the headline values and metrics tables, and SHALL place no AI-written text inside the headline values or metrics tables.
11. IF no route's per-route Stage_Metrics in any Stage exceeded either Stop_Thresholds value, THEN THE Capacity_Report SHALL show no First_Degraded_Route value and SHALL state that no route exceeded the Stop_Thresholds.
12. IF no Stage of the Run has Stage_Metrics, THEN THE Capacity_Report SHALL show the Run status, the Run's Containment_Events, and a statement that no Stage produced metrics, SHALL show no Safe_Capacity, Breaking_Point, or First_Degraded_Route value, and THE Macro_API SHALL send no Report_Writer request.
13. WHEN the Macro_API accepts a `write_report` Tool_Call, THE Macro_API SHALL keep only the first 5 suggestions, SHALL truncate the `explanation` to 1,500 characters and each suggestion to 300 characters, and SHALL run the Number_Guard check on the truncated text.

### Requirement 11: Show live Run progress and Containment_Events (Core)

**User Story:** As a developer watching a Run, I want to see each Stage, decision, and containment step as it happens, so that I can follow the test and stop it if needed.

#### Acceptance Criteria

1. WHILE a Run has status `running`, THE Web_UI SHALL show the current Stage as "Stage N of M" (N is the 1-based position of the current Stage and M is the number of Stages in the approved Test_Plan), the current Stage's VU count from the Test_Plan, the elapsed time since the Run started in minutes and seconds updated at least once per second, and the stop control from Requirement 9.
2. WHEN the Run_Store records a Stage start, a Stage end, a decision, or a Containment_Event for a Run that the Web_UI is showing, THE Web_UI SHALL show the change within 5 seconds of its recording, with each decision shown as its `continue` or `stop` value, its source (agent or fallback), and its reason after the Number_Guard check from Requirement 10.
3. WHEN a Stage ends with Stage_Metrics, THE Web_UI SHALL add a row to the progress view with that Stage's position, VU count, Stage_Verdict, and overall Stage_Metrics (request count, requests per second, Request_Error rate, HTTP 429 count, and p50, p95, and p99 latency), formatted as in Requirement 7 criterion 4.
4. THE Web_UI SHALL show every Containment_Event recorded for the Run in a timeline sorted by timestamp from oldest to newest, including events recorded before the page was opened, with each entry showing the event type, the Stage index, and the timestamp to the second.
5. THE Web_UI SHALL mark "egress blocked", "memory cap hit", and "time cap hit" Containment_Events in the timeline with a warning icon and a highlight color that the other Containment_Event types (Sandbox created, Sandbox killed, Sandbox removed, Ephemeral_Runner created or deleted) do not use.
6. IF a Stage ends with status `error` (Requirement 7 criterion 2), THEN THE Web_UI SHALL show that Stage's row with the `error` status and the recorded reason in place of Stage_Metrics and a Stage_Verdict.
7. WHEN a Run's status changes from `running` to `completed`, `halted`, `stopped`, `timed_out`, `failed`, or `interrupted`, THE Web_UI SHALL show the new status within 5 seconds, remove the stop control, and keep all Stage rows, decisions, and Containment_Events already shown.
8. IF the Web_UI has received no update from the Macro_API for 10 seconds while it shows a Run with status `running`, THEN THE Web_UI SHALL show an indicator that the progress view may be out of date, keep all data already shown, and, once updates arrive again, add every change recorded during the gap.

### Requirement 12: Run the Containment_Probe (Core)

**User Story:** As a hackathon judge, I want to watch the sandbox stop an escape attempt, so that I can see containment work instead of taking it on trust.

#### Acceptance Criteria

1. THE Web_UI SHALL provide a Containment_Probe start control that works without a Test_Plan and is separate from the Test_Plan approval, stop, and re-run controls.
2. WHEN the user activates the Containment_Probe start control and the start passes the checks in Requirement 9 criteria 6–8, THE Sandbox_Runner SHALL run the fixed Containment_Probe script in one new Sandbox on its own internal Docker network and Egress_Proxy, under Requirement 6 criteria 2–8 and 12–14. THE Sandbox_Runner SHALL record every Containment_Event of the probe with the Run ID assigned to the probe and Stage index 1.
3. THE Containment_Probe SHALL attempt these actions in this order, with a 10-second timeout on each network request, and SHALL report the outcome of each: (a) an HTTPS request to one fixed host outside the Target_Allowlist; (b) an HTTP request to `169.254.169.254`; (c) a request to the Macro_API; (d) a case-insensitive check of environment variable names for `KEY`, `SECRET`, or `TOKEN`, reporting only the matching names and never their values; (e) as the last action, an allocation of more than 1 GiB of memory.
4. WHEN the probe Sandbox exits for any reason, THE Web_UI SHALL show within 5 seconds each of the five actions with its result, the Containment_Events recorded with the probe's Run ID, and the Sandbox_Runtime. An action is `contained` under these rules and `escaped` otherwise. Actions (a)–(c) are `contained` when the request receives no response from the destination host. Action (d) is `contained` when no environment variable name matches. Action (e) is `contained` when the Sandbox exceeds its memory limit and a "memory cap hit" Containment_Event is recorded. WHEN all five actions are `contained`, THE Web_UI SHALL show the probe result as passed.
5. IF any Containment_Probe action is `escaped`, THEN THE Web_UI SHALL show the probe result as failed and name every action that escaped.
6. WHEN the probe Sandbox exits for any reason, THE Sandbox_Runner SHALL remove the probe Sandbox, its output directory, and its Docker network, confirm through Docker that the probe Sandbox no longer exists, and record a "Sandbox removed" Containment_Event, as in Requirement 6 criteria 9–10.
7. IF a Run or another Containment_Probe has status `running` when a Containment_Probe start is requested, THEN THE Macro_API SHALL reject the start with an error that names the active Run or probe, and SHALL start no Sandbox.
8. IF the probe Sandbox is still running 60 seconds after it was created, THEN THE Sandbox_Runner SHALL kill the probe Sandbox and record a "time cap hit" Containment_Event and a "Sandbox killed" Containment_Event.
9. IF no action is `escaped` and at least one action reported no outcome before the probe Sandbox exited, THEN THE Web_UI SHALL show each such action as `no result` and the probe result as incomplete.

### Requirement 13: Re-run a Test_Plan and compare Runs (Core)

**User Story:** As a developer who just shipped a fix, I want to re-run the same plan and compare results side by side, so that I can prove the fix moved the breaking point.

#### Acceptance Criteria

1. WHEN the Capacity_Report of a Run with status `completed`, `halted`, `stopped`, or `timed_out` is shown, THE Capacity_Report SHALL show a re-run control for that Run's Plan_Hash.
2. THE Capacity_Report SHALL list the 20 most recently started Runs of its Plan_Hash, newest first, each with Run ID, start time in UTC, status, Safe_Capacity, and Breaking_Point. The Safe_Capacity SHALL read "none" when no Safe_Capacity was found, and the Breaking_Point SHALL read "not reached" when no Stage has Stage_Verdict `fail`.
3. WHEN the user selects two different Runs with the same Plan_Hash, THE Web_UI SHALL show them side by side, with the earlier-started Run as the baseline. The view SHALL include each Run's Safe_Capacity, Breaking_Point, and First_Degraded_Route. For each Stage index that has Stage_Metrics in both Runs, it SHALL also show overall and per-route p95 latency, Request_Error rate, and requests per second, formatted as in Requirement 7 criterion 4. For each of these numeric values, the view SHALL show the difference (later Run minus baseline) in the same format and the percent change relative to the baseline with one decimal. It SHALL show "n/a" in place of the difference and percent change when either Run lacks the value or the baseline value is 0.
4. IF the user selects two Runs with different Plan_Hashes, THEN THE Web_UI SHALL show no side-by-side values and SHALL state that only Runs of the same approved Test_Plan can be compared.
5. IF a Stage index, or a route within a Stage index, has Stage_Metrics in only one of the two compared Runs, THEN THE Web_UI SHALL show the values for the Run that has them, mark the other Run's column as "not run", and show no difference or percent change for that row.
6. WHEN the user activates the re-run control and accepts the single confirmation prompt, THE Macro_API SHALL start a new Run with a new Run ID for the same Plan_Hash. The start SHALL be subject to Requirement 5 criteria 3–4 and to Requirement 9, including Turnstile_Token verification.
7. IF the user cancels the re-run confirmation prompt, THEN THE Web_UI SHALL send no Run start request.
8. IF the Macro_API rejects a re-run start under Requirement 5 or Requirement 9, THEN THE Web_UI SHALL show the rejection error on the Capacity_Report, and no new Run SHALL be added to the Run_Store or the Run list.

### Requirement 14: Prepare the Demo_Target (Core)

**User Story:** As the owner of YUE, I want the load to hit an isolated demo copy only, so that production customers, data, and notifications are never affected.

#### Acceptance Criteria

1. THE Demo_Target SHALL run on the `yue-demo` Vultr VM (45.32.113.74), separate from the `macro` VM (45.77.37.116), with its own Postgres and Redis running on the `yue-demo` VM.
2. THE Demo_Target configuration SHALL contain no host name, connection string, storage bucket name, API key, or other secret that belongs to the YUE production deployment (`yueshop.xyz`, `api.yueshop.xyz`, or its Supabase database).
3. THE Demo_Target SHALL run with `DISCORD_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL`, and every Kafka and S3 setting absent or empty, so that the Demo_Target sends no Discord or WhatsApp notification and makes no Kafka or S3 connection while it serves load-test requests.
4. THE Demo_Target SHALL apply no per-IP rate limit to requests whose source address is the `macro` VM public IP address (45.77.37.116), so that Stage_Metrics from a Run report a count of 0 HTTP 429 responses caused by the Demo_Target's per-IP rate limit, and measured Request_Errors reflect application capacity rather than the throttle configuration.
5. THE Demo_Target SHALL keep its existing per-IP rate limit, unchanged, for requests from every source address other than 45.77.37.116.
6. THE Demo_Target SHALL contain a seeded catalog of at least 5 products that the Route_Catalog `catalog_list` route returns, and every product ID used by the Route_Catalog `product_detail` and `order_create` entries SHALL be one of those seeded products.
7. WHERE a seeded product tracks stock, THE Demo_Target SHALL hold at least 100,000 units of stock for each product used by the Route_Catalog `order_create` entry before a Run starts, so that `order_create` Request_Errors are not caused by stock running out.
8. THE Route_Catalog `order_create` body template SHALL set the customer name of every load-test order to `Macro Load Test` and SHALL set the order notes to a value that contains the Run ID, so that every order created during a Run can be found on the Demo_Target by customer name and Run ID and then deleted.
9. THE DNS records for `yue.macro.my.id` and `api.yue.macro.my.id` SHALL be Cloudflare DNS-only records that resolve to 45.32.113.74, so that Cloudflare neither proxies nor throttles load-test traffic.
10. THE Demo_Target SHALL serve the web origin `https://yue.macro.my.id` and the API origin `https://api.yue.macro.my.id` over HTTPS on port 443, each with a TLS certificate that is valid for its host name and unexpired, so that Sandbox traffic through the Egress_Proxy reaches both Target_Allowlist origins without certificate errors.
11. THE rate-limit exemption in criterion 4 SHALL exist only in two places: as a local, uncommitted patch applied to `/opt/yue` on the `yue-demo` VM, and as a patch file in the Macro GitHub repository for reproducibility. The exemption SHALL be absent from every branch of the YUE GitHub repository and from the YUE production deployment.

### Requirement 15: Deploy and document Macro on Vultr (Core)

**User Story:** As a hackathon judge, I want a live demo and a clear README, so that I can verify how Vultr is used and try the app myself.

#### Acceptance Criteria

1. THE Macro_API, the Sandbox_Runner, and the Web_UI SHALL run on the Vultr VM `macro` (45.77.37.116). From the submission deadline (4:00 AM UTC+7, November 9, 2026) onward, THE Web_UI SHALL load over HTTPS at `https://macro.my.id` with a valid certificate and without any sign-in.
2. WHEN the single Docker Compose command documented in the README is run on the `macro` VM, THE Macro repository SHALL start the Web_UI and the Macro_API with no further manual step, and the Web_UI SHALL load at `https://macro.my.id` within 10 minutes, image builds included. The command's preconditions are: Docker with Compose is installed, the `runsc` runtime is registered with Docker (or `SANDBOX_RUNTIME=runc` is set), and a completed environment file is present.
3. THE Macro_API SHALL read every secret from one environment file: the Vultr Serverless Inference API key, `TURNSTILE_SECRET_KEY`, and, where Requirement 17 is built, the Vultr API key. The Macro repository's git ignore rules SHALL exclude that file, no commit in the repository history SHALL contain a secret value, and the repository SHALL include an example environment file that lists every setting the Macro_API reads (including `VULTR_INFERENCE_MODEL`, `VULTR_INFERENCE_FALLBACK_MODEL`, `SANDBOX_RUNTIME`, `TARGET_ORIGINS`, and `TURNSTILE_SECRET_KEY`) with placeholder values only.
4. THE README SHALL explain how Macro uses Vultr and Docker:
   - the `macro` and `yue-demo` VMs, with their region and what each one runs;
   - Vultr Serverless Inference, with the base URL `https://api.vultrinference.com/v1`, the default primary model `minimax-m3.1-flash` and fallback model `mimo-v2.6-flash` with their setting names, and a statement that every Planner_Agent, Supervisor_Agent, and Report_Writer call goes through it;
   - Docker, as one Sandbox per Stage run with the Sandbox_Runtime.
5. THE README SHALL include:
   - an architecture overview that names the Web_UI, Macro_API, Inference_Client, Sandbox_Runner, Egress_Proxy, Sandbox, and Demo_Target, and the VM each runs on;
   - setup steps for the `macro` VM and for the Demo_Target, including the Requirement 14 patch file;
   - the public demo URL `https://macro.my.id`;
   - both Target_Allowlist origins;
   - the steps to reproduce the containment moment shown in the video: start the Containment_Probe from the Web_UI, then expect every attempted action to show `contained` together with its related Containment_Events.
6. THE README SHALL state these limits:
   - only the Demo_Target can be tested in this version, because arbitrary targets would turn Macro into a denial-of-service tool;
   - domain ownership verification by DNS TXT record is future work;
   - results come from one VM in one region;
   - the First_Degraded_Route is the first route observed to degrade, not a proven root cause.
7. THE README SHALL state that YUE existed before the hackathon and serves only as the test target, and that Macro was built during the hackathon.
8. THE README SHALL list each containment control in Requirement 6 criteria 3–5, 7–10, and 12–13. Each entry SHALL give the file path and function name in the Macro repository that enforces the control, as a link into the public repository.
9. IF a required secret setting from criterion 3 is missing or empty when the Macro_API starts, THEN THE Macro_API SHALL exit with an error that names the missing setting, without starting any Run or Containment_Probe.
10. THE Macro source code SHALL be in a public GitHub repository that anyone can read without signing in, from the submission deadline (4:00 AM UTC+7, November 9, 2026) onward.

### Requirement 16: Export and share a Capacity_Report (Optional)

**User Story:** As a developer, I want to share a report with my team, so that we can discuss the fix without rerunning the test.

#### Acceptance Criteria

1. WHEN the user activates the export control on the Capacity_Report of a Run with no Stage running or pending, THE Web_UI SHALL download exactly one Markdown file whose file name contains the Run ID. The file SHALL contain:
   - the Run ID and Plan_Hash;
   - the Safe_Capacity, the Breaking_Point, and the First_Degraded_Route, with a statement that none was observed for any value the Run does not have;
   - the Stop_Thresholds;
   - one table row per Stage with Stage index, VU count, duration, overall Stage_Metrics, and Stage_Verdict;
   - one table row per route per Stage with the per-route Stage_Metrics;
   - every Supervisor_Agent decision with its reason;
   - the Report_Writer explanation and suggestions.
2. THE Web_UI SHALL place the Report_Writer explanation, the suggestions, and every Supervisor_Agent reason in the exported Markdown file under a heading or label that marks them as AI-generated.
3. WHILE a Run has a Stage running or pending, THE Web_UI SHALL show no export control on that Run's Capacity_Report.
4. WHEN the Macro_API receives a GET request for the read-only Capacity_Report URL that contains a Run ID stored in the Run_Store, THE Macro_API SHALL serve that Run's Capacity_Report with the same headline values, tables, decisions, and AI-generated text as the Web_UI. The page SHALL have no start, stop, approve, or re-run control.
5. IF the Macro_API receives a GET request for a read-only Capacity_Report URL whose Run ID is not stored in the Run_Store, THEN THE Macro_API SHALL return a not-found page that shows no Capacity_Report data from any Run.
6. THE Web_UI SHALL write the Report_Writer explanation, the suggestions, and the Supervisor_Agent reasons into the exported Markdown file as literal text, so that any Markdown headings, tables, links, images, or HTML tags in that Untrusted_Data do not render as formatting when the file is viewed.
7. FOR ALL Capacity_Reports, every number in the exported Markdown file except digits inside the Run ID and Plan_Hash SHALL equal the corresponding number shown in the Web_UI. Each number SHALL use the same formatting as Requirement 7 criterion 4 and SHALL be a member of the Run's Allowed_Numbers.

### Requirement 17: Run a Stage from another Vultr region (Optional)

**User Story:** As a developer, I want to send load from another region, so that I can see how distance from the target changes latency.

#### Acceptance Criteria

1. WHERE `VULTR_API_KEY` is set, WHEN the user starts a Run of an approved Test_Plan, THE Web_UI SHALL offer exactly three region choices: Singapore (`sgp`, the default, which runs every Stage in a Sandbox as in Requirement 6), Tokyo (`nrt`), and Frankfurt (`fra`). The chosen region SHALL apply to every Stage of that Run, subject to Requirement 5 criteria 3–4 and Requirement 9.
2. WHEN a Stage of a Run with region `nrt` or `fra` starts, THE Macro_API SHALL create one Ephemeral_Runner in that region through the Vultr API, using a 1 vCPU / 2 GB Ubuntu 24.04 plan and tagged `macro-ephemeral` and the Run ID. Its startup script SHALL install k6 and carry the Script_Generator script for that Stage and one results token issued for that Stage only. THE Macro_API SHALL then record an "Ephemeral_Runner created" Containment_Event.
3. WHILE an Ephemeral_Runner exists, THE Macro_API SHALL reject any request that would create another Ephemeral_Runner, and SHALL start the next Stage of a regional Run only after the previous Stage's Ephemeral_Runner has been deleted as in criterion 7.
4. WHEN k6 is installed, THE Ephemeral_Runner startup script SHALL apply outbound firewall rules on the VM before k6 starts. The rules SHALL allow only TCP port 443 to the IP addresses the Target_Allowlist hosts resolve to, the results endpoint on 45.77.37.116, and DNS resolution, and SHALL deny every other destination, including `169.254.169.254`. If applying the rules fails, the startup script SHALL not start k6.
5. WHEN the Stage ends on an Ephemeral_Runner, THE Ephemeral_Runner SHALL post the k6 summary with its results token to a dedicated HTTPS results endpoint served directly on the Macro VM public IP 45.77.37.116, not through `macro.my.id`. THE Macro_API SHALL accept a post only if it carries the token issued for the Stage currently running on that Ephemeral_Runner, the token has not been used, and the body is at most 1 MiB.
6. WHEN the Macro_API accepts an Ephemeral_Runner's k6 summary, THE Metrics_Reader and Run_Controller SHALL process the summary as in Requirements 7 and 8. THE Capacity_Report, the past-Run list, and the Run comparison view SHALL show each Run's region.
7. WHEN a Stage on an Ephemeral_Runner ends, or the user activates the stop control (Requirement 9 criterion 2), or the Run reaches its 15-minute limit (Requirement 9 criterion 3), THE Macro_API SHALL send the delete request for the Ephemeral_Runner through the Vultr API within 10 seconds. It SHALL record an "Ephemeral_Runner deleted" Containment_Event only after the Vultr API confirms the VM no longer exists.
8. WHEN the Macro_API starts, and every 5 minutes after that, THE Macro_API SHALL delete every Vultr VM tagged `macro-ephemeral` that was created more than 15 minutes earlier, and SHALL delete no VM without that tag.
9. THE Macro_API SHALL keep the Vultr account API key only in the Macro_API environment. Apart from the per-Stage results token, it SHALL pass no Macro secret, including the Vultr account API key and the Vultr Serverless Inference key, to any Sandbox or Ephemeral_Runner.
10. IF a Run start request names a region other than `sgp`, `nrt`, or `fra`, or names `nrt` or `fra` while `VULTR_API_KEY` is unset, THEN THE Macro_API SHALL reject the request with an error naming the invalid region, and SHALL create no Ephemeral_Runner and start no Sandbox.
11. IF the Vultr API rejects the Ephemeral_Runner create request or gives no response within 30 seconds, or no accepted k6 summary arrives within 300 seconds plus the Stage duration after the create request, THEN THE Macro_API SHALL:
    - delete any Ephemeral_Runner it created for that Stage as in criterion 7,
    - mark the Stage as `error` with the reason,
    - record a "time cap hit" Containment_Event when the cause is the summary deadline,
    - end the Run with status `failed`.
12. THE Demo_Target rate-limit exemption SHALL stay limited to the Macro VM public IP (Requirement 14 criteria 3 and 7) and SHALL NOT be extended to Ephemeral_Runners. For every Run with region `nrt` or `fra`, THE Capacity_Report SHALL state that the load came from an IP the Demo_Target's per-IP rate limit does not exempt, so the Request_Errors and Stage_Verdicts may include per-IP throttling, and SHALL show each Stage's HTTP 429 count next to that statement.
