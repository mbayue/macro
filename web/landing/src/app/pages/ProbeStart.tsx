/** Start the containment probe (`#/probe`). Needs no plan; Turnstile like every action. */
import { useEffect, useRef, useState } from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DitherBanner, StageBand, TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { ApiErrorText, Busy } from '../components/ui.tsx';
import { useApp } from '../context.tsx';
import { type ApiError, postProbe, VERIFICATION_ERROR } from '../lib/api.ts';
import { ACTION_EXPLANATIONS, PROBE_ACTIONS } from '../lib/probe-view.ts';

export function ProbeStart() {
  const { config, navigate, announce } = useApp();
  const turnstile = useTurnstile();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    announce('Starting the containment probe.');
    let result: Awaited<ReturnType<typeof postProbe>>;
    try {
      const token = await turnstile.token();
      result = await postProbe({ turnstileToken: token });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      turnstile.reset();
    }
    if (!alive.current) return;
    if (result.ok) {
      navigate(`/probe/${encodeURIComponent(result.data.runId)}`);
      return;
    }
    setBusy(false);
    setError(result.error);
    announce(result.error.message);
  }

  const allowedHost = `${config.webOrigin.replace(/^https:\/\//, '')}:443`;

  return (
    <div className="mx-auto grid w-full max-w-[1440px] grid-cols-[minmax(0,1fr)] gap-5">
      <TelemetryPanel aria-labelledby="probe-start-heading" className="gap-5 bg-card">
        <DitherBanner
          src="/landing/img/dither/sanok-workers.webp"
          label={`Containment Probe · ${config.runtime} + Egress Proxy`}
          meta="5 actions"
        />

        <div className="flex flex-col justify-between gap-4 min-[861px]:flex-row min-[861px]:items-start">
          <div className="grid gap-1.5">
            <StageBand />
            <h1
              id="probe-start-heading"
              className="m-0 font-display text-[2rem] leading-[1.08] font-semibold tracking-[-0.034em] text-balance text-foreground max-[860px]:text-[1.625rem]"
            >
              Containment Probe
            </h1>
            <p className="m-0 max-w-[68ch] text-sm text-muted-foreground">
              Verifies on demand that the sandbox blocks disallowed network egress, cloud metadata, private subnets, host secrets, and memory over-allocation. Sends no load to any site.
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2 min-[861px]:items-end">
            <TurnstileBox boxRef={turnstile.box} />
            <Button type="button" disabled={busy} onClick={() => void start()}>
              <ShieldCheckIcon data-icon="inline-start" />
              Run containment probe
            </Button>
            {busy ? <Busy>Starting the probe…</Busy> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground tabular-nums">
          <Badge variant="outline" className="font-mono">Runtime: {config.runtime}</Badge>
          <Badge variant="outline" className="font-mono tabular-nums">Time cap: 60 s</Badge>
          <Badge variant="outline" className="font-mono tabular-nums">Memory cap: 1 GiB</Badge>
          <Badge variant="outline" className="font-mono" translate="no">Allowlist: {allowedHost}</Badge>
        </div>

        <div
          role="alert"
          className={cn(
            error
              ? 'flex flex-col gap-2 rounded-md border border-destructive bg-background px-3.5 py-3 text-sm text-foreground'
              : 'sr-only',
          )}
        >
          {error ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="destructive">Could not start probe</Badge>
              </div>
              <ApiErrorText error={error} />
            </>
          ) : null}
        </div>

        <div className="overflow-x-auto">
          <table
            className="data-table [&_tbody_tr:last-child>*]:border-b [&_tbody_tr:last-child>*]:border-border"
            aria-label="The five escape attempts"
          >
            <thead>
              <tr>
                <th>Check</th>
                <th>Escape vector</th>
                <th>Expected containment</th>
              </tr>
            </thead>
            <tbody>
              {PROBE_ACTIONS.map((a) => (
                <tr key={a.id}>
                  <td className="idx align-baseline font-mono text-sm text-muted-foreground">({a.id})</td>
                  <th scope="row" className="align-baseline font-medium text-foreground">{a.label}</th>
                  <td className="align-baseline text-muted-foreground">{ACTION_EXPLANATIONS[a.id]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TelemetryPanel>
    </div>
  );
}
