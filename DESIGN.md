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
    fontFamily: "Stack Sans Text, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 400
  code:
    fontFamily: "ui-monospace, SF Mono, Cascadia Mono, Menlo, Consolas, monospace"
    fontSize: "0.92em"
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
    padding: "18px 20px 26px"
---

# Design System: Macro

## Overview

**Creative North Star: "The Test Bench"** (proposed name; change it freely)

Macro looks like a well-kept test bench: a dark evergreen field where the instrument readings are the only bright things. The evergreen ground and its two surface steps hold everything; spring green marks the one live or primary thing on a screen, and large light-weight figures carry the numbers people came for. The same world runs the landing site (persuade), the legal pages (read) and the app (operate); the app keeps it but swaps the landing page's fluid display scale for fixed product steps.

Dark is the default (the HTML ships `data-theme="dark"`); light is a full alternate theme on cream, chosen per person and stored in the browser. Every token below exists in both.

**Key Characteristics:**
- Flat surfaces, no shadows, no gradients; depth comes from three tonal steps.
- One accent, spring green, used as a fill. Where the accent must be text, a line or a focus ring, it becomes forest in light mode.
- Numbers lead: page titles and readings in Stack Sans Headline 300, everything else in Stack Sans Text.
- State colours (ok, warn, bad) only where they carry meaning, always with words.

## Colors

An evergreen field with one spring-green accent, the same colours as mongodb.com.

### Primary
- **Spring green** (#00ed64): the primary button, the live tile, the running stage, the approve panel, the passed-probe result. A fill, never body text on a light ground.
- **Forest** (#00684a): the accent as text, marker, chart line and focus ring in light mode (6.8:1 on cream). In dark mode the spring green itself plays this role.
- **Spring ink soft** (#014e3d): secondary text on a spring-green fill. Forest on spring green is only 4.3:1.

### Neutral
- **Evergreen** (#001e2b), **Evergreen Surface** (#061621), **Evergreen Surface 2** (#21313a): dark ground, panels and rails, then rows and hovers.
- **Cream** (#fdfff5), **Cream Surface** (#f1f5eb), **Cream Surface 2** (#e4e8e0): the same three steps in light mode.
- **Bar** (#616c6d both themes; hover #9ea2a1 dark, #404f54 light): input borders, chart bars and quiet chart lines.
- **Muted** (#9ea2a1 dark, #404f54 light): labels, captions, secondary text; both pass 4.5:1 on every surface.

### Named Rules
**The One Live Thing Rule.** On any screen, spring green marks one thing: the primary action, or the answer that matters now (the running stage, then safe capacity). A second spring-green area must be the next step of the same task, never decoration.
**The Forest Swap Rule.** If the accent is text, a line or a focus ring, use `--accent-text`: spring green in dark mode, forest in light mode.

## Typography

**Display Font:** Stack Sans Headline 300 (self-hosted, OFL)
**Body Font:** Stack Sans Text 400 and 500 (self-hosted, OFL)
**Code Font:** the platform monospace stack, only for real code: ids, hosts, routes, paths, hashes.

**Character:** a narrow, quiet grotesque that lets large readings feel measured rather than loud.

### Hierarchy
- **Display** (300, fluid on the landing page only): landing headlines.
- **Title** (300, 2.25rem, 1.1): app page titles and the plan name.
- **Figure** (300, 2.75rem, 1): tile readings; the report's safe-capacity figure steps up to the landing scale (up to 5.5rem).
- **Heading** (500, 1.0625rem, 1.3): panel and section headings in the app.
- **Body** (400, 0.9375rem, 1.5): app text; prose blocks capped at 72ch.
- **Label** (400, 0.8125rem): table headers, key-value terms, tile labels; never uppercase-tracked.

### Named Rules
**The Readings Rule.** Headline 300 is for titles and numbers only; controls, labels and data stay in Stack Sans Text.

## Layout

The app is a side rail (240px) beside a main column that fills up to 1600px and centres beyond it, so the space left and right stays equal. Task pages split into a main column and a 300 to 380px side column for the rules and actions that belong to the task; the side column is sticky. The run page is a board: four tiles, then the route chart beside the event feed, then the stage strip, then tables. Gaps are 8px between tiles and sibling panels, 16 to 24px between sections. Below 1180px tiles go two-up and the board stacks; below 860px the rail becomes a top bar with a menu, and everything is one column. A one-line footer note sits at the bottom of the screen on short pages and after the content on long ones.

## Elevation & Depth

Flat by default: no shadows anywhere. Depth is tonal (ground, surface, surface 2) plus 1px hairlines in surface 2. Outlines are drawn as inset box-shadows of 1px only where a component needs an edge (danger button, line button, failed result).

## Shapes

One corner language: 6px on buttons, panels, tiles, inputs and bars; 4px on badges and table regions. Bars stand on a baseline with rounded tops only, like the landing page's latency bars.

## Components

### Buttons
- **Shape:** 6px radius, 40px tall in the app (48px on the landing page).
- **Primary:** spring-green fill, evergreen text; hover deepens the green. Press scales to 0.97.
- **Quiet:** surface-2 fill for secondary actions. **Danger:** transparent with a 1px red edge (Stop run). **On spring green:** ink fill or a 1px ink outline (Approve and run, Cancel).
- **Focus:** 3px outline in the accent-text colour, 3px offset; ink on spring-green areas.

### Badges
- **Style:** 1px border and text in the tone colour, 4px radius, 0.75rem/500. Running is a spring-green fill. The word always states the status.

### Panels and tiles
- **Panel:** surface fill, 6px radius, 20px by 24px padding, heading row with a quiet note on the right.
- **Tile:** a panel holding one reading: label, figure, sub-line naming its source. The live tile is spring green with a progress bar along its foot.

### Inputs
- **Style:** ground-coloured field inside a panel, 1px bar-coloured border, 6px radius. **Focus:** 2px accent-text outline and border.

### Navigation
- **Rail:** wordmark, the spring-green New test button, quiet links, then this browser's recent runs, then the theme toggle and legal links. Current item: surface-2 fill and ink text.

### Live board (signature)
- Four tiles; while running the spring-green tile is the stage in progress, and when the run ends the same tiles become the report's headline (safe capacity in spring green at the landing figure scale, breaking point, first degraded route, status). Every live number names the stage it came from.

## Do's and Don'ts

### Do:
- **Do** name the source of every number on screen (which stage, which limit).
- **Do** keep status words next to every colour signal.
- **Do** use the shared `tokens.css` for any new surface, and both themes.

### Don't:
- **Don't** add shadows, gradients, glass or glows.
- **Don't** put a badge or label above a heading as an eyebrow.
- **Don't** use spring green as text on a light ground; use forest.
- **Don't** show internal requirement terms (Supervisor_Agent, Stop_Thresholds) in copy.
