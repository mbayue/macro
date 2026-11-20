# Coding Standards

Review-time engineering standards for Macro. Mechanical syntax bans are enforced by `bun run check` and `bun run build:web` (`scripts/build-web-check.ts`); this document covers cross-file judgement calls and conventions.

## Domain Vocabulary

- UI headings, navigation links, buttons, badges, and test descriptions must use the canonical terms in `GLOSSARY.md`: **Test Studio**, **Runs Table**, **Run Compare**, **Capacity Report**, **Approve & Run**, **Containment Probe**, **Quick Jump**, **Top Context Bar**, and **KPI Strip**.
- Translate internal backend or specification identifiers (`Supervisor_Agent`, `Stop_Thresholds`, `Number_Guard`) into plain glossary wording before displaying them in user-facing copy.

## Telemetry & Design System (`DESIGN.md`)

- **Source attribution:** Every KPI tile and **KPI Strip** cell must name its source (for example `"from stage N"` or threshold limit notes).
- **Monospace telemetry:** Numerical readouts, quotas (`used/limit`), IDs, hostnames, durations, latencies, UTC timestamps, and SVG chart axis ticks/labels use `font-mono` with `tabular-nums`.
- **The One Live Thing Rule:** Spring green (`#00ed64`) marks only the live running stage or primary action on screen (**Approve & Run**, passed **Containment Probe** banner, live **Safe Capacity** reading).
- **The Forest Swap Rule:** Use `--accent-text` (`spring` in dark mode, `forest` in light mode) whenever the accent appears as text, chart stroke, or focus ring.
- **Strict CSP (`style-src 'self'`):** Keep markup free of `<style>` tags and `style=` props/attributes. Drive dynamic bar or meter geometry through CSS custom properties updated via DOM refs in `useEffect`.

## React 19 & Base UI Composition

- Read contexts with React 19 `use(Context)` rather than `useContext`, and accept `ref` as a standard prop rather than `forwardRef`.
- Compose `@base-ui/react` primitives (`Button`, `TooltipTrigger`, `DropdownMenuTrigger`) with the `render` prop (`render={<a href="..." />}` and `nativeButton={false}` on non-button elements).
- Place accessible `DialogTitle` / `SheetTitle` elements inside every overlay `DialogContent` / `SheetContent` root.
- Define all React components at module scope so parent re-renders preserve child identity and state.
- Merge conditional utility classes with `cn()` from `@/lib/utils`, and reuse shared helpers in `web/landing/src/app/lib/` (`reducedMotion`, `layoutRouteEndLabels`, `routeDash`) and `ShellContext` actions instead of duplicating component logic.

## Agent Tooling & Windows Worktrees

- In Windows `pwsh` sessions where `rg` is not on `PATH`, search repository files with `git grep -n -E`.
- When managing git worktrees on Windows with a `node_modules` directory junction, unlink `<worktree>\node_modules` via `cmd /c rmdir "<worktree>\node_modules"` and stop idle subagents before running `git worktree remove`.
- Cap concurrent heavy (`inherit`) implementation subagents to 2 to avoid `429 RESOURCE_EXHAUSTED` quota errors.
