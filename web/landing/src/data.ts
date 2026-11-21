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
