# Landing pages

The prerendered pages under `web/landing/src/` outside `app/`: home, privacy, terms and 404. `/app/` follows `DESIGN.md` instead; where the two disagree (monospace, `cn()`, the accent rules), these rules win on landing pages.

## Design

The page was designed with tasteskill v2 (direction "One motif", brand palette and type kept). Its one motif is the **stage band**: four filled segments sized 1 : 2 : 4 : 8 like the four Stages (25, 50, 100, 200 users). It is the only ornament, and recurs as the hero strip, the slider track, list bullets and the stepped footer wordmark.

House rules, checked in review (the mechanical ones also by `validateWebSource`, see Checks):

- Flat filled tiles separated by tone steps. Lines and 1px outlined boxes appear only inside `data-ui` product fragments and real tables.
- One corner radius: plain `rounded` (`--radius` from `tokens.css`). One button shape: `.site-btn`, plus `.site-btn--ink` on accent fields.
- Theme colour utilities only: `bg surface surface-2 ink muted bar accent accent-ink accent-text accent-hover accent-ink-soft bad ui-bg ui-line ui-field white refusal forest`. New fixed colours become a named token in `landing.css`.
- The text face for everything, numbers included, with `tabular-nums` where figures align. No monospace.
- Headings are plain: no label or badge above them, no 01/02/03 numbering. Every headline fits in two lines at every width (check 390, 860, 1280, 1440, 1920).
- Body text 16px or more, small text 13px or more. No em dash characters in copy.
- No gradients, glows or shadows on resting elements.
- Product names follow `GLOSSARY.md` exactly (Approve & Run, Safe Capacity, Containment Probe, Runs Table, Stage).
- Photos of the Sanok bridge load test are the analogy, never Macro's product; each is credited in the footer (`src/sanok.ts`).

## Building blocks

- Stylesheet entry: `landing.css` (Tailwind v4 on `tokens.css`, no Geist Mono). Phone layout is the base classes; desktop goes under `split:` (860 px).
- Shared classes in `@layer components` of `landing.css`: `.section` (space between sections), `.section-title` (h2 scale), `.press` (press feedback), `.crossfade`. Add a shared class there only when three or more components need it.
- `components/StageBand.tsx`: `<StageBand upTo size tone />`; `STAGE_SEGMENTS` is the single source of the 1 : 2 : 4 : 8 weights.
- `pages/Home.tsx` lists the sections in page order. Interactive sections are islands (`islands.tsx`, hydrated by `entry-home.tsx`); the rest stay static HTML. Add a section as its own component and one line in that list.
- Entrance motion: `data-reveal` (and `data-i` for stagger) handled by `reveal.ts`; content stays visible if the script fails. Motion uses transform and opacity only; `motion.ts` has `prefersReducedMotion`.
- CSP: no `style=` or `<style>`. Dynamic values go through CSS custom properties set in an effect.
- Conditional classes are template literals; `cn()` lives in `/app/` and would pull clsx and tailwind-merge into the landing bundle.

## Checks

- `bun run build:web` runs `validateWebSource` and `validateWebDist` (`scripts/build-web-check.ts`): CSP, no Geist Mono or `/app/` bundles on landing pages, landing class rules (no `#rrggbb` or `rounded-[…]` in class names), the `rounded` utility exists in the built CSS, and the weight budget (landing JS 24 KiB, CSS 36 KiB per page).
- Renderer tests: `test/landing/`, one file per section, in `bun run test:web`.
- Screenshots: `bun scripts/shots.ts --help` (headless Edge over CDP; tasteskill's `inspect.mjs` cannot start Edge on this Windows PC).
