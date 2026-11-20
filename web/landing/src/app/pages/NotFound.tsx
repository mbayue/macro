import { PlusIcon, TablePropertiesIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';

/** Fallback view (`*`) when the hash route does not match any app screen. */
export function NotFound() {
  return (
    <section className="mx-auto grid w-full max-w-[1600px] gap-6" aria-labelledby="not-found-heading">
      <header className="grid gap-2">
        <h1
          id="not-found-heading"
          className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]"
        >
          Page not found
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          The address you opened does not match any screen in Macro.
        </p>
      </header>

      <TelemetryPanel ticks="bar" className="gap-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <Badge variant="outline" className="font-mono tabular-nums">
            404
          </Badge>
          <p className="m-0 text-sm text-muted-foreground">Choose where to go next.</p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button render={<a href="#/" />} nativeButton={false}>
            <PlusIcon data-icon="inline-start" />
            Start a new test
          </Button>
          <Button
            render={<a href="#/runs" />}
            nativeButton={false}
            variant="secondary"
            className="border border-bar-hover"
          >
            <TablePropertiesIcon data-icon="inline-start" />
            Open recent runs
          </Button>
        </div>
      </TelemetryPanel>
    </section>
  );
}
