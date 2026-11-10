# Account design — Macro

Date: 2026-11-10  
Status: approved (design only; implementation plan separate)

## Intent

Macro today can only load-test the demo shop (`yue.macro.my.id`). Own-site testing needs a verified origin and a durable owner. Accounts exist so Macro can attach ownership, private reports, verification, and usage caps to a person—not to a browser or IP alone.

Demo shop stays the free, signed-out path. Own-site is the gated path.

## Why now

Task 9 cutover shipped the React planner at `/app/`. The remaining product gap is testing a user's own site. Domain verification without an account has no owner; accounts without verification still cannot leave the demo allowlist. Account comes first; verification rides on it.

## Goals

- Let a person sign in with GitHub or a magic link (Resend).
- Keep demo-shop draft / plan / run / report usable signed out; containment probe stays demo-shop only.
- Make target choice explicit on New test: **Demo shop** or **My site** (host/URL field). Never infer the host from the traffic description.
- Require sign-in before own-site draft or approve.
- Attach drafts, runners, reports, run list, and the verified site to the account after sign-in.
- Prove one replaceable origin per account (DNS TXT or `/.well-known/`).
- Keep own-site runs and reports owner-only.
- Claim this browser's demo runs onto the account at sign-in (reports stay public).
- Persist the in-progress draft on the account so another device can continue it.

## Non-goals (v1)

- Teams / orgs / shared access.
- More than one active verified origin (paid / later).
- Public shareable links for own-site reports.
- Standalone `#/account` or `#/verify` destinations.
- Scheduled re-verification of an already-proven origin.
- Paid plans UI.
- Account linking UI beyond same-email merge of GitHub + magic link.
- Inferring the load-test host from the plain-words description.
- GitHub-only accounts with no email.
- Own-site containment probe (probe stays demo-shop only in v1).

## Anti-goals

- Implying own-site testing works before verification ships.
- Letting a later DNS / `.well-known` check steal an origin another account already holds.
- Privatizing demo-shop reports when they are claimed.
- Killing a live own-site sandbox just because the browser signed out.
- Forcing Turnstile on every signed-in action after the session already exists.

## Target selection (New test)

New test keeps the plain-words traffic description. Target is chosen explicitly — Macro does **not** infer a host from the description.

| Control | Behavior |
| --- | --- |
| **Demo shop** | Target is `yue.macro.my.id`. Usable signed out. No verification. |
| **My site** | User enters a host/URL. Signed out → straight to sign-in, then back to this draft. Signed in → Draft/Approve blocked until that host is the account's verified origin (or they verify it inline). |

## Auth

| Decision | Choice |
| --- | --- |
| Methods | Magic link + GitHub |
| Magic-link email | Resend (API key in env) |
| Same email on both methods | One account (merge by email) |
| GitHub with no usable email | Refuse GitHub sign-in until an email is available (public GitHub email, or they supply one after OAuth). No GitHub-only account without email — that would break same-email merge with magic link. |
| Session | Stay signed in until Sign out; sliding refresh on use |
| Signed-out own-site | Straight to sign-in (no explain-first interstitial) |
| After sign-in | Return to the draft they were writing |
| Sign out | Clear session, leave private pages, land on New test (demo) |
| Sign out during live own-site run | Sandbox keeps running; report stays account-only; Stop is only the Stop control |

Builder may choose cookie name, HttpOnly / Secure / SameSite, CSRF approach, OAuth library, and exact token TTLs, as long as the session policy above holds.

## Ownership and privacy

| Surface | Signed out | Signed in |
| --- | --- | --- |
| Demo shop draft / plan / run / report | Allowed (public reports) | Still allowed; demo does not spend the verified-origin slot; demo reports stay public |
| Containment probe | Demo shop only in v1 | Demo shop only in v1 (own-site probe later) |
| Own-site draft / approve | Blocked → sign-in | Allowed only for the account's verified origin |
| Own-site run / report | N/A | Owner-only (coworkers with the URL cannot see it) |
| Recent run list | Browser-local demo list | Account list across devices |
| Claimed demo runs at sign-in | — | Appear on the account list; URLs stay public |
| Shareable public own-site links | — | Later (out of v1) |

## Drafts across devices

- At Sign in, persist the in-progress draft on the account so another device can open it.
- If the account already has a draft and this browser has a different local draft, keep the newer by last-edited time.
- After sign-in, continuing edits update the account draft.

Builder chooses storage shape (one draft per account vs draft id) and sync timing (on Sign in only vs also while signed in), as long as conflict resolution is newer-by-last-edited.

## Verification

Trigger: user may keep editing an own-origin draft while signed in. **Draft a plan** and **Approve** for a non-demo origin are blocked until that origin is verified. Demo-shop drafts stay free.

UI: verification interrupt stays on the New test flow (inline or panel). Show the token and both proof methods; after success, return to the same draft. No dedicated `#/verify` screen in v1. A later “Change site” control can live in the rail identity slot.

| Decision | Choice |
| --- | --- |
| Methods | DNS TXT **and** `/.well-known/` — same token; either check may pass |
| Slots | One active verified origin per account |
| Demo shop | Does not count against the slot |
| Replace | Allowed: new verify clears the old target; old own-site runs stay readable; drafting/approving against the old host stops until it is verified again |
| Clear without replace | Allowed: drop the verified origin to `none` (demo-only) without verifying a new host. Matches “first verifier keeps until replace or clear.” |
| Contested origin | First verifier keeps it until they replace or clear; a later proof by another account is refused |
| Freshness | Trust until replace; no scheduled re-check in v1 |

Policy / egress: once verified, the allowlist for that account's own-site runs includes that origin (in addition to the demo shop when they choose demo). Fixed policy code decides; AI does not.

Builder chooses exact TXT name / value format, well-known path and body, token entropy, and check timeouts.

## Usage caps and Turnstile

| Who | Cap | Turnstile |
| --- | --- | --- |
| Signed-out demo | Per IP (existing daily / action limits) | Required on costly actions |
| Signed-in | Per account (daily draft / run budget on user id) | Not required; session + account caps gate abuse |

Exact numeric budgets are left to the builder / ops unless product sets them later. Abuse controls must not rely on IP alone for signed-in own-site traffic.

## UI (planner)

Rail foot (same area as theme / legal links):

- Signed out: quiet **Sign in**
- Signed in: compact identity slot — email or GitHub name, verified host or `none`, **Sign out**
- No full Account screen until paid / multi-site needs one
- No popup menu required in v1

Sign-in surface: enough to choose GitHub or enter email for magic link, then continue. After magic link, land back on the saved draft when possible.

Routes: prefer extending the existing hash router (`#/` …). A small `#/sign-in` is fine if needed for OAuth / magic-link return; verification itself stays on New test.

Match existing planner primitives in `web/landing/src/app` (`Shell`, `ui.tsx`, tokens). No new component library.

## Teams

Personal accounts only for v1. No shared verified origin, no coworker seats.

## Constraints (existing product)

- Live demo target today: `yue.macro.my.id` only until verification ships.
- Copy must not claim own-site works before it does.
- Strict CSP: no inline scripts, no style attributes; untrusted text as text.
- WCAG 2.2 AA in both themes; status never by colour alone.
- Voice: plain, specific, measured; no hype; no em dashes in copy.
- Open source MIT; free during early access; no paid plans shown in UI yet.
- “The model proposes, code decides” — verification and allowlisting are fixed code.

## Implementation seams (guidance, not a plan)

Likely touch points when building later (not authorized by this document alone):

- Server: session / OAuth / magic-link routes; Resend send; ownership on plans/runs; claim-on-signin; draft persistence; verification issue + check; policy allowlist by account; account-scoped rate limits; Turnstile skip when session present.
- Client: rail identity slot; sign-in entry; own-site gate → sign-in; inline verify panel on New test; draft sync; hide/redirect private own-site views when signed out.
- Data: user, auth identities (GitHub / email), session, verified origin (unique active host), drafts, run ownership + privacy flag (demo public vs own-site private).

Exact schema, libraries, and file layout are left to the builder.

## Success

A signed-out user can still complete a demo-shop run and a demo-shop containment probe. A signed-in user picks Demo shop or My site explicitly, verifies one site (or clears it back to none), drafts and approves only against that site or the demo shop, sees private own-site reports only while signed in, and picks up a newer draft on another device. GitHub sign-in only completes when Macro has an email for merge. A second account cannot take over an origin the first still holds.

## Open for builder (sensible defaults OK)

- Cookie / session mechanics and TTLs within “until Sign out, sliding”
- OAuth app setup details and callback URLs
- Resend from-address / template copy (plain voice)
- Exact verification token formats and well-known path
- Numeric account daily budgets
- Whether “Change site” is only in the rail slot or also near the target field
- Storage layout for users, drafts, and verified origins

## Out of scope until a later design

- Paid plans and extra verified-origin slots
- Teams / orgs
- Public share links for own-site reports
- Scheduled re-verification
- Full Account settings screen
- Own-site containment probe
