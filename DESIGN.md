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
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontWeight: 600
    letterSpacing: "-0.034em"
  title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "2.25rem"
    fontWeight: 600
    lineHeight: 1.08
    letterSpacing: "-0.034em"
  section-title:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "-0.03em"
  figure:
    fontFamily: "Space Grotesk, system-ui, sans-serif"
    fontSize: "2.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.034em"
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
  panel-y: "24px"
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
    padding: "24px"
  tile-live:
    backgroundColor: "{colors.spring}"
    textColor: "{colors.ink-dark}"
    rounded: "{rounded.md}"
    padding: "16px 20px 24px"
---

# Design System: Macro

## Overview

**Creative North Star: "The Test Bench"**

Macro looks like a well-kept test bench: a dark evergreen field where the instrument readings are the only bright things. The evergreen ground and its two surface steps hold everything; spring green marks the one live or primary thing on a screen, and large light-weight figures carry the numbers people came for. The same token world runs the landing site (persuade) and the legal and 404 pages (read), both on Tailwind CSS v4 in `landing.css`, and the app workspace (operate, Tailwind CSS v4 + shadcn/ui on Base UI in `tailwind.css` mapped onto `tokens.css`). The rest of this document describes the app workspace; the landing, legal and 404 pages share the tokens but follow their own rules in `docs/landing.md` (no hairlines or monospace, one stage-band motif).

Dark is the default (the HTML ships `data-theme="dark"`); light is a full alternate theme on cream, chosen per person and stored in the browser (`macro-theme`). Every token exists in both, and print styles (`@media print`) lock the Capacity Report deliverable onto the light cream palette.

**Key Characteristics:**
- Flat cards and panels with zero box shadows; depth comes from three tonal steps, 1px hairline borders, a frosted sticky **Top Context Bar**, and subtle Bayer-dithered Sanok atmospheric accents (`220px` header band behind `<main>` and `92px` card banners).
- Permanent dark-evergreen desktop rail (`#001e2b` / `#21313a`) in both Light and Dark themes with a monochrome `M` `BrandMark`, so **`+ New test`** is the single spring-green focal point in the rail.
- One accent, spring green, used as a fill. Where the accent must be text, a chart line, or a focus ring, it becomes forest in light mode.
- Numbers lead: page titles and headline figures in Space Grotesk 600 (`-0.034em` tracking), controls and prose in Stack Sans Text (`400` / `500`, with `strong, b { font-weight: 500; }` preventing faux-bold), and instrument readouts, IDs, quotas, and SVG axis ticks in self-hosted Geist Mono (`tabular-nums`).
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

**Display Font:** Space Grotesk 600 (self-hosted, OFL)
**Body Font:** Stack Sans Text 400 and 500 (self-hosted, OFL; `strong, b` locked to `500` to avoid browser faux-bold)
**Telemetry & Code Font:** Geist Mono 400 (self-hosted, OFL), with `tabular-nums` for numerical readouts, quotas, latencies, timestamps, IDs, hosts, routes, paths, hashes, and SVG axis ticks.

### Hierarchy
- **Display** (600, fluid on the landing page): landing headlines.
- **Title** (600, `2.25rem` desktop / `1.75rem` at `<= 860px`, line-height `1.08`, tracking `-0.034em`): app page titles and run headings, anchored by the compact `StageBand` (`1 : 2 : 4 : 8`) motif.
- **Figure** (600, `2.75rem`, line-height `1`, tracking `-0.034em`): live tile readings; the completed report's **Safe Capacity** figure scales up with `clamp(3rem, 2.4rem + 2.2vw, 5rem)`.
- **Heading** (500, `1.0625rem`, line-height `1.3`): panel and section headings in the app.
- **Body** (400, `0.9375rem`, line-height `1.5`): app text; prose blocks capped at `64ch`–`72ch`.
- **Label** (400/500, `0.8125rem`): table headers, key-value terms, tile labels; never uppercase-tracked.
- **Telemetry Readout** (Geist Mono 400, `tabular-nums`, `11px`–`0.875rem`): quota counters (`N of M` left), run IDs, stage indices, latencies, and chart axis ticks.

### Named Rules
**The Readings Rule.** Space Grotesk 600 is for titles and signature figures only; controls, labels, and prose stay in Stack Sans Text, and instrument metrics/identifiers use Geist Mono with `tabular-nums`.

## Layout & Breakpoints

The workspace uses three primary responsive thresholds checked across `1440px`, `1180px`, and `860px`:

- **Desktop (`>= 1180px`, checked at `1440px`):** A permanent dark-evergreen sticky collapsible left rail (`240px` expanded, `64px` collapsed icon-only, preference persisted in `localStorage` under `macro.railCollapsed.v1`) sits beside a flex column holding the frosted sticky **Top Context Bar**, a `220px` CSS-switched Bayer-dithered atmospheric header band (`sanok-trucks.webp` light / `dark-horizon.webp` dark, hidden in print) behind `<main>` (centered up to `1440px` with `40px` horizontal padding), and the footer. Task pages (**Test Studio**, **Containment Probe**) render a two-column split (`minmax(0, 1fr)` main + `minmax(300px, 380px)` sticky right sidebar). KPI tiles (`SignatureTiles` and `KpiStrip`) render 4-up, and the Overview telemetry board renders the `RouteChart` beside the `What happened` feed.
- **Compact Desktop / Tablet (`861px`–`1179px`, checked at `1180px` / below `1180px`):** The desktop rail remains sticky on the left, while two-column splits stack to a single column with the sidebar last, KPI tiles switch to 2-up (`sm:grid-cols-2`), the Overview board stacks vertically, and **Test Studio** displays a fixed bottom `ApproveBar` (`left: var(--rail)`) whenever the **Approve & Run** gate scrolls out of view.
- **Mobile (`<= 860px`, checked at `860px`):** The desktop rail hides and becomes a sticky **MobileTopBar** with a **Quick Jump** button and a menu trigger opening a left-side `Sheet` containing full navigation, active target status, theme toggle, account controls, and legal links. The `/api/quota` readout hides from the **Top Context Bar**, page titles step down from `2.25rem` to `1.75rem`, `<main>` padding tightens to `24px 16px 0`, and Journey tables stack each row into a 2-column card. At `< 640px`, KPI tiles stack 1-up.

## Telemetry Framing & Elevation

Flat by default: zero box shadows anywhere (`@theme` zeroes all `--shadow-*` and `--inset-shadow-*`). Depth is strictly tonal (`bg`, `surface`, `surface-2`) plus 1px hairline framing:
- **1px Hairline Grid Frames:** Structural separators (`--surface-2`) frame the rail, top context bar, meta strips, KPI strip dividers, and table rows; interactive controls, inputs, and overlay surfaces (`Dialog`, `Sheet`, `DropdownMenu`) use `1px` `--bar` borders (or `--bar-hover` on `surface-2` backgrounds to keep >= 3:1 non-text contrast).
- **Corner Ticks (`CornerTicks`):** Key `TelemetryPanel` frames, KPI tiles, and verdict banners use subtle 1px hairline corner ticks (`--bar`, `--accent-text`, `--bad`, or `--primary-foreground/60` on spring green) to anchor readings like a bench oscilloscope.
- **Tabulated Monospace Readouts:** Quotas (`N of M` left), IDs, hostnames, durations, latencies, and chart axis ticks use **Geist Mono** (`tabular-nums`) so numbers never jitter as digits update.

## Shapes

One corner language: `6px` (`rounded-md`) on buttons, panels, tiles, inputs, dialogs, and bars; `4px` (`rounded-sm`) on badges, progress tracks, keyboard hints, and table wrappers. Stage bars stand on a baseline with rounded tops only (`4px 4px 0 0`).

## Components & App Screens

### Shell Navigation
- **Desktop Rail & Mobile Sheet:** Permanent dark-evergreen desktop rail (`#001e2b` / `#21313a`) in both themes with monochrome `M` `BrandMark` + wordmark, spring-green **New test** button (`#/`), quiet navigation links (**Test Studio** `#/`, **Runs Table** `#/runs`, **Containment Probe** `#/probe`, **Domains** `#/domains`, **Account** `#/account` or `#/sign-in`), and footer legal links (**About Macro**, **Privacy**, **Terms**). Current route gets `#21313a` fill, `#ffffff` text, and a subtle hairline indicator (never spring green). Collapsing on desktop shows `Tooltip` labels on icons.
- **Top Context Bar:** Single-line `59px` frosted sticky header (`var(--ap-glass)`, `backdrop-filter: blur(14px)`) aligned seamlessly with the `59px` rail brand header, showing `Macro / <Screen Title>` breadcrumb (`15px` Geist Mono, truncated cleanly), active target host and `Demo` / `Verified` badge (plus a pending verification link to `#/domains` when present), `/api/quota` planning and daily run counters (`Plans left N of M`, `Runs left N of M` in Geist Mono, labelled `per IP` when signed out, hidden at `<= 860px`), and `34px`-tall **Quick Jump** trigger (`Ctrl+K` / `⌘K`), theme toggle, and static informational email pill when signed in (`Sign in` link when signed out; account management lives in the **Account** rail route). Never duplicates rail routes as tabs.
- **Atmospheric Dither Accents:** `220px` CSS-switched Bayer-dithered header band behind `<main>` (`sanok-trucks.webp` light / `dark-horizon.webp` dark, covered by `--ap-scrim`) and `92px` Bayer-dithered banner strips with frosted mono captions on `GateSidebar`, `ProbeStart`/`Probe`, `Domains`, and `SignIn` (all `print:hidden`).
- **Quick Jump (`Ctrl/Cmd+K`):** Instant-open (`duration-0`, `overscroll-contain`) keyboard-driven `CommandDialog` listing main routes (including **Domains** `#/domains`), recent runs (`/api/account/runs` when signed in, browser storage when signed out), and global actions (**New test**, **Toggle theme**, **Sign in** / **Sign out**), with loop navigation and clean focus restoration when dismissed.

### Test Studio (`#/`)
- **Left Column:** **Traffic Description** composer with header Hybrid AI availability badge (`On-Device Model: Gemini Nano` / `Cloud Model: Gemini`), `aria-pressed` example tabs, live code-point counter, one-click **Refine with Scenario Assistant**, and dark-ink **Draft a plan** button (plus **After you draft** and **30-day demo baseline** below on Demo Target). Once drafted, folds into `PlanBrief` + `PlanReview` (**Policy Gate** status badge, stage bars with full-width expandable table, journey table, and `JourneyChecks`), with always-open **Model calls** spanning full-width below the two-column grid.
- **Sticky Right Column (`GateSidebar`):** Before drafting, shows `GateRules` (with flush dither banner) + **Sample report** on Demo Target. Once drafted, merges into a single unified **Policy Gate Verdict** card (flush dither banner, verdict badge, Turnstile, spring-green **Approve & Run** — swapping to **Revise the plan** whenever route checkboxes change — **Cancel**, and always-open **What the policy gate allows** limits footer; `ApproveBar` docks at bottom `< 1180px` when off-screen).

### Live Run & Capacity Report (`#/run/:id?tab=overview|stages|ai|audit`)
- **Tabs & Sticky KPI Strip:** `?tab=overview|stages|ai|audit` (unknown values fall back to `overview`). **AI Insights & Report Q&A** stays disabled while the run is live (`available when the report is ready`). Scrolling past the full **SignatureTiles** on Overview or switching to another tab reveals the sticky one-line **KPI Strip** above the tabs (`stage-or-safe`, `p95-or-breaking`, `error-or-route`, `safe-or-peak` with source stage/limit notes).
- **Overview:** Four **SignatureTiles** (spring green highlights the live running stage with `TileProgress`, then **Safe Capacity** at display scale when ended), restyled hand-written SVG `RouteChart` (`p95 latency per route` using semantic strokes and Geist Mono ticks) beside `What happened` feed (`Feed`), `StageProfile` bar, `ReportMeta`, CSV & Print/PDF `ReportExport`, and `Run again and compare` (`RunsPanel`, using a Base UI `Dialog` confirmation modal for **Run this plan again?**), which fetches `/api/compare` and embeds `CompareView` inline alongside an **Open full compare view** link (`#/compare/:a/:b`).
- **Stages & Routes:** `LiveStages` / `ReportStages` with expandable per-stage route breakdowns and per-second SVG `SecondChart` (`During the stage`).
- **AI Insights & Report Q&A:** AI-labelled explanation and suggestions (`AiSection`) plus **Report Q&A** (`ReportQa`) with pre-flight `HybridAvailabilityBadge`, `HybridStopButton`, and client-side Number Guard verification on completed replies.
- **Audit Log:** **Policy Gate** & plan approval metadata, **Supervisor** decisions, containment events, and always-open `Model calls`.

### Runs Table (`#/runs`) & Run Compare (`#/compare/:a/:b`)
- **Runs Table:** Loads `/api/account/runs` (up to 50) when signed in or browser recent runs (up to 10) when signed out; supports client-side search (plan name or run ID), type filter (`All`, `Load tests`, `Probes`), status filter (`All`, `Completed`, `Running`, `Stopped / Halted`, `Failed`), and two-row checkbox selection gating **Compare selected runs**.
- **Run Compare:** Shared `CompareView` component used both at `#/compare/:a/:b` and inline in Capacity Report `RunsPanel`; handles loading skeletons, error retries, `"Different plans"` warning banner when plan IDs differ, baseline vs later summary cards, headline comparison, and per-stage comparison tables.

### Containment Probe, Domains, Sign-in & Account
- **Containment Probe (`#/probe`, `#/probe/:id`):** Full-width launch panel with flush dither banner, runtime/cap mono badges, Turnstile + **Run containment probe**, and baseline-aligned `(a)`–`(e)` escape-attempt table; live probe polling/SSE feed, spring-green passed verdict (`5/5 actions contained`), and actions/containment tables.
- **Domains (`#/domains`, aliases `#/verify`, `#/verify-panel`):** Two-column layout (`VerifyPanel` + **How own-site testing works** on the left; **Domain rules & limits** sticky sidebar on the right) enforcing one verified HTTPS origin per account via Domain Connect, DNS TXT (`_macro-verify`), or `/.well-known/macro-site-verification`.
- **Sign in (`#/sign-in`) & Account (`#/account`):** Google / GitHub OAuth links, accessible magic-link email form (`aria-invalid`, `aria-describedby`, cooldown badge), two-column signed-in layout (**Session active** + **Delete account** `ConfirmButton` on the left; **Account & data** sticky sidebar on the right), and a shared **Sign out?** `Dialog` confirmation across all sign-out triggers.

## Buttons, Badges & Inputs
- **Buttons (`40px` default height, `6px` radius):** Primary spring-green fill with evergreen ink (`scale(0.97)` active, disabled in `motion-reduce`); Quiet/Secondary (`surface-2` with `--bar-hover` border where needed); Outline (`bg-background` with `--bar` border); Danger (solid `--bad` fill with `--bg` ink). Focus ring: `3px` `--accent-text` outline with `3px` offset (`--primary-foreground` on spring green).
- **Badges (`4px` radius, `0.75rem`/500):** `1px` border and text in tone colour (`ok`, `warn`, `destructive`, `outline`); `live` uses spring-green fill with evergreen text. Status words always accompany colour.
- **Inputs:** Ground-coloured (`--bg`) field with `1px` `--bar` border and `6px` radius; focus uses `--accent-text` ring.

## Do's and Don'ts

### Do:
- **Do** name the source of every number on screen (which stage, which limit).
- **Do** keep status words next to every colour signal.
- **Do** use the shared `tokens.css` / `tailwind.css` semantic tokens for any new surface in both themes.

### Don't:
- **Don't** add box shadows or glows; keep frosted glass strictly limited to the sticky **Top Context Bar** and `DitherBanner` caption chips.
- **Don't** put a badge or label above a heading as an eyebrow (the compact `StageBand` motif is the only header accent).
- **Don't** use spring green as text on a light ground; use forest (`--accent-text`).
- **Don't** show internal requirement terms (`Supervisor_Agent`, `Stop_Thresholds`) in copy.
- **Don't** emit `<style>` tags or inline `style=""` attributes (enforced by `CSP style-src 'self'` and `build-web-check.ts`).
