/**
 * Sign in (`#/sign-in`) and Account (`#/account`): GitHub/Google OAuth, magic link email,
 * active session actions, and account deletion.
 */
import { type Ref, useEffect, useId, useRef, useState } from 'react';
import { ArrowLeftIcon, GlobeIcon, LogOutIcon, MailIcon, TablePropertiesIcon } from 'lucide-react';
import type { MeResponse } from '../../../../../src/api-types.ts';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DitherBanner, StageBand, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { useOptionalShell } from '../components/shell/ShellContext.tsx';
import { Busy, ConfirmButton } from '../components/ui.tsx';
import { useApp } from '../context.tsx';
import { clearReviewState, deleteAccount, githubStartHref, googleStartHref, postMagicLink } from '../lib/auth-api.ts';
import { clearRecentRuns } from '../lib/recent-runs.ts';

export interface EmailLinkPanelProps {
  email: string;
  busy: boolean;
  sent: boolean;
  wait: number;
  error: string | null;
  /** Receives the email field so the page can focus it when a submit is rejected. */
  inputRef?: Ref<HTMLInputElement> | undefined;
  onEmailChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onBack: () => void;
}

/** Magic-link email sign-in panel with explicit label association, validation alert, and cooldown state. */
export function EmailLinkPanel({
  email,
  busy,
  sent,
  wait,
  error,
  inputRef,
  onEmailChange,
  onSubmit,
  onBack,
}: EmailLinkPanelProps) {
  const emailId = useId();
  const emailHintId = useId();
  const emailErrorId = useId();
  const emailStatusId = useId();
  const describedBy = [emailHintId, emailErrorId, sent ? emailStatusId : null].filter(Boolean).join(' ');

  return (
    <TelemetryPanel ticks="bar" aria-labelledby="signin-email-heading" className="bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="signin-email-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          Email link
        </h2>
        {wait > 0 ? (
          <Badge variant="outline" className="font-mono tabular-nums">
            Cooldown {wait}s
          </Badge>
        ) : null}
      </div>

      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-3.5">
        <div className="flex max-w-[420px] flex-col gap-1.5">
          <label htmlFor={emailId} className="text-[0.8125rem] font-medium text-muted-foreground">
            Email
          </label>
          <input
            ref={inputRef}
            id={emailId}
            type="email"
            name="email"
            autoComplete="email"
            spellCheck={false}
            placeholder="you@company.com…"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
            disabled={busy}
            aria-invalid={Boolean(error)}
            aria-describedby={describedBy}
            className={cn(
              'h-10 w-full rounded-md border bg-background px-3 text-[0.9375rem] text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
              error ? 'border-bad' : 'border-bar',
            )}
          />
          <p id={emailHintId} className="m-0 text-xs text-muted-foreground">
            We will email a one-time sign-in link to this address.
          </p>
        </div>

        <div
          id={emailErrorId}
          role="alert"
          className={cn(
            error
              ? 'flex max-w-[420px] flex-col gap-1.5 rounded-md border border-bad bg-background px-3.5 py-2.5 text-sm text-foreground'
              : 'sr-only',
          )}
        >
          {error ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">Could not send link</Badge>
              </div>
              <p className="m-0">{error}</p>
            </>
          ) : null}
        </div>

        <div
          id={emailStatusId}
          role="status"
          className={cn(
            sent
              ? 'flex max-w-[420px] flex-wrap items-center gap-2 rounded-md border border-ok bg-background px-3.5 py-2.5 text-sm text-foreground'
              : 'sr-only',
          )}
        >
          {sent ? (
            <>
              <Badge variant="ok">Link sent</Badge>
              <span>Check your email for a sign-in link.</span>
            </>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button type="submit" disabled={busy || wait > 0}>
            {busy ? (
              <Busy>Sending…</Busy>
            ) : wait > 0 ? (
              <span className="font-mono tabular-nums">{`Wait ${wait}s`}</span>
            ) : (
              <>
                <MailIcon data-icon="inline-start" />
                Send sign-in link
              </>
            )}
          </Button>
          <Button type="button" variant="secondary" onClick={onBack}>
            <ArrowLeftIcon data-icon="inline-start" />
            Back to Test Studio
          </Button>
        </div>
      </form>
    </TelemetryPanel>
  );
}

export interface AccountPanelProps {
  me: MeResponse;
  signingOut: boolean;
  deleting: boolean;
  deleteError: string | null;
  onBack: () => void;
  onSignOut: () => void;
  onDelete: () => void;
}

/** Signed-in Account workspace view: identity telemetry, navigation/sign-out actions, and account deletion. */
export function AccountPanel({
  me,
  signingOut,
  deleting,
  deleteError,
  onBack,
  onSignOut,
  onDelete,
}: AccountPanelProps) {
  const identity = me.user.githubLogin ?? me.user.email;

  return (
    <section className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-6" aria-labelledby="account-heading">
      <header className="grid gap-2">
        <StageBand />
        <h1
          id="account-heading"
          className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]"
        >
          Account
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          You are signed in as <strong className="font-medium break-all text-foreground">{identity}</strong>.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-4">
          <TelemetryPanel ticks="bar" aria-labelledby="session-active-heading" className="gap-4 bg-card">
            <h2 id="session-active-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              Session active
            </h2>

            <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
              Your account can run private load tests against your verified domain.
            </p>

            <div className="flex flex-wrap items-center gap-2.5">
              <Button type="button" onClick={onBack}>
                <ArrowLeftIcon data-icon="inline-start" />
                Back to Test Studio
              </Button>
              <Button render={<a href="#/domains" />} nativeButton={false} variant="secondary">
                <GlobeIcon data-icon="inline-start" />
                Manage domains
              </Button>
              <Button render={<a href="#/runs" />} nativeButton={false} variant="secondary">
                <TablePropertiesIcon data-icon="inline-start" />
                View Runs Table
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-bar"
                disabled={signingOut || deleting}
                onClick={onSignOut}
              >
                {signingOut ? (
                  <Busy>Signing out…</Busy>
                ) : (
                  <>
                    <LogOutIcon data-icon="inline-start" />
                    Sign out
                  </>
                )}
              </Button>
            </div>
          </TelemetryPanel>

          <TelemetryPanel ticks="bar" aria-labelledby="delete-account-heading" className="gap-4 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="delete-account-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                Delete account
              </h2>
              <Badge variant="outline">Permanent</Badge>
            </div>

            <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
              Permanently deletes your account, verified domain, saved draft, and private runs.
            </p>

            <div
              role="alert"
              className={cn(
                deleteError
                  ? 'flex flex-col gap-1.5 rounded-md border border-bad bg-background px-3.5 py-2.5 text-sm text-foreground'
                  : 'sr-only',
              )}
            >
              {deleteError ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="destructive">Delete failed</Badge>
                  </div>
                  <p className="m-0">{deleteError}</p>
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <ConfirmButton
                label={deleting ? 'Deleting…' : 'Delete account'}
                confirmLabel="Confirm delete"
                cancelLabel="Keep account"
                className={buttonVariants({ variant: 'secondary' })}
                confirmClassName={buttonVariants({ variant: 'destructive' })}
                cancelClassName={buttonVariants({ variant: 'secondary' })}
                disabled={deleting || signingOut}
                onConfirm={onDelete}
              />
              {deleting ? <Busy>Deleting your account…</Busy> : null}
            </div>
          </TelemetryPanel>
        </div>

        <aside aria-label="Account and data summary" className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20">
          <TelemetryPanel ticks="bar" aria-labelledby="account-data-heading">
            <DitherBanner
              src="/landing/img/dither/sanok-workers.webp"
              label="Account & data"
              meta="Private runs & drafts"
            />
            <h2 id="account-data-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              Account &amp; data
            </h2>
            <dl className="m-0 grid gap-3">
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Email</dt>
                <dd className="m-0 font-mono text-xs break-all text-foreground">{me.user.email}</dd>
              </div>
              <div className="grid gap-0.5 border-t border-border pt-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Session cookie</dt>
                <dd className="m-0 text-sm text-foreground">HttpOnly cookie solely to keep you signed in.</dd>
              </div>
              <div className="grid gap-0.5 border-t border-border pt-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Account deletion</dt>
                <dd className="m-0 text-sm text-foreground">
                  Immediately removes your account, saved draft, verified domain, and private runs.
                </dd>
              </div>
            </dl>
            <p className="m-0 text-xs text-muted-foreground">
              Details in the{' '}
              <a href="/privacy" className="text-foreground underline underline-offset-4 hover:text-accent-text">
                privacy policy
              </a>
              .
            </p>
          </TelemetryPanel>
        </aside>
      </div>
    </section>
  );
}

export function SignIn() {
  const { config, me, navigate, announce, refreshMe } = useApp();
  const shell = useOptionalShell();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [wait, setWait] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const signingOut = shell?.state.signingOut ?? false;

  useEffect(() => {
    if (wait <= 0) return;
    const id = window.setInterval(() => setWait((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => window.clearInterval(id);
  }, [wait]);

  const rawHash = typeof window !== 'undefined' ? window.location.hash : '';
  const params = new URLSearchParams(rawHash.split('?')[1] ?? '');
  const githubEmailError = params.get('error') === 'github_email';
  const googleEmailError = params.get('error') === 'google_email';

  if (me !== null) {
    return (
      <AccountPanel
        me={me}
        signingOut={signingOut}
        deleting={deleting}
        deleteError={deleteError}
        onBack={() => navigate('/')}
        onSignOut={() => {
          if (!signingOut && !deleting) void shell?.actions.signOut();
        }}
        onDelete={() => {
          if (deleting || signingOut) return;
          void (async () => {
            setDeleting(true);
            setDeleteError(null);
            const res = await deleteAccount();
            setDeleting(false);
            if (!res.ok) {
              setDeleteError(res.error.message);
              announce(res.error.message);
              return;
            }
            clearRecentRuns();
            clearReviewState();
            await refreshMe();
            announce('Account deleted.');
          })();
        }}
      />
    );
  }

  async function onMagic(e: React.FormEvent) {
    e.preventDefault();
    if (busy || wait > 0) return;
    const trimmed = email.trim();
    if (trimmed === '' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      const msg = 'Enter a valid email address.';
      setError(msg);
      setSent(false);
      announce(msg);
      emailInput.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    setSent(false);
    const result = await postMagicLink(trimmed, '/app/#/'); // return to New test; draft hydrates from account + stash
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
    <section className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-6" aria-labelledby="signin-heading">
      <header className="grid gap-2">
        <StageBand />
        <h1
          id="signin-heading"
          className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]"
        >
          Sign in
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          Sign in to verify your site and keep own-site runs private. The demo shop still works signed out.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <div className="flex min-w-0 flex-col gap-4">
        {githubEmailError ? (
          <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-2 bg-card">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">GitHub email required</Badge>
            </div>
            <p className="m-0 max-w-[72ch] text-sm text-foreground">
              GitHub did not provide a verified email. Use a magic link, or make a verified email public on GitHub and try again.
            </p>
          </TelemetryPanel>
        ) : null}

        {googleEmailError ? (
          <TelemetryPanel tone="bad" ticks="bad" role="alert" className="gap-2 bg-card">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="destructive">Google email required</Badge>
            </div>
            <p className="m-0 max-w-[72ch] text-sm text-foreground">
              Google did not provide a verified email. Use a magic link or another Google account with a verified email.
            </p>
          </TelemetryPanel>
        ) : null}

        {config.googleSignIn ? (
          <TelemetryPanel ticks="bar" aria-labelledby="signin-google-heading" className="bg-card">
            <h2 id="signin-google-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              Google
            </h2>
            <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
              Uses your Google account. Macro needs a verified email address.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button render={<a href={googleStartHref()} />} nativeButton={false}>
                Continue with Google
              </Button>
            </div>
          </TelemetryPanel>
        ) : null}

        {config.githubSignIn ? (
          <TelemetryPanel ticks="bar" aria-labelledby="signin-github-heading" className="bg-card">
            <h2 id="signin-github-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              GitHub
            </h2>
            <p className="m-0 max-w-[72ch] text-sm text-muted-foreground">
              Uses your GitHub account. Macro needs a verified email address.
            </p>
            <div className="flex flex-wrap items-center gap-2.5">
              <Button render={<a href={githubStartHref()} />} nativeButton={false}>
                Continue with GitHub
              </Button>
            </div>
          </TelemetryPanel>
        ) : null}

        <EmailLinkPanel
          email={email}
          busy={busy}
          sent={sent}
          wait={wait}
          error={error}
          inputRef={emailInput}
          onEmailChange={(value) => {
            setEmail(value);
            if (error) setError(null);
          }}
          onSubmit={(e) => void onMagic(e)}
          onBack={() => navigate('/')}
        />
        </div>

        <aside aria-label="What signing in unlocks" className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20">
          <TelemetryPanel ticks="bar" aria-labelledby="signin-benefits-heading">
            <DitherBanner
              src="/landing/img/dither/sanok-trucks.webp"
              label="No credit card required"
              meta="Demo & Own Site"
            />
            <h2 id="signin-benefits-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
              What signing in unlocks
            </h2>
            <dl className="m-0 grid gap-3">
              <div className="grid gap-0.5">
                <dt className="text-xs font-medium text-muted-foreground">Verified Own Site</dt>
                <dd className="m-0 text-sm text-foreground">Verify 1 HTTPS origin via Domain Connect, DNS TXT, or /.well-known/.</dd>
              </div>
              <div className="grid gap-0.5 border-t border-border pt-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Runs Table retention</dt>
                <dd className="m-0 text-sm text-foreground">Store up to 50 private runs with side-by-side Run Compare.</dd>
              </div>
              <div className="grid gap-0.5 border-t border-border pt-2.5">
                <dt className="text-xs font-medium text-muted-foreground">Draft sync</dt>
                <dd className="m-0 text-sm text-foreground">Keep your Traffic Description saved across sessions.</dd>
              </div>
            </dl>
          </TelemetryPanel>
        </aside>
      </div>
    </section>
  );
}
