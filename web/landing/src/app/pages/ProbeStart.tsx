/** Start the containment probe (`#/probe`). Needs no plan; Turnstile like every action. */
import { useEffect, useRef, useState } from 'react';
import { type ApiError, postProbe, VERIFICATION_ERROR } from '../lib/api.ts';
import { ACTION_EXPLANATIONS, PROBE_ACTIONS } from '../lib/probe-view.ts';
import { TurnstileBox, useTurnstile } from '../components/Turnstile.tsx';
import { AlertRegion, Busy, KeyValues } from '../components/ui.tsx';
import { useApp } from '../context.tsx';

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

  return (
    <div className="page">
      <header className="page__head">
        <h1 className="page__title">Containment probe</h1>
        <p className="page__lead">
          The probe tries to escape the sandbox with five attempts, such as reaching the internet and the cloud metadata address. The
          sandbox should block each one. It takes about a minute and sends no load to any site.
        </p>
      </header>
      <div className="split">
        <ol className="attempts split__main" aria-label="The five escape attempts">
          {PROBE_ACTIONS.map((a) => (
            <li key={a.id}>
              <span className="attempts__id code">({a.id})</span>
              <div>
                <p className="attempts__label">{a.label}</p>
                <p className="muted">{ACTION_EXPLANATIONS[a.id]}</p>
              </div>
            </li>
          ))}
        </ol>
        <aside className="split__side" aria-label="Run the probe">
          <section className="panel panel--sticky" aria-labelledby="probe-run-heading">
            <h2 id="probe-run-heading">Run the probe</h2>
            <KeyValues
              items={[
                ['Sandbox', <span className="code">{config.runtime}</span>],
                ['Time cap', '60 s, then the sandbox is killed'],
                ['Memory cap', '1 GiB'],
                [
                  'Network',
                  <span>
                    Only <span className="code">{config.webOrigin.replace(/^https:\/\//, '')}:443</span> through the egress proxy
                  </span>,
                ],
                ['Load sent', 'None'],
              ]}
            />
            <TurnstileBox boxRef={turnstile.box} />
            <button type="button" className="btn btn--block" disabled={busy} onClick={() => void start()}>
              Run containment probe
            </button>
            {busy ? <Busy>Starting the probe.</Busy> : null}
            <AlertRegion error={error} />
          </section>
        </aside>
      </div>{' '}
    </div>
  );
}
