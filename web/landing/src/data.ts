/** Content for the landing page. Numbers here are real (run d28cacd6) or decided prices. */

/** p95 latency (ms) per route and stage, from run d28cacd6 on the demo shop. */
export interface Bar {
  route: string;
  stage: number;
  vus: number;
  p95: number;
}

export const BARS: readonly Bar[] = [
  { route: 'store_home', stage: 1, vus: 25, p95: 575 },
  { route: 'catalog_list', stage: 1, vus: 25, p95: 77 },
  { route: 'product_detail', stage: 1, vus: 25, p95: 81 },
  { route: 'store_home', stage: 2, vus: 50, p95: 292 },
  { route: 'catalog_list', stage: 2, vus: 50, p95: 128 },
  { route: 'product_detail', stage: 2, vus: 50, p95: 43 },
  { route: 'store_home', stage: 3, vus: 100, p95: 910 },
  { route: 'catalog_list', stage: 3, vus: 100, p95: 226 },
  { route: 'product_detail', stage: 3, vus: 100, p95: 138 },
  { route: 'store_home', stage: 4, vus: 200, p95: 1611 },
  { route: 'catalog_list', stage: 4, vus: 200, p95: 618 },
  { route: 'product_detail', stage: 4, vus: 200, p95: 794 },
];

export interface Plan {
  name: string;
  price: string;
  period: string;
  recommended: boolean;
  sites: string;
  vus: string;
  runs: string;
  history: string;
  probe: string;
  support: string;
  action: { label: string; href: string };
}

export interface RouteSample {
  name: string;
  p95Ms: number;
}

export interface StageSample {
  id: number;
  vus: number;
  duration: string;
  p95Ms: number;
  errorRate: string;
  status: 'pass' | 'stop';
  verdictLabel: string;
  route: string;
  barPct: number;
  supervisorNote: string;
  routes: readonly RouteSample[];
}

/** Real measured stage & route p95 latencies from run d28cacd6 on yue.macro.my.id. */
export const SAMPLE_STAGES: readonly StageSample[] = [
  {
    id: 1,
    vus: 25,
    duration: '30s',
    p95Ms: 575,
    errorRate: '0.0%',
    status: 'pass',
    verdictLabel: 'Within Safe Capacity',
    route: 'store_home (run d28cacd6)',
    barPct: 36,
    supervisorNote: 'Continue to Stage 2 (50 VUs). All three routes stayed under the 1,000 ms stop limit.',
    routes: [
      { name: 'store_home', p95Ms: 575 },
      { name: 'catalog_list', p95Ms: 77 },
      { name: 'product_detail', p95Ms: 81 },
    ],
  },
  {
    id: 2,
    vus: 50,
    duration: '30s',
    p95Ms: 292,
    errorRate: '0.0%',
    status: 'pass',
    verdictLabel: 'Within Safe Capacity',
    route: 'store_home (run d28cacd6)',
    barPct: 48,
    supervisorNote: 'Continue to Stage 3 (100 VUs). Warmed caches held store_home at 292 ms p95.',
    routes: [
      { name: 'store_home', p95Ms: 292 },
      { name: 'catalog_list', p95Ms: 128 },
      { name: 'product_detail', p95Ms: 43 },
    ],
  },
  {
    id: 3,
    vus: 100,
    duration: '30s',
    p95Ms: 910,
    errorRate: '0.0%',
    status: 'pass',
    verdictLabel: 'Safe Capacity',
    route: 'store_home (run d28cacd6)',
    barPct: 70,
    supervisorNote: 'Highest passing Stage. Continue to Stage 4 (200 VUs) to test the upper bound.',
    routes: [
      { name: 'store_home', p95Ms: 910 },
      { name: 'catalog_list', p95Ms: 226 },
      { name: 'product_detail', p95Ms: 138 },
    ],
  },
  {
    id: 4,
    vus: 200,
    duration: '30s',
    p95Ms: 1611,
    errorRate: '0.0%',
    status: 'stop',
    verdictLabel: 'Breaking Point',
    route: 'store_home (run d28cacd6)',
    barPct: 100,
    supervisorNote: 'Halt run. store_home reached 1,611 ms p95, breaching the 1,000 ms stop threshold.',
    routes: [
      { name: 'store_home', p95Ms: 1611 },
      { name: 'catalog_list', p95Ms: 618 },
      { name: 'product_detail', p95Ms: 794 },
    ],
  },
];

export interface PolicyPreset {
  id: string;
  label: string;
  target: string;
  verdict: 'approved' | 'rejected';
  checks: readonly { rule: string; detail: string; pass: boolean }[];
}

export const POLICY_PRESETS: readonly PolicyPreset[] = [
  {
    id: 'demo-ramp',
    label: 'Safe ramp on Demo Target',
    target: 'https://yue.macro.my.id',
    verdict: 'approved',
    checks: [
      { rule: 'Target allowlist', detail: 'yue.macro.my.id is the allowlisted Demo Target', pass: true },
      { rule: 'VU & stage bounds', detail: '4 stages, peak 200 VUs (limit: 6 stages, 200 VUs)', pass: true },
      { rule: 'Stop thresholds', detail: 'p95 <= 1,000 ms, error rate <= 2.0%, HTTP 429 halt enabled', pass: true },
    ],
  },
  {
    id: 'over-vu',
    label: 'Over-limit 500 VUs spike',
    target: 'https://yue.macro.my.id',
    verdict: 'rejected',
    checks: [
      { rule: 'Target allowlist', detail: 'yue.macro.my.id is the allowlisted Demo Target', pass: true },
      { rule: 'VU & stage bounds', detail: '500 VUs exceeds the 200 VU ceiling for Demo Target', pass: false },
      { rule: 'Stop thresholds', detail: 'Missing latency and error-rate stop thresholds', pass: false },
    ],
  },
  {
    id: 'unverified-host',
    label: 'Unverified third-party host',
    target: 'https://shop.example.com',
    verdict: 'rejected',
    checks: [
      { rule: 'Target allowlist', detail: 'shop.example.com has no verified ownership record', pass: false },
      { rule: 'VU & stage bounds', detail: '1 stage, 50 VUs within bounds', pass: true },
      { rule: 'Stop thresholds', detail: 'Default stop thresholds applied', pass: true },
    ],
  },
];

export const CONTAINMENT_CHECKS = [
  { code: '(a)', name: 'Disallowed egress host', attempt: 'HTTPS request to an unverified external domain', result: 'Blocked by egress proxy' },
  { code: '(b)', name: 'Cloud metadata endpoint', attempt: 'GET http://169.254.169.254/latest/meta-data/', result: 'Denied (link-local)' },
  { code: '(c)', name: 'Private network scan', attempt: 'TCP connect to RFC1918 internal subnet', result: 'Denied (private IP)' },
  { code: '(d)', name: 'Host secret discovery', attempt: 'Read /proc, env vars, and mounted host paths', result: 'Isolated by gVisor' },
  { code: '(e)', name: 'Memory over-allocation', attempt: 'Allocate beyond the 1 GiB container cgroup limit', result: 'OOM killed inside sandbox' },
] as const;

export const PIPELINE_NODES = [
  {
    id: 'description',
    step: '01',
    title: 'Traffic Description',
    role: 'Plain English input',
    contract: 'Scenario Assistant refines your draft on-device (Gemini Nano) with Cloud Fallback before the server planner drafts 1 to 6 Stages.',
    artifact: 'Input: plain text (<= 1,000 chars)',
  },
  {
    id: 'gate',
    step: '02',
    title: 'Policy Gate',
    role: 'Deterministic code',
    contract: 'Fixed code checks origin ownership, VU caps, duration bounds, and stop thresholds. Passing plans lock into an Approved Plan by SHA-256 hash.',
    artifact: 'Output: Approved Plan (locked hash)',
  },
  {
    id: 'sandbox',
    step: '03',
    title: 'gVisor + Egress Proxy',
    role: 'Isolated execution',
    contract: 'Each Stage runs in a short-lived gVisor container behind a single-origin allowlist proxy that denies private IPs and 169.254.169.254.',
    artifact: 'Guarantee: 5 / 5 Containment Probe',
  },
  {
    id: 'guard',
    step: '04',
    title: 'Number Guard',
    role: 'Measured verification',
    contract: 'Every digit in AI-generated Capacity Report prose and Report Q&A is checked against measured Stage and route metrics. Unmatched figures are withheld.',
    artifact: 'Rule: 0 invented numbers',
  },
] as const;

export const FREE_LIMITS = [
  {
    mode: 'Demo Target (signed out)',
    target: 'yue.macro.my.id',
    verification: 'None required',
  },
  {
    mode: 'Own Site (signed in)',
    target: '1 verified HTTPS origin',
    verification: 'Domain Connect, DNS TXT, or /.well-known/',
  },
] as const;

export const LANDING_FAQS = [
  {
    q: 'How do you prove Macro cannot be pointed at someone else’s site?',
    a: 'Every non-demo target must pass ownership verification via Domain Connect, a _macro-verify DNS TXT record, or a /.well-known/ file. The egress proxy enforces that single verified origin at the network layer.',
  },
  {
    q: 'What stops the AI from inventing numbers in the Capacity Report?',
    a: 'Number Guard inspects AI-generated prose before it is shown. If the text cites any number not present in the measured Stage and route metrics, Macro withholds that prose and shows the measured tables alone.',
  },
  {
    q: 'When does Hybrid Inference run on-device versus in the cloud?',
    a: 'Scenario Assistant and Report Q&A check for Chrome’s built-in On-Device Model (Gemini Nano) first. On browsers without it, Macro switches to Cloud Fallback automatically.',
  },
  {
    q: 'Do I need an account or credit card to try it?',
    a: 'No. You can draft a Test Plan, run a load test against the Demo Target, and execute a live 5/5 Containment Probe directly in Test Studio without signing in.',
  },
] as const;

export function getStage(index: number): StageSample {
  return SAMPLE_STAGES[index] ?? SAMPLE_STAGES[2]!;
}

export function getPolicyPreset(index: number): PolicyPreset {
  return POLICY_PRESETS[index] ?? POLICY_PRESETS[0]!;
}

/**
 * Launch pricing, not shown while Macro is free in early access (the page renders
 * components/FreePlans.tsx instead; components/Pricing.tsx renders these plans).
 * One run costs Macro about 2 cents on Vultr: about 9,000 input and 2,500
 * output tokens on Serverless Inference ($0.55 and $2.75 per million), plus about five minutes
 * of a $10-a-month VM. The paid tiers cover larger generator VMs for higher user counts.
 */
export const PLANS: readonly Plan[] = [
  {
    name: 'Free',
    price: '$0',
    period: 'forever',
    recommended: false,
    sites: '1',
    vus: '100',
    runs: '10',
    history: '7 days',
    probe: 'Included',
    support: 'Community',
    action: { label: 'Try the live demo', href: '/app/' },
  },
  {
    name: 'Pro',
    price: '$9',
    period: 'per month',
    recommended: true,
    sites: '3',
    vus: '300',
    runs: '100',
    history: '90 days',
    probe: 'Included',
    support: 'Email',
    action: { label: 'Join the waitlist', href: '#waitlist' },
  },
  {
    name: 'Team',
    price: '$29',
    period: 'per month',
    recommended: false,
    sites: '10',
    vus: '500',
    runs: '400',
    history: '1 year',
    probe: 'Included',
    support: 'Priority email',
    action: { label: 'Join the waitlist', href: '#waitlist' },
  },
];

export const PLAN_ROWS: readonly { label: string; key: keyof Pick<Plan, 'sites' | 'vus' | 'runs' | 'history' | 'probe' | 'support'> }[] = [
  { label: 'Verified sites', key: 'sites' },
  { label: 'Peak virtual users', key: 'vus' },
  { label: 'Runs per month', key: 'runs' },
  { label: 'Run history', key: 'history' },
  { label: 'Containment Probe', key: 'probe' },
  { label: 'Support', key: 'support' },
];

export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Can Macro test my own site today?',
    a: 'Yes. Sign in with Google, GitHub, or an email link, verify your HTTPS site via Domain Connect, a DNS TXT record, or a /.well-known/macro-site-verification file, and Macro will auto-discover safe routes and run private load tests against it. The public demo shop still works signed out.',
  },
  {
    q: 'What stops someone using it as a DDoS tool?',
    a: 'The target must match a verified site (or the demo shop) exactly, and the Policy Gate caps users and duration in code. The sandbox network has no route out except a proxy that allows HTTPS to that one host, and concurrent runs queue FIFO.',
  },
  {
    q: 'What does the AI decide, and what does code decide?',
    a: 'The AI drafts the plan, suggests whether to continue after each Stage, and writes the explanation. The target, limits, script, sandbox settings and stop-on-failure rule are fixed code.',
  },
  {
    q: 'Can the AI make up numbers in the report?',
    a: 'Every number in the AI text is checked against the measured values and the plan. If one does not match, the explanation is withheld and a plain template is shown instead.',
  },
  {
    q: 'Is Macro free?',
    a: 'Yes, for now. The hosted app costs nothing during early access, and the code is MIT-licensed, so you can run your own copy and pay only for your server and serverless inference. One run costs about 2 cents.',
  },
  {
    q: 'What runs inside the sandbox?',
    a: 'k6, pinned by digest, under gVisor, as a non-root user with a read-only filesystem, 1 GiB of memory, one CPU and no secrets. Each Stage gets a fresh sandbox that is removed afterwards.',
  },
  {
    q: 'Where does the traffic come from?',
    a: 'One cloud machine in Singapore. At high user counts the load generator itself can become the limit, and the report says so.',
  },
];
