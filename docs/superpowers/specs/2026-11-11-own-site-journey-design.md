# Own-site journey discovery

**Status:** draft, for review. Supersedes the assumption that every target uses the Yue route catalog. Demo shop and the containment probe stay on that catalog.

## Problem

An own-site plan is gated at approve against the verified origin, then rejected at start. `loadApprovedPlan` runs `evaluatePlan` against `config.target.allowlist` (Yue). The k6 script is built with Yue web and API origins. The sandbox proxy allowlist is those same hosts.

The planner only offers the six Yue routes, and its prompt calls the target a shop. A non-shop origin such as `https://sketch.my.id` never receives a request that matches its files. `GET /` on that host is a small HTML shell. The bytes are the linked script, the linked stylesheet, and image paths named as string literals in the script. k6 does not run JavaScript, so it will not discover those URLs itself.

The model must not fetch the site. Page text is untrusted data, and a fetch tool would let the model request hosts the account has not verified.

## What ships

1. **Remember the origin chosen at approve.** An own-site run stores the verified origin as both web and API origin, plus the route rows discovered for that plan. Start uses that allowlist and those routes. If the account's verified origin is different or gone when the run starts, the run fails. It does not fall back to Yue.
2. **The server reads the site before the model runs.** Seed is `GET /` on the verified origin only. From that document, keep same-origin script and stylesheet URLs. Fetch at most four scripts. From those scripts, keep quoted static asset paths. The model receives that table and may only return those ids, each with a probability and a think time.
3. **The script is still the fixed template.** Own-site routes are GET. No `{productId}` replacement, no order body. The proxy for that run allows the verified hostname and not the Yue hosts.

Demo (`targetMode` omitted or `demo`) is unchanged: catalog, Yue origins, no discovery, no `plan_targets` row.

## Discovery

`discoverOwnSite(origin, fetchImpl)` in `src/plan/discover.ts`. `fetchImpl` is injectable. No clock besides the timeout below.

Limits, exact:

| Name | Value |
| --- | --- |
| Timeout | 5000 ms |
| Document body | 262144 decoded bytes. One more byte fails the discovery. |
| Script body | 524288 decoded bytes. Over the cap, skip that script. |
| Script fetches | 4, document order |
| Routes | 32 |
| Path length | 200 characters |

Request rules:

- HTTPS, the verified origin only. `redirect: 'manual'`. Do not read a `Location` header. Do not follow.
- Document: status 200 and `content-type` contains `text/html`. Anything else fails discovery. A 3xx fails discovery.
- Script: status 200 and `content-type` contains `javascript` or `ecmascript`. Else skip that script. A 3xx skips that script.
- Stylesheet URLs are recorded and not fetched.

Path rules, applied to every recorded path:

- Starts with `/`. No scheme, no host, no `?`, no `#`, no `\`.
- Length 1 to 200.
- No segment is `.` or `..`, and the string does not contain `..`.
- Asset paths extracted from scripts also end in `.js`, `.css`, `.webp`, `.png`, `.jpg`, `.jpeg`, `.svg`, or `.woff2`.

Document references:

- `<script src>` and `<link>` whose `rel` contains `stylesheet`, from `href`.
- Ignore `data:`, `javascript:`, empty, and protocol-relative (`//`).
- Absolute URL: keep only when `new URL(value).origin === origin`.
- Other relative URLs resolve against `origin + '/'`, then the same path rules.

Script literals: quoted strings matching a single static path (`/` + segments of `[A-Za-z0-9._~-]` + one of the suffixes above). Then the path rules. Do not execute the script. Do not request the asset URLs.

Order, then ids `r1`…`rN`: the document `/` if present, scripts sorted by path, styles sorted by path, assets sorted by path. Dedupe by path. Past 32, drop assets from the end, then styles, then scripts. Never drop `/`.

Failure of the document fetch is the whole discovery. There is no catalog fallback. Public error, one sentence, no response body: `Could not read ${origin}/. Nothing was sent to the planner.` Log the internal reason only.

## What the model may do

Own-site system prompt does not call the target a shop and does not mention `order_create`. It includes the discovered table (`id`, `kind`, `method`, `path`). The tool's `journey[].route` is an enum of those ids.

Sizing text, exact:

`Include the document, each script, and each style. For routes whose kind is asset, use at most two steps and a probability from 5 to 20.`

Policy is unchanged when no route set is passed. When a route set is passed, rule 4.3 accepts only ids in that set. Message: `route "<id>" is not in the discovered routes`.

## What is stored

Discovery result is written on the planning draft (`origin`, `routes_json`) before the model runs. It is not part of the plan text, so the model cannot invent a path.

`POST /api/approve` with `targetMode: "own"` requires `draftId`. The server loads that draft and rejects unless every journey id is in the draft's routes and `plan.target` equals the draft origin and the caller's current verified origin. Public message: `This plan's routes do not match the routes read from the site.`

On accept, insert `plan_targets`:

- `plan_hash` primary key, referencing `plans(hash)`
- `web_origin`, `api_origin` (both the verified origin)
- `routes_json` (the draft's discovered rows)

Demo approve writes no `plan_targets` row. A missing row means Yue and the catalog, including plans approved before this change.

A draft has no user id. Approve still requires the caller to own the draft's origin, so another account cannot use it. One origin has one owner.

## Start-time checks

`loadApprovedPlan` for a hash with `plan_targets`:

- Allowlist is `[web_origin]`, not `config.target.allowlist`.
- Route set is `routes_json`.
- The run's `owner_user_id` must still have that verified origin. Else fail with `The verified origin changed before the run started.`
- Script origins are `web_origin` and `api_origin`.
- Proxy allow-hosts for that run is the verified hostname only.

`readSummary`, `firstDegradedRoute`, and `buildReport`'s per-route rows take the stored id order. Without it they keep catalog order, so demo reports stay the same. `RouteRowView.route` widens to `string`.

`StageMetrics.routes` and `Headline.firstDegradedRoute` widen from `RouteId` to `string`. Catalog ids still type-check.

## API the UI needs

`PlanResponse.routes` and `RunSnapshot.routes`: `{ id, path, method, kind }[]`. Empty for demo. Own-site kind is `document`, `script`, `style`, or `asset`. The journey table and the run page show `path` for those ids. Demo keeps looking up `config.catalog`.

Copy under the My site control, exact:

`Macro reads / on your site, then the scripts that page links, and uses those files as the journey. It does not run the page.`

## Non-goals

- The model fetching or browsing.
- A user-typed path list. Seed is `/` only.
- Following links, reading `sitemap.xml`, or executing JavaScript.
- Fetching stylesheets or image bytes at plan time.
- CSS `url()` extraction.
- POST, `{productId}`, or `order_create` on own-site.
- Changing the demo catalog, the probe, or unsigned demo runs.
