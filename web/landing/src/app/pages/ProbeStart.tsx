/** Start the containment probe (`#/probe`). Needs no plan; Turnstile like every action. */
import { useEffect, useRef, useState } from 'react';
import { ShieldCheckIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { TelemetryPanel } from '../components/studio/TelemetryFrame.tsx';
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
    <div className="mx-auto grid w-full max-w-[1600px] gap-6">
      <header className="grid gap-2">
        <h1 className="m-0 font-display text-[2.25rem] leading-[1.1] font-light tracking-[-0.02em] text-balance text-foreground max-[860px]:text-[1.75rem]">
          Containment Probe
        </h1>
        <p className="m-0 max-w-[64ch] text-muted-foreground">
          The probe tries to escape the sandbox with five attempts, such as reaching the internet and the cloud metadata address. The
          sandbox should block each one. It takes about a minute and sends no load to any site.
        </p>
      </header>

      <div className="grid grid-cols-1 items-start gap-6 min-[1180px]:grid-cols-[minmax(0,1fr)_minmax(300px,380px)]">
        <ol className="m-0 flex min-w-0 list-none flex-col gap-2 p-0" aria-label="The five escape attempts">
          {PROBE_ACTIONS.map((a) => (
            <li
              key={a.id}
              className="grid grid-cols-[44px_minmax(0,1fr)] items-start gap-3 rounded-md border border-border bg-card px-4 py-3.5 text-sm sm:px-5"
            >
              <span className="pt-0.5 font-mono text-xs font-medium text-muted-foreground tabular-nums">
                ({a.id})
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <p className="m-0 font-medium text-foreground">{a.label}</p>
                <p className="m-0 max-w-[72ch] text-muted-foreground">{ACTION_EXPLANATIONS[a.id]}</p>
              </div>
            </li>
          ))}
        </ol>

        <aside className="flex min-w-0 flex-col gap-4 min-[1180px]:sticky min-[1180px]:top-20" aria-label="Run the probe">
          <TelemetryPanel ticks="bar" aria-labelledby="probe-run-heading" className="gap-4 bg-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="probe-run-heading" className="m-0 font-sans text-[1.0625rem] font-medium text-foreground">
                Run the probe
              </h2>
              <Badge variant="outline">5 actions</Badge>
            </div>

            <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Sandbox</dt>
              <dd className="m-0 min-w-0 font-mono text-xs text-foreground">{config.runtime}</dd>
              <dt className="text-muted-foreground">Time cap</dt>
              <dd className="m-0 min-w-0 text-foreground">
                <span className="font-mono text-xs tabular-nums">60 s</span>, then the sandbox is killed
              </dd>
              <dt className="text-muted-foreground">Memory cap</dt>
              <dd className="m-0 min-w-0 font-mono text-xs text-foreground tabular-nums">1 GiB</dd>
              <dt className="text-muted-foreground">Network</dt>
              <dd className="m-0 min-w-0 text-foreground">
                Only <span className="font-mono text-xs break-all text-foreground">{allowedHost}</span> (egress proxy)
              </dd>
              <dt className="text-muted-foreground">Load sent</dt>
              <dd className="m-0 min-w-0 text-foreground">None</dd>
            </dl>

            <Separator />

            <TurnstileBox boxRef={turnstile.box} />

            <Button type="button" className="w-full" disabled={busy} onClick={() => void start()}>
              <ShieldCheckIcon data-icon="inline-start" />
              Run containment probe
            </Button>

            {busy ? <Busy>Starting the probe.</Busy> : null}

            <div
              role="alert"
              className={
                error
                  ? 'flex flex-col gap-2 rounded-md border border-destructive bg-background px-3.5 py-3 text-sm text-foreground'
                  : 'sr-only'
              }
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
          </TelemetryPanel>
        </aside>
      </div>
    </div>
  );
}
