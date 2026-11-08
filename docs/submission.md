# Macro: lablab.ai submission text

Hackathon: Vultr Agent Rush, Challenge 1 "Blast Radius Zero".
Deadline: Nov 9, 04:00 UTC+7.

All figures below come from a real run on the live deployment (run `d28cacd6-a637-4306-8484-3413df15e47c`).

## Fields

**Title**

Macro: a load-test agent with zero blast radius

**Short description** (one line)

An AI agent that plans, runs and explains a load test, inside a gVisor sandbox that can only reach one approved target.

**Tags**

Vultr, AI Agents, Sandbox, gVisor, k6, Docker, TypeScript, Bun, Load Testing, Serverless Inference

**Demo platform**

Vultr Cloud Compute (plus Vultr Serverless Inference)

**Application URL**

https://macro.my.id

**Public GitHub repository**

https://github.com/mbayue/macro

## Long description (about 1,500 characters)

Macro is an AI agent that answers one question before a launch: how many users can this site take before it breaks?

You describe the goal in plain words. A Planner agent (Vultr Serverless Inference, forced tool call) proposes a staged k6 plan. A deterministic Policy Gate checks the plan against hard rules: one approved target, capped virtual users, capped duration. You approve it. Macro then runs 25, 50, 100 and 200 virtual-user stages. After each stage a Supervisor agent decides whether to continue or stop, and a separate rule engine can overrule it. A Report Writer explains the result, and every number in its text is checked against the measured data before it is shown.

Blast radius is the point. Each stage runs k6 in its own Docker container under gVisor (runsc), with no route out of the VM except an egress proxy that allows HTTPS to one exact host. Memory, CPU and process counts are capped. A built-in probe tries five hostile actions (three egress attempts, a memory bomb, a sandbox escape check). All five are contained, live, from the UI.

In the live run against a demo shop on a second Vultr VM, Macro found a safe capacity of 200 virtual users. The first degraded route was the store home page, at p95 1,611 ms at 200 users. The supervisor stopped after stage 4, and the full run took 4 minutes 28 seconds.

Two Vultr Cloud Compute VMs (Singapore), Vultr Firewall limited to Cloudflare ranges, Vultr Serverless Inference for all three agents. 422 automated tests.

## Video script (3 to 4 minutes)

Record at 1080p. Keep the browser zoom at 100%. Have two tabs open: https://macro.my.id and a terminal on the `macro` VM (`docker ps`).

| Time | Show | Say |
| --- | --- | --- |
| 0:00 to 0:20 | Landing page | "Before a launch, everyone asks how much traffic the site can take. Load tests answer it, but a load-testing agent can also become a weapon. Macro is built so it cannot." |
| 0:20 to 0:50 | Scroll the landing explanation, then the Policy Gate demo button | "The agent can only plan against one approved target. Here are hostile plans: a different host, 100,000 users, a 3-hour run. The gate rejects each one with a reason. This gate is code, not a prompt, so a model cannot talk its way past it." |
| 0:50 to 1:40 | Click the containment probe | "This is the containment moment. Macro starts a real sandbox and tries five things: three outbound connections, a memory bomb, and removing itself. Three egress attempts blocked by the proxy, memory cap hit, sandbox removed. Five of five contained." Show `docker ps` in the terminal if time allows. |
| 1:40 to 2:10 | Type the goal, pass Turnstile, press Plan | "Now a real run. I describe the goal in plain language. The Planner on Vultr Serverless Inference returns a staged plan. I approve it." |
| 2:10 to 3:10 | Run page: stages 25, 50, 100, 200 | "Each stage is a k6 container under gVisor. After each stage the Supervisor decides whether to continue. A rule engine can overrule it. At 200 users the home page gets slow, and the Supervisor stops." Speed up this part in the edit, or cut to the finished run. |
| 3:10 to 3:40 | Report page | "Safe capacity is 200 virtual users. The first route to degrade is the store home page, p95 1.6 seconds. Every number in this text is checked against measured data before it is shown." |
| 3:40 to 4:00 | Architecture slide | "Two Vultr VMs, Serverless Inference for the three agents, Vultr Firewall, gVisor and an egress proxy. Repo and live demo are linked. Thanks." |

Tips:

- A full run takes about 4.5 minutes. Record it once, then cut the waiting.
- Run the probe on camera. It is quick and it is the strongest proof.
- If the live site is slow, open the saved report for run `d28cacd6-a637-4306-8484-3413df15e47c` instead.
- Do not show `.env`, the Vultr dashboard API page, or the Turnstile secret.

## Slide outline (8 slides)

1. Title: Macro. "How many users can your site take? Ask an agent that cannot hurt anyone."
2. Problem: load-testing agents are dual-use. An agent that can send traffic anywhere is a DDoS tool.
3. Idea: plan, run, supervise, explain, inside a hard boundary.
4. Blast radius zero: Policy Gate (code), gVisor sandbox, egress proxy, resource caps, Turnstile, run limits.
5. Live proof: probe result, 5 of 5 contained (screenshot `macro-probe.png`).
6. Live result: 4 stages, safe capacity 200, home page degrades first at p95 1,611 ms (screenshots `macro-run.png`, `macro-report-bottom.png`).
7. Vultr usage: 2 Cloud Compute VMs, Serverless Inference (minimax-m3.1-flash with mimo-v2.6-flash fallback), Firewall.
8. What is next: DNS TXT verification to test your own sites, regional runs from throwaway VMs, before/after compare.
