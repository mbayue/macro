/**
 * Under the Test Studio form, until a plan is drafted: what happens after "Draft a plan".
 */
import { TelemetryPanel } from './studio/TelemetryFrame.tsx';

const STEPS = [
  {
    index: '01',
    title: 'The planner drafts a plan',
    text: 'Stages of rising virtual users, the routes they visit, and stop limits for p95 latency and errors.',
  },
  {
    index: '02',
    title: 'The policy gate checks it',
    text: 'Fixed code tests the target, routes, users and duration. A plan that breaks a rule cannot be approved.',
  },
  {
    index: '03',
    title: 'You approve, then watch',
    text: 'Each stage runs in a fresh sandbox. The report shows the safe capacity and the first route to slow down.',
  },
] as const;

export function NextUp() {
  return (
    <TelemetryPanel ticks="bar" aria-labelledby="next-steps-heading">
      <h2 id="next-steps-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
        After you draft
      </h2>
      <ol className="m-0 grid list-none grid-cols-1 divide-y divide-border p-0 min-[1180px]:grid-cols-3 min-[1180px]:divide-x min-[1180px]:divide-y-0">
        {STEPS.map((step) => (
          <li
            key={step.title}
            className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 min-[1180px]:px-5 min-[1180px]:py-1 min-[1180px]:first:pl-0 min-[1180px]:last:pr-0"
          >
            <div className="flex items-baseline gap-2 text-sm font-medium text-foreground">
              <span className="font-mono text-xs text-accent-text tabular-nums">{step.index}</span>
              <span>{step.title}</span>
            </div>
            <p className="text-sm text-muted-foreground">{step.text}</p>
          </li>
        ))}
      </ol>
    </TelemetryPanel>
  );
}
