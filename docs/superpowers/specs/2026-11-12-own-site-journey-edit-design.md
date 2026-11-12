# Own-site journey edit

**Status:** draft, for review. Amends `docs/superpowers/specs/2026-11-11-own-site-journey-design.md`. Demo shop and the containment probe stay on the Yue catalog.

## Why

Own-site discovery today reads `GET /`, the scripts and stylesheets that document links, and static files quoted inside those scripts. It does not read the pages the homepage links, so a plan for `https://sketch.my.id` never asks for `/about` or `/product`. k6 does not run the page, so those links are invisible unless the server records them.

The person running the test needs to drop a page, or add a picture the scan already found, without typing a path and without the model fetching the site.

## What they decided

- The edit happens after the first plan, on the plan screen, before approve. The first plan does not run.
- `/` is always on and cannot be removed.
- Pages the homepage already links, plus script and stylesheet URLs taken from the document, start on. Any of them can be turned off.
- Pictures, fonts, and extra files named inside a script start off. Any one can be turned on.
- A page link starts off when its last path segment is exactly `logout`, `log-out`, `signout`, `sign-out`, or `unsubscribe`. It stays in the list. `/cart`, `/checkout`, and `/account` start on.
- The scan reads only the homepage. It does not open `/about` to find more pages, and it does not guess names.
- The person cannot type a path the scan never found.
- **Revise the plan** sends the original description again. The planner writes a new plan using only the rows left on, and it sets visitor shares and pauses again. Approve stays on the plan that matches the checks. Checks that have not been revised yet do not change the plan.

## Scan

Still `discoverOwnSite` in `src/plan/discover.ts`. Same timeouts, body caps, script cap (4), path rules, redirect rule, and origin rule as the 2026-11-11 spec. No new fetch. Page URLs are not requested. Stylesheets are still not fetched. Scripts are still not executed.

New document references: `<a href>` only. Same URL resolution as `<script src>` and stylesheet `<link>`. Ignore `data:`, `javascript:`, empty, protocol-relative, other origins, query strings, and hashes (those already fail `acceptPath`). Ignore buttons and forms.

Kind for a kept anchor:

- Last segment matches the action list below: `page`, and `defaultOn: false`.
- Path ends in `.js`: file it as `script` if that path is not already recorded.
- Path ends in `.css`: file it as `style` if not already recorded.
- Path ends in `.webp`, `.png`, `.jpg`, `.jpeg`, `.svg`, or `.woff2`: file it as `asset`.
- Otherwise: `page`.

Action match: the last segment, compared case-insensitively, is one of `logout`, `log-out`, `signout`, `sign-out`, `unsubscribe`. A longer block list is intentionally not used.

Record order, then ids `r1`…`rN`: `/` as `document`, then page paths in document order, then scripts sorted by path, then styles sorted by path, then assets sorted by path. Dedupe by path. The earlier row wins.

Store every kept row, up to 128. Past 128, drop assets from the end, then styles, then scripts, then pages. Never drop `/`. This ceiling is only so the checkbox list can show pages that would not fit in a 32-route plan. The plan itself still holds at most 32 routes.

`DiscoveredRoute` gains `defaultOn: boolean`.

Default on:

- `document`
- `page`, except an action link
- `script` and `style` that came from the document (including an anchor filed as script or style)

Default off:

- `asset`
- action `page` rows
- any row that would have been on but did not fit in the 32-route selection below

## What the first plan sees

The model does not see the full stored list. It sees the default selection:

1. `/`
2. default-on pages, document order
3. default-on scripts, path order
4. default-on styles, path order

Stop at 32. Rows past that stay in the stored list with `defaultOn` forced false. The plan screen says, only when that happened: `Some pages were left off because a plan holds 32 routes.`

Own-site sizing text replaces the 2026-11-11 asset sentence. Exact:

`Use only the routes in the table. Include the document and each page, script, and style in that table.`

If the user later turns an asset on, that row is in the table and the same sentence still applies. Do not add a separate asset probability rule.

Policy rule 4.3 is unchanged: a journey id must be in the route set passed to that call.

## Edit and replan

The plan response already returns `routes`. Each row includes `defaultOn` and the kind. The plan screen lists them in id order under the plan, in three groups:

- Always in the test: `/`, checkbox on and disabled.
- On, and you can turn them off: rows with `defaultOn` true, except `/`.
- Found, and left off until you turn one on: the rest.

Labels: Page, Script, Stylesheet, Image, Font. An asset ending in `.js` or `.css` is labeled Script or Stylesheet and still starts off, because it was named inside a script rather than linked from the document. Action rows use the Page label plus: `A repeated visit would hit this link.`

Button label, exact: `Revise the plan`.

`POST /api/plan` for `targetMode: "own"` accepts optional `routeIds: string[]` only when the account draft for this origin already has a discovery result. Rules:

- Every id is in that stored list.
- `r1` (`/`) is present.
- Length is 1 to 32.
- No duplicates.

The server plans again with that subset, in stored id order, and the original draft description. It does not read the site again. A bad `routeIds` is 400 with one sentence: `Those routes do not match the pages read from the site.`

Omitting `routeIds` on the first plan uses the default selection. The server writes `selected_ids_json` on the draft next to the full `routes_json`.

If the checks differ from `selected_ids_json`, Approve is disabled. The screen says: `Revise the plan to use these checks.` Reverting the checks re-enables Approve.

Approve still requires every journey id to be in `selected_ids_json`, and `plan.target` to equal the draft origin and the caller's verified origin. The stored `plan_targets.routes_json` is the selected rows only, so a later report lists the routes that were actually in the plan.

Demo requests ignore `routeIds`.

## Non-goals

- Crawling past the homepage, sitemaps, or guessed paths.
- A text field for a path.
- Fetching linked pages, stylesheets, images, or fonts at plan time.
- POST, form buttons, or treating `/cart` as an action.
- A block list beyond the five segments above.
- Changing the demo catalog, the probe, or the 32-route plan cap.

## Calls made here

- Anchor paths that already look like a script, stylesheet, image, or font are filed as that file kind, not as a page.
- Action segments match case-insensitively.
- The checkbox list keeps up to 128 rows. The plan still caps at 32, and overflow default-on rows start off.
- Unrevised checks disable Approve instead of silently approving the previous plan.
- `plan_targets` stores the selected rows, not the rows left off.
