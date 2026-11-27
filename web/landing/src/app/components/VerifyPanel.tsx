/**
 * Inline own-site verification: start a token, show DNS + well-known instructions, check, or clear.
 */
import { type Ref, useEffect, useId, useReducer, useRef, useState } from 'react';
import { ArrowRightIcon, CheckIcon, CloudIcon, CopyIcon, ExternalLinkIcon, ZapIcon } from 'lucide-react';
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
          spellCheck={false}
          required
          placeholder="shop.example.com…"
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
          {starting ? <Busy>Starting…</Busy> : 'Start verification'}
        </Button>
      </div>
    </form>
  );
}

/** Removes `domainConnect=done` from a location hash while preserving any sibling query parameters. */
export function stripDomainConnectParam(hash: string): string {
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return hash;
  const base = hash.slice(0, qIdx);
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  if (!params.has('domainConnect')) return hash;
  params.delete('domainConnect');
  const rest = params.toString();
  return rest === '' ? base : `${base}?${rest}`;
}

/** Decides whether returning from Domain Connect should trigger `onCheck`, wait for hydration, or ignore. */
export function shouldAutoCheckDomainConnect({
  hash,
  hasPending,
  alreadyVerified,
}: {
  hash: string;
  hasPending: boolean;
  alreadyVerified: boolean;
}): 'wait' | 'check' | 'ignore' {
  const qIdx = hash.indexOf('?');
  if (qIdx === -1) return 'ignore';
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  if (params.get('domainConnect') !== 'done') return 'ignore';
  if (hasPending) return 'check';
  if (alreadyVerified) return 'ignore';
  return 'wait';
}

export type VerifyFlowState =
  | { kind: 'idle'; error: string | null }
  | { kind: 'starting' }
  | { kind: 'pending'; pending: VerifyStartResponse; showManual: boolean; error: string | null }
  | { kind: 'checking'; pending: VerifyStartResponse; showManual: boolean }
  | { kind: 'cancelling'; pending: VerifyStartResponse; showManual: boolean }
  | { kind: 'clearing' };

export type VerifyFlowEvent =
  | { type: 'validation_error'; message: string }
  | { type: 'clear_error' }
  | { type: 'restore_pending'; pending: VerifyStartResponse }
  | { type: 'toggle_manual' }
  | { type: 'start' }
  | { type: 'start_ok'; pending: VerifyStartResponse }
  | { type: 'start_err'; message: string }
  | { type: 'check' }
  | { type: 'check_ok' }
  | { type: 'check_err'; message: string }
  | { type: 'cancel' }
  | { type: 'cancel_ok' }
  | { type: 'cancel_err'; message: string }
  | { type: 'clear' }
  | { type: 'clear_ok' }
  | { type: 'clear_err'; message: string };

export function verifyFlowReducer(state: VerifyFlowState, event: VerifyFlowEvent): VerifyFlowState {
  switch (event.type) {
    case 'validation_error':
      return state.kind === 'idle' ? { kind: 'idle', error: event.message } : state;
    case 'clear_error':
      if (state.kind === 'idle') return state.error === null ? state : { kind: 'idle', error: null };
      if (state.kind === 'pending') return state.error === null ? state : { ...state, error: null };
      return state;
    case 'restore_pending':
      return state.kind === 'idle'
        ? { kind: 'pending', pending: event.pending, showManual: false, error: null }
        : state;
    case 'toggle_manual':
      return state.kind === 'pending' ? { ...state, showManual: !state.showManual } : state;
    case 'start':
      return state.kind === 'idle' ? { kind: 'starting' } : state;
    case 'start_ok':
      return state.kind === 'starting'
        ? { kind: 'pending', pending: event.pending, showManual: false, error: null }
        : state;
    case 'start_err':
      return state.kind === 'starting' ? { kind: 'idle', error: event.message } : state;
    case 'check':
      return state.kind === 'pending'
        ? { kind: 'checking', pending: state.pending, showManual: state.showManual }
        : state;
    case 'check_ok':
      return state.kind === 'checking' ? { kind: 'idle', error: null } : state;
    case 'check_err':
      return state.kind === 'checking'
        ? { kind: 'pending', pending: state.pending, showManual: state.showManual, error: event.message }
        : state;
    case 'cancel':
      return state.kind === 'pending'
        ? { kind: 'cancelling', pending: state.pending, showManual: state.showManual }
        : state;
    case 'cancel_ok':
      return state.kind === 'cancelling' ? { kind: 'idle', error: null } : state;
    case 'cancel_err':
      return state.kind === 'cancelling'
        ? { kind: 'pending', pending: state.pending, showManual: state.showManual, error: event.message }
        : state;
    case 'clear':
      return state.kind === 'idle' ? { kind: 'clearing' } : state;
    case 'clear_ok':
      return state.kind === 'clearing' ? { kind: 'idle', error: null } : state;
    case 'clear_err':
      return state.kind === 'clearing' ? { kind: 'idle', error: event.message } : state;
  }
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
  const [flow, dispatch] = useReducer(verifyFlowReducer, { kind: 'idle', error: null });
  const restoreGen = useRef(0);
  const hostInput = useRef<HTMLInputElement>(null);
  const verifyHelpId = useId();
  const verifyErrorId = useId();

  const verified = me?.verifiedOrigin ?? null;
  const pending =
    flow.kind === 'pending' || flow.kind === 'checking' || flow.kind === 'cancelling'
      ? flow.pending
      : null;
  const showManual =
    flow.kind === 'pending' || flow.kind === 'checking' || flow.kind === 'cancelling'
      ? flow.showManual
      : false;
  const busy: 'start' | 'check' | 'clear' | 'cancel' | null =
    flow.kind === 'starting'
      ? 'start'
      : flow.kind === 'checking'
        ? 'check'
        : flow.kind === 'cancelling'
          ? 'cancel'
          : flow.kind === 'clearing'
            ? 'clear'
            : null;
  const error = flow.kind === 'idle' || flow.kind === 'pending' ? flow.error : null;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const hash = window.location.hash;
    const cleanHash = stripDomainConnectParam(hash);
    if (cleanHash === hash) return;

    const action = shouldAutoCheckDomainConnect({
      hash,
      hasPending: pending !== null,
      alreadyVerified: verified !== null,
    });
    if (action === 'wait' && (me === null || me.pendingVerification !== null)) {
      return;
    }

    window.history.replaceState(null, '', window.location.pathname + cleanHash);
    if (action === 'check') {
      void onCheck();
    }
  }, [pending?.token, verified?.origin, me?.pendingVerification]);

  useEffect(() => {
    if (me?.verifiedOrigin != null || me?.pendingVerification == null) return;
    const gen = ++restoreGen.current;
    let cancelled = false;
    void (async () => {
      const res = await getVerifyPending();
      if (cancelled || gen !== restoreGen.current) return;
      if (!res.ok || res.data === null) return;
      dispatch({ type: 'restore_pending', pending: res.data });
    })();
    return () => {
      cancelled = true;
    };
  }, [me?.user.id, me?.pendingVerification?.host, me?.pendingVerification?.origin]);

  async function onStart(e: React.FormEvent) {
    e.preventDefault();
    if (flow.kind !== 'idle') return;
    const trimmed = host.trim();
    if (trimmed === '') {
      const msg = 'Enter a host or https origin.';
      dispatch({ type: 'validation_error', message: msg });
      announce(msg);
      hostInput.current?.focus();
      return;
    }
    dispatch({ type: 'start' });
    const res = await postVerifyStart(trimmed);
    if (!res.ok) {
      dispatch({ type: 'start_err', message: res.error.message });
      announce(res.error.message);
      return;
    }
    dispatch({ type: 'start_ok', pending: res.data });
    await refreshMe();
    announce('Verification token ready. Add the DNS record or well-known file, then check.');
  }

  async function onCheck() {
    if (flow.kind !== 'pending') return;
    dispatch({ type: 'check' });
    const res = await postVerifyCheck();
    if (!res.ok) {
      dispatch({ type: 'check_err', message: res.error.message });
      announce(res.error.message);
      return;
    }
    dispatch({ type: 'check_ok' });
    await refreshMe();
    onVerified?.(res.data.verifiedOrigin);
    announce(`Verified ${res.data.verifiedOrigin.host}.`);
  }

  async function onStartOver() {
    if (flow.kind !== 'pending') return;
    restoreGen.current += 1;
    dispatch({ type: 'cancel' });
    const res = await postVerifyCancel();
    if (!res.ok) {
      dispatch({ type: 'cancel_err', message: res.error.message });
      announce(res.error.message);
      return;
    }
    dispatch({ type: 'cancel_ok' });
    setHost('');
    await refreshMe();
    announce('Verification reset. The previous token will no longer work.');
  }

  async function onClear() {
    if (flow.kind !== 'idle') return;
    dispatch({ type: 'clear' });
    const res = await postVerifyClear();
    if (!res.ok) {
      dispatch({ type: 'clear_err', message: res.error.message });
      announce(res.error.message);
      return;
    }
    dispatch({ type: 'clear_ok' });
    await refreshMe();
    onCleared?.();
    announce('Verified site cleared.');
  }

  const quietBtn = buttonVariants({ variant: 'secondary', size: 'sm' });
  const dangerBtn = buttonVariants({ variant: 'destructive', size: 'sm' });

  const onHostChange = (value: string) => {
    setHost(value);
    if (error) dispatch({ type: 'clear_error' });
  };

  if (verified !== null) {
    return (
      <TelemetryPanel ticks="bar" aria-labelledby="verify-panel-heading" className="bg-background">
        <div className="flex flex-col gap-1">
          <h3 id="verify-panel-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
            Verified domain
          </h3>
          <p className="text-sm text-muted-foreground">
            Your account is limited to one verified HTTPS origin at a time. Remove this domain first if you want to verify a different one.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 text-sm" role="status">
          <Badge variant="ok">Verified</Badge>
          <span className="min-w-0 font-mono break-all text-foreground">{verified.origin}</span>
          {busy === 'clear' ? (
            <Button type="button" variant="secondary" size="sm" disabled>
              <Busy>Removing…</Busy>
            </Button>
          ) : (
            <ConfirmButton
              label="Remove domain"
              confirmLabel="Confirm remove"
              cancelLabel="Keep"
              className={quietBtn}
              confirmClassName={dangerBtn}
              cancelClassName={quietBtn}
              disabled={busy !== null}
              onConfirm={() => void onClear()}
            />
          )}
          <Button render={<a href="#/" />} nativeButton={false} variant="secondary" size="sm">
            Test in Test Studio
            <ArrowRightIcon data-icon="inline-end" />
          </Button>
        </div>

        <AlertRegion id={verifyErrorId} className={cn(!error && 'sr-only')}>
          {error ? <p>{error}</p> : null}
        </AlertRegion>
      </TelemetryPanel>
    );
  }

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

      <AlertRegion id={verifyErrorId} className={cn(!error && 'sr-only')}>
        {error ? <p>{error}</p> : null}
      </AlertRegion>

      {pending === null ? (
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
                  <span className="sr-only"> (opens in new tab)</span>
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
                  <span className="sr-only"> (opens in new tab)</span>
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
                onClick={() => dispatch({ type: 'toggle_manual' })}
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
                    <code className="min-w-0 flex-1 font-mono text-xs break-all text-foreground select-all" translate="no">
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
              {busy === 'check' ? <Busy>Checking…</Busy> : 'Check my proof'}
            </Button>
            {busy === 'cancel' ? (
              <Button type="button" variant="secondary" disabled>
                <Busy>Resetting…</Busy>
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
