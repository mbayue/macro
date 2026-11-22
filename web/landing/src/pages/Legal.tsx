import type { ReactNode } from 'react';
import { SiteFooter } from '../components/SiteFooter.tsx';
import { SiteHeader } from '../components/SiteHeader.tsx';
import { StageBand } from '../components/StageBand.tsx';

const UPDATED = '21 November 2026';
const CONTACT = 'hello@macro.my.id';

type Section = { id: string; title: string; body: ReactNode };
type Fact = { term: string; detail: ReactNode };

/** Styles for the section bodies, which are plain p, ul, li, strong and code elements. */
const PROSE =
  '[&_p]:mt-3.5 [&_p]:max-w-[64ch] [&_li]:mt-3.5 [&_li]:max-w-[64ch] [&_ul]:m-0 [&_ul]:list-disc [&_ul]:pl-[1.2em] [&_li]:marker:text-accent-text [&_strong]:font-medium [&_code]:font-text [&_code]:text-[0.95em] [&_a]:underline';

/**
 * One legal page: the text on the left, and on screens 1100 px and wider (min-[68.75rem], the layout's
 * width before the redesign, wider than `split`) a sticky panel on the right with the
 * key facts and an index of the sections. web/landing/src/legal-spy.ts marks the section in view
 * (aria-current on its index link, shown as the miniature stage band).
 */
function Page({ title, lead, facts, sections }: { title: string; lead: string; facts: Fact[]; sections: Section[] }) {
  return (
    <>
      <SiteHeader />
      <main
        id="top"
        data-legal
        className="lp-container lp-legal-main"
      >
        <header className="lp-legal-head">
          <div className="lp-stage-band" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <h1 className="lp-display mt-5">{title}</h1>
          <p className="lp-mono mt-3 text-[0.8125rem] text-muted">Last updated {UPDATED}</p>
          <p className="lp-lead mt-5">{lead}</p>
        </header>

        <aside className="lp-legal-aside" aria-label="Summary">
          <div className="lp-legal-sticky">
            <section className="lp-legal-card" aria-labelledby="in-short">
              <h2 id="in-short" className="lp-mono text-[0.8125rem] font-medium tracking-normal text-accent-text">
                In short
              </h2>
              <dl className="lp-kv-list mt-4">
                {facts.map((f) => (
                  <div key={f.term} className="lp-legal-fact">
                    <dt className="lp-mono text-[0.75rem] text-muted">{f.term}</dt>
                    <dd className="m-0 mt-1 text-[0.875rem] leading-[1.45] [overflow-wrap:anywhere] [&_a]:underline">{f.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <nav className="lp-legal-toc" aria-label="On this page" data-legal-toc>
              <p className="lp-mono text-[0.75rem] text-muted">On this page</p>
              <ol className="m-0 mt-3 grid list-none p-0 text-[0.875rem]">
                {sections.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="group flex min-h-9 items-center gap-3 py-1.5 text-muted no-underline press aria-[current=true]:text-ink pointer-fine:hover:text-ink"
                    >
                      <StageBand
                        size="bullet"
                        className="shrink-0 opacity-0 transition-opacity duration-150 group-aria-[current=true]:opacity-100"
                      />
                      {s.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </aside>

        <div className={`${PROSE} lp-legal-body`} data-legal-body>
          {sections.map((s) => (
            <section key={s.id} id={s.id} className="lp-legal-sec">
              <h2 className="lp-legal-h2">{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

const PRIVACY_FACTS: Fact[] = [
  { term: 'We store', detail: 'Waitlist email, account info (if signed in), and run data' },
  { term: 'We never', detail: 'Sell it or share it for marketing' },
  { term: 'Runs', detail: 'Demo runs are public; own-site runs are private to your account' },
  { term: 'Cookies', detail: 'Only a session cookie when you sign in' },
  {
    term: 'To delete',
    detail: (
      <>
        <a href="/app/#/account">Account settings</a> (signed in) or <Mail />
      </>
    ),
  },
];

const PRIVACY_SECTIONS: Section[] = [
  {
    id: 'who-we-are',
    title: 'Who we are',
    body: (
      <p>
        Macro is a load-testing service run from macro.my.id. For any question about your data, or to have it removed, write to{' '}
        <Mail />.
      </p>
    ),
  },
  {
    id: 'waitlist',
    title: 'The waitlist',
    body: (
      <>
        <p>
          When you join the waitlist we store your email address and the time you signed up. Nothing else: not your name, and not
          your IP address (it is held in memory for up to an hour, only to limit sign-ups, and is never written down). We use your
          email only to notify you once if paid plans with higher user and run limits launch, plus anything essential about that
          change. We never sell it, share it for marketing, or add it to other lists.
        </p>
        <p>
          We keep it until the hosted product launches and for as long as you stay subscribed after that. Ask us at <Mail /> and we
          delete it, usually within seven days.
        </p>
      </>
    ),
  },
  {
    id: 'live-demo',
    title: 'Using the app (demo and accounts)',
    body: (
      <ul>
        <li>
          The traffic descriptions you type, the plans drafted from them and the results of each run are stored in Macro's database.
          Demo runs are public (anyone with a run's link can open its page), so do not put personal data in a traffic description.
        </li>
        <li>
          If you sign in (with Google, GitHub, or an email magic link), we store your email address, optional OAuth account identity, your verified
          HTTPS origin and verification token, any saved draft text, and your private own-site runs.
        </li>
        <li>
          When you verify and draft a test for your own site, Macro fetches public documents and scripts from that origin to
          discover safe routes for the planner.
        </li>
        <li>
          Your traffic description and the measured results are sent to serverless LLM inference, which drafts the plan, advises
          between stages and writes the report explanation. Scenario Assistant and Report Q&amp;A run on your device via Chrome Gemini
          Nano when available; otherwise, requests are routed to Google Cloud Gemini via Firebase AI Logic with App Check attestation.
        </li>
        <li>
          Your IP address is recorded with a timestamp when you draft a plan or start a run while signed out, so we can enforce
          per-person limits. These records are deleted automatically after 24 hours.
        </li>
        <li>The list of recent runs on the planner page is kept in your own browser (local storage) unless you claim them onto an account.</li>
      </ul>
    ),
  },
  {
    id: 'processors',
    title: 'Services that process data for us',
    body: (
      <>
        <ul>
          <li>
            <strong>Vultr</strong> hosts Macro's servers and database in Singapore and runs the AI models.
          </li>
          <li>
            <strong>Cloudflare</strong> sits in front of the site for security and delivery, runs Turnstile (the check that you are a
            person, not a bot) on forms, and provides privacy-first page analytics without cookies.
          </li>
          <li>
            <strong>Resend</strong> sends sign-in magic links and waitlist emails when you request them.
          </li>
          <li>
            <strong>Google and Firebase</strong> handle Google OAuth sign-in, Firebase App Check client attestation, Firebase Remote
            Config for client AI settings, Cloud Firestore for public read-only scenario templates (cached locally in your browser),
            and cloud Gemini inference fallback when on-device Gemini Nano is not available.
          </li>
          <li>
            <strong>GitHub</strong> handles OAuth sign-in if you choose to sign in with GitHub.
          </li>
          <li>
            <strong>Tiger Cloud</strong> receives public demo-run per-second metrics when configured; private own-site runs are not
            sent there.
          </li>
        </ul>
        <p>Each processes data under its own privacy policy and only to provide its part of the service.</p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: (
      <p>
        Macro uses no advertising or cross-site tracking cookies. Signed-out browsing sets no cookies of its own; if you sign in,
        Macro sets an HttpOnly session cookie solely to keep you signed in. If you switch between light and dark mode, that choice
        is kept in your browser's local storage and never sent to us.
      </p>
    ),
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: (
      <p>
        If you have an account, you can delete it directly from <a href="/app/#/account">Account</a> (this immediately removes
        your account, verified origin, saved draft, and private runs, and unlinks any public demo runs). For waitlist entries,
        questions about what we hold, or corrections, write to <Mail />. We answer within 30 days.
      </p>
    ),
  },
  {
    id: 'changes',
    title: 'Changes',
    body: <p>If this policy changes, the date at the top changes too. A change that affects the waitlist is announced by email first.</p>,
  },
];

export function Privacy() {
  return (
    <Page
      title="Privacy policy"
      lead="Macro collects as little as it can. This page lists everything it stores, why, and how to have it removed."
      facts={PRIVACY_FACTS}
      sections={PRIVACY_SECTIONS}
    />
  );
}

const TERMS_FACTS: Fact[] = [
  { term: 'Today', detail: 'Free early access: public demo shop + verified own-site testing' },
  { term: 'Your site', detail: 'Only HTTPS sites you own, verified via DNS TXT or /.well-known/' },
  { term: 'Results', detail: 'Estimates from one run in one region' },
  { term: 'Warranty', detail: 'None. The service is provided as it is' },
  { term: 'Questions', detail: <Mail /> },
];

const TERMS_SECTIONS: Section[] = [
  {
    id: 'today',
    title: 'What Macro is today',
    body: (
      <p>
        Macro is in free early access. Anyone can use the live demo against our demo shop without signing in, and signed-in users
        can verify one HTTPS origin they own to run private load tests against their own site (up to 500 virtual users per stage).
        There are no paid plans today; if they launch later, prices will be shown before you can buy one.
      </p>
    ),
  },
  {
    id: 'acceptable-use',
    title: 'Acceptable use',
    body: (
      <>
        <ul>
          <li>Use the demo to learn how Macro works, not to disrupt it or anyone else.</li>
          <li>
            Do not try to get around the policy gate, the sandbox, the rate limits or the human check, except through the built-in
            containment probe.
          </li>
          <li>Do not automate requests to the demo or send traffic descriptions that contain personal data or someone else's secrets.</li>
          <li>
            Report a security problem privately to <Mail /> instead of exploiting it.
          </li>
        </ul>
        <p>We may limit or block access for anyone who breaks these rules.</p>
      </>
    ),
  },
  {
    id: 'your-site',
    title: 'Load tests on your own site',
    body: (
      <p>
        You may only verify and load-test sites you own or are explicitly authorized to test, proved via DNS TXT or{' '}
        <code>/.well-known/macro-site-verification</code>. You are responsible for the load you approve and send.
      </p>
    ),
  },
  {
    id: 'results',
    title: 'Results',
    body: (
      <p>
        Reports describe what one load generator in one region measured during one run. They are an estimate, not a guarantee of how
        your site behaves under real traffic. The AI-written explanation is checked against the measured numbers, but it can still be
        wrong; the measured numbers are the source of truth.
      </p>
    ),
  },
  {
    id: 'no-warranty',
    title: 'No warranty',
    body: (
      <p>
        The website and the demo are provided as they are, without warranties of any kind. They may change, pause or stop at any
        time. To the extent the law allows, Macro is not liable for any loss arising from using them.
      </p>
    ),
  },
  {
    id: 'open-source',
    title: 'Open source',
    body: (
      <p>
        Macro's code is published at <a href="https://github.com/mbayue/macro">github.com/mbayue/macro</a> under the MIT License.
        That licence covers the code; these terms cover the hosted website and demo.
      </p>
    ),
  },
  {
    id: 'contact',
    title: 'Contact',
    body: (
      <p>
        Questions about these terms: <Mail />. How we handle data is in the <a href="/privacy">privacy policy</a>.
      </p>
    ),
  },
];

export function Terms() {
  return (
    <Page
      title="Terms of use"
      lead="These terms cover the macro.my.id website, the live demo and the waitlist. By using them you agree to these terms."
      facts={TERMS_FACTS}
      sections={TERMS_SECTIONS}
    />
  );
}
