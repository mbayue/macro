/**
 * Inline own-site verification: start a token, show DNS + well-known instructions, check, or clear.
 */
import { useState } from 'react';
import type { VerifyStartResponse } from '../../../../../src/api-types.ts';
import { postVerifyCheck, postVerifyClear, postVerifyStart } from '../lib/auth-api.ts';
import { useApp } from '../context.tsx';
import { AlertRegion, Busy, Panel } from './ui.tsx';

function CloudflareIcon({ width = 14, height = 14 }: { width?: number; height?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={width} height={height} fill="currentColor" aria-hidden="true">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z" />
    </svg>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <button
      type="button"
      className="btn btn--quiet btn--copy"
      onClick={() => void copy()}
      title={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
    >
      {copied ? (
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
    </button>
  );
}

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
          {pending.isCloudflare ? (
            <div className="cf-banner">
              <div className="cf-banner__header">
                <span className="cf-badge">
                  <CloudflareIcon /> Cloudflare detected
                </span>
                <a
                  href={pending.cloudFlareDirectUrl ?? 'https://dash.cloudflare.com'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn btn--cf"
                >
                  Open Cloudflare DNS ↗
                </a>
              </div>
              <p className="cf-banner__desc">
                Your domain uses Cloudflare DNS. Open your dashboard to add the TXT record, then check below.
              </p>
            </div>
          ) : null}
          <div className="verify-records">
            <div className="verify-record">
              <span className="verify-record__label">DNS TXT name</span>
              <div className="verify-record__box">
                <code>{pending.txtName}</code>
                <CopyButton text={pending.txtName} />
              </div>
            </div>
            <div className="verify-record">
              <span className="verify-record__label">DNS TXT value</span>
              <div className="verify-record__box">
                <code>{pending.txtValue}</code>
                <CopyButton text={pending.txtValue} />
              </div>
            </div>
            <div className="verify-record">
              <span className="verify-record__label">Well-known URL</span>
              <div className="verify-record__box">
                <code>{pending.wellKnownUrl}</code>
                <CopyButton text={pending.wellKnownUrl} />
              </div>
            </div>
            <div className="verify-record">
              <span className="verify-record__label">File body</span>
              <div className="verify-record__box">
                <code>{pending.token}</code>
                <CopyButton text={pending.token} />
              </div>
            </div>
          </div>
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
