/** Small building blocks shared by every screen of the app. */
import { type ReactNode, useEffect, useState } from 'react';
import { Badge as UiBadge } from '@/components/ui/badge';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PolicyViolationView } from '../../../../../src/api-types.ts';
import type { RunStatus } from '../../../../../src/types.ts';
import type { ApiError } from '../lib/api.ts';
import { fmtUtc, parseErrorText } from '../lib/format.ts';
import { runHref } from '../router.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'live';

const TONE_TO_VARIANT: Record<Tone, 'ok' | 'warn' | 'destructive' | 'outline' | 'live'> = {
  ok: 'ok',
  warn: 'warn',
  bad: 'destructive',
  neutral: 'outline',
  live: 'live',
};

/** Status words always carry the meaning; the tone only adds colour. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <UiBadge variant={TONE_TO_VARIANT[tone]}>{children}</UiBadge>;
}

export function statusTone(status: RunStatus | string): Tone {
  switch (status) {
    case 'running':
      return 'live';
    case 'completed':
      return 'ok';
    case 'halted':
    case 'stopped':
    case 'timed_out':
      return 'warn';
    case 'failed':
    case 'interrupted':
      return 'bad';
    default:
      return 'neutral';
  }
}

export const statusWords = (status: string): string => status.replace(/_/g, ' ');

export function StatusBadge({ status }: { status: RunStatus | string }) {
  return <Badge tone={statusTone(status)}>{status === 'running' ? 'running' : statusWords(status)}</Badge>;
}

/** A busy line: spinner plus the words saying what is happening. */
export function Busy({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return (
    <span
      className={cn('inline-flex items-center gap-2 text-[0.8125rem] text-muted-foreground', className)}
      role="status"
    >
      <span className="spinner" aria-hidden="true" />
      <span>{children}</span>
    </span>
  );
}

/** Anticipatory structural page skeleton displayed while loading. */
export function PageSkeleton({
  title = 'Loading…',
  showSplit = true,
}: {
  title?: string;
  showSplit?: boolean;
}) {
  return (
    <section
      className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6"
      role="status"
      aria-busy="true"
      aria-label={title}
    >
      <header className="grid animate-pulse gap-2 motion-reduce:animate-none">
        <div className="mb-1 h-7 w-[220px] rounded-sm bg-surface-2" />
        <div className="mb-3 h-4 w-[440px] max-w-[90%] rounded-sm bg-surface-2" />
      </header>
      {showSplit ? (
        <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex animate-pulse flex-col gap-3 rounded-md border border-border bg-surface p-5 motion-reduce:animate-none sm:px-6">
              <div className="h-[18px] w-40 rounded-sm bg-surface-2" />
              <div className="h-[150px] rounded-md bg-surface-2" />
              <div className="flex gap-2.5 pt-1">
                <div className="h-[30px] w-24 rounded-md bg-surface-2" />
                <div className="h-[30px] w-24 rounded-md bg-surface-2" />
                <div className="h-[30px] w-24 rounded-md bg-surface-2" />
              </div>
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            <div className="flex animate-pulse flex-col gap-2.5 rounded-md border border-border bg-surface p-5 motion-reduce:animate-none sm:px-6">
              <div className="mb-1.5 h-[18px] w-40 rounded-sm bg-surface-2" />
              <div className="h-3 w-4/5 rounded-sm bg-surface-2" />
              <div className="h-3 w-3/5 rounded-sm bg-surface-2" />
              <div className="h-3 w-[90%] rounded-sm bg-surface-2" />
              <div className="h-3 w-2/5 rounded-sm bg-surface-2" />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex animate-pulse flex-col gap-3 rounded-md border border-border bg-surface p-5 motion-reduce:animate-none sm:px-6">
          <div className="h-[18px] w-40 rounded-sm bg-surface-2" />
          <div className="h-[150px] rounded-md bg-surface-2" />
        </div>
      )}
    </section>
  );
}

/** Horizontal scroll region for wide tables, reachable by keyboard. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="overflow-x-auto rounded-sm print:overflow-visible" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function KeyValues({ items }: { items: readonly (readonly [string, ReactNode] | null | false)[] }) {
  return (
    <dl className="m-0 grid min-w-0 grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-[0.8125rem]">
      {items.map((item) =>
        item ? (
          <div key={item[0]} className="contents">
            <dt className="text-muted-foreground">{item[0]}</dt>
            <dd className="m-0 min-w-0 break-words [&_code]:break-all">{item[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

export function ViolationsTable({ violations }: { violations: readonly PolicyViolationView[] }) {
  return (
    <TableWrap label="Policy violations">
      <table className="data-table">
        <caption>Policy violations</caption>
        <thead>
          <tr>
            <th scope="col">Rule</th>
            <th scope="col">Field</th>
            <th scope="col">Problem</th>
          </tr>
        </thead>
        <tbody>
          {violations.map((v, i) => (
            <tr key={`${v.rule}-${v.path}-${i}`}>
              <th scope="row" className="idx font-mono tabular-nums">
                {v.rule}
              </th>
              <td className="font-mono text-xs break-all">{v.path === '' ? '(whole plan)' : v.path}</td>
              <td>{v.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableWrap>
  );
}

/** The fixed message, then whatever the error carries: retry time, active run, parse error, violations. */
export function ApiErrorText({ error }: { error: ApiError }) {
  return (
    <div className="grid gap-1.5">
      <p className="m-0 font-medium">{error.message}</p>
      {error.code === 'rate_limited' && error.retryAt !== undefined ? <p className="m-0">You can try again after {fmtUtc(error.retryAt)}.</p> : null}
      {error.code === 'daily_limit' && error.resetAt !== undefined ? <p className="m-0">The daily limit resets at {fmtUtc(error.resetAt)}.</p> : null}
      {error.code === 'run_active' && error.activeRunId !== undefined ? (
        <p className="m-0">
          <a href={runHref(error.activeRunId)}>Open the active run</a>.
        </p>
      ) : null}
      {error.parseError ? <p className="m-0">Plan could not be read: {parseErrorText(error.parseError)}</p> : null}
      {error.violations && error.violations.length > 0 ? <ViolationsTable violations={error.violations} /> : null}
    </div>
  );
}

/** An alert region that is always in the DOM, so screen readers hear what lands in it. */
export function AlertRegion({
  id,
  error,
  className,
  children,
}: {
  id?: string | undefined;
  error?: ApiError | null;
  className?: string | undefined;
  children?: ReactNode;
}) {
  const has = Boolean(error) || Boolean(children);
  return (
    <div
      id={id}
      className={cn(
        has ? 'grid gap-1.5 rounded-md border border-bad px-3.5 py-3 text-[0.8125rem] text-foreground' : 'border-0 p-0',
        className,
      )}
      role="alert"
    >
      {error ? <ApiErrorText error={error} /> : children}
    </div>
  );
}

export const DASH = '\u2013';

/** Two-step inline confirmation for destructive actions without native popups. */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel = 'Keep',
  disabled = false,
  className = buttonVariants({ variant: 'secondary' }),
  confirmClassName = buttonVariants({ variant: 'destructive' }),
  cancelClassName = buttonVariants({ variant: 'secondary' }),
  onConfirm,
}: {
  label: ReactNode;
  confirmLabel: ReactNode;
  cancelLabel?: ReactNode;
  disabled?: boolean;
  className?: string;
  confirmClassName?: string;
  cancelClassName?: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (disabled) setArmed(false);
  }, [disabled]);

  if (!armed) {
    return (
      <button type="button" className={className} disabled={disabled} onClick={() => setArmed(true)}>
        {label}
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-3">
      <button type="button" className={cancelClassName} disabled={disabled} onClick={() => setArmed(false)}>
        {cancelLabel}
      </button>
      <button
        type="button"
        className={confirmClassName}
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onConfirm();
        }}
      >
        {confirmLabel}
      </button>
    </span>
  );
}
