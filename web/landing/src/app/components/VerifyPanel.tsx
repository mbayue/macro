/**
 * Inline own-site verification: start a token, show DNS + well-known instructions, check, or clear.
 */
import { useState } from 'react';
import type { VerifyStartResponse } from '../../../../../src/api-types.ts';
import { postVerifyCheck, postVerifyClear, postVerifyStart } from '../lib/auth-api.ts';
import { useApp } from '../context.tsx';
import { AlertRegion, Busy, Panel } from './ui.tsx';

export function VerifyPanel({
  initialHost = '',
  onVerified,
  onCleared,
}: {
  initialHost?: string;
  onVerified?: (origin: { origin: string; host: string }) => void;
  onCleared?: () => void;
}) {
  const { me, refreshMe, announce } = useApp();
  const [host, setHost] = useState(initialHost);
  const [pending, setPending] = useState<VerifyStartResponse | null>(null);
  const [busy, setBusy] = useState<'start' | 'check' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const verified = me?.verifiedOrigin ?? null;

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy('start');
    setError(null);
    const res = await postVerifyStart(host.trim());
    setBusy(null);
    if (!res.ok) {
      setError(res.error.message);
      announce(res.error.message);
      return;
    }
    setPending(res.data);
    announce('Verification token ready. Add the DNS record or well-known file, then check.');
  }

  async function onCheck() {
    if (busy) return;
    setBusy('check');
    setError(null);
    const res = await postVerifyCheck();
    setBusy(null);
    if (!res.ok) {
      setError(res.error.message);
      announce(res.error.message);
      return;
    }
    setPending(null);
    await refreshMe();
    onVerified?.(res.data.verifiedOrigin);
    announce(`Verified ${res.data.verifiedOrigin.host}.`);
  }

  async function onClear() {
    if (busy) return;
    setBusy('clear');
    setError(null);
    const res = await postVerifyClear();
    setBusy(null);
    if (!res.ok) {
      setError(res.error.message);
      announce(res.error.message);
      return;
    }
    setPending(null);
    await refreshMe();
    onCleared?.();
    announce('Verified site cleared.');
  }

  return (
    <Panel title="Verify your site">
      <p className="muted">
        Macro needs proof you control one HTTPS origin. Add either a DNS TXT record or a{' '}
        <code>/.well-known/macro-site-verification</code> file with the token below, then check.
      </p>

      {verified !== null ? (
        <p role="status">
          Verified: <strong>{verified.host}</strong>{' '}
          <button type="button" className="btn btn--ghost" disabled={busy !== null} onClick={() => void onClear()}>
            {busy === 'clear' ? <Busy>Clearing</Busy> : 'Clear'}
          </button>
        </p>
      ) : null}

      {error ? (
        <AlertRegion>
          <p>{error}</p>
        </AlertRegion>
      ) : null}

      {pending === null ? (
        <form onSubmit={onStart} className="stack">
          <label className="field">
            <span className="field__label">Host or https origin</span>
            <input
              type="text"
              name="host"
              autoComplete="url"
              required
              placeholder="shop.example.com"
              value={host}
              onChange={(e) => setHost(e.target.value)}
              disabled={busy !== null}
            />
          </label>
          <p className="actions">
            <button type="submit" className="btn" disabled={busy !== null || host.trim() === ''}>
              {busy === 'start' ? <Busy>Starting</Busy> : 'Start verification'}
            </button>
          </p>
        </form>
      ) : (
        <div className="stack">
          <dl className="kv">
            <div>
              <dt>DNS TXT name</dt>
              <dd>
                <code>{pending.txtName}</code>
              </dd>
            </div>
            <div>
              <dt>DNS TXT value</dt>
              <dd>
                <code>{pending.txtValue}</code>
              </dd>
            </div>
            <div>
              <dt>Well-known URL</dt>
              <dd>
                <code>{pending.wellKnownUrl}</code>
              </dd>
            </div>
            <div>
              <dt>File body</dt>
              <dd>
                <code>{pending.token}</code>
              </dd>
            </div>
          </dl>
          <p className="actions">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void onCheck()}>
              {busy === 'check' ? <Busy>Checking</Busy> : 'I added the proof — check'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              disabled={busy !== null}
              onClick={() => {
                setPending(null);
                setError(null);
              }}
            >
              Start over
            </button>
          </p>
        </div>
      )}
    </Panel>
  );
}
