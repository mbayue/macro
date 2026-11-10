# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers and site owners who need to know how much traffic their site can take before a launch, a sale, a campaign or a mention. Any kind of site, not only shops (confirmed). They run a test, watch it, and read the result to decide whether the site is ready and what to fix first.

## Product Purpose

Macro turns a plain-words description of expected traffic into a safe, measured load test. The AI drafts a staged plan, a fixed policy gate checks it, the user approves it, and k6 runs each stage in a fresh gVisor sandbox while the user watches. The report gives the safe capacity, the breaking point and the first route to slow down. Success: the user trusts the numbers and knows what to do next.

## Positioning

The model proposes, code decides. The target, limits, script, sandbox settings, stop rules and every number in the report come from fixed code; AI text is checked against the measured numbers and withheld when a number does not match. The load can only reach a verified site, and the containment probe demonstrates the sandbox blocking escape attempts on demand.

## Operating Context

A session: describe the traffic, review and approve the plan, watch a run of a few minutes (stages of increasing virtual users, supervisor decisions between stages, containment events), read the capacity report, then re-run the same approved plan and compare two runs. The containment probe is a separate, shorter flow. Runs and probes have public links; the recent-runs list is kept in the browser.

## Capabilities and Constraints

- Today the live demo can only test one target: the demo shop at yue.macro.my.id. Testing your own site needs domain verification, which is not built yet (Phase 2). Copy must not imply it works today.
- Every action that costs money or load (draft plan, approve, re-run, probe) requires Cloudflare Turnstile; there are per-IP and daily limits.
- Strict CSP: no inline scripts, no style attributes. Untrusted text (user input, AI output) is rendered as text, never HTML.
- The planner app is React 19 + Vite at /app/, next to the landing site.
- Confirmed: the app is the tool only (new test, live run, report with re-run and compare, probe, recent runs); the intro and the policy gate demo live on the landing page.
- Confirmed: desktop first (people watch a run of several minutes), and every screen must work on a phone.

## Brand Commitments

- Name: Macro. Domain macro.my.id. Contact hello@macro.my.id.
- Voice: plain, specific, measured; no hype, no buzzwords, no em dashes in copy.
- The app must match the landing page (web/landing): its visual world is binding.
- Open source, MIT License, github.com/mbayue/macro. Free during early access; no paid plans shown.

## Evidence on Hand

Real runs on the demo shop (for example run d28cacd6: store_home p95 1,611 ms at 200 users against a 1,500 ms limit), the containment probe result (5 of 5 contained), and screenshots in web/landing/public/landing/img. No customers, testimonials or benchmarks exist; do not invent them.

## Product Principles

1. Show what was measured, and say where each number came from.
2. Nothing reaches a site until the user approves; make that moment unmistakable.
3. Fixed rules decide; the AI's part is always labelled as the AI's.
4. Honest states: running, stale, stopped, failed and withheld are shown as they are, never smoothed over.
5. One task at a time: the screen serves the step the user is on.

## Accessibility & Inclusion

WCAG 2.2 AA in both themes: text contrast 4.5:1, non-text 3:1, keyboard operable, visible focus, live regions for run progress, status never by colour alone, reduced motion respected.
