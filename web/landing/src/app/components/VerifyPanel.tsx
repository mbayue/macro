/**
 * Inline own-site verification: start a token, show DNS + well-known instructions, check, or clear.
 */
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { CheckIcon, CloudIcon, CopyIcon, ExternalLinkIcon, ZapIcon } from 'lucide-react';
import type { VerifyStartResponse } from '../../../../../src/api-types.ts';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getVerifyPending, postVerifyCancel, postVerifyCheck, postVerifyClear, postVerifyStart } from '../lib/auth-api.ts';
import { useApp } from '../context.tsx';
import { AlertRegion, Busy, ConfirmButton } from './ui.tsx';
import { TelemetryPanel } from './studio/TelemetryFrame.tsx';

function CopyButton({ text, onAnnounce }: { text: string; onAnnounce?: ((msg: string) => void) | undefined }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      onAnnounce?.('Copied to clipboard.');
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onAnnounce?.('Could not copy to clipboard.');
    }
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="icon-xs"
      className="shrink-0 border-bar-hover bg-background"
      onClick={() => void copy()}
      title={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
      aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
    >
      {copied ? <CheckIcon /> : <CopyIcon />}
    </Button>
  );
}

function VerifyHostForm({
  host,
  busy,
  starting,
  hasError,
  helpId,
  errorId,
  className,
  inputRef,
  onHostChange,
  onSubmit,
}: {
  host: string;
  busy: boolean;
  starting: boolean;
  hasError: boolean;
  helpId: string;
  errorId: string;
  className?: string | undefined;
  inputRef: Ref<HTMLInputElement>;
  onHostChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const inputId = useId();
  const describedBy = [helpId, errorId].join(' ');
  return (
    <form onSubmit={onSubmit} noValidate className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-1.5">
        <label htmlFor={inputId} className="text-xs font-medium text-muted-foreground">
          Host or https origin
        </label>
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          name="host"
          autoComplete="url"
          required
          placeholder="shop.example.com"
          value={host}
          onChange={(e) => onHostChange(e.target.value)}
          disabled={busy}
          aria-invalid={hasError}
          aria-describedby={describedBy}
          className={cn(
            'h-10 w-full rounded-md border bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-[2px] focus-visible:outline-offset-[1px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
            hasError ? 'border-bad' : 'border-bar',
          )}
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {starting ? <Busy>Starting</Busy> : 'Start verification'}
        </Button>
      </div>
    </form>
  );
}

export function VerifyPanel({
  initialHost = '',
  onVerified,
  onCleared,
}: {
  initialHost?: string;
  onVerified?: ((origin: { origin: string; host: string }) => void) | undefined;
  onCleared?: (() => void) | undefined;
}) {
  const { me, refreshMe, announce } = useApp();
  const [host, setHost] = useState(initialHost);
  const [pending, setPending] = useState<VerifyStartResponse | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [busy, setBusy] = useState<'start' | 'check' | 'clear' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const restoreGen = useRef(0);
  const hostInput = useRef<HTMLInputElement>(null);
  const verifyHelpId = useId();
  const verifyErrorId = useId();

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    if (hash.includes('domainConnect=done')) {
      const cleanHash = hash.replace(/[?&]domainConnect=done/, '');
      window.history.replaceState(null, '', window.location.pathname + cleanHash);
      void onCheck();
    }
  }, [pending?.token]);

  useEffect(() => {
    if (me?.pendingVerification == null) return;
    const gen = ++restoreGen.current;
    let cancelled = false;
    void (async () => {
      const res = await getVerifyPending();
      if (cancelled || gen !== restoreGen.current) return;
      if (!res.ok || res.data === null) return;
      setPending((current) => current ?? res.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [me?.user.id, me?.pendingVerification?.host, me?.pendingVerification?.origin]);

  const verified = me?.verifiedOrigin ?? null;

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = host.trim();
    if (trimmed === '') {
      const msg = 'Enter a host or https origin.';
      setError(msg);
      announce(msg);
      hostInput.current?.focus();
      return;
    }
    setBusy('start');
    setError(null);
    const res = await postVerifyStart(trimmed);
    setBusy(null);
    if (!res.ok) {
      setError(res.error.message);
      announce(res.error.message);
      return;
    }
    setPending(res.data);
    await refreshMe();
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

  async function onStartOver() {
    if (busy) return;
    restoreGen.current += 1;
    setBusy('cancel');
    setError(null);
    const res = await postVerifyCancel();
    setBusy(null);
    if (!res.ok) {
      setError(res.error.message);
      announce(res.error.message);
      return;
    }
    setPending(null);
    setHost('');
    await refreshMe();
    announce('Verification reset. The previous token will no longer work.');
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

  const quietBtn = buttonVariants({ variant: 'secondary', size: 'sm' });
  const dangerBtn = buttonVariants({ variant: 'destructive', size: 'sm' });

  const onHostChange = (value: string) => {
    setHost(value);
    if (error) setError(null);
  };

  return (
    <TelemetryPanel ticks="bar" aria-labelledby="verify-panel-heading" className="bg-background">
      <div className="flex flex-col gap-1">
        <h3 id="verify-panel-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          Verify your site
        </h3>
        <p id={verifyHelpId} className="text-sm text-muted-foreground">
          Macro needs proof you control one HTTPS origin. Add either a DNS TXT record or a{' '}
          <code className="font-mono text-[0.92em] text-foreground">/.well-known/macro-site-verification</code> file with the token below, then check.
        </p>
      </div>

      {verified !== null ? (
        <div className="flex flex-wrap items-center gap-2.5 text-sm" role="status">
          <Badge variant="ok">Verified</Badge>
          <span className="font-mono text-foreground">{verified.host}</span>
          {busy === 'clear' ? (
            <Button type="button" variant="secondary" size="sm" disabled>
              <Busy>Clearing</Busy>
            </Button>
          ) : (
            <ConfirmButton
              label="Clear"
              confirmLabel="Confirm clear"
              cancelLabel="Keep"
              className={quietBtn}
              confirmClassName={dangerBtn}
              cancelClassName={quietBtn}
              disabled={busy !== null}
              onConfirm={() => void onClear()}
            />
          )}
        </div>
      ) : null}

      <AlertRegion id={verifyErrorId} className={cn(!error && 'sr-only')}>
        {error ? <p>{error}</p> : null}
      </AlertRegion>

      {pending === null ? (
        verified !== null ? (
          <details className="rounded-md border border-border bg-surface p-3.5">
            <summary className="cursor-pointer text-sm font-medium text-foreground focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring">
              Verify a different host
            </summary>
            <VerifyHostForm
              host={host}
              busy={busy !== null}
              starting={busy === 'start'}
              hasError={Boolean(error)}
              helpId={verifyHelpId}
              errorId={verifyErrorId}
              inputRef={hostInput}
              className="mt-3"
              onHostChange={onHostChange}
              onSubmit={(e) => void onStart(e)}
            />
          </details>
        ) : (
          <VerifyHostForm
            host={host}
            busy={busy !== null}
            starting={busy === 'start'}
            hasError={Boolean(error)}
            helpId={verifyHelpId}
            errorId={verifyErrorId}
            inputRef={hostInput}
            onHostChange={onHostChange}
            onSubmit={(e) => void onStart(e)}
          />
        )
      ) : (
        <div className="flex flex-col gap-3">
          {pending.domainConnectUrl ? (
            <div className="flex flex-col gap-2 rounded-md border border-bar-hover bg-secondary p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="ok">
                  <ZapIcon aria-hidden="true" />
                  {pending.domainConnectProviderName
                    ? `${pending.domainConnectProviderName} detected`
                    : 'Domain Connect ready'}
                </Badge>
                <Button
                  render={
                    <a href={pending.domainConnectUrl} target="_blank" rel="noopener noreferrer" />
                  }
                  nativeButton={false}
                  variant="default"
                  size="sm"
                >
                  Auto-configure DNS
                  <ExternalLinkIcon data-icon="inline-end" />
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your DNS provider supports Domain Connect. Authorize Macro to provision the verification TXT record automatically in one click.
              </p>
            </div>
          ) : pending.isCloudflare ? (
            <div className="flex flex-col gap-2 rounded-md border border-bar-hover bg-secondary p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge variant="warn">
                  <CloudIcon aria-hidden="true" />
                  Cloudflare detected
                </Badge>
                <Button
                  render={
                    <a
                      href={pending.cloudFlareDirectUrl ?? 'https://dash.cloudflare.com'}
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  }
                  nativeButton={false}
                  variant="outline"
                  size="sm"
                  className="border-bar-hover bg-background"
                >
                  Open Cloudflare DNS
                  <ExternalLinkIcon data-icon="inline-end" />
                </Button>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Your domain uses Cloudflare DNS. Open your dashboard to add the TXT record, then check below.
              </p>
            </div>
          ) : null}

          {pending.domainConnectUrl ? (
            <div>
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setShowManual((v) => !v)}
              >
                {showManual ? 'Hide manual DNS records' : 'Or configure DNS records manually'}
              </Button>
            </div>
          ) : null}

          {showManual || !pending.domainConnectUrl ? (
            <div className="grid gap-2.5">
              {[
                { label: 'DNS TXT name', value: pending.txtName },
                { label: 'DNS TXT value', value: pending.txtValue },
                { label: 'Well-known URL', value: pending.wellKnownUrl },
                { label: 'File body', value: pending.token },
              ].map((record) => (
                <div key={record.label} className="grid gap-1">
                  <span className="text-xs font-medium text-muted-foreground">{record.label}</span>
                  <div className="flex items-center justify-between gap-2 rounded-md border border-bar-hover bg-secondary px-2.5 py-1.5">
                    <code className="min-w-0 flex-1 font-mono text-xs break-all text-foreground select-all">
                      {record.value}
                    </code>
                    <CopyButton text={record.value} onAnnounce={announce} />
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2.5">
            <Button type="button" disabled={busy !== null} onClick={() => void onCheck()}>
              {busy === 'check' ? <Busy>Checking</Busy> : 'I added the proof — check'}
            </Button>
            {busy === 'cancel' ? (
              <Button type="button" variant="secondary" disabled>
                <Busy>Resetting</Busy>
              </Button>
            ) : (
              <ConfirmButton
                label="Start over"
                confirmLabel="Reset token"
                cancelLabel="Keep"
                className={buttonVariants({ variant: 'secondary' })}
                confirmClassName={buttonVariants({ variant: 'destructive' })}
                cancelClassName={buttonVariants({ variant: 'secondary' })}
                disabled={busy !== null}
                onConfirm={() => void onStartOver()}
              />
            )}
          </div>
        </div>
      )}
    </TelemetryPanel>
  );
}
