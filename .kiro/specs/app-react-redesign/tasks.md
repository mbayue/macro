# Tasks: Phase 1, the Macro app in React

Standing rule: commit locally after each task; do not push or deploy until the user has reviewed `/app-next/` locally and says ship.

- [x] 1. Foundation
  - [x] 1.1 Split `tokens.css` out of `web/landing/src/styles.css`; landing and legal pages render unchanged.
  - [x] 1.2 Add `web/landing/app-next/index.html` (+ entry `src/app/main.tsx`) to the Vite build; serve `/app-next/` from `src/server.ts`; guard the old-hash redirect in `landing-early.js` to `/` only.
  - [x] 1.3 Shell: router (`parseRoute`, titles, focus and announce on navigation), side rail and phone top bar, skip link, live region, theme toggle, config load with loading and error states, not-found page.
  - [x] 1.4 Shared components: Button, Badge (status words, never colour alone), Alert (`ApiError` rendering incl. retry time, daily reset and active run link), Table with scroll region, KeyValue list, Turnstile slot, Spinner line.
- [x] 2. New test screen: form, counter and problems, examples, Turnstile, draft, retry, all review branches, approve and cancel, runtime notice, announcements and focus.
- [x] 3. Run screen, live: `useRun` hook (snapshot, stream, poll, stale, grace, report wait, stop), header and Stop run, live tiles, stage strip, decisions and containment feed, stage table, reason box, recent-runs write.
- [x] 4. Run screen, report in place: headline tiles, notices, chart from `buildChartGeometry` as React SVG, stage and route tables, decisions, events, AI section, model calls, re-run with confirm, runs of this plan, compare picker and comparison tables.
- [x] 5. Probe screen: load, 1 s poll and stream, running state, result, actions table, events, explanations, end announcement, redirects.
- [x] 6. Recent runs screen and the rail's recent list (status lookup, forget on not found).
- [x] 7. Responsive and themes: 1440, 1280 and 390 widths in dark and light; keyboard pass; reduced motion.
- [x] 8. Finish: impeccable detector run, finish review, fixes, DESIGN.md.
- [ ] 9. Switch: serve the new app at `/app/`, move pure logic into `src/app/lib/`, delete the old `web/*.ts` views, `web/index.html` and `web/style.css`, update the build script and README. Local review, then ship on the user's word.
