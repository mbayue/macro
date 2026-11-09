import type { ReactNode } from 'react';
import { Footer, Nav } from '../components/Chrome.tsx';

const UPDATED = '9 November 2026';
const CONTACT = 'hello@macro.my.id';

type Section = { id: string; title: string; body: ReactNode };
type Fact = { term: string; detail: ReactNode };

/**
 * One legal page: the text on the left, and on wide screens a sticky panel on the right with the
 * key facts and an index of the sections. web/landing/src/legal-spy.ts highlights the section in view.
 */
function Page({ title, lead, facts, sections }: { title: string; lead: string; facts: Fact[]; sections: Section[] }) {
  return (
    <>
      <Nav home={false} />
      <main className="legal wrap" id="top">
        <header className="legal__head">
          <h1>{title}</h1>
          <p className="legal__updated">Last updated {UPDATED}</p>
          <p className="legal__lead">{lead}</p>
        </header>

        <aside className="legal__side" aria-label="Summary">
          <div className="legal__panel">
            <section className="legal__facts" aria-labelledby="in-short">
              <h2 id="in-short">In short</h2>
              <dl>
                {facts.map((f) => (
                  <div key={f.term}>
                    <dt>{f.term}</dt>
                    <dd>{f.detail}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <nav className="legal__toc" aria-label="On this page">
              <p className="legal__toc-title">On this page</p>
              <ol>
                {sections.map((s) => (
                  <li key={s.id}>
                    <a href={`#${s.id}`}>{s.title}</a>
                  </li>
                ))}
              </ol>
            </nav>
          </div>
        </aside>

        <div className="legal__body">
          {sections.map((s) => (
            <section key={s.id} id={s.id}>
              <h2>{s.title}</h2>
              {s.body}
            </section>
          ))}
        </div>
      </main>
      <Footer />
    </>
  );
}

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

const PRIVACY_FACTS: Fact[] = [
  { term: 'We store', detail: 'Your email and when you joined the waitlist' },
  { term: 'We never', detail: 'Sell it or share it for marketing' },
  { term: 'Demo runs', detail: 'Open to anyone who has the link' },
  { term: 'Cookies', detail: 'None of our own' },
  { term: 'To delete', detail: <Mail /> },
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
          email only to email you when you can verify and test your own site, plus anything essential about that launch. We never
          sell it, share it for marketing, or add it to other lists.
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
    title: 'Using the live demo',
    body: (
      <ul>
        <li>
          The traffic descriptions you type, the plans drafted from them and the results of each run are stored in Macro's database.
          Anyone with a run's link can open its page, so do not put personal data in a traffic description.
        </li>
        <li>
          Your traffic description and the measured results are sent to Vultr Serverless Inference, which drafts the plan, advises
          between stages and writes the report explanation.
        </li>
        <li>
          Your IP address is recorded with a timestamp when you draft a plan or start a run, so we can enforce the per-person limits.
          These records are deleted automatically after 24 hours.
        </li>
        <li>The list of recent runs on the planner page is kept in your own browser (local storage). It is never sent to us.</li>
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
        </ul>
        <p>Each processes data under its own privacy policy and only to provide its part of the service.</p>
      </>
    ),
  },
  {
    id: 'cookies',
    title: 'Cookies',
    body: <p>Macro sets no cookies of its own and uses no advertising or cross-site tracking.</p>,
  },
  {
    id: 'your-rights',
    title: 'Your rights',
    body: (
      <p>
        You can ask what we hold about you, ask us to correct it, or ask us to delete it, by writing to <Mail />. We answer within 30
        days.
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
  { term: 'Today', detail: 'A free demo that tests only our own demo shop' },
  { term: 'Your site', detail: 'Only sites you own, once domain verification launches' },
  { term: 'Results', detail: 'Estimates from one run in one region' },
  { term: 'Warranty', detail: 'None. The demo is provided as it is' },
  { term: 'Questions', detail: <Mail /> },
];

const TERMS_SECTIONS: Section[] = [
  {
    id: 'today',
    title: 'What Macro is today',
    body: (
      <p>
        Macro is in early access. The live demo is free and can only load-test one demo shop that we run for that purpose. Testing
        your own site, and the paid plans shown on the pricing table, are not available yet. Prices may change before they launch.
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
        When testing your own site becomes available, you may only test sites you own or are allowed to test, and you will prove that
        with domain verification. You are responsible for the load you choose to send.
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
