# Macro

**Know your breaking point before your users do.**

Describe the traffic you expect in plain words ("a new banner drops tonight, 500 players open the store, 10% order"). An AI agent drafts a staged load test, fixed code checks it, you approve it, and k6 runs it inside a sandbox that can reach only the demo shop. You get a capacity report: safe capacity, breaking point, and the first route that slowed down.

- Website: **https://macro.my.id** · live demo app: **https://macro.my.id/app/** (no sign-in, protected by Cloudflare Turnstile)

**The model proposes, code decides.** The AI drafts the plan, advises whether to continue after each stage, and explains the result. The target, limits, k6 script, sandbox settings, stop rules and every number in the report come from fixed code.

## How Macro uses Vultr

| Vultr product | Used for |
| --- | --- |
| **Cloud Compute** `macro` (Singapore, 1 vCPU / 2 GB) | Macro API and web UI (Bun), Caddy, the least-privilege Docker socket proxy, the egress proxy, and one gVisor sandbox per load-test stage. |
| **Cloud Compute** `yue-demo` (Singapore, 1 vCPU / 2 GB) | The only allowed target: a demo copy of the YUE web shop (web, API, Postgres, Redis) at `yue.macro.my.id`. |
| **Serverless Inference** | All three agents: Planner, Supervisor and Report Writer. Each call forces a single tool (`propose_plan`, `decide_next_stage`, `write_report`). Model `minimax-m3.1-flash`, with one fallback attempt on `mimo-v2.6-flash`. Every call is shown in the UI with model, latency and tokens. |
| **Firewall** | Inbound 80/443 on `macro` accepts only Cloudflare IP ranges, so the origin can't be reached directly and the client IP header can't be spoofed. Script: [`deploy/macro/vultr-firewall.sh`](deploy/macro/vultr-firewall.sh). |

## Architecture

```mermaid
flowchart LR
  B[Browser] -->|HTTPS| CF[Cloudflare]
  CF --> CD[Caddy]
  subgraph M["Vultr VM: macro"]
    CD --> API["Macro API (Bun)<br/>planner, policy gate, run controller"]
    API -->|least-privilege<br/>Docker API| SP[Socket proxy]
    SP --> DCK[dockerd]
    DCK --> SBX["k6 sandbox (gVisor)<br/>internal network only"]
    SBX -->|"CONNECT host:443"| PX[Egress proxy]
  end
  API -.->|forced tool calls| VI[Vultr Serverless Inference]
  PX -->|allowlisted host only| DT
  subgraph Y["Vultr VM: yue-demo"]
    DT[YUE demo shop]
  end
```

A run, step by step:

1. **Plan.** The Planner turns your description into a staged plan. For the demo shop, it targets the allowlisted store catalog; for verified own-site origins, it plans journeys across routes discovered directly from the site. Your text is passed to the model as untrusted data.
2. **Gate.** A deterministic policy gate checks the plan: exact target match, known routes only, 1 to 6 stages, at most 500 VUs per stage, at most 600 s in total. A rejected plan has no approve button.
3. **Approve.** The approved plan is stored under its SHA-256 hash. The run executes exactly that text, and re-checks the hash and the gate before starting.
4. **Run.** Each stage renders k6 from a fixed template and runs it in a fresh sandbox. Your text never reaches the script.
5. **Supervise.** After each stage the Supervisor answers `continue` or `stop`. A failing stage stops the run whatever the model says.
6. **Report.** All numbers come from k6's measurements. The AI explanation sits in its own section, and any number in it that doesn't match a measured value causes the text to be withheld.

## Containment

| Rule | How Macro enforces it |
| --- | --- |
| Process isolation | k6 runs under gVisor (`runsc`) as a non-root user, with a read-only root filesystem, all capabilities dropped and `no-new-privileges`. The sandbox gets no Docker socket. |
| Network | The sandbox sits on a per-run Docker network with no route out. Its only exit is an egress proxy that allows HTTPS `CONNECT` to the exact allowlisted host on port 443. The proxy refuses IP literals, private, link-local and metadata addresses (`169.254.169.254`), and the Macro VM itself. |
| Docker access | `macro-api` holds no Docker socket. It talks to Docker through a socket proxy ([`deploy/macro/docker-compose.yml`](deploy/macro/docker-compose.yml)) that forwards only the container/network/image-inspect endpoints Macro uses, and answers 403 for everything else: exec, build, image pull, volumes, secrets, swarm. |
| Secret hygiene | The sandbox environment holds only the proxy address. API keys live in the `macro-api` container only. |
| Resource limits | 1 GiB memory with no swap, 1 CPU, 256 processes. A sandbox that runs past the stage time plus 30 s is killed. |
| Lifecycle | Every sandbox is force-removed after it exits, and "Sandbox removed" is logged only after Docker confirms it is gone. When a run ends, its network and proxy are removed too. Leftovers are swept at startup. |
| Fixed rules | The policy gate, the script template, plan-hash approval, stop-on-failure and the number check on AI text are all plain code with property tests. |

Main code: [`src/sandbox/runner.ts`](src/sandbox/runner.ts), [`proxy/ip.ts`](proxy/ip.ts), [`src/plan/policy.ts`](src/plan/policy.ts), [`src/k6/script.ts`](src/k6/script.ts), [`src/report/number-guard.ts`](src/report/number-guard.ts).

One trust boundary to know about: only the `socket-proxy` container mounts the Docker socket, and it forwards a fixed allowlist of Docker API endpoints to `macro-api` over the Compose network. No request can choose an image, mount, network or command — those all come from code constants, and the API cannot reach the endpoints that would let it do otherwise. The real-container test suite (`bun run test:vm`) runs the whole sandbox loop through this proxy, so a missing endpoint fails CI before a deploy does.

## See it contained

1. Open https://macro.my.id/app/, complete the Turnstile check and click **Run containment probe**.
2. A fixed k6 script ([`src/k6/probe.js`](src/k6/probe.js)) tries five things from inside a sandbox:
   - HTTPS to `example.com`, which is not allowlisted
   - HTTP to the cloud metadata address `169.254.169.254`
   - a request to the Macro API
   - a scan of environment variable names for `KEY`, `SECRET` or `TOKEN`
   - an allocation of more than 1 GiB of memory
3. Expected result: all five **contained**. The timeline shows Egress blocked three times, Memory cap hit, then Sandbox removed.

The panel **See the policy gate block a hostile plan** sends three hostile plans (another website, far too much load, an unknown route) through the same gate the approval uses. Each one is rejected with its rule violations, and 0 requests are sent. No model is involved.

## Try a load test

1. Pick an example such as **Gacha banner launch**, or write your own, then submit.
2. Review the draft plan (stages, journey, stop thresholds) and press **Approve and run**.
3. Watch the stages run live. A typical 4-stage run (25, 50, 100, 200 VUs) takes about 4.5 minutes.
4. Read the report: safe capacity, breaking point, first degraded route, a p95 and error-rate chart, per-route tables and the AI explanation.
5. **Re-run** the same plan and compare two runs side by side.

Example result from the live deployment: all four stages passed and safe capacity was 200 VUs. `store_home` was the first route to slow down, at p95 1,611 ms at 200 VUs (limit 1,500 ms).

## Setup

### Macro VM (Ubuntu 24.04)

```bash
git clone https://github.com/mbayue/macro.git /opt/macro && cd /opt/macro
sudo bash deploy/macro/install-gvisor.sh          # registers runsc with Docker
cp .env.example .env && chmod 600 .env            # fill in the secrets
# put the Cloudflare Origin CA cert and key in /etc/macro/tls/origin.pem and origin.key
deploy/macro/vultr-firewall.sh --dry-run          # optional; needs VULTR_API_KEY in the shell
docker compose -f deploy/macro/docker-compose.yml up -d --build
curl https://macro.my.id/healthz                  # {"ok":true}
```

Main settings (full list in [`.env.example`](.env.example) and [`src/config.ts`](src/config.ts)):

| Setting | Notes |
| --- | --- |
| `VULTR_INFERENCE_API_KEY` | Required, secret. |
| `TURNSTILE_SECRET_KEY`, `TURNSTILE_SITE_KEY` | Required. Cloudflare's test keys work locally. |
| `TARGET_ORIGINS` | The whole allowlist: the web origin, then the API origin. |
| `SANDBOX_RUNTIME` | `runsc` (default) or `runc` to opt out of gVisor. |
| `K6_IMAGE` | Must be pinned by `@sha256:` digest. |
| Auth block (all or nothing) | `SESSION_SECRET`, `PUBLIC_BASE_URL`, `RESEND_API_KEY`, `RESEND_FROM`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_REDIRECT_URI`. Omit all to disable sign-in; set every one to enable accounts. |

If a sandbox prerequisite is missing (Docker, gVisor, the proxy image), the API still starts but refuses every run, and `GET /api/config` names the problem.

### Accounts and own-site testing

Auth is optional. With the auth env block unset, `/api/me` and verify routes stay unavailable and the planner works as a signed-out demo against `TARGET_ORIGINS` only.

When auth is configured:

1. Open `/app/#/sign-in` (GitHub OAuth or Resend magic link). GitHub must provide a verified email or Macro refuses the sign-in.
2. On **New test**, choose **Demo shop** (public, works signed out) or **My site** (requires sign-in and a verified origin).
3. Verify one HTTPS host. Macro detects nameservers (Cloudflare quick link or the official upstream [Domain Connect template](https://github.com/Domain-Connect/Templates/blob/master/macro.my.id.verify.json)), or manual verification via a DNS TXT record at `_macro-verify.<host>` or a file at `/.well-known/macro-site-verification` containing the issued token. Once verified, Macro automatically discovers client routes from the site's document and scripts to constrain journey planning.
4. Own-site runs are private to the account; demo runs stay public and can be claimed onto the account from browser recent-runs after sign-in.

Local smoke (auth configured): sign in → verify a throwaway host you control → draft Demo and My site plans → confirm a private own-site report 404s when signed out → sign out lands on New test.

### Demo target VM

YUE is a separate, pre-existing project and isn't in this repo. [`deploy/yue-demo/`](deploy/yue-demo/) holds what the demo copy needs:

- a rate-limit allowlist patch for the Macro VM's IP, applied only to the throwaway checkout
- an env template with fresh local secrets
- a Compose override and a Caddyfile
- seed data, a cleanup script for test orders, and smoke checks

### Local development

```bash
bun install
bun test             # 539 tests, no Docker needed (the real-container suite skips)
bun run check        # tsc --noEmit
bun run build:web    # the app at /app/ and the prerendered landing site at /, /privacy, /terms
bun run dev          # the API; serves web/dist
bun run dev:landing  # optional: Vite dev server for the landing site with hot reload (port 5173)
bun run test:vm      # real-Docker containment tests; needs Docker (see Testing)
```

The landing site and the planner app are React + Vite in `web/landing/`. Landing pages are prerendered at build time and hydrated in the browser; the app at `/app/` is client-rendered. Both work under the strict CSP (no inline scripts or style attributes).

### Local development on Windows

Bun cannot open Docker Desktop's named pipe with its `unix` fetch option, so point `DOCKER_HOST` at it with the `pipe://` scheme, and give `DATA_DIR` an **absolute** path — Docker bind mounts of a relative path fail:

```bash
set DOCKER_HOST=pipe://\\.\pipe\docker_engine
set DATA_DIR=C:\absolute\path\to\macro\data
bun run dev
```

With both set, runs work locally on `runc`; `bun run test:vm` uses the same pipe on its own. The `test:vm` suite skips whenever these are unset.

### Waitlist

`POST /api/waitlist` stores an email (normalised, once) after a Turnstile check, with at most 5 sign-ups per IP per hour. The row keeps the email, the sign-up time, and, after an invite, the invite and first-join times. On the VM:

```bash
docker exec macro-api bun src/admin/waitlist.ts list              # CSV: email, signed up, invited, joined
docker exec macro-api bun src/admin/waitlist.ts invite <email>    # one invite (--force re-sends)
docker exec macro-api bun src/admin/waitlist.ts invite --all      # every not-yet-invited address, 200 ms apart
docker exec macro-api bun src/admin/waitlist.ts remove <email>    # deletion request
```

Invites go through Resend with the same sender as the sign-in emails and need `RESEND_API_KEY` and `RESEND_FROM` (already set when accounts are on). A failed send records nothing, so re-running retries exactly the failures. The first sign-in from an invited address stamps the join time, which is what turns `list` into the funnel.

## Limits

- **Targets are gated.** Signed-out clients only hit the demo allowlist. Signed-in clients may add one verified HTTPS origin (DNS TXT, Domain Connect, or `/.well-known/`). Contested hosts stay with the first verifier until clear or replace.
- **One load generator** in Singapore with 1 CPU per sandbox. At high VU counts, the generator itself can become the limit.
- **"First degraded route" is an observation, not a root cause.**
- **Quotas:** one active run at a time, rolling planning and start limits (per IP when signed out, per account when signed in), a daily start cap, and a 15-minute cap per run.
- **Not built:** regional runs from other Vultr regions, multi-seat orgs, and own-site containment probes.

## Testing

`bun test` runs the unit and property suite ([fast-check](https://fast-check.dev)). They cover the plan parser, the policy gate against an independent reference model, script generation, the proxy decision, sandbox lifecycle with a fake Docker, metrics and verdicts, agent fallbacks, the number check and run comparison, plus account auth, verification (DNS TXT, well-known, Domain Connect template), route discovery, drafts, run privacy, and the security headers on every response.

`bun run test:vm` runs the real-container suite (`test/vm/`) against a real Docker daemon: a k6 stage writes its summary, egress to a non-allowlisted host and to `169.254.169.254` is denied and logged by the real proxy, an over-1-GiB allocation is OOM-killed, a sandbox past its time cap is killed, the startup sweep removes everything labelled `macro=1`, and the production containment probe runs end to end. The suite is opt-in (`MACRO_VM_TEST=1`), pulls the pinned k6 image and builds the proxy image on first use, and refuses to start when `macro=1` resources already exist, so it can never sweep a live deployment. gVisor is used when registered; otherwise the suite runs on `runc`. One host difference is reported rather than assumed: Linux VMs (production, CI) enforce the 1 GiB memory cap eagerly, so the probe passes all five actions there; Docker Desktop/WSL2 lets a bounded allocation finish, and the suite says so instead of claiming containment. GitHub Actions runs both suites on push ([.github/workflows/ci.yml](.github/workflows/ci.yml)).

## License

MIT. Built with Bun, k6, gVisor, Caddy, zod, fast-check, Cloudflare Turnstile and Vultr Serverless Inference.
