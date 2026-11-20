# Macro

Macro turns a plain-English traffic description into a safe, policy-gated load test and capacity report.

## Core Load Testing

**Traffic Description**:
The plain-English summary of expected load that a user submits to the planner.
_Avoid_: Prompt, scenario text

**Test Plan**:
A structured sequence of 1 to 6 load-test stages, target routes, and stop thresholds drafted from a traffic description.
_Avoid_: Script, config, job

**Policy Gate**:
The deterministic rule check that accepts or rejects a test plan before it can be approved or executed.
_Avoid_: Validator, AI filter

**Approved Plan**:
A test plan accepted by the policy gate and locked by its content hash so execution matches what the user reviewed.
_Avoid_: Draft plan, active plan

**Run**:
A single execution of an approved plan across its stages, from start to terminal verdict.
_Avoid_: Job, execution, test session

**Stage**:
One step within a run that applies a fixed virtual-user count and duration against the target.
_Avoid_: Phase, round

**Supervisor**:
The between-stage advisor that recommends whether to continue or stop a run based on measured stage metrics.
_Avoid_: Monitor, controller

**Safe Capacity**:
The highest virtual-user stage in a run that completed without breaching stop thresholds.
_Avoid_: Max load, peak capacity

**Breaking Point**:
The first stage in a run where latency, error rate, or HTTP 429 thresholds fail.
_Avoid_: Crash point, failure limit

**Capacity Report**:
The final summary of a run combining measured stage and route metrics with an optional AI explanation.
_Avoid_: Summary, dashboard

**Number Guard**:
The check that withholds AI-generated report text if it cites any number not present in the measured metrics.
_Avoid_: Hallucination filter, fact checker

**Containment Probe**:
A fixed, on-demand run that verifies the sandbox blocks disallowed network egress, metadata access, secret discovery, and memory over-allocation.
_Avoid_: Security scan, health check

**Demo Target**:
The allowlisted YUE demo shop (`yue.macro.my.id`) available for signed-out load tests and containment probes.
_Avoid_: Sandbox site, test server

**Own Site**:
A user-owned HTTPS origin verified via DNS TXT or `/.well-known/` for private authenticated load tests.
_Avoid_: Custom target, external site

## Hybrid AI

**Hybrid Inference**:
Client-side AI execution that prefers an on-device model when the browser supports it and falls back to a cloud model otherwise.
_Avoid_: Local LLM, browser AI, client planner

**On-Device Model**:
The browser-hosted Gemini Nano model used for local inference without network round-trips or server quota consumption.
_Avoid_: Local model, edge model

**Cloud Fallback**:
The remote Gemini model invoked automatically when an on-device model is unavailable or unsupported.
_Avoid_: Server fallback, remote model

**Scenario Assistant**:
The pre-submission helper in the Test Studio that refines a user's traffic description into a clearer draft without calling the server planner.
_Avoid_: Prompt optimizer, auto-planner

**Report Q&A**:
The AI-labelled question-and-answer panel on a completed capacity report, grounded in that run's measured stage and route metrics.
_Avoid_: Report chat, AI summary

## App Workspace

**Test Studio**:
The app's home screen (`#/`) where a user picks a target, writes a traffic description, reviews the policy gate verdict and stage preview, and approves the plan to start a run.
_Avoid_: Composer, new test page, editor

**Runs Table**:
The filterable list of runs at `#/runs`, sourced from the signed-in account's runs or, when signed out, this browser's recent runs.
_Avoid_: History, dashboard, run log

**Run Compare**:
The side-by-side view of two runs' capacity reports at `#/compare/:a/:b`, flagging when the runs used different plans.
_Avoid_: Diff, benchmark

**Quick Jump**:
The `Ctrl/Cmd+K` menu that jumps to app routes and recent runs and runs a few global actions.
_Avoid_: Command palette, search, spotlight

**Top Context Bar**:
The sticky workspace header displaying the active target host and `Demo` / `Verified` badge, desktop `/api/quota` counters, Quick Jump trigger, theme toggle, and account menu.
_Avoid_: Navbar, toolbar

**KPI Strip**:
The compact single-line telemetry summary anchored above tabs when scrolling past the full Capacity Report signature tiles or viewing secondary tabs, preserving source stage and limit notes.
_Avoid_: Ticker, status bar
