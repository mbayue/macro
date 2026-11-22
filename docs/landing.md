# Landing pages

The prerendered pages under `web/landing/src/` outside `app/`: home, privacy, terms and 404. `/app/` follows `DESIGN.md` instead; where the two disagree (display typeface, frosted glass cap, framing radius), these rules win on landing pages.

## Design

The home page follows the **Atmospheric Telemetry** direction (`#22`): Bayer-dithered Sanok bridge photography on warm cream (`#fdfff5`) in light mode and a dithered green horizon on deep evergreen (`#001e2b`) in dark mode, paired with an interactive embedded Macro Workbench and the **stage band** motif (four filled segments sized 1 : 2 : 4 : 8 for the four Stages: 25, 50, 100, 200 VUs). Legal and 404 pages stay clean editorial pages sharing the typography, color tokens, header, and compact single-row footer without full-bleed dithered backdrops.

House rules, checked in review (the mechanical ones also by `validateWebSource`, see Checks):

- **Typography:** `Space Grotesk 600` (self-hosted at `/landing/fonts/space-grotesk-600.woff2`, shared via `tokens.css`) for display headlines (`h1`, `h2`, `-0.036em` tracking); `Stack Sans Text` (`400` / `500`, with `strong, b` pinned to `500` and `font-synthesis-weight: none` to prevent faux-bolding) for body copy and UI controls; `Geist Mono 400` (`tabular-nums`, `/landing/fonts/geist-mono-400.woff2`) for telemetry readouts, identifiers, badges, and quotas.
- **Single deliberate accent:** Spring green (`#00ed64`) is reserved for the primary CTA (**Try the Demo Target** / **Open Test Studio**) and the active **Safe Capacity** reading. Navigation marks stay monochrome, secondary buttons use `--surface` or `--ink`, and active tabs use tonal `surface-2`.
- **Two-tier radius & glass cap:** `--radius` (`6px`, plain `rounded`) for controls, KPI tiles, subpanels, and tags; `--radius-frame` (`12px`) for the floating header, hero workbench shell, and editorial plates. Frosted glass (`backdrop-filter: blur`) is capped at 2 elements: the floating header and the hero workbench frame.
- **Theme colour utilities only:** `bg surface surface-2 ink muted bar accent accent-ink accent-text accent-hover accent-ink-soft bad ui-bg ui-line ui-field white refusal forest`. New fixed colours become named tokens in `landing.css`.
- **Honest copy & evidence:** Product names follow `GLOSSARY.md` exactly (Test Studio, Policy Gate, Approved Plan, Stage, Supervisor, Safe Capacity, Breaking Point, Capacity Report, Number Guard, Containment Probe, Demo Target, Own Site, Hybrid Inference, On-Device Model, Cloud Fallback, Scenario Assistant, Report Q&A). Every figure comes from real measured `run d28cacd6` on `yue.macro.my.id`. No em dash characters in copy.
- **Sanok bridge analogy:** All four Wikimedia Commons CC BY-SA 4.0 photos by Marsilar (`trucks`, `span`, `static`, `workers`) ship as lossless Bayer-dithered WebPs under `public/landing/img/dither/` (`src/sanok.ts`) and are credited in `SiteFooter`.

## Building blocks

- Stylesheet entry: `landing.css` (Tailwind v4 on `tokens.css`, declaring `Space Grotesk 600` and `Geist Mono 400`). Phone layout is the base; desktop goes under `split:` (860 px) or media queries in `@layer components`.
- `components/StageBand.tsx`: `<StageBand upTo size tone />`; `STAGE_SEGMENTS` is the single source of the 1 : 2 : 4 : 8 weights.
- `pages/Home.tsx` lists the 5 beats in page order:
  1. `HeroWorkbench` (island): floating nav + `ThemeToggle`, dithered hero backdrop (switched via CSS `dark:block` / `dark:hidden` for zero hydration flash), H1 + CTAs, and fixed-height (`520px` desktop) 3-tab interactive workbench (`Capacity Report` matching `/app/`'s 4-KPI + `What happened` feed, 2-column `Policy Gate` with real 500 VU cap and in-place `Draft a plan` / `Approve & Run`, and `Containment 5/5` with real `(a)`–`(e)` checks) with clickable `/app/`-matched left rail.
  2. `Pipeline` (island): 4-node deterministic execution chain (`01 Traffic Description` -> `02 Policy Gate` -> `03 gVisor + Egress Proxy` -> `04 Number Guard`).
  3. `SanokProof` (island): 4 interactive Bayer-dithered Sanok bridge plates (fixed caption `min-height: 102px` to prevent height jumps) + Hybrid Inference & Number Guard quote + real `d28cacd6` per-route p95 breakdown (`store_home`, `catalog_list`, `product_detail`).
  4. `LimitsFaq` (static HTML): two stacked sections: `#vd-limits` (early-access `$0` Self-host and Hosted cards with Bayer-dithered strips above a full-width `Demo Target` vs. `Own Site` table) followed by `#vd-faq` (2x2 grid of 4 open product-specific FAQs with mono topic headers).
  5. `Close` (static HTML): dithered closing CTA backdrop + `SiteFooter` (compact single-row footer).
- Entrance motion: `data-reveal` (and `data-i` for stagger) handled by `reveal.ts`; content stays visible if the script fails. Motion uses transform and opacity only; `prefers-reduced-motion: reduce` disables press/entrance transforms.
- CSP: no `style=` or `<style>`. Dynamic bar heights use `data-bar` attributes or CSS custom properties set in an effect.
- Conditional classes are template literals; `cn()` lives in `/app/` and would pull clsx and tailwind-merge into the landing bundle.

## Checks

- `bun run build:web` runs `validateWebSource` and `validateWebDist` (`scripts/build-web-check.ts`): CSP, no `/app/` stylesheets on landing pages, landing class rules (no `#rrggbb` or `rounded-[...]` in class names, no em dashes), the `rounded` utility exists in the built CSS, and the weight budget (landing JS 24 KiB, CSS under 36 KiB per page).
- Renderer tests: `test/landing/`, in `bun run test:web`.
- Screenshots: `bun scripts/shots.ts --help` (headless Edge over CDP).
