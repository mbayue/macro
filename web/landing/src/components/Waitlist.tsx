import { type FormEvent, useRef, useState } from 'react';
import type { ApiErrorBody, ConfigResponse, WaitlistRequest } from '../../../../src/api-types.ts';
import { getToken, resetWidget } from '../app/lib/turnstile.ts';

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const IDLE_NOTE = 'One email if paid plans with higher user and run limits launch. Nothing else.';
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

let siteKeyPromise: Promise<string> | null = null;
function siteKey(): Promise<string> {
  siteKeyPromise ??= fetch('/api/config', { headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? (r.json() as Promise<ConfigResponse>) : Promise.reject(new Error('config'))))
    .then((c) => c.turnstileSiteKey)
    .catch((err: unknown) => {
      siteKeyPromise = null;
      throw err;
    });
  return siteKeyPromise;
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as ApiErrorBody;
    if (typeof body?.error?.message === 'string') return body.error.message;
  } catch {
    // fall through
  }
  return 'Something went wrong. Please try again.';
}

/** The closing sentence; the blank in it is the form. Posts to /api/waitlist with a Turnstile token. */
export function Waitlist() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });
  const box = useRef<HTMLDivElement>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (state.kind === 'sending') return;
    const value = email.trim();
    if (!EMAIL_RE.test(value)) {
      setState({ kind: 'error', message: 'Enter a valid email address.' });
      return;
    }
    setState({ kind: 'sending' });
    try {
      const key = await siteKey();
      const token = await getToken(key, box.current!);
      const body: WaitlistRequest = { email: value, turnstileToken: token };
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setState({ kind: 'done' });
        setEmail('');
      } else {
        setState({ kind: 'error', message: await errorMessage(res) });
      }
    } catch {
      setState({ kind: 'error', message: 'Human verification could not finish. Please try again.' });
    } finally {
      resetWidget();
    }
  }

  const note =
    state.kind === 'done'
      ? "You're on the list. We'll email you once if paid plans launch."
      : state.kind === 'error'
        ? state.message
        : state.kind === 'sending'
          ? 'Adding you to the list.'
          : IDLE_NOTE;

  return (
    <section className="cta" id="waitlist" aria-labelledby="cta-title">
      <div className="wrap">
        <form noValidate onSubmit={(e) => void submit(e)}>
          <h2 id="cta-title" data-reveal>
            <label htmlFor="cta-email">Add</label>{' '}
            <input
              id="cta-email"
              type="email"
              name="email"
              aria-label="Email address"
              placeholder="you@shop.com"
              autoComplete="email"
              spellCheck={false}
              required
              aria-invalid={state.kind === 'error'}
              aria-describedby="cta-note"
              value={email}
              disabled={state.kind === 'sending'}
              onChange={(e) => setEmail(e.target.value)}
            />{' '}
            to the{' '}
            <button type="submit" disabled={state.kind === 'sending'}>
              waitlist
            </button>
          </h2>
          <div className="cta__turnstile" ref={box} />
          {/* The reveal sits on a wrapper: React rewriting the note's className (for the error style)
              would otherwise remove the "in" class that useMotion adds, and the note would fade out. */}
          <div data-reveal data-i="1">
            <p id="cta-note" className={state.kind === 'error' ? 'cta__note cta__note--bad' : 'cta__note'} aria-live="polite">
              {note}
            </p>
          </div>
          <p className="cta__fine">
            We store only your email and the time you signed up. See the <a href="/privacy">privacy policy</a>.
          </p>
        </form>
      </div>
    </section>
  );
}
