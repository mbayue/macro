import { PlusIcon, TablePropertiesIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';

/** Fallback view (`*`) when the hash route does not match any app screen. */
export function NotFound() {
  return (
    <section className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-6" aria-labelledby="not-found-heading">
      <header className="grid gap-2">
        <h1
          id="not-found-heading"
          className="m-0 font-display text-[2.25rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.75rem]"
        >
          Page not found
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          The address you opened does not match any screen in Macro.
        </p>
      </header>

      <TelemetryPanel ticks="bar" className="gap-4">
        <p className="m-0 text-sm text-muted-foreground">Choose where to go next.</p>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button render={<a href="#/" />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            Test Studio
          </Button>
          <Button render={<a href="#/runs" />} nativeButton={false} variant="secondary">
            <TablePropertiesIcon data-icon="inline-start" />
            Runs Table
          </Button>
        </div>
      </TelemetryPanel>
    </section>
  );
}
