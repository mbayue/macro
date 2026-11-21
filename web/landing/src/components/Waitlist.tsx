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

/**
 * The waitlist tile in the close of the page: an email field and a submit button at thumb size, the
 * Turnstile container (empty unless Cloudflare needs the visitor), and one polite status line that
 * carries the idle note, progress, success or the error. Posts to /api/waitlist with a Turnstile token.
 * `className` places the tile in its parent's grid.
 */
export function Waitlist({ className = '' }: { className?: string }) {
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
  const sending = state.kind === 'sending';

  return (
    <div id="waitlist" className={`rounded bg-surface p-7 split:p-10 ${className}`} data-reveal data-i="1">
      <form noValidate aria-labelledby="waitlist-title" onSubmit={(e) => void submit(e)}>
        <h3 id="waitlist-title" className="text-[clamp(28px,2.4vw,40px)] leading-none tracking-[-0.03em]">
          Hear first if paid plans launch
        </h3>
        <div className="mt-7 flex flex-col gap-2 split:flex-row">
          <input
            id="waitlist-email"
            type="email"
            name="email"
            aria-label="Email address"
            placeholder="you@shop.com…"
            autoComplete="email"
            spellCheck={false}
            required
            aria-invalid={state.kind === 'error'}
            aria-describedby="waitlist-note"
            value={email}
            disabled={sending}
            onChange={(e) => setEmail(e.target.value)}
            className="min-h-[52px] w-full min-w-0 flex-1 rounded border-0 bg-bg px-4 font-text text-[17px] text-ink placeholder:text-muted disabled:cursor-progress disabled:opacity-60 aria-invalid:outline-2 aria-invalid:outline-offset-2 aria-invalid:outline-bad"
          />
          <button type="submit" className="site-btn disabled:cursor-progress disabled:opacity-60" disabled={sending}>
            Join the waitlist
          </button>
        </div>
        <div className="mt-5 empty:hidden" ref={box} />
        <p
          id="waitlist-note"
          className={`mt-5 min-h-[1.5em] text-base ${state.kind === 'error' ? 'text-bad' : 'text-ink'}`}
          aria-live="polite"
        >
          {note}
        </p>
        <p className="mt-2 text-[15px] text-muted">
          We store only your email and the time you signed up. See the{' '}
          <a className="text-ink" href="/privacy">
            privacy policy
          </a>
          .
        </p>
      </form>
    </div>
  );
}
