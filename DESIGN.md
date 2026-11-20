---
name: Macro
description: Load tests that stay contained. One world for the landing site, the legal pages and the app.
colors:
  evergreen: "#001e2b"
  evergreen-surface: "#061621"
  evergreen-surface-2: "#21313a"
  evergreen-bar: "#616c6d"
  cream: "#fdfff5"
  cream-surface: "#f1f5eb"
  cream-surface-2: "#e4e8e0"
  cream-bar: "#616c6d"
  ink-dark: "#001e2b"
  ink-light: "#ffffff"
  muted-dark: "#9ea2a1"
  muted-light: "#404f54"
  spring: "#00ed64"
  forest: "#00684a"
  spring-ink-soft: "#014e3d"
  ok-dark: "#00ed64"
  ok-light: "#00684a"
  warn-dark: "#f2c46d"
  warn-light: "#7a4e00"
  bad-dark: "#ff8a80"
  bad-light: "#b3261e"
typography:
  display:
    fontFamily: "Stack Sans Headline, system-ui, sans-serif"
    fontWeight: 300
    letterSpacing: "-0.022em"
  title:
    fontFamily: "Stack Sans Headline, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  section-title:
    fontFamily: "Stack Sans Headline, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 300
    lineHeight: 1.1
    letterSpacing: "-0.02em"
  figure:
    fontFamily: "Stack Sans Headline, system-ui, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 300
    lineHeight: 1
    letterSpacing: "-0.03em"
  heading:
    fontFamily: "Stack Sans Text, system-ui, sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 500
    lineHeight: 1.3
  body:
    fontFamily: "Stack Sans Text, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Stack Sans Text, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
  chart-text:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 400
  code:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "0.92em"
  telemetry:
    fontFamily: "Geist Mono, ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontWeight: 400
    fontVariantNumeric: "tabular-nums"
rounded:
  badge: "4px"
  md: "6px"
spacing:
  tile-gap: "8px"
  panel-x: "24px"
  panel-y: "20px"
  section: "24px"
components:
  button-primary:
    backgroundColor: "{colors.spring}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    height: "40px"
    padding: "0 16px"
  button-quiet:
    backgroundColor: "{colors.evergreen-surface-2}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.md}"
    height: "40px"
  button-on-spring:
    backgroundColor: "{colors.ink-dark}"
    textColor: "{colors.ink-light}"
    rounded: "{rounded.md}"
    height: "40px"
  panel:
    backgroundColor: "{colors.evergreen-surface}"
    rounded: "{rounded.md}"
    padding: "20px 24px"
  tile-live:
    backgroundColor: "{colors.spring}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "16px 20px 24px"
---

# Design System: Macro

## Overview

**Creative North Star: "The Test Bench"**

Macro looks like a well-kept test bench: a dark evergreen field where the instrument readings are the only bright things. The evergreen ground and its two surface steps hold everything; spring green marks the one live or primary thing on a screen, and large light-weight figures carry the numbers people came for. The same token world runs the landing site (persuade) and the legal and 404 pages (read), both on Tailwind CSS v4 in `landing.css`, and the app workspace (operate, Tailwind CSS v4 + shadcn/ui on Base UI in `tailwind.css` mapped onto `tokens.css`).

Dark is the default (the HTML ships `data-theme="dark"`); light is a full alternate theme on cream, chosen per person and stored in the browser (`macro-theme`). Every token exists in both, and print styles (`@media print`) lock the Capacity Report deliverable onto the light cream palette.

**Key Characteristics:**
- Flat surfaces, zero shadows, zero gradients; depth comes strictly from three tonal steps and 1px hairline borders.
- One accent, spring green, used as a fill. Where the accent must be text, a chart line, or a focus ring, it becomes forest in light mode.
- Numbers lead: page titles and headline figures in Stack Sans Headline 300, controls and prose in Stack Sans Text, and instrument readouts, IDs, quotas, and SVG axis ticks in self-hosted Geist Mono (`tabular-nums`).
- State colours (`ok`, `warn`, `bad`) only where they carry meaning, always accompanied by status words.
- Strict CSP compliance (`style-src 'self'`): zero inline `<style>` tags and zero `style=""` attributes; dynamic bar geometry (`StageProfile`, `TileProgress`) updates CSS custom properties via DOM refs.

## Colors

An evergreen ground paired with a single spring-green accent, mirrored on cream in light mode.

### Primary
- **Spring green** (`#00ed64`): the primary button, the live running stage tile, the **Safe Capacity** hero tile, the **Approve & Run** gate panel, and the passed **Containment Probe** banner. A fill, never body text on a light ground.
- **Forest** (`#00684a`): the accent as text, marker, chart line, and focus ring in light mode (6.76:1 on cream). In dark mode, spring green itself plays this role (10.89:1 on evergreen).
- **Spring ink soft** (`#014e3d`): secondary text on a spring-green fill (6.16:1 on `#00ed64`).

### Neutral
- **Evergreen** (`#001e2b`), **Evergreen Surface** (`#061621`), **Evergreen Surface 2** (`#21313a`): dark ground, panels and rails, then rows and hovers.
- **Cream** (`#fdfff5`), **Cream Surface** (`#f1f5eb`), **Cream Surface 2** (`#e4e8e0`): the same three steps in light mode.
- **Bar** (`#616c6d` both themes; hover `#9ea2a1` dark, `#404f54` light): input borders, chart bars, and quiet chart lines. On `surface-2` (`#21313a`) in dark mode, interactive borders step up to `--bar-hover` (`#9ea2a1`, 5.20:1) to exceed 3:1 non-text contrast.
- **Muted** (`#9ea2a1` dark, `#404f54` light): labels, captions, secondary text; both exceed 4.5:1 on every surface.

### Named Rules
**The One Live Thing Rule.** On any screen, spring green marks one thing: the primary action, or the answer that matters now (the running stage, then **Safe Capacity**). A second spring-green area must be the next step of the same task, never decoration.
**The Forest Swap Rule.** If the accent is text, a line, or a focus ring, use `--accent-text`: spring green in dark mode, forest in light mode.

## Typography

**Display Font:** Stack Sans Headline 300 (self-hosted, OFL)
**Body Font:** Stack Sans Text 400 and 500 (self-hosted, OFL)
**Telemetry & Code Font:** Geist Mono 400 (self-hosted, OFL; preloaded only in `/app/`), with `tabular-nums` for numerical readouts, quotas, latencies, timestamps, IDs, hosts, routes, paths, hashes, and SVG axis ticks.

### Hierarchy
- **Display** (300, fluid on the landing page only): landing headlines.
- **Title** (300, `2.25rem` desktop / `1.75rem` at `<= 860px`, line-height `1.1`): app page titles and run headings.
- **Figure** (300, `2.75rem`, line-height `1`): live tile readings; the completed report's **Safe Capacity** figure scales up with `clamp(3rem, 2.4rem + 2.2vw, 5rem)`.
- **Heading** (500, `1.0625rem`, line-height `1.3`): panel and section headings in the app.
- **Body** (400, `0.9375rem`, line-height `1.5`): app text; prose blocks capped at `64ch`–`72ch`.
- **Label** (400/500, `0.8125rem`): table headers, key-value terms, tile labels; never uppercase-tracked.
- **Telemetry Readout** (Geist Mono 400, `tabular-nums`, `11px`–`0.875rem`): quota counters (`used/limit`), run IDs, stage indices, latencies, and chart axis ticks.

### Named Rules
**The Readings Rule.** Headline 300 is for titles and signature figures only; controls, labels, and prose stay in Stack Sans Text, and instrument metrics/identifiers use Geist Mono with `tabular-nums`.

## Layout & Breakpoints

The workspace uses three primary responsive thresholds checked across `1440px`, `1180px`, and `860px`:

- **Desktop (`>= 1180px`, checked at `1440px`):** A sticky collapsible left rail (`240px` expanded, `64px` collapsed icon-only, preference persisted in `localStorage` under `macro.railCollapsed.v1`) sits beside a flex column holding the sticky **Top Context Bar**, `<main>` (centered up to `1600px` with `40px` horizontal padding), and the footer. Task pages (**Test Studio**, **Containment Probe**) render a two-column split (`minmax(0, 1fr)` main + `minmax(300px, 380px)` sticky right sidebar). KPI tiles (`SignatureTiles` and `KpiStrip`) render 4-up, and the Overview telemetry board renders the `RouteChart` beside the `What happened` feed.
- **Compact Desktop / Tablet (`861px`–`1179px`, checked at `1180px` / below `1180px`):** The desktop rail remains sticky on the left, while two-column splits stack to a single column with the sidebar last, KPI tiles switch to 2-up (`sm:grid-cols-2`), the Overview board stacks vertically, and **Test Studio** displays a fixed bottom `ApproveBar` (`left: var(--rail)`) whenever the **Approve & Run** gate scrolls out of view.
- **Mobile (`<= 860px`, checked at `860px`):** The desktop rail hides and becomes a sticky **MobileTopBar** with a **Quick Jump** button and a menu trigger opening a left-side `Sheet` containing full navigation, active target status, theme toggle, account controls, and legal links. The `/api/quota` readout hides from the **Top Context Bar**, page titles step down from `2.25rem` to `1.75rem`, `<main>` padding tightens to `24px 16px 0`, and Journey tables stack each row into a 2-column card. At `< 640px`, KPI tiles stack 1-up.

## Telemetry Framing & Elevation

Flat by default: zero box shadows anywhere (`@theme` zeroes all `--shadow-*` and `--inset-shadow-*`). Depth is strictly tonal (`bg`, `surface`, `surface-2`) plus 1px hairline framing:
- **1px Hairline Grid Frames:** Structural separators (`--surface-2`) frame the rail, top context bar, meta strips, KPI strip dividers, and table rows; interactive controls, inputs, and overlay surfaces (`Dialog`, `Sheet`, `DropdownMenu`) use `1px` `--bar` borders (or `--bar-hover` on `surface-2` backgrounds to keep >= 3:1 non-text contrast).
- **Corner Ticks (`CornerTicks`):** Key `TelemetryPanel` frames, KPI tiles, and verdict banners use subtle 1px hairline corner ticks (`--bar`, `--accent-text`, `--bad`, or `--primary-foreground/60` on spring green) to anchor readings like a bench oscilloscope.
- **Tabulated Monospace Readouts:** Quotas (`used/limit`), IDs, hostnames, durations, latencies, and chart axis ticks use **Geist Mono** (`tabular-nums`) so numbers never jitter as digits update.

## Shapes

One corner language: `6px` (`rounded-md`) on buttons, panels, tiles, inputs, dialogs, and bars; `4px` (`rounded-sm`) on badges, progress tracks, keyboard hints, and table wrappers. Stage bars stand on a baseline with rounded tops only (`4px 4px 0 0`).

## Components & App Screens

### Shell Navigation
- **Desktop Rail & Mobile Sheet:** Macro monogram + wordmark, spring-green **New test** button (`#/`), quiet navigation links (**Test Studio** `#/`, **Runs Table** `#/runs`, **Containment Probe** `#/probe`, **Account** `#/account` or `#/sign-in`), and footer legal links (**About Macro**, **Privacy**, **Terms**). Current route gets `surface-2` fill, foreground text, and a hairline `--accent-text` bar indicator. Collapsing on desktop shows `Tooltip` labels on icons.
- **Top Context Bar:** Sticky header showing the active target host and `Demo` / `Verified` badge (plus a pending verification link to `#/verify-panel` when present), `/api/quota` planning and daily run counters (`used/limit` in Geist Mono, labelled `per IP` when signed out, hidden at `<= 860px`), **Quick Jump** trigger (`Ctrl+K` / `⌘K`), theme toggle, and account dropdown (`Sign in` when signed out; identity, links, and `Sign out` when signed in).
- **Quick Jump (`Ctrl/Cmd+K`):** Keyboard-driven `CommandDialog` listing main routes, recent runs (`/api/account/runs` when signed in, browser storage when signed out), and global actions (**New test**, **Toggle theme**, **Sign in** / **Sign out**), restoring focus cleanly when dismissed.

### Test Studio (`#/`)
- **Left Column:** **Target environment** picker (**Demo Target** vs **Own Site** with inline `VerifyPanel` for DNS TXT / `/.well-known/` / Domain Connect verification), **Traffic description** composer with live code-point counter, example buttons, and **Scenario Assistant** (`HybridBadge` for on-device Gemini Nano / cloud Gemini), folding into `PlanBrief` + `PlanReview` (**Policy Gate** verdict, stage bars, journey table, `JourneyChecks`, and `Model calls`) once drafted.
- **Sticky Right Column (`GateSidebar`):** **Policy Gate** verdict summary, collapsible/expanded `GateRules` (`Target`, stage/VU/duration bounds, route catalog), `Stage & VU preview`, and spring-green **Approve & Run** gate with Turnstile inside (`ApproveBar` docks at bottom `< 1180px` when off-screen).

### Live Run & Capacity Report (`#/run/:id?tab=overview|stages|ai|audit`)
- **Tabs & Sticky KPI Strip:** `?tab=overview|stages|ai|audit` (unknown values fall back to `overview`). **AI Insights & Report Q&A** stays disabled while the run is live (`available when the report is ready`). Scrolling past the full **SignatureTiles** on Overview or switching to another tab reveals the sticky one-line **KPI Strip** above the tabs (`stage-or-safe`, `p95-or-breaking`, `error-or-route`, `safe-or-peak` with source stage/limit notes).
- **Overview:** Four **SignatureTiles** (spring green highlights the live running stage with `TileProgress`, then **Safe Capacity** at display scale when ended), restyled hand-written SVG `RouteChart` (`p95 latency per route` using semantic strokes and Geist Mono ticks) beside `What happened` feed (`Feed`), `StageProfile` bar, `ReportMeta`, CSV & Print/PDF `ReportExport`, and `Run again and compare` (`RunsPanel`), which fetches `/api/compare` and embeds `CompareView` inline alongside an **Open full compare view** link (`#/compare/:a/:b`).
- **Stages & Routes:** `LiveStages` / `ReportStages` with expandable per-stage route breakdowns and per-second SVG `SecondChart` (`During the stage`).
- **AI Insights & Report Q&A:** AI-labelled explanation and suggestions (`AiSection`) plus **Report Q&A** (`ReportQa`) grounded strictly in measured report metrics.
- **Audit Log:** **Policy Gate** & plan approval metadata, **Supervisor** decisions, containment events, and collapsible `Model calls`.

### Runs Table (`#/runs`) & Run Compare (`#/compare/:a/:b`)
- **Runs Table:** Loads `/api/account/runs` (up to 50) when signed in or browser recent runs (up to 10) when signed out; supports client-side search (plan name or run ID), type filter (`All`, `Load tests`, `Probes`), status filter (`All`, `Completed`, `Running`, `Stopped / Halted`, `Failed`), and two-row checkbox selection gating **Compare selected runs**.
- **Run Compare:** Shared `CompareView` component used both at `#/compare/:a/:b` and inline in Capacity Report `RunsPanel`; handles loading skeletons, error retries, `"Different plans"` warning banner when plan IDs differ, baseline vs later summary cards, headline comparison, and per-stage comparison tables.

### Containment Probe, Sign-in & Account
- **Containment Probe (`#/probe`, `#/probe/:id`):** Five escape-attempt cards `(a)`–`(e)`, sticky run panel with Turnstile, live probe polling/SSE feed, spring-green passed verdict (`5/5 actions contained`), and actions/containment tables.
- **Sign in (`#/sign-in`) & Account (`#/account`):** Google / GitHub OAuth links, accessible magic-link email form (`aria-invalid`, `aria-describedby`, cooldown badge), signed-in identity grid, and two-step inline `ConfirmButton` for permanent account deletion.

## Buttons, Badges & Inputs
- **Buttons (`40px` default height, `6px` radius):** Primary spring-green fill with evergreen ink (`scale(0.97)` active, disabled in `motion-reduce`); Quiet/Secondary (`surface-2` with `--bar-hover` border where needed); Outline (`bg-background` with `--bar` border); Danger (transparent with 1px `--bad` border). Focus ring: `3px` `--accent-text` outline with `3px` offset (`--primary-foreground` on spring green).
- **Badges (`4px` radius, `0.75rem`/500):** `1px` border and text in tone colour (`ok`, `warn`, `destructive`, `outline`); `live` uses spring-green fill with evergreen text. Status words always accompany colour.
- **Inputs:** Ground-coloured (`--bg`) field with `1px` `--bar` border and `6px` radius; focus uses `--accent-text` ring.

## Do's and Don'ts

### Do:
- **Do** name the source of every number on screen (which stage, which limit).
- **Do** keep status words next to every colour signal.
- **Do** use the shared `tokens.css` / `tailwind.css` semantic tokens for any new surface in both themes.

### Don't:
- **Don't** add shadows, gradients, glass, or glows.
- **Don't** put a badge or label above a heading as an eyebrow.
- **Don't** use spring green as text on a light ground; use forest (`--accent-text`).
- **Don't** show internal requirement terms (`Supervisor_Agent`, `Stop_Thresholds`) in copy.
- **Don't** emit `<style>` tags or inline `style=""` attributes (enforced by `CSP style-src 'self'` and `build-web-check.ts`).
