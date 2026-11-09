import type { ReactNode } from 'react';
import { Footer, Nav } from '../components/Chrome.tsx';

const UPDATED = '9 November 2026';
const CONTACT = 'hello@macro.my.id';

function Page({ title, lead, children }: { title: string; lead: string; children: ReactNode }) {
  return (
    <>
      <Nav home={false} />
      <main className="legal wrap" id="top">
        <h1>{title}</h1>
        <p className="legal__updated">Last updated {UPDATED}</p>
        <p className="legal__lead">{lead}</p>
        {children}
      </main>
      <Footer />
    </>
  );
}

const Mail = () => <a href={`mailto:${CONTACT}`}>{CONTACT}</a>;

export function Privacy() {
  return (
    <Page
      title="Privacy policy"
      lead="Macro collects as little as it can. This page lists everything it stores, why, and how to have it removed."
    >
      <section>
        <h2>Who we are</h2>
        <p>
          Macro is a load-testing service run from macro.my.id. For any question about your data, or to have it removed, write to{' '}
          <Mail />.
        </p>
      </section>

      <section>
        <h2>The waitlist</h2>
        <p>
          When you join the waitlist we store your email address and the time you signed up. Nothing else: not your name, and not
          your IP address (it is held in memory for up to an hour, only to limit sign-ups, and is never written down). We use your email only to email you when you can verify and test your own site, plus anything essential about
          that launch. We never sell it, share it for marketing, or add it to other lists.
        </p>
        <p>
          We keep it until the hosted product launches and for as long as you stay subscribed after that. Ask us at <Mail /> and we
          delete it, usually within seven days.
        </p>
      </section>

      <section>
        <h2>Using the live demo</h2>
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
          <li>
            The list of recent runs on the planner page is kept in your own browser (local storage). It is never sent to us.
          </li>
        </ul>
      </section>

      <section>
        <h2>Services that process data for us</h2>
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
      </section>

      <section>
        <h2>Cookies</h2>
        <p>Macro sets no cookies of its own and uses no advertising or cross-site tracking.</p>
      </section>

      <section>
        <h2>Your rights</h2>
        <p>
          You can ask what we hold about you, ask us to correct it, or ask us to delete it, by writing to <Mail />. We answer within 30
          days.
        </p>
      </section>

      <section>
        <h2>Changes</h2>
        <p>If this policy changes, the date at the top changes too. A change that affects the waitlist is announced by email first.</p>
      </section>
    </Page>
  );
}

export function Terms() {
  return (
    <Page
      title="Terms of use"
      lead="These terms cover the macro.my.id website, the live demo and the waitlist. By using them you agree to these terms."
    >
      <section>
        <h2>What Macro is today</h2>
        <p>
          Macro is in early access. The live demo is free and can only load-test one demo shop that we run for that purpose. Testing
          your own site, and the paid plans shown on the pricing table, are not available yet. Prices may change before they launch.
        </p>
      </section>

      <section>
        <h2>Acceptable use</h2>
        <ul>
          <li>Use the demo to learn how Macro works, not to disrupt it or anyone else.</li>
          <li>Do not try to get around the policy gate, the sandbox, the rate limits or the human check, except through the built-in containment probe.</li>
          <li>Do not automate requests to the demo or send traffic descriptions that contain personal data or someone else's secrets.</li>
          <li>
            Report a security problem privately to <a href={`mailto:${CONTACT}`}>{CONTACT}</a> instead of exploiting it.
          </li>
        </ul>
        <p>We may limit or block access for anyone who breaks these rules.</p>
      </section>

      <section>
        <h2>Load tests on your own site</h2>
        <p>
          When testing your own site becomes available, you may only test sites you own or are allowed to test, and you will prove that
          with domain verification. You are responsible for the load you choose to send.
        </p>
      </section>

      <section>
        <h2>Results</h2>
        <p>
          Reports describe what one load generator in one region measured during one run. They are an estimate, not a guarantee of
          how your site behaves under real traffic. The AI-written explanation is checked against the measured numbers, but it can
          still be wrong; the measured numbers are the source of truth.
        </p>
      </section>

      <section>
        <h2>No warranty</h2>
        <p>
          The website and the demo are provided as they are, without warranties of any kind. They may change, pause or stop at any
          time. To the extent the law allows, Macro is not liable for any loss arising from using them.
        </p>
      </section>

      <section>
        <h2>Open source</h2>
        <p>
          Macro's code is published at <a href="https://github.com/mbayue/macro">github.com/mbayue/macro</a> under the MIT License.
          That licence covers the code; these terms cover the hosted website and demo.
        </p>
      </section>

      <section>
        <h2>Contact</h2>
        <p>
          Questions about these terms: <a href={`mailto:${CONTACT}`}>{CONTACT}</a>. How we handle data is in the{' '}
          <a href="/privacy">privacy policy</a>.
        </p>
      </section>
    </Page>
  );
}
