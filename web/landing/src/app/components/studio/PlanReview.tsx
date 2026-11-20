import { useEffect, useId, useRef, useState } from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import type { PlanResponse } from '../../../../../../src/api-types.ts';
import { isActionPath } from '../../../../../../src/plan/discover.ts';
import { journeyGroups, journeyLabel, type JourneyRow } from '../../../../../../src/plan/journey-edit.ts';
import type { TestPlan } from '../../../../../../src/types.ts';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useApp } from '../../context.tsx';
import { parseErrorText } from '../../lib/format.ts';
import { ModelCalls } from '../ModelCalls.tsx';
import { StageProfile } from '../StageProfile.tsx';
import { TableWrap, ViolationsTable } from '../ui.tsx';
import {
  isApprovable,
  kindGroups,
  kindHeading,
  pathFace,
  planSize,
  resolveGateStatus,
  sharedDir,
  type StudioBusy,
} from './studio-view.ts';
import { TelemetryPanel } from './TelemetryFrame.tsx';

const fmt = (n: number): string => n.toLocaleString('en-US');

/** The Traffic Description a plan was drafted from, folded once a draft exists. */
export function PlanBrief({
  text,
  origin,
  disabled,
  onEdit,
}: {
  text: string;
  origin: string;
  disabled: boolean;
  onEdit: () => void;
}) {
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="brief-title" className="gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="brief-title" className="m-0 font-sans text-sm font-medium text-muted-foreground">
          Traffic description
        </h2>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={onEdit}
        >
          Edit description
        </Button>
      </div>
      <p className="max-w-[72ch] text-[1.0625rem] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {text}
      </p>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">Target</span>
        <span className="font-mono text-xs break-all text-foreground">{origin}</span>
      </p>
    </TelemetryPanel>
  );
}

/** Drafted Test Plan review: Policy Gate verdict, plan stages & journey, optional route picks, and Model calls. */
export function PlanReview({
  res,
  stale,
  busy,
  onEdit,
  onRevise,
  onChecksDiffer,
}: {
  res: PlanResponse;
  stale: boolean;
  busy: StudioBusy;
  onEdit: () => void;
  onRevise: (routeIds: string[]) => void;
  onChecksDiffer: (differ: boolean) => void;
}) {
  const { announce } = useApp();
  const heading = useRef<HTMLHeadingElement>(null);
  const plan = res.plan;
  const gate = res.gate;
  const gateStatus = resolveGateStatus(res);
  const rejected = gate !== null && gate.status === 'rejected';
  const approvable = isApprovable(res);

  // Announce the outcome and move focus to the review once, when it appears.
  useEffect(() => {
    if (res.parseError) announce('The drafted plan could not be read. It cannot be approved.');
    else if (plan !== null && rejected) announce('The plan was rejected by the policy gate.');
    else if (approvable) announce('Plan ready for review.');
    heading.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const editButton = (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="secondary"
        disabled={busy !== null}
        onClick={onEdit}
      >
        Edit description
      </Button>
    </div>
  );

  const badgeVariant =
    gateStatus.tone === 'ok' ? 'ok' : gateStatus.tone === 'bad' ? 'destructive' : 'outline';

  return (
    <section className="flex flex-col gap-4" aria-labelledby="review-title">
      <div className="flex flex-wrap items-center gap-3">
        <h2
          id="review-title"
          ref={heading}
          tabIndex={-1}
          className="m-0 font-display text-[1.75rem] leading-[1.1] font-light tracking-[-0.02em] text-foreground"
        >
          Draft plan
        </h2>
        {res.parseError || plan !== null ? <Badge variant={badgeVariant}>{gateStatus.label}</Badge> : null}
      </div>

      {stale ? (
        <p className="text-sm text-muted-foreground">
          The text above changed after this plan was drafted. The plan below is for the earlier text.
        </p>
      ) : null}

      {res.parseError ? (
        <TelemetryPanel tone="bad" ticks="bad">
          <p className="text-sm text-foreground">The plan could not be read, so it cannot be approved.</p>
          <p className="font-mono text-xs break-all text-foreground">{parseErrorText(res.parseError)}</p>
          {editButton}
        </TelemetryPanel>
      ) : plan === null ? (
        <TelemetryPanel ticks="bar">
          <p className="text-sm text-foreground">No plan was returned.</p>
          {editButton}
        </TelemetryPanel>
      ) : (
        <>
          {rejected ? (
            <TelemetryPanel tone="bad" ticks="bad">
              <p className="text-sm text-foreground">
                This plan breaks the rules below, so it cannot be approved. Change the description and draft again.
              </p>
              <ViolationsTable violations={gate.violations} />
              {editButton}
            </TelemetryPanel>
          ) : !approvable ? (
            <TelemetryPanel ticks="bar">
              <p className="text-sm text-foreground">This plan has no policy result, so it cannot be approved.</p>
            </TelemetryPanel>
          ) : null}

          <PlanDetails plan={plan} rationale={res.rationale} routes={res.routes} />

          {res.routes.some((row) => row.kind !== 'catalog') ? (
            <JourneyChecks
              routes={res.routes}
              disabled={busy !== null}
              onRevise={onRevise}
              onChecksDiffer={onChecksDiffer}
            />
          ) : null}
        </>
      )}

      <ModelCalls calls={res.modelCalls} />
    </section>
  );
}

function PlanDetails({
  plan,
  rationale,
  routes,
}: {
  plan: TestPlan;
  rationale: string | null;
  routes: PlanResponse['routes'];
}) {
  const { config } = useApp();
  const catalog = new Map<string, (typeof config.catalog)[number]>(config.catalog.map((r) => [r.id, r]));
  const captionId = useId();
  const { totalSec } = planSize(plan);

  return (
    <TelemetryPanel ticks="bar" className="gap-4.5">
      <p className="m-0 min-w-0 font-display text-[1.625rem] leading-[1.15] font-light tracking-[-0.015em] break-words text-foreground">
        {plan.name}
      </p>

      {rationale ? (
        <div className="flex flex-col gap-1.5">
          <h3 className="m-0 flex items-center gap-2 font-sans text-[0.8125rem] font-medium text-muted-foreground">
            <span>Why this plan</span>
            <Badge variant="secondary">AI</Badge>
          </h3>
          <p className="max-w-[72ch] text-sm text-foreground">{rationale}</p>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">Stop thresholds</h3>
        <p className="max-w-[72ch] text-sm text-foreground">
          The run stops early if p95 latency goes over{' '}
          <strong className="font-mono font-medium tabular-nums">{fmt(plan.stopThresholds.p95Ms)} ms</strong> or the
          error rate goes over{' '}
          <strong className="font-mono font-medium tabular-nums">{plan.stopThresholds.errorRatePct}%</strong>.
        </p>
      </div>

      <div className="flex min-w-0 flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
          <h3 id={captionId} className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">
            Stages
          </h3>
          <span className="font-mono text-xs text-muted-foreground tabular-nums">
            {plan.stages.length} {plan.stages.length === 1 ? 'stage' : 'stages'}, {fmt(totalSec)} s in total
          </span>
        </div>

        {/* The chart is decorative; this list is what assistive technology reads. */}
        <ol className="sr-only" aria-labelledby={captionId}>
          {plan.stages.map((s, i) => (
            <li key={i}>
              Stage {i + 1}: {fmt(s.vus)} VUs for {s.durationSec} s
            </li>
          ))}
        </ol>

        <StageProfile
          mode="preview"
          stages={plan.stages.map((s) => ({ vus: s.vus, durationSec: s.durationSec, state: 'planned' as const }))}
        />

        <details className="group grid gap-3">
          <summary className="flex w-fit cursor-pointer list-none items-center gap-2 rounded-sm py-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-[3px] focus-visible:outline-offset-[2px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>Show the stages as a table</span>
            <ChevronDownIcon
              className="size-4 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="max-w-[520px]">
            <TableWrap label="Stages">
              <table className="data-table">
                <caption className="sr-only">Stages</caption>
                <thead>
                  <tr>
                    <th scope="col">Stage</th>
                    <th scope="col" className="num">
                      VUs
                    </th>
                    <th scope="col" className="num">
                      Duration (s)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {plan.stages.map((s, i) => (
                    <tr key={i}>
                      <th scope="row" className="idx font-mono tabular-nums">
                        {i + 1}
                      </th>
                      <td className="num font-mono tabular-nums">{fmt(s.vus)}</td>
                      <td className="num font-mono tabular-nums">{s.durationSec}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          </div>
        </details>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">Journey</h3>
        <TableWrap label="Journey">
          {/* Explicit roles: on phones the rows are laid out as cards, which can drop table semantics. */}
          <table className="data-table data-table--journey" role="table">
            <caption className="sr-only">Journey</caption>
            <thead role="rowgroup">
              <tr role="row">
                <th scope="col" role="columnheader">
                  Route
                </th>
                <th scope="col" role="columnheader">
                  Method
                </th>
                <th scope="col" role="columnheader">
                  Path
                </th>
                <th scope="col" role="columnheader" className="num">
                  Probability (%)
                </th>
                <th scope="col" role="columnheader" className="num">
                  Think time (ms)
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {plan.journey.map((step, i) => {
                const route =
                  routes.length > 0 ? routes.find((r) => r.id === step.route) : catalog.get(step.route);
                return (
                  <tr key={`${step.route}-${i}`} role="row">
                    <th scope="row" role="rowheader" className="font-mono text-xs break-all">
                      {step.route}
                    </th>
                    {route ? (
                      <>
                        <td className="font-mono text-xs break-all" role="cell" data-label="Method">
                          {route.method}
                        </td>
                        <td className="font-mono text-xs break-all" role="cell" data-label="Path">
                          {route.path}
                        </td>
                      </>
                    ) : (
                      <td className="text-muted-foreground" role="cell" colSpan={2}>
                        Not in the route catalog
                      </td>
                    )}
                    <td className="num font-mono tabular-nums" role="cell" data-label="Probability (%)">
                      {step.probability}
                    </td>
                    <td className="num font-mono tabular-nums" role="cell" data-label="Think time (ms)">
                      {fmt(step.thinkMs)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </div>
    </TelemetryPanel>
  );
}

function JourneyPick({
  row,
  on,
  locked,
  disabled,
  showKind,
  showDir,
  onToggle,
}: {
  row: JourneyRow;
  on: boolean;
  locked: boolean;
  disabled: boolean;
  showKind: boolean;
  showDir: boolean;
  onToggle: () => void;
}) {
  const face = pathFace(row.path);
  const action = row.kind === 'page' && isActionPath(row.path);
  const aside = locked ? 'Required' : showKind ? journeyLabel(row) : null;

  const box = (
    <span
      className={cn(
        'grid size-[18px] shrink-0 place-items-center rounded-sm border transition-colors duration-150 motion-reduce:transition-none',
        on || locked ? 'border-foreground bg-foreground text-background' : 'border-bar bg-background text-transparent',
      )}
      aria-hidden="true"
    >
      <CheckIcon className="size-3" strokeWidth={2.5} />
    </span>
  );

  const body = (
    <>
      {box}
      <span className="grid min-w-0 gap-0.5">
        <span className="font-mono text-xs break-all text-foreground">{face.name}</span>
        {showDir && face.dir !== null ? (
          <span className="font-mono text-xs break-all text-muted-foreground">{face.dir}</span>
        ) : null}
        {!showDir && face.dir !== null ? <span className="sr-only">{face.dir}</span> : null}
        {action ? (
          <span className="text-xs break-words text-muted-foreground">A repeated visit would hit this link.</span>
        ) : null}
      </span>
      {aside !== null ? <span className="text-xs whitespace-nowrap text-muted-foreground">{aside}</span> : null}
    </>
  );

  const rowClass = cn(
    'grid min-h-11 items-center gap-x-3 rounded-md border px-3 py-2 transition-colors duration-150 motion-reduce:transition-none',
    aside !== null ? 'grid-cols-[18px_minmax(0,1fr)_auto]' : 'grid-cols-[18px_minmax(0,1fr)]',
    locked
      ? 'cursor-default border-transparent bg-secondary'
      : on
        ? 'cursor-pointer border-transparent bg-secondary'
        : 'cursor-pointer border-border bg-transparent hover:bg-secondary',
  );

  if (locked) {
    return <div className={rowClass}>{body}</div>;
  }

  return (
    <label
      className={cn(
        rowClass,
        'has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-60 has-[input:focus-visible]:outline-[3px] has-[input:focus-visible]:outline-offset-[2px] has-[input:focus-visible]:outline-ring',
      )}
    >
      <input className="sr-only" type="checkbox" checked={on} disabled={disabled} onChange={onToggle} />
      {body}
    </label>
  );
}

function JourneyChecks({
  routes,
  disabled,
  onRevise,
  onChecksDiffer,
}: {
  routes: PlanResponse['routes'];
  disabled: boolean;
  onRevise: (routeIds: string[]) => void;
  onChecksDiffer: (differ: boolean) => void;
}) {
  const groups = journeyGroups(routes.map((row) => ({ ...row, defaultOn: row.defaultOn === true })));
  const [checked, setChecked] = useState<ReadonlySet<string>>(
    () => new Set(routes.filter((row) => row.defaultOn === true).map((row) => row.id)),
  );

  // A revised plan returns a new routes list; re-sync the checkboxes to its
  // defaultOn flags, or the stale selection keeps checksDiffer true forever
  // and "Approve & Run" stays disabled.
  useEffect(() => {
    setChecked(new Set(routes.filter((row) => row.defaultOn === true).map((row) => row.id)));
  }, [routes]);

  const baseline = routes
    .filter((row) => row.defaultOn === true)
    .map((row) => row.id)
    .sort()
    .join('\n');
  const current = [...checked].sort().join('\n');
  const differ = current !== baseline;

  useEffect(() => {
    onChecksDiffer(differ);
  }, [differ, onChecksDiffer]);

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setGroup(rows: readonly { id: string }[], on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const row of rows) {
        if (on) next.add(row.id);
        else next.delete(row.id);
      }
      return next;
    });
  }

  const sections = [
    ['Always in the test', groups.locked, true],
    ['On, and you can turn them off', groups.on, false],
    ['Found, and left off until you turn one on', groups.off, false],
  ] as const;

  return (
    <TelemetryPanel ticks="bar" aria-label="Journey" className="gap-5">
      {sections.map(([title, rows, locked]) => {
        if (rows.length === 0) return null;
        const kinds = kindGroups(rows);
        const grouped = kinds.length > 1 || rows.length > 1;
        return (
          <div className="grid gap-2" key={title}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
              <h3 className="m-0 font-sans text-[0.8125rem] font-normal text-muted-foreground">{title}</h3>
              <span className="font-mono text-[0.8125rem] text-muted-foreground tabular-nums">
                {rows.length}
                <span className="sr-only"> routes</span>
              </span>
              {locked || rows.length < 2 ? null : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="ml-auto"
                  disabled={disabled}
                  onClick={() => setGroup(rows, !rows.every((row) => checked.has(row.id)))}
                >
                  {rows.every((row) => checked.has(row.id)) ? 'All off' : 'All on'}
                </Button>
              )}
            </div>

            <div className="grid gap-4">
              {kinds.map((group) => {
                const dir = grouped ? sharedDir(group.rows) : null;
                const list = (
                  <ul className="m-0 grid list-none gap-2 p-0">
                    {group.rows.map((row) => (
                      <li key={row.id}>
                        <JourneyPick
                          row={row}
                          on={locked || checked.has(row.id)}
                          locked={locked}
                          disabled={disabled}
                          showKind={!grouped}
                          showDir={dir === null}
                          onToggle={() => toggle(row.id)}
                        />
                      </li>
                    ))}
                  </ul>
                );
                if (!grouped) return <div key={group.label}>{list}</div>;
                return (
                  <div className="grid gap-2" key={group.label}>
                    <div className="grid gap-0.5">
                      <h4 className="m-0 font-sans text-[0.8125rem] font-medium text-foreground">
                        {kindHeading(group.label, group.rows.length)}
                      </h4>
                      {dir !== null ? (
                        <p className="m-0 font-mono text-xs break-all text-muted-foreground">{dir}</p>
                      ) : null}
                    </div>
                    {list}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {groups.overflow ? (
        <p className="text-sm text-muted-foreground">Some pages were left off because a plan holds 32 routes.</p>
      ) : null}

      {differ ? (
        <div className="flex flex-col gap-3 pt-1">
          <Separator />
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="m-0 flex-1 text-sm text-foreground" aria-live="polite">
              Revise the plan to use these checks.
            </p>
            <Button
              type="button"
              variant="secondary"
              disabled={disabled}
              onClick={() =>
                onRevise([
                  'r1',
                  ...routes.filter((row) => row.path !== '/' && checked.has(row.id)).map((row) => row.id),
                ])
              }
            >
              Revise the plan
            </Button>
          </div>
        </div>
      ) : null}
    </TelemetryPanel>
  );
}
