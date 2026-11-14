/** Small building blocks shared by every screen of the app. */
import { type ReactNode, useEffect, useState } from 'react';
import type { ApiError } from '../lib/api.ts';
import { fmtUtc, parseErrorText } from '../lib/format.ts';
import type { PolicyViolationView } from '../../../../../src/api-types.ts';
import type { RunStatus } from '../../../../../src/types.ts';
import { runHref } from '../router.ts';

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral' | 'live';

/** Status words always carry the meaning; the tone only adds colour. */
export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={tone === 'neutral' ? 'badge' : `badge badge--${tone}`}>{children}</span>;
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
export function Busy({ children }: { children: ReactNode }) {
  return (
    <span className="busy" role="status">
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
    <section className="page page--skeleton" role="status" aria-busy="true" aria-label={title}>
      <header className="page__head skeleton-pulse">
        <div className="skeleton-line skeleton-line--title" />
        <div className="skeleton-line skeleton-line--lead" />
      </header>
      {showSplit ? (
        <div className="split">
          <div className="split__main">
            <div className="panel skeleton-pulse">
              <div className="skeleton-line skeleton-line--heading" />
              <div className="skeleton-block skeleton-block--area" />
              <div className="skeleton-row">
                <div className="skeleton-pill" />
                <div className="skeleton-pill" />
                <div className="skeleton-pill" />
              </div>
            </div>
          </div>
          <div className="split__side">
            <div className="panel skeleton-pulse">
              <div className="skeleton-line skeleton-line--heading" />
              <div className="skeleton-line skeleton-line--w80" />
              <div className="skeleton-line skeleton-line--w60" />
              <div className="skeleton-line skeleton-line--w90" />
              <div className="skeleton-line skeleton-line--w40" />
            </div>
          </div>
        </div>
      ) : (
        <div className="panel skeleton-pulse">
          <div className="skeleton-line skeleton-line--heading" />
          <div className="skeleton-block skeleton-block--area" />
        </div>
      )}
    </section>
  );
}

/** Horizontal scroll region for wide tables, reachable by keyboard. */
export function TableWrap({ label, children }: { label: string; children: ReactNode }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
    <div className="table-wrap" role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

export function KeyValues({ items }: { items: readonly (readonly [string, ReactNode] | null | false)[] }) {
  return (
    <dl className="kv">
      {items.map((item) =>
        item ? (
          <div key={item[0]}>
            <dt>{item[0]}</dt>
            <dd>{item[1]}</dd>
          </div>
        ) : null,
      )}
    </dl>
  );
}

export function ViolationsTable({ violations }: { violations: readonly PolicyViolationView[] }) {
  return (
    <TableWrap label="Policy violations">
      <table className="table">
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
              <th scope="row" className="idx">
                {v.rule}
              </th>
              <td className="code">{v.path === '' ? '(whole plan)' : v.path}</td>
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
    <div className="stack-tight">
      <p className="alert__message">{error.message}</p>
      {error.code === 'rate_limited' && error.retryAt !== undefined ? <p>You can try again after {fmtUtc(error.retryAt)}.</p> : null}
      {error.code === 'daily_limit' && error.resetAt !== undefined ? <p>The daily limit resets at {fmtUtc(error.resetAt)}.</p> : null}
      {error.code === 'run_active' && error.activeRunId !== undefined ? (
        <p>
          <a href={runHref(error.activeRunId)}>Open the active run</a>.
        </p>
      ) : null}
      {error.parseError ? <p>Plan could not be read: {parseErrorText(error.parseError)}</p> : null}
      {error.violations && error.violations.length > 0 ? <ViolationsTable violations={error.violations} /> : null}
    </div>
  );
}

/** An alert region that is always in the DOM, so screen readers hear what lands in it. */
export function AlertRegion({ error, children }: { error?: ApiError | null; children?: ReactNode }) {
  const has = Boolean(error) || Boolean(children);
  return (
    <div className={has ? 'alert' : 'alert alert--empty'} role="alert">
      {error ? <ApiErrorText error={error} /> : children}
    </div>
  );
}

export function Panel({
  title,
  id,
  note,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  id?: string;
  note?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={className ? `panel ${className}` : 'panel'} aria-labelledby={title && id ? id : undefined}>
      {title || actions ? (
        <div className="panel__head">
          {title ? <h2 id={id}>{title}</h2> : null}
          {actions}
        </div>
      ) : null}
      {note ? <p className="panel__note">{note}</p> : null}
      {children}
    </section>
  );
}

export const DASH = '\u2013';

/** Two-step inline confirmation for destructive actions without native popups. */
export function ConfirmButton({
  label,
  confirmLabel,
  cancelLabel = 'Keep',
  disabled = false,
  className = 'btn btn--quiet',
  confirmClassName = 'btn btn--danger',
  cancelClassName = 'btn btn--quiet',
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
    <span className="row">
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
      <button type="button" className={cancelClassName} disabled={disabled} onClick={() => setArmed(false)}>
        {cancelLabel}
      </button>
    </span>
  );
}
