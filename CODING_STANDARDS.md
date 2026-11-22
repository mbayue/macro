# Coding Standards

Review-time engineering standards for Macro. Mechanical syntax bans are enforced by `bun run check` and `bun run build:web` (`scripts/build-web-check.ts`); this document covers cross-file judgement calls and conventions.

## Domain Vocabulary

- UI headings, navigation links, buttons, badges, and test descriptions must use the canonical terms in `GLOSSARY.md`: **Test Studio**, **Runs Table**, **Run Compare**, **Capacity Report**, **Approve & Run**, **Containment Probe**, **Quick Jump**, **Top Context Bar**, and **KPI Strip**.
- Translate internal backend or specification identifiers (`Supervisor_Agent`, `Stop_Thresholds`, `Number_Guard`) into plain glossary wording before displaying them in user-facing copy.

## `/app/` Telemetry & Design System (`DESIGN.md`)

These apply to the workspace under `web/landing/src/app/`. Landing pages (home, privacy, terms, 404) follow `docs/landing.md` instead.

- **Source attribution:** Every KPI tile and **KPI Strip** cell must name its source (for example `"from stage N"` or threshold limit notes).
- **Monospace telemetry:** Numerical readouts, quotas (`N of M` left), IDs, hostnames, durations, latencies, UTC timestamps, and SVG chart axis ticks/labels use `font-mono` with `tabular-nums`.
- **The One Live Thing Rule:** Spring green (`#00ed64`) marks only the live running stage or primary action on screen (**Approve & Run**, passed **Containment Probe** banner, live **Safe Capacity** reading).
- **The Forest Swap Rule:** Use `--accent-text` (`spring` in dark mode, `forest` in light mode) whenever the accent appears as text, chart stroke, or focus ring.
- **Layout-neutral live regions & synced shell transitions:** Keep empty `role="alert"` / `aria-live` containers out of flex/grid flow (`sr-only` when empty) so they never inject phantom bottom gaps, and animate collapsible shell columns on the parent grid (`grid-template-columns`) rather than on `<aside>` width independently.

## Landing pages (`docs/landing.md`)

- Each section reads as one composition built from the stage band, filled tiles and tone steps; a section that falls back to a card grid or a generic layout is a finding.
- Copy claims only what the product does today, with real numbers and their source (run d28cacd6, the probe result).
- Shared spacing, headings and press feedback come from the `landing.css` component classes rather than repeated utility strings.

## Both

- **Strict CSP (`style-src 'self'`):** Keep markup free of `<style>` tags and `style=` props/attributes. Drive dynamic bar or meter geometry through CSS custom properties updated via DOM refs in `useEffect`.

## React 19 & Base UI Composition

- Read contexts with React 19 `use(Context)` rather than `useContext`, and accept `ref` as a standard prop rather than `forwardRef`.
- Compose `@base-ui/react` primitives (`Button`, `TooltipTrigger`, `DropdownMenuTrigger`) with the `render` prop (`render={<a href="..." />}` and `nativeButton={false}` on non-button elements).
- Place accessible `DialogTitle` / `SheetTitle` elements inside every overlay `DialogContent` / `SheetContent` root.
- Define all React components at module scope so parent re-renders preserve child identity and state.
- In `/app/`, merge conditional utility classes with `cn()` from `@/lib/utils`, and reuse shared helpers in `web/landing/src/app/lib/` (`reducedMotion`, `layoutRouteEndLabels`, `routeDash`) and `ShellContext` actions instead of duplicating component logic. Landing pages use template literals and `src/motion.ts` (see `docs/landing.md`).
