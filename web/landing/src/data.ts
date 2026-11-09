/** Content for the landing page. Numbers here are real (run d28cacd6) or decided prices. */

export interface HowStep {
  name: string;
  title: string;
  text: string;
  img: string;
  width: number;
  height: number;
  alt: string;
}

export const HOW_STEPS: readonly HowStep[] = [
  {
    name: 'Describe',
    title: 'First, describe the traffic',
    text: 'Write what you expect in plain words: who arrives, when, and what they do. The AI planner turns it into a staged k6 plan.',
    img: '/landing/img/ui-describe.png',
    width: 1016,
    height: 600,
    alt: "Macro's planner: a text box for describing the expected traffic, three example prompts and the demo target.",
  },
  {
    name: 'Check',
    title: 'Then the gate checks it',
    text: 'Fixed code checks the target, the routes, the users and the duration. A rejected plan has no approve button, and nothing is sent.',
    img: '/landing/img/ui-gate.png',
    width: 1016,
    height: 840,
    alt: 'A plan aimed at another website, rejected by the policy gate with rule 4.2 on the target field and 0 requests sent.',
  },
  {
    name: 'Run',
    title: 'Each stage runs sandboxed',
    text: 'Stages of 25, 50, 100 and 200 users run in fresh gVisor sandboxes. After each one, the supervisor decides whether to go on.',
    img: '/landing/img/ui-run.png',
    width: 1018,
    height: 720,
    alt: 'A running test: stage 1 of 4 at 25 users, with stages 2 to 4 pending and a Stop run button.',
  },
  {
    name: 'Report',
    title: 'Finally, read the report',
    text: 'Safe capacity, breaking point and the first route to slow down, all from measured numbers. The AI explanation sits in its own section.',
    img: '/landing/img/ui-report.png',
    width: 1040,
    height: 890,
    alt: 'The capacity report: safe capacity 200 users, breaking point not reached, first degraded route store_home, and a p95 chart.',
  },
];

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
export const BAR_MAX = 1611;
/** The bar the section is about. */
export const BAR_ACCENT = 9;
/** Bars that print their value. */
export const BAR_LABELLED: readonly number[] = [6, 9, 11];
/** On a phone, eight bars at most, worst first. */
export const BAR_PHONE_ORDER: readonly number[] = [9, 6, 11, 10, 0, 3, 7, 8];

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
 * Launch pricing. One run costs Macro about 2 cents on Vultr: about 9,000 input and 2,500
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
  { label: 'Containment probe', key: 'probe' },
  { label: 'Support', key: 'support' },
];

export const FAQ: readonly { q: string; a: string }[] = [
  {
    q: 'Can Macro test my own site today?',
    a: 'Not yet. The demo can only reach one demo shop. Your own sites need domain verification with a DNS TXT record, which is the next thing being built. Join the waitlist to hear when it ships.',
  },
  {
    q: 'What stops someone using it as a DDoS tool?',
    a: 'The target must match a verified site exactly, and the policy gate caps users and duration in code. The sandbox network has no route out except a proxy that allows HTTPS to that one host.',
  },
  {
    q: 'What does the AI decide, and what does code decide?',
    a: 'The AI drafts the plan, suggests whether to continue after each stage, and writes the explanation. The target, limits, script, sandbox settings and stop-on-failure rule are fixed code.',
  },
  {
    q: 'Can the AI make up numbers in the report?',
    a: 'Every number in the AI text is checked against the measured values and the plan. If one does not match, the explanation is withheld and a plain template is shown instead.',
  },
  {
    q: 'Why is it this cheap?',
    a: 'A run costs us about 2 cents on Vultr: a few thousand tokens on Serverless Inference and five minutes of a small VM. The paid plans pay for larger load generators and longer history.',
  },
  {
    q: 'What runs inside the sandbox?',
    a: 'k6, pinned by digest, under gVisor, as a non-root user with a read-only filesystem, 1 GiB of memory, one CPU and no secrets. Each stage gets a fresh sandbox that is removed afterwards.',
  },
  {
    q: 'Where does the traffic come from?',
    a: 'One Vultr machine in Singapore. At high user counts the load generator itself can become the limit, and the report says so.',
  },
];
