/**
 * What the policy gate allows, stated from the fixed rules in src/plan/policy.ts, plus the
 * routes a plan may use (from /api/config). Shown beside the Test Studio form so people write
 * descriptions that can pass. Once a plan is ready to approve, the rules fold away under the
 * approve panel (`folded`).
 */
import { ChevronDownIcon } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { useApp } from '../context.tsx';
import { TelemetryPanel } from './studio/TelemetryFrame.tsx';

const TITLE = 'What the policy gate allows';
const NOTE = 'Fixed code checks every plan against these rules before it can be approved. The AI cannot change them.';

function Rules({ targetOrigin }: { targetOrigin?: string | null | undefined }) {
  const { config } = useApp();
  const target = targetOrigin ?? config.webOrigin;
  const isOwn = target !== config.webOrigin;

  const bounds = [
    { label: 'Target', value: target, mono: true },
    { label: 'Stages', value: '1 to 6, each with more users than the one before', mono: false },
    { label: 'Users per stage', value: '1 to 500', mono: true },
    { label: 'Stage length', value: '30 to 180\u00A0s, at most 600\u00A0s in total', mono: true },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <dl className="m-0 grid grid-cols-1 gap-2 text-sm sm:grid-cols-[max-content_minmax(0,1fr)] sm:gap-x-5 sm:gap-y-2">
        {bounds.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd
              className={cn(
                'm-0 min-w-0 text-[0.8125rem] text-foreground',
                row.mono && 'font-mono break-all tabular-nums',
              )}
            >
              {row.value}
            </dd>
          </div>
        ))}
      </dl>

      <Separator />

      <div className="flex flex-col gap-2">
        <h3 className="m-0 font-sans text-[0.8125rem] font-medium text-muted-foreground">
          Routes a plan can use
        </h3>
        {isOwn ? (
          <p className="text-[0.8125rem] text-muted-foreground">
            Discovered from <span className="font-mono text-foreground break-all">{target}</span> when you click Draft a plan.
          </p>
        ) : (
          <ul className="m-0 grid list-none divide-y divide-border p-0 text-[0.8125rem]">
            {config.catalog.map((r) => (
              <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 first:pt-0 last:pb-0">
                <span className="font-mono text-xs text-foreground">{r.id}</span>
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  <span className="text-foreground">{r.method}</span> {r.path}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function GateRules({
  folded = false,
  targetOrigin,
}: {
  folded?: boolean;
  targetOrigin?: string | null | undefined;
}) {
  if (folded) {
    return (
      <details className="group rounded-md border border-border bg-surface p-5 sm:px-6">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-sm py-0.5 focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <h2 className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">{TITLE}</h2>
          <ChevronDownIcon
            className="size-4 shrink-0 text-muted-foreground transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none"
            aria-hidden="true"
          />
        </summary>
        <div className="mt-3.5 flex flex-col gap-3.5">
          <p className="text-sm text-muted-foreground">{NOTE}</p>
          <Rules targetOrigin={targetOrigin} />
        </div>
      </details>
    );
  }

  return (
    <TelemetryPanel ticks="bar" aria-labelledby="gate-rules-heading">
      <div className="flex flex-col gap-1.5">
        <h2 id="gate-rules-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
          {TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">{NOTE}</p>
      </div>
      <Rules targetOrigin={targetOrigin} />
    </TelemetryPanel>
  );
}
