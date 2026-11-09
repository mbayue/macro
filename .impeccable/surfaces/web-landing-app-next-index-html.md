---
version: 1
slug: "web-landing-app-next-index-html"
primary_target: "web/landing/app-next/index.html"
related_targets: ["web/landing/src/app"]
---

# Surface brief: the Macro app (/app/)

Scope: the whole app at /app/, rebuilt in React 19 + Vite (built at /app-next/ until it replaces /app/). Visitor mode: Operate.

Audience and job: developers and site owners about to face a traffic spike. Job: describe the traffic, approve a staged plan, watch it run for a few minutes, read the capacity report, re-run and compare; occasionally run the containment probe.

Constraints: every current function, state and accessibility behaviour is kept (inventory in the Phase 1 spec). Strict CSP (no inline style attributes; CSS variables through the CSSOM). Demo target only; copy never implies testing your own site works today. Desktop first; every screen works at 390px.

## Direction contract

THESIS: A run is watched, so the run page is a live board: the answers the report exists for (p95 against the limit, errors, safe capacity) lead as large numbers that fill in stage by stage while the test runs. Metrics exist only per finished stage, so every live number names the stage it came from. Refuses the category default of a stack of equal grey panels and tables.

OWN-WORLD: the landing page's world. Soot ground (#0f0f0f, surfaces #1a1a1a / #262626), lime #dafa9c as the one live/primary colour, light theme as the alternate; Stack Sans Headline 300 for large numbers and page titles, Stack Sans Text for everything else; 6px radius, flat surfaces, no shadows, no gradients. State colours (ok green, warn amber, bad red) only where they carry meaning, always with words.

STORY: The user sees at a glance whether the site is holding, what Macro decided and why, and that the sandbox stayed contained; they can stop the run at any moment and trust every number because its source is named.

FIRST VIEWPORT: left side rail (Macro, New test as the lime primary, Live run, All runs, Containment probe, then Recent runs). Main: title and target line with Stop run at the right; a row of four live tiles: the running stage filled lime (users, seconds into the stage, a progress fill), then p95 and error rate of the last finished stage against their limits, then safe capacity so far; a per-route p95 chart with the dashed stop limit, beside a feed of supervisor decisions and containment events; the stage strip along the bottom with the running stage outlined lime.

FORM: Live board, position 3 on the ordered structure list; seed: seed:bda9d858a64f55b3.

SIGNATURE MOVE: the lime tile follows the answer: while running it is the stage in progress, and when the run ends it becomes the report's headline (safe capacity), with breaking point and first degraded route taking the next tiles, so the run page turns into the report in place instead of navigating away.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Exact chart treatment for runs with more than three routes.
- Whether "All runs" lists runs across plans (needs a server endpoint; today runs are listed per plan).
