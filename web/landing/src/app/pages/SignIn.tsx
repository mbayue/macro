/**
 * Sign in (`#/sign-in`): GitHub OAuth or magic link email.
 */
import { useEffect, useState } from 'react';
import { clearReviewState, githubStartHref, postMagicLink, postSignOut } from '../lib/auth-api.ts';
import { clearRecentRuns } from '../lib/recent-runs.ts';
import { AlertRegion, Busy, Panel } from '../components/ui.tsx';
import { useApp } from '../context.tsx';

export function SignIn() {
  const { me, navigate, announce, refreshMe } = useApp();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setInterval(() => setWait((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [wait]);

  const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
  const githubEmailError = params.get('error') === 'github_email';

  if (me !== null) {
    return (
      <section className="page">
        <header className="page__head">
          <h1 className="page__title">Account</h1>
          <p className="page__lead">
            You are signed in as <strong>{me.user.githubLogin ?? me.user.email}</strong>.
          </p>
        </header>
        <Panel title="Session active">
          <p className="muted">
            Your account can run private load tests against your verified origin.
          </p>
          <p className="actions">
            <button type="button" className="btn" onClick={() => navigate('/')}>
              Back to new test
            </button>
            <a href="#/runs" className="btn btn--quiet">
              View your runs
            </a>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                void (async () => {
                  await postSignOut();
                  clearRecentRuns();
                  clearReviewState();
                  await refreshMe();
                  announce('Signed out.');
                })();
              }}
            >
              Sign out
            </button>
          </p>
        </Panel>
      </section>
    );
  }

  async function onMagic(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setSent(false);
    const result = await postMagicLink(email.trim(), '/app/#/'); // return to New test; draft hydrates from account + stash
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      announce(result.error.message);
      return;
    }
    setSent(true);
    setWait(60);
    announce('Check your email for a sign-in link.');
    void refreshMe();
  }

  return (
    <section className="page">
      <header className="page__head">
        <h1 className="page__title">Sign in</h1>
        <p className="page__lead">
          Sign in to verify your site and keep own-site runs private. The demo shop still works signed out.
        </p>
      </header>

      {githubEmailError ? (
        <AlertRegion>
          <p>GitHub did not provide a verified email. Use a magic link, or make a verified email public on GitHub and try again.</p>
        </AlertRegion>
      ) : null}

      <Panel title="GitHub">
        <p className="muted">Uses your GitHub account. Macro needs a verified email address.</p>
        <p className="actions">
          <a className="btn" href={githubStartHref()}>
            Continue with GitHub
          </a>
        </p>
      </Panel>

      <Panel title="Email link">
        <form onSubmit={onMagic} className="stack">
          <label className="field">
            <span className="field__label">Email</span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
          </label>
          {error ? (
            <AlertRegion>
              <p>{error}</p>
            </AlertRegion>
          ) : null}
          {sent ? (
            <p className="muted" role="status">
              Check your email for a sign-in link.
            </p>
          ) : null}
          <div className="actions">
            <button type="submit" className="btn" disabled={busy || wait > 0 || email.trim() === ''}>
              {busy ? <Busy>Sending</Busy> : wait > 0 ? `Wait ${wait}s` : 'Send sign-in link'}
            </button>
            <button type="button" className="btn btn--quiet" onClick={() => navigate('/')}>
              Back to new test
            </button>
          </div>
        </form>
      </Panel>
    </section>
  );
}
