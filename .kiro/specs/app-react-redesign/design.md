# Phase 1: the Macro app in React, redesigned

## Goal

Rebuild the planner app (today plain TypeScript in `web/*.ts`, served at `/app/`) in React 19 + Vite with the landing page's visual world and the chosen "Live board" structure. Keep every function, state, copy rule and accessibility behaviour listed in [inventory.md](inventory.md). Build it at `/app-next/` and switch `/app/` over only when every screen is done and reviewed locally.

Design direction: `.impeccable/surfaces/web-landing-app-next-index-html.md` (direction contract) and the chosen sketch `.impeccable/mocks/decision/live-board.html`. Product truth: `PRODUCT.md`.

## Decisions

| Topic | Decision | Why |
| --- | --- | --- |
| Project | A third page in the existing landing Vite project: `web/landing/app-next/index.html`, code in `web/landing/src/app/`. Output `web/dist/app-next/index.html`. | One React/Vite setup, shared fonts, tokens and theme code; the build script already runs this project. |
| Rendering | Client-rendered SPA (no prerender). The HTML shell has a static loading line and a noscript message. | Every screen depends on live API data. |
| Routing | Hash routes, the same as today: `#/` new test, `#/run/<id>`, `#/probe/<id>`, plus `#/runs` (recent runs). `parseRoute` keeps today's id rules. | Old shared links (`/app/#/run/<id>`) keep working after the switch. |
| Pure logic | Imported from the existing modules (`web/api.ts`, `run-view.ts` model functions, `report-view.ts` view models, `compare-view.ts` rows, `chart.ts` geometry, `probe-view.ts` wording, `recent-runs.ts` storage). At the switch they move into `web/landing/src/app/lib/` and the DOM code is deleted. | No behaviour drift; the DOM builders tree-shake away. |
| Live data | One `useRun(id)` hook owns snapshot load, the event stream, the 5 s poll, stale detection, end grace and report wait, using `modelFromSnapshot`, `applyEvent`, `mergeSnapshot`, `shouldPoll`, `isStale` unchanged. Probe keeps its own 1 s poll hook. | The rules are already tested by use; React only renders the model. |
| Turnstile | `web/turnstile.ts` unchanged, wrapped in a `<Turnstile>` slot component that passes its container element. | One widget at a time, same lifecycle. |
| Styling | Shared `tokens.css` (fonts, both palettes, base, focus, selection) split out of `styles.css` and imported by the landing CSS and `app.css`. App CSS uses the operate scale: fixed rem steps, Stack Sans Text for UI, Stack Sans Headline 300 only for big numbers and page titles. | Same world, product-appropriate type. |
| Theme | Dark default, light toggle, same `theme.ts` and storage key as the landing page. | One preference across the site. |
| CSP | No style attributes (CSS variables through `el.style.setProperty` in effects); untrusted text rendered as React text only, never `dangerouslySetInnerHTML`. | Same rules as today. |
| Live board truth | Metrics exist per finished stage. Live tiles name their stage: "Stage 3 of 4 running", "p95 at stage 2", "Safe capacity so far". | The sketch showed a "p95 now" the server does not send. |
| Report in place | When the run ends the board turns into the report on the same page: the lime tile becomes Safe capacity, the next tiles Breaking point and First degraded route; tables, AI section, re-run and compare follow below. | The signature move in the direction contract. |

## Screens

- **Shell**: skip link, side rail (Macro, New test, Live run when one is open, Recent runs, Containment probe, theme toggle, footer links About Macro, Privacy, Terms), live region, focus to main on navigation, document titles as today. Phone: the rail collapses to a top bar with a menu button.
- **New test** (`#/`): the describe form, examples, target line, Turnstile, Draft a plan and Retry planning, then the review in place (draft plan, rejected, not approvable and no-policy states, plan, journey, thresholds, model calls, approve panel with Approve and run and Cancel). Runtime problem notice.
- **Run** (`#/run/<id>`): header with plan name, target, status, stale badge and Stop run; live tiles; p95 per route chart (from finished stages) with the stop limit; decisions and containment feed; stage strip; full stage table. After the end: report headline in the tiles, notices, chart, stage and route tables, decisions, containment events, AI section, model calls, re-run with confirm, runs of this plan with compare.
- **Probe** (`#/probe/<id>`): running state, result with score and verdict, the five actions table, containment events, "What each action does".
- **Recent runs** (`#/runs`): the browser's recent runs with live status, plus a Start the containment probe action.

## Out of scope

Accounts, domain verification and user-defined routes (Phase 2). A cross-plan "all runs" list needs a new endpoint and is not part of Phase 1.
