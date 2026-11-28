# Implementation Plan: Macro

## Overview

Macro is built in TypeScript on Bun 1.4 in the existing repository `c:\Users\bayue\Documents\projects\macro\` (it already has `.git`, `.gitignore`, `docs/`, and a local `.env`). The tasks follow the design's Build Order. Pure modules come first with their property tests, then the Demo_Target and the Sandbox path, then metrics, store, controller, API, and a minimal Web_UI. That gives a demoable slice (hand-written plan → Policy_Gate → Sandbox + Egress_Proxy → Metrics_Reader → Web_UI) before any agent work. Agents, the AI part of the report, re-run and compare, deployment, and the README follow. Optional Requirements 16 and 17 come last.

Rules that apply to every task:

- Never read, print, or commit `macro/.env`. Docker Compose reads it through `env_file` only. Placeholders go in `.env.example`.
- Every Docker call uses fixed values from code. No request may name an image, mount, network, or command.
- Untrusted strings in the Web_UI are set with `textContent` only.
- "Depends on" lists the tasks that must be finished first. Tasks without a shared file or a dependency can go to parallel sub-agents; the Task Dependency Graph at the end groups them into waves.
- Tasks that run on a VM (`macro` 45.77.37.116 or `yue-demo` 45.32.113.74) are marked "(VM)". They need the owner's SSH key; a sub-agent writes the script or config file and the owner runs it if the agent has no SSH access.

## Tasks

- [x] 1. Scaffold the repository and configuration
  - [x] 1.1 Scaffold the Bun project
    - Create `package.json` (scripts `test`, `test:vm` placeholder, `build:web`), `tsconfig.json` (strict), and dependencies `zod` v4 and `fast-check` (dev)
    - Create the directory layout from the design (`src/plan`, `src/k6`, `src/run`, `src/sandbox`, `src/agents`, `src/report`, `src/store`, `src/security`, `proxy`, `web`, `test`, `deploy/macro`, `deploy/yue-demo`, `scripts`)
    - Create `src/types.ts` with the shared types from the design's Data Models (`TestPlan`, `Metrics`, `StageMetrics`, `StageResult`, `RunStatus`, `ContainmentType`, `RouteId`)
    - Confirm `.gitignore` contains `.env` by reading `.gitignore` only (never open `.env`); add the line if it is missing
    - Create an initial `.env.example` with placeholder values for every setting in the design's Config table
    - _Requirements: 15.3_
  - [x] 1.2 Implement `src/config.ts`
    - Read `process.env` once into a frozen `Config` with the defaults from the design; accept `AI_API_KEY` as an alias for `VULTR_INFERENCE_API_KEY`
    - Exit with an error naming the setting when `VULTR_INFERENCE_API_KEY`, `TURNSTILE_SECRET_KEY`, or `TURNSTILE_SITE_KEY` is empty
    - Validate `SANDBOX_RUNTIME` (`runsc` default, `runc` explicit, anything else is a runtime error), parse `TARGET_ORIGINS` (first = web, second = api), require `@sha256:` in `K6_IMAGE`
    - _Requirements: 2.4, 2.9, 6.12, 6.13, 15.3, 15.9_
    - _Depends on: 1.1_
  - [x]* 1.3 Write unit tests for config in `test/config.test.ts`
    - Missing secret exits naming the setting; `AI_API_KEY` alias works; invalid `SANDBOX_RUNTIME` is reported; `K6_IMAGE` without a digest fails
    - _Requirements: 6.13, 15.9_
    - _Depends on: 1.2_

- [x] 2. Build the Test_Plan core (Plan_Parser, Plan_Printer, Policy_Gate)
  - [x] 2.1 Implement the Route_Catalog in `src/plan/catalog.ts`
    - `ROUTE_CATALOG` with the six entries in tie-break order, origin roles, methods, paths, and `body: 'order'` for `order_create`
    - `PRODUCT_IDS` and `ORDER_PRODUCT_ID` as placeholders until task 3.4 fills them
    - Fixed `order_create` body: `customer: "Macro Load Test"`, `notes: "macro run <runId>"`, `qty: 1`, fixed `gameUid`, `contactId`, `chatChannel`
    - _Requirements: 14.6, 14.8_
    - _Depends on: 1.1_
  - [x] 2.2 Implement the strict JSON parser in `src/plan/json-strict.ts`
    - Recursive-descent `parseStrict` returning offsets for syntax errors, field paths for duplicate keys, the set of non-integer number lexemes by path, and value spans by path
    - _Requirements: 3.3_
    - _Depends on: 1.1_
  - [x] 2.3 Implement the Test_Plan schema and Plan_Parser in `src/plan/schema.ts` and `src/plan/parser.ts`
    - zod strict schema with `z.int()` integer fields and finite `errorRatePct`
    - `parsePlan`: 16 KiB UTF-8 cap measured before fence handling, `{`-first check, first fence extraction, unclosed-fence error, `parseStrict`, zod issues mapped to `{ reason, path }` with array indexes, integer-lexeme check, `-0` normalized
    - Out-of-policy values with correct types parse successfully
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_
    - _Depends on: 2.2_
  - [x] 2.4 Implement the Plan_Printer and Plan_Hash in `src/plan/printer.ts`
    - `printPlan` with keys sorted by code point at every level, no whitespace, arrays in order; `planHash` as SHA-256 hex of the UTF-8 bytes
    - _Requirements: 3.6, 3.7_
    - _Depends on: 2.3_
  - [x] 2.5 Implement the Policy_Gate in `src/plan/policy.ts`
    - Pure `evaluatePlan(plan, allowlist)` running rules 4.2 → 4.6 in fixed order, collecting every violation with rule number and field path
    - Origin parsing (no userinfo, path `/` or empty, no query or fragment, exact scheme, host, effective port), Target_Denylist including IPv4 and bracketed IPv6 literals, applied even when allowlisted
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_
    - _Depends on: 2.1, 2.3_
  - [x]* 2.6 Write shared generators in `test/arb.ts`
    - `arbTestPlan`, `arbAcceptedPlan`, `arbBoundaryPlan` now; later tasks add `arbSummary`, `arbStageResults`, `arbIp`, `arbAllowedText` to their own test files or to this file in their own wave
    - _Requirements: 3.1, 4.4, 4.5, 4.6_
    - _Depends on: 2.3_
  - [x]* 2.7 Write property test for plan round trip in `test/plan-roundtrip.test.ts`
    - **Property 1: Plan round trip**
    - **Validates: Requirements 3.1, 3.2, 3.7**
    - _Depends on: 2.4, 2.6_
  - [x]* 2.8 Write property test for canonical print format in `test/plan-print.test.ts`
    - **Property 2: Canonical print format**
    - **Validates: Requirements 3.6**
    - _Depends on: 2.4, 2.6_
  - [x]* 2.9 Write property test for malformed plan rejection in `test/plan-malformed.test.ts`
    - **Property 3: Malformed plan text is rejected with a located error**
    - **Validates: Requirements 3.3**
    - _Depends on: 2.4, 2.6_
  - [x]* 2.10 Write property test for fence extraction in `test/plan-fence.test.ts`
    - **Property 4: Fence extraction**
    - **Validates: Requirements 3.4, 3.5**
    - _Depends on: 2.4, 2.6_
  - [x]* 2.11 Write property test for the Policy_Gate reference model in `test/policy-model.test.ts`
    - **Property 5: Policy_Gate matches a reference rule model**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5, 4.6**
    - _Depends on: 2.5, 2.6_
  - [x]* 2.12 Write property test for Policy_Gate determinism in `test/policy-determinism.test.ts`
    - **Property 6: Policy_Gate is deterministic and offline**
    - **Validates: Requirements 4.7**
    - _Depends on: 2.5, 2.6_
  - [x]* 2.13 Write unit tests for Policy_Gate boundaries in `test/policy-bounds.test.ts`
    - One accept and one reject example at each inclusive bound of criteria 4.4–4.6
    - _Requirements: 4.4, 4.5, 4.6_
    - _Depends on: 2.5_

- [x] 3. Prepare the Demo_Target on `yue-demo` (parallel with tasks 2 and 4)
  - [x] 3.1 Write the rate-limit allowlist patch `deploy/yue-demo/rate-limit-allowlist.patch` (VM)
    - Against the YUE checkout at `/opt/yue`: `@fastify/rate-limit` `allowList` from `RATE_LIMIT_ALLOWLIST`; a `ThrottlerGuard` subclass whose `shouldSkip` returns true for those IPs (covers the per-route `@Throttle` limits); Fastify `trustProxy` set to Caddy's address
    - Apply it to `/opt/yue` with `git apply` and leave it uncommitted; never push it to any YUE branch
    - _Requirements: 14.4, 14.5, 14.11_
  - [x] 3.2 Write the demo environment template `deploy/yue-demo/yue.env.template` and create `/opt/yue/.env` (VM)
    - Local Postgres and Redis URLs with freshly generated local passwords, `RATE_LIMIT_ALLOWLIST=45.77.37.116`, and `DISCORD_WEBHOOK_URL`, `WHATSAPP_WEBHOOK_URL`, every Kafka and S3 setting empty
    - No value copied from the YUE production deployment (`yueshop.xyz`, `api.yueshop.xyz`, Supabase)
    - _Requirements: 14.1, 14.2, 14.3_
    - _Depends on: 1.1_
  - [x] 3.3 Write `deploy/yue-demo/docker-compose.override.yml` and `deploy/yue-demo/Caddyfile`, then start the stack (VM)
    - Postgres, Redis, API, and web on `yue-demo`; Caddy with Let's Encrypt for `yue.macro.my.id` (web) and `api.yue.macro.my.id` (API) on port 443
    - Confirm both Cloudflare records are DNS-only and resolve to 45.32.113.74
    - _Requirements: 14.1, 14.9, 14.10_
    - _Depends on: 3.1, 3.2_
  - [x] 3.4 Seed products and fill the catalog
    - Write `deploy/yue-demo/seed-products.sql` (at least 5 products) and `deploy/yue-demo/cleanup-orders.sql` (deletes orders with customer `Macro Load Test`); run the seed on the VM
    - Confirm products have no stock field (Requirement 14.7 becomes N/A); if one exists, seed at least 100,000 units for `ORDER_PRODUCT_ID`
    - Copy the seeded slugs into `PRODUCT_IDS` and `ORDER_PRODUCT_ID` in `src/plan/catalog.ts`
    - _Requirements: 14.6, 14.7, 14.8_
    - _Depends on: 2.1, 3.3_
  - [x] 3.5 Write the Demo_Target smoke checks in `deploy/check.sh`
    - `dig` both hosts → 45.32.113.74 without Cloudflare; `curl -v` shows valid certificates; `GET /api/v1/products` returns at least 5 products; 200 rapid `GET /api/v1/orders/public?page=1` from `macro` return no 429; grep YUE `.env` for `yueshop`, `supabase`, webhook, Kafka, and S3 values
    - _Requirements: 14.2, 14.3, 14.4, 14.5, 14.6, 14.9, 14.10_
    - _Depends on: 3.4_
  - [x]* 3.6 Write unit test pinning the order body in `test/order-body.test.ts`
    - Literal `order_create` body matches YUE's `createOrderSchema` field set and contains the Run ID in the notes
    - _Requirements: 14.8_
    - _Depends on: 3.4_

- [x] 4. Build the Sandbox path (gVisor, Egress_Proxy, Docker client, Script_Generator, Containment_Probe)
  - [x] 4.1 Write `deploy/macro/install-gvisor.sh` and run it on `macro` (VM)
    - Install the `runsc` apt package, run `runsc install`, restart Docker, and check that `docker info` lists `runsc` under Runtimes
    - _Requirements: 6.12, 6.13_
  - [x] 4.2 Implement blocked-address classification and the connect decision in `proxy/ip.ts`
    - `isBlockedIp` for every range in the design (IPv4, IPv6, IPv4-mapped IPv6, `BLOCK_IPS`); pure `decideConnect(host, port, addresses, allowHosts, blockIps)` returning allow with a non-blocked address or deny with a reason
    - _Requirements: 6.15_
    - _Depends on: 1.1_
  - [x] 4.3 Implement the Egress_Proxy in `proxy/proxy.ts` and `proxy/Dockerfile`
    - `Bun.listen` on 3128; CONNECT only, single `dns.lookup` then connect to the chosen IP; `403` with `X-Macro-Proxy: denied` otherwise; append `{ts,host,port,reason}` to `denials.jsonl`
    - Image runs as non-root with no extra packages
    - _Requirements: 6.5, 6.6, 6.15_
    - _Depends on: 4.2_
  - [x]* 4.4 Write property test for the egress decision in `test/proxy-decision.test.ts`
    - **Property 10: Egress decision allows only allowlisted hosts on 443 with public addresses**
    - **Validates: Requirements 6.15**
    - _Depends on: 4.2_
  - [x] 4.5 Implement the Docker Engine API client in `src/sandbox/docker.ts`
    - `fetch('http://docker/v1.47/...', { unix: '/var/run/docker.sock' })` wrappers for network create/connect/remove, container create/start/wait/kill/inspect/delete/logs, list by label, `GET /info`; 8-byte-header log demux
    - _Requirements: 6.2, 6.9, 6.13_
    - _Depends on: 1.1_
  - [x] 4.6 Implement the Script_Generator in `src/k6/script.ts`
    - Fixed template with one `const CFG = <JSON>` injection point holding only numbers, catalog entries, configured origins, product IDs, and the Run ID
    - `constant-vus` executor, `summaryTrendStats`, always-true per-route thresholds, `timeout: '10s'`, `route` tag, `macro_429` counter, probability and think-time loop, `handleSummary` writing `/out/summary.json`
    - _Requirements: 6.1, 7.1, 7.3, 14.8_
    - _Depends on: 2.1, 2.3_
  - [x]* 4.7 Write property test for Stage scripts in `test/script.test.ts`
    - **Property 9: Stage scripts contain only approved values**
    - **Validates: Requirements 6.1**
    - _Depends on: 4.6, 2.6_
  - [x] 4.8 Implement the Sandbox_Runner in `src/sandbox/runner.ts`
    - `openRunNetwork` (internal network + proxy container on it and on `macro-egress`), `runSandbox` (hardened create body from the design, time cap, OOM detection, summary read, removal confirmed by 404), `closeRunNetwork` (within 30 s, 3 retries), `cleanupAll` (startup sweep of `macro=1`)
    - Poll `denials.jsonl` every 1 s and record "egress blocked" events; clean up partial resources on create failure
    - Expose the runner behind a `StageExecutor` interface (`run(stageSpec, signal) → StageRunResult`) so Requirement 17 can add another executor
    - _Requirements: 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.16_
    - _Depends on: 1.2, 4.3, 4.5_
  - [x]* 4.9 Write unit tests for the Sandbox_Runner with a fake Docker client in `test/runner.test.ts`
    - Exact `HostConfig` hardening fields, exact `Env` list, labels, pinned image, runtime; time-cap event order; OOM detection; "Sandbox removed" only after 404; create-failure cleanup; startup sweep
    - _Requirements: 6.2, 6.3, 6.4, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.16_
    - _Depends on: 4.8_
  - [x] 4.10 Implement the Containment_Probe in `src/k6/probe.js` and its classifier in `src/k6/probe-result.ts`
    - Fixed probe performing actions a–e in order with 10 s timeouts and one `MACRO_PROBE {...}` log line per action; env check prints names only
    - Pure classifier: parse log lines with zod, decide action e from Docker OOM state, return `passed`, `failed` (naming escaped actions), or `incomplete` with `no result` actions
    - _Requirements: 12.3, 12.4, 12.5, 12.9_
    - _Depends on: 1.1_
  - [x]* 4.11 Write property test for probe classification in `test/probe-classify.test.ts`
    - **Property 24: Containment_Probe classification**
    - **Validates: Requirements 12.4, 12.5, 12.9**
    - _Depends on: 4.10_
  - [x] 4.12 Write manual harnesses `scripts/run-stage.ts` and `scripts/run-probe.ts`, and pin the k6 digest
    - `run-stage.ts` runs one hand-written Stage against the Demo_Target and prints the raw summary JSON; `run-probe.ts` runs the probe and prints the classification
    - Pull `grafana/k6`, record its digest as the `K6_IMAGE` default in `src/config.ts` and in `.env.example`
    - _Requirements: 6.1, 6.2, 12.2_
    - _Depends on: 4.6, 4.8, 4.10_
  - [ ]* 4.13 Write VM integration tests in `test/vm/sandbox.vm.test.ts` and wire `bun run test:vm` in `package.json`
    - Probe under `runsc`: all five actions `contained`, events include "egress blocked" (a, b, c), "memory cap hit", "Sandbox removed", and no `macro=1` container remains
    - Two-Stage plan (10 → 20 VUs, 30 s each) against the Demo_Target: summary parses, per-route metrics present, 429 count 0
    - `docker inspect` of a live Sandbox shows `Runtime`, `ReadonlyRootfs`, `CapDrop`, `PidsLimit`, `Memory`, `MemorySwap`, `User`
    - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.10, 7.1, 12.2, 12.3, 12.6, 14.4_
    - _Depends on: 4.12_

- [x] 5. Read metrics and compute verdicts
  - [x] 5.1 Implement display formatting in `src/run/format.ts`
    - `roundHalfAway` (with `toPrecision(15)` pre-step), `fmtMs`, `fmtPct`, `fmtRps`
    - _Requirements: 7.4_
    - _Depends on: 1.1_
  - [x] 5.2 Implement the Metrics_Reader in `src/k6/metrics.ts`
    - zod `passthrough` validation of the summary; overall and per-route values from tagged sub-metrics; rps from `state.testRunDurationMs`; `macro_429` absent → 0; every 7.2 error case returns a reason
    - Check the real summary shape printed by `scripts/run-stage.ts` for the pinned digest and adjust the key names
    - _Requirements: 7.1, 7.2, 7.3_
    - _Depends on: 4.12_
  - [x] 5.3 Implement verdict and capacity math in `src/run/verdict.ts`
    - `stageVerdict`, `safeCapacity`, `breakingPoint`, `firstDegradedRoute` on rounded values, with `ROUTE_CATALOG` order as the tie-break
    - _Requirements: 7.5, 10.3, 10.4, 10.11_
    - _Depends on: 2.1, 5.1_
  - [x]* 5.4 Write property test for summary reading in `test/metrics-read.test.ts`
    - **Property 11: Metrics_Reader recovers generated summary values**
    - **Validates: Requirements 7.1**
    - _Depends on: 5.2_
  - [x]* 5.5 Write property test for summary rejection in `test/metrics-reject.test.ts`
    - **Property 12: Metrics_Reader rejects incomplete summaries**
    - **Validates: Requirements 7.2**
    - _Depends on: 5.2_
  - [x]* 5.6 Write property test for display rounding in `test/format.test.ts`
    - **Property 13: Display rounding**
    - **Validates: Requirements 7.4**
    - _Depends on: 5.1_
  - [x]* 5.7 Write property test for verdict and capacity values in `test/verdict.test.ts`
    - **Property 14: Verdict and capacity values match a reference**
    - **Validates: Requirements 7.5, 10.3, 10.4, 10.11**
    - _Depends on: 5.3_

- [x] 6. Checkpoint - pure core and Sandbox path
  - Ensure all tests pass, ask the user if questions arise.
  - `bun test` is green; `scripts/run-stage.ts` and `scripts/run-probe.ts` work on `macro` under `runsc`.

- [x] 7. Build the Run_Store, Run_Controller, limits, and HTTP API
  - [x] 7.1 Implement the Run_Store in `src/store/db.ts`
    - `bun:sqlite` in WAL mode at `DATA_DIR/macro.db` with the design's schema; typed queries for drafts, plans, runs, stages, decisions, events, reports, model calls, planning requests, client starts; hourly deletion of limit rows older than 24 h
    - No secret is ever written
    - _Requirements: 2.6, 5.2, 6.14, 7.5, 8.8, 9.6, 10.1_
    - _Depends on: 1.1_
  - [x] 7.2 Implement decision application in `src/run/decide.ts`
    - Pure `applyDecision(isLast, verdict, agent)` per the design's rules, including fixed fallback reason kinds
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.7, 8.8_
    - _Depends on: 1.1_
  - [x]* 7.3 Write property test for decision application in `test/decide.test.ts`
    - **Property 15: Decision application**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.7, 8.8**
    - _Depends on: 7.2_
  - [x] 7.4 Implement limit math in `src/run/limits.ts`
    - Pure `rollingCheck` and `dailyCheck` returning `retryAt` or `resetAt`
    - _Requirements: 9.4, 9.5, 9.6_
    - _Depends on: 1.1_
  - [x]* 7.5 Write property test for limits in `test/limits.test.ts`
    - **Property 19: Rolling and daily limits match a reference**
    - **Validates: Requirements 9.4, 9.5, 9.6**
    - _Depends on: 7.4_
  - [x] 7.6 Implement Turnstile verification and client IP in `src/security/turnstile.ts` and `src/security/client-ip.ts`
    - Siteverify POST with a 10 s timeout; missing token, `success: false`, error, or timeout → `ok: false`; `clientIp` returns `CF-Connecting-IP`
    - _Requirements: 9.7, 9.8, 9.10_
    - _Depends on: 1.2_
  - [x]* 7.7 Write unit tests for Turnstile and client IP in `test/security.test.ts`
    - Each failure mode returns `ok: false`; IP is taken from `CF-Connecting-IP`, not the socket address
    - _Requirements: 9.7, 9.8, 9.10_
    - _Depends on: 7.6_
  - [x] 7.8 Implement the Capacity_Report builder without AI text in `src/report/build.ts`
    - `buildReport(run)` with headline values, per-Stage and per-route tables, decisions, Containment_Events, and explicit fields for the 10.3, 10.4, 10.11, 10.12 states; every number from stored metrics and the approved plan
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6, 10.11, 10.12_
    - _Depends on: 5.1, 5.3_
  - [x] 7.9 Implement the Run_Controller in `src/run/controller.ts`
    - Start re-check (hash, parse, gate) → `failed` on mismatch; open run network; per Stage: script → `StageExecutor.run` → `readSummary` → verdict → store before any Supervisor call → decision (verdict-only for now; a Supervisor hook is injected later) → store decision
    - Stop (status first, then abort) and 15-minute timer; discard late responses when status is no longer `running`; `try/finally` closes the run network; build the report for `completed|halted|stopped|timed_out`
    - _Requirements: 5.3, 5.4, 5.7, 6.10, 7.5, 7.6, 8.1, 8.2, 8.4, 8.7, 8.9, 9.2, 9.3, 10.1_
    - _Depends on: 2.4, 2.5, 4.8, 5.2, 7.1, 7.2, 7.8_
  - [x]* 7.10 Write unit tests for the Run_Controller with fakes in `test/controller.test.ts`
    - Metrics stored before the Supervisor call; Stage error ends `failed` and keeps earlier Stages; stop and timeout during a Supervisor wait discard the response; last Stage skips the Supervisor; hash mismatch starts no Sandbox
    - _Requirements: 5.4, 5.7, 7.5, 7.6, 8.1, 8.7, 8.9, 9.2, 9.3_
    - _Depends on: 7.9_
  - [x] 7.11 Implement start admission in `src/run/admission.ts`
    - One synchronous block after Turnstile: active slot check (Run or probe) → per-IP 6/60 min → daily 50 from `runs.started_at` → insert `runs` and `client_starts`; Plan_Hash format and approval check; runtime error check
    - _Requirements: 5.3, 5.5, 6.13, 9.1, 9.5, 9.6, 9.9, 12.7_
    - _Depends on: 7.1, 7.4_
  - [x] 7.12 Implement Containment_Probe orchestration in `src/run/probe.ts`
    - Own Run ID, network, and proxy; Stage index 1; 60 s cap with "time cap hit" and "Sandbox killed"; classify and store `probe_result`; remove Sandbox, output directory, and network
    - _Requirements: 12.2, 12.6, 12.8, 6.14_
    - _Depends on: 4.8, 4.10, 7.1_
  - [x] 7.13 Implement the HTTP API, SSE, and startup in `src/server.ts` and `src/main.ts`
    - Routes from the design's HTTP API table; zod bodies, 64 KiB cap, CSP header, uniform error shape with fixed messages
    - Planning handler: length check → Turnstile → planning limit → a temporary stub in `src/agents/planner-stub.ts` that returns a hand-written plan; approve handler: parse → gate → print → hash → store → admission → controller
    - SSE with `Last-Event-ID` replay and 3 s heartbeat; static files from the `Bun.build` output
    - `src/main.ts` startup order: config → DB → runtime check → `cleanupAll` → mark `running` Runs `interrupted` → ensure `macro-egress` network and proxy image → listen
    - _Requirements: 1.3, 1.4, 2.9, 4.9, 5.2, 5.5, 5.6, 6.11, 6.13, 9.2, 9.4, 9.7, 9.8, 11.2, 11.8, 12.1_
    - _Depends on: 7.6, 7.9, 7.11, 7.12_
  - [x]* 7.14 Write property test for unapproved hashes in `test/start-handler.test.ts`
    - **Property 8: Unapproved Plan_Hash never starts a Run**
    - **Validates: Requirements 5.5**
    - _Depends on: 7.13_
  - [x]* 7.15 Write property test for one active Run in `test/admission-concurrency.test.ts`
    - **Property 20: One active Run under concurrent starts**
    - **Validates: Requirements 9.1, 9.9**
    - _Depends on: 7.13_
  - [x]* 7.16 Write property test for approval storage in `test/approve.test.ts`
    - **Property 7: Approval stores only canonical, accepted plans**
    - **Validates: Requirements 4.9, 5.2, 5.6**
    - _Depends on: 7.13_
  - [x]* 7.17 Write property test for the Traffic_Event length gate in `test/plan-length.test.ts`
    - **Property 18: Traffic_Event length gate**
    - **Validates: Requirements 1.4**
    - _Depends on: 7.13_

- [x] 8. Build the minimal Web_UI
  - [x] 8.1 Implement the page shell and the describe and plan-review view
    - `web/index.html`, `web/style.css`, `web/app.ts` (hash router, API client, Turnstile helper with `reset()` after each use), and `scripts/build-web.ts` (`Bun.build`)
    - Create stub modules `web/run-view.ts`, `web/report-view.ts`, `web/probe-view.ts` that the router imports
    - `web/describe.ts`: textarea with code-point counter out of 1,000, example buttons that fill only, read-only target, disabled submit outside 10–1,000 or while pending, progress indicator, error display that keeps the text; Stages and Journey tables, thresholds, rationale via `textContent`, violation list with no approval control, approval control stating target, max VUs, and total seconds
    - _Requirements: 1.1, 1.2, 1.5, 1.6, 1.7, 1.8, 2.5, 2.8, 4.8, 5.1_
    - _Depends on: 7.13_
  - [x] 8.2 Implement the live Run view in `web/run-view.ts`
    - "Stage N of M", VUs, elapsed `mm:ss` ticking every second, stop control, Stage rows (metrics or `error` with reason), decisions with source and reason, Containment_Event timeline oldest first with warning icon and amber highlight for egress blocked, memory cap hit, time cap hit; runtime shown; staleness badge after 10 s; `EventSource` replay
    - _Requirements: 6.14, 9.2, 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_
    - _Depends on: 8.1_
  - [x] 8.3 Implement the Capacity_Report view in `web/report-view.ts`
    - Headline values, the 10.3/10.4/10.11/10.12 sentences, per-Stage and per-route tables formatted per 7.4, decisions, Containment_Events, runtime
    - _Requirements: 6.14, 10.2, 10.3, 10.4, 10.11, 10.12_
    - _Depends on: 8.1_
  - [x] 8.4 Implement the Containment_Probe view in `web/probe-view.ts`
    - Separate start control, five action rows with `contained`, `escaped`, or `no result`, the probe's Containment_Events, runtime, and the passed, failed (naming escaped actions), or incomplete result
    - _Requirements: 6.14, 12.1, 12.4, 12.5, 12.9_
    - _Depends on: 8.1_

- [x] 9. Checkpoint - first demoable slice
  - Ensure all tests pass, ask the user if questions arise.
  - A hand-written plan runs from the browser on `macro`: approval → Sandbox + Egress_Proxy → metrics → live view → report; the probe page shows all five actions `contained`.

- [x] 10. Add the agents and the AI part of the report
  - [x] 10.1 Implement the Inference_Client in `src/agents/inference.ts`
    - `callTool` posting to `{VULTR_INFERENCE_BASE_URL}/chat/completions` with `tools`, forced `tool_choice`, `temperature: 0.2`, Bearer key in the header only; per-attempt timeout; one identical fallback attempt; one `model_calls` row per attempt with token counts or null; fixed error strings
    - _Requirements: 2.4, 2.6, 2.7_
    - _Depends on: 1.2, 7.1_
  - [x]* 10.2 Write unit tests for the Inference_Client in `test/inference.test.ts`
    - Body uses `tools` and `tool_choice`; URL is the configured base; key only in the header and never in a returned error or stored row
    - _Requirements: 2.4, 2.6_
    - _Depends on: 10.1_
  - [x] 10.3 Implement the Planner_Agent in `src/agents/planner.ts` and replace the stub in `src/server.ts`
    - System message with instructions, Route_Catalog, allowlist, 4.4–4.6 limits, and sizing advice; user message with only the `<traffic_event>` block; `propose_plan` tool from `z.toJSONSchema`; first call only; plan slice via `spans`; one retry with errors; "planning failed" after both attempts of a request fail; delete `src/agents/planner-stub.ts`
    - _Requirements: 2.1, 2.2, 2.3, 2.8, 2.9_
    - _Depends on: 10.1, 7.13_
  - [x]* 10.4 Write property test for the planner attempt budget in `test/planner.test.ts`
    - **Property 17: Planner attempt budget**
    - **Validates: Requirements 2.2, 2.6, 2.7**
    - _Depends on: 10.3_
  - [x] 10.5 Implement the Number_Guard in `src/report/number-guard.ts`
    - `numericTokens` (NFKC, letter-prefix exclusion, grouping rules, split on malformed groupings), `guardText`, `allowedNumbers`
    - _Requirements: 10.7_
    - _Depends on: 5.1_
  - [x]* 10.6 Write property test for the Number_Guard in `test/number-guard.test.ts`
    - **Property 21: Number_Guard accepts exactly allowed numbers**
    - **Validates: Requirements 10.7**
    - _Depends on: 10.5_
  - [x] 10.7 Implement the Supervisor_Agent in `src/agents/supervisor.ts` and wire it into `src/run/controller.ts`
    - `decide_next_stage` tool; 15 s per attempt and 30 s overall; validator takes only the first call; Number_Guard on the reason with the template replacement; decision stored with source and reason
    - _Requirements: 8.1, 8.3, 8.5, 8.6, 8.8, 10.7, 10.8_
    - _Depends on: 10.1, 10.5, 7.9_
  - [x]* 10.8 Write property test for Supervisor validation in `test/supervisor.test.ts`
    - **Property 16: Supervisor response validation**
    - **Validates: Requirements 8.5, 8.6**
    - _Depends on: 10.7_
  - [x] 10.9 Implement the Report_Writer in `src/agents/reporter.ts` and its AI section in `src/report/build.ts`
    - `write_report` tool, 45 s per attempt; first 5 suggestions, explanation cut to 1,500 and suggestions to 300 characters, Number_Guard on the truncated text, template or removal with "AI explanation withheld: unverified number"; "AI explanation unavailable" note on failure; no request when no Stage has metrics
    - _Requirements: 10.5, 10.8, 10.9, 10.10, 10.12, 10.13_
    - _Depends on: 10.1, 10.5, 7.8_
  - [x]* 10.10 Write property test for bounded and verified AI text in `test/report-ai.test.ts`
    - **Property 22: AI text shown is bounded and verified**
    - **Validates: Requirements 10.8, 10.13**
    - _Depends on: 10.9_
  - [x]* 10.11 Write property test for AI-independent report numbers in `test/report-independence.test.ts`
    - **Property 23: Report numbers do not depend on AI output**
    - **Validates: Requirements 10.6**
    - _Depends on: 10.9_
  - [x] 10.12 Show agent output in the Web_UI (`web/describe.ts`, `web/report-view.ts`)
    - Model-call list in request order for the draft and the Run; retry control after "planning failed"; AI-generated section separate from headline values and tables; withheld and unavailable labels
    - _Requirements: 2.3, 2.6, 10.8, 10.9, 10.10_
    - _Depends on: 8.1, 8.3, 10.3, 10.9_

- [x] 11. Add re-run and Run comparison
  - [x] 11.1 Implement `compareRuns` in `src/report/compare.ts`
    - `different_plan` for different Plan_Hashes; earlier-started baseline; differences on displayed rounded values; percent change at one decimal; `n/a` and `not run` rules
    - _Requirements: 13.3, 13.4, 13.5_
    - _Depends on: 5.1, 7.8_
  - [x]* 11.2 Write property test for Run comparison in `test/compare.test.ts`
    - **Property 25: Run comparison**
    - **Validates: Requirements 13.3, 13.4, 13.5**
    - _Depends on: 11.1_
  - [x] 11.3 Add the re-run, Run-list, and compare endpoints to `src/server.ts`
    - `POST /api/runs` through admission and controller with Turnstile; `GET /api/plans/:hash/runs` (20 newest); `GET /api/compare?a=&b=`
    - _Requirements: 13.1, 13.2, 13.6, 13.8_
    - _Depends on: 11.1, 10.3_
  - [x] 11.4 Implement the re-run control, Run list, and compare view (`web/report-view.ts`, `web/compare-view.ts`)
    - Re-run control for ended Runs with one `confirm()` (cancel sends nothing); Run list with "none" and "not reached"; two-Run picker; side-by-side view; rejection error shown on the report
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8_
    - _Depends on: 11.3, 10.12_
  - [x]* 11.5 Add the SVG chart in `web/chart.ts` and show it in `web/report-view.ts`
    - p95 per Stage with a dashed threshold line and error-rate bars, drawn only from stored metrics (first item on the cut list)
    - _Requirements: 10.2, 10.6_
    - _Depends on: 11.4_
  - [ ]* 11.6 Add load-generator saturation sampling
    - `src/sandbox/runner.ts` samples container stats every 5 s and sets `generator_saturated` at ≥ 90 % of one core; `src/report/build.ts` and `web/report-view.ts` show the caution line
    - _Requirements: 10.2_
    - _Depends on: 11.5_

- [x] 12. Checkpoint - full feature set
  - Ensure all tests pass, ask the user if questions arise.
  - The Uma Musume example plans, runs with agent decisions, and two Runs compare side by side.

- [x] 13. Deploy Macro on the `macro` VM
  - [x] 13.1 Write `Dockerfile`, `deploy/macro/docker-compose.yml`, and `deploy/macro/Caddyfile`
    - `macro-api` image with the bundled Web_UI; Compose services `caddy` (80/443, origin cert from `/etc/macro/tls/`) and `macro-api` (`env_file: ../../.env`, Docker socket, `/var/lib/macro:/var/lib/macro`, listening on `127.0.0.1:3000` inside the Compose network); `macro-proxy` image under a `build-only` profile
    - One command: `docker compose -f deploy/macro/docker-compose.yml up -d --build`
    - _Requirements: 15.1, 15.2, 15.3_
    - _Depends on: 4.3, 7.13_
  - [x] 13.2 Install the Cloudflare Origin CA certificate and secrets on `macro` (VM)
    - Origin CA cert and key at `/etc/macro/tls/` (outside the repo); Cloudflare SSL mode Full (strict); Turnstile widget for `macro.my.id`; the owner writes the VM's `.env` by hand from `.env.example` (agents never read or print it)
    - _Requirements: 15.1, 15.3, 9.7_
    - _Depends on: 13.1_
  - [x] 13.3 Write `deploy/macro/vultr-firewall.sh` and apply the firewall group to `macro` (VM)
    - Fetch `https://www.cloudflare.com/ips-v4` and `ips-v6`, create inbound rules for 80/443 from those ranges only and 22 from the owner IP, attach the group to the `macro` instance; the Vultr API key comes from the shell environment and is never echoed or written to a file
    - _Requirements: 9.10_
    - _Depends on: 1.1_
  - [x] 13.4 Deploy and verify on `macro` (VM)
    - Clone the repo to the VM, run the Compose command, run `bun run test:vm` and `deploy/check.sh`, and confirm `https://macro.my.id` loads in a private window within 10 minutes of the command
    - _Requirements: 15.1, 15.2_
    - _Depends on: 13.2, 13.3, 13.5, 4.13_
  - [x] 13.5 Extend `deploy/check.sh` with Macro deployment checks
    - `https://macro.my.id` loads without sign-in; the GitHub repo is readable anonymously; `git log -p` grep for key prefixes finds nothing; a direct hit on 45.77.37.116:443 from a non-Cloudflare IP is refused
    - _Requirements: 9.10, 15.1, 15.3, 15.10_
    - _Depends on: 3.5_

- [x] 14. Write the README and publish the repository
  - [x] 14.1 Write `README.md`
    - Vultr usage (both VMs with region and role; Serverless Inference base URL, default models, and setting names; every agent call goes through it), Docker with one Sandbox per Stage and the Sandbox_Runtime
    - Architecture overview with VM placement; setup steps for `macro` and `yue-demo` including the patch file; demo URL; both Target_Allowlist origins; containment-moment reproduction steps
    - Limits (Demo_Target only, DNS TXT verification is future work, one VM in one region, First_Degraded_Route is not a root cause, 1-vCPU generator caution); YUE pre-existed and Macro was built during the hackathon
    - Containment control table for 6.3–6.5, 6.7–6.10, 6.12–6.13 with file path and function name linked into the public repo; manual UI checklist for Requirements 1, 2.5, 4.8, 5.1, 11, 13
    - _Requirements: 15.4, 15.5, 15.6, 15.7, 15.8_
    - _Depends on: 13.4_
  - [x] 14.2 Finalize `.env.example`
    - Every setting `src/config.ts` reads, including `VULTR_INFERENCE_MODEL`, `VULTR_INFERENCE_FALLBACK_MODEL`, `SANDBOX_RUNTIME`, `TARGET_ORIGINS`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY`, `K6_IMAGE`, with placeholders only
    - _Requirements: 15.3_
    - _Depends on: 13.4_
  - [x] 14.3 Scan history for secrets and make the repository public
    - Run a secret scan over the full git history (for example `gitleaks detect` or a `git log -p` grep for key prefixes), confirm `.env` was never committed, push, and set the GitHub repository to public
    - _Requirements: 15.3, 15.10_
    - _Depends on: 14.1, 14.2_

- [x] 15. Final checkpoint - submission ready
  - Ensure all tests pass, ask the user if questions arise.
  - `https://macro.my.id` is live, the repository is public, and the containment moment can be reproduced from the README.

- [ ] 16. Export and share a Capacity_Report (Requirement 16, optional, only after task 15)
  - [ ]* 16.1 Implement `exportMarkdown(report)` in `src/report/export.ts`
    - File name with the Run ID; all 16.1 content; AI text under an AI-generated heading with Markdown control characters and `<` backslash-escaped; numbers formatted as 7.4
    - _Requirements: 16.1, 16.2, 16.6, 16.7_
    - _Depends on: 10.9_
  - [ ]* 16.2 Write unit tests for the export in `test/export.test.ts`
    - Injected headings, links, images, and HTML stay literal; every number except Run ID and Plan_Hash digits is in Allowed_Numbers and matches the UI formatting
    - _Requirements: 16.6, 16.7_
    - _Depends on: 16.1_
  - [ ]* 16.3 Add the read-only report page `GET /r/:id` to `src/server.ts`
    - Same view model as the Web_UI with no start, stop, approve, or re-run control; not-found page for unknown Run IDs
    - _Requirements: 16.4, 16.5_
    - _Depends on: 16.1, 11.3_
  - [ ]* 16.4 Add the export control to `web/report-view.ts`
    - Shown only when no Stage is running or pending; downloads exactly one file
    - _Requirements: 16.1, 16.3_
    - _Depends on: 16.1, 11.6_

- [ ] 17. Run a Stage from another Vultr region (Requirement 17, optional, only after task 15)
  - [ ]* 17.1 Add region selection to the `StageExecutor` wiring in `src/run/controller.ts` and `src/sandbox/runner.ts`
    - Controller picks the executor per Run region (`sgp` = local Sandbox); one Ephemeral_Runner at a time; next Stage only after the previous runner is deleted
    - _Requirements: 17.1, 17.3_
    - _Depends on: 10.7, 11.6_
  - [ ]* 17.2 Implement `VultrRegionExecutor` in `src/sandbox/vultr-executor.ts`
    - Create a 1 vCPU / 2 GB Ubuntu 24.04 VM tagged `macro-ephemeral` and the Run ID; startup script installs k6, applies outbound firewall rules (443 to allowlisted IPs, results endpoint, DNS; deny `169.254.169.254` and everything else) and refuses to start k6 if that fails; per-Stage results token; delete within 10 s with "Ephemeral_Runner deleted" only after Vultr confirms; 30 s create timeout and 300 s + duration summary deadline
    - _Requirements: 17.2, 17.4, 17.7, 17.9, 17.11_
    - _Depends on: 17.1_
  - [ ]* 17.3 Add the results endpoint on 45.77.37.116 to `src/server.ts` and `deploy/macro/Caddyfile`, and start the sweeper from `src/main.ts`
    - HTTPS endpoint served directly on the VM IP, not through `macro.my.id`; accept only the current Stage's unused token and bodies up to 1 MiB; pass the summary through the Metrics_Reader and Run_Controller
    - _Requirements: 17.5, 17.6, 17.8_
    - _Depends on: 17.2, 17.4, 16.3_
  - [ ]* 17.4 Implement the Ephemeral_Runner sweeper in `src/sandbox/vultr-sweeper.ts`
    - At startup and every 5 minutes, delete VMs tagged `macro-ephemeral` older than 15 minutes; never touch untagged VMs
    - _Requirements: 17.8_
    - _Depends on: 17.1_
  - [ ]* 17.5 Add region choice, validation, and region reporting (`src/server.ts`, `web/describe.ts`, `web/report-view.ts`, `web/compare-view.ts`)
    - Exactly `sgp`, `nrt`, `fra` offered when `VULTR_API_KEY` is set; reject other regions or `nrt`/`fra` without the key; region shown in report, Run list, and comparison; per-IP throttling statement with each Stage's 429 count for `nrt` and `fra`
    - _Requirements: 17.1, 17.6, 17.10, 17.12_
    - _Depends on: 17.3, 16.4_
  - [ ]* 17.6 Write unit tests for regional runs in `test/region.test.ts`
    - Invalid region rejection; single-use token; oversized body rejected; sweeper deletes only tagged VMs older than 15 minutes; no secret in the startup script
    - _Requirements: 17.5, 17.8, 17.9, 17.10_
    - _Depends on: 17.5_

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. All of Requirements 16 and 17 are optional and start only after the final checkpoint.
- Do not cut tasks that carry the "Blast Radius Zero" claim: Requirements 4, 6, 9, 10.6–10.8, and 12 (tasks 2.5, 4.1–4.3, 4.5, 4.8, 4.10, 7.4, 7.6, 7.9, 7.11–7.13, 8.4, 10.5, 10.7, 10.9).
- Cut order if time runs short: 11.6 saturation sampling, 11.5 SVG chart, percent changes in 11.1 (keep differences), staleness badge polish in 8.2.
- Tasks 3.x and 4.1 run on the VMs and can proceed in parallel with tasks 2.x from the start.
- Each property test uses `fast-check` with `{ numRuns: 100 }` or more and a `// Feature: macro, Property N: <title>` comment.
- Recording the video and submitting on lablab.ai are owner steps outside this task list, planned for 02:45–03:30 in the design's Build Order.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2", "3.2", "4.2", "4.5", "4.10"] },
    { "id": 2, "tasks": ["1.3", "2.3", "3.3", "4.3", "4.4", "4.11", "5.1"] },
    { "id": 3, "tasks": ["2.4", "2.5", "2.6", "4.6", "5.3", "5.6", "7.1", "7.2", "7.4", "7.6", "13.3"] },
    { "id": 4, "tasks": ["2.7", "2.8", "2.9", "2.10", "2.11", "2.12", "2.13", "3.4", "4.7", "4.8", "5.7", "7.3", "7.5", "7.7", "7.8", "7.11"] },
    { "id": 5, "tasks": ["3.5", "3.6", "4.9", "4.12", "7.12"] },
    { "id": 6, "tasks": ["4.13", "5.2", "13.5"] },
    { "id": 7, "tasks": ["5.4", "5.5", "7.9"] },
    { "id": 8, "tasks": ["7.10", "7.13"] },
    { "id": 9, "tasks": ["7.14", "7.15", "7.16", "7.17", "8.1", "13.1"] },
    { "id": 10, "tasks": ["8.2", "8.3", "8.4", "13.2"] },
    { "id": 11, "tasks": ["10.1", "10.5"] },
    { "id": 12, "tasks": ["10.2", "10.3", "10.6", "10.7", "10.9", "11.1"] },
    { "id": 13, "tasks": ["10.4", "10.8", "10.10", "10.11", "10.12", "11.2", "11.3"] },
    { "id": 14, "tasks": ["11.4"] },
    { "id": 15, "tasks": ["11.5", "13.4"] },
    { "id": 16, "tasks": ["11.6", "14.1", "14.2"] },
    { "id": 17, "tasks": ["14.3", "16.1"] },
    { "id": 18, "tasks": ["16.2", "16.3", "16.4", "17.1"] },
    { "id": 19, "tasks": ["17.2", "17.4"] },
    { "id": 20, "tasks": ["17.3"] },
    { "id": 21, "tasks": ["17.5"] },
    { "id": 22, "tasks": ["17.6"] }
  ]
}
```
