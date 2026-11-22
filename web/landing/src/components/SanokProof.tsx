/**
 * Beat 3: Sanok Bridge Analogy (4 Bayer-dithered plates) + Hybrid Inference, Number Guard,
 * and real per-route p95 breakdown from run d28cacd6 (hydrated island).
 */
import { useState } from 'react';
import { getStage, SAMPLE_STAGES } from '../data.ts';
import { sanokDitherSrc } from '../sanok.ts';

const SANOK_PLATES = [
  {
    name: 'trucks' as const,
    stage: '01 / Staged Load (1 : 2 : 4 : 8)',
    title: 'Trucks on the deck',
    caption: 'Loaded test trucks parked nose to tail across the Sanok bridge span, stepping load up one Stage at a time.',
  },
  {
    name: 'span' as const,
    stage: '02 / Policy Gate & Plan Lock',
    title: 'Engineers under the pylon',
    caption: 'Engineers in hard hats verify the test plan under the cable-stayed pylon before sending the next truck weight onto the deck.',
  },
  {
    name: 'static' as const,
    stage: '03 / Measured, Never Invented',
    title: 'The static instrument test',
    caption: 'Engineers read deflection instruments directly on the bridge deck beside a loaded truck. Number Guard enforces the same rule on AI prose.',
  },
  {
    name: 'workers' as const,
    stage: '04 / Contained Perimeter',
    title: 'Workers by the river railing',
    caption: 'Crew stands behind the riverside perimeter railing while the bridge deck is under load, mirroring gVisor and the egress allowlist.',
  },
] as const;

export function SanokProof() {
  const [plateIdx, setPlateIdx] = useState(2);
  const [stageIdx, setStageIdx] = useState(2);

  const activePlate = SANOK_PLATES[plateIdx] ?? SANOK_PLATES[2];
  const stage = getStage(stageIdx);

  return (
    <section className="lp-sec lp-sec-bordered" id="vd-proof">
      <div className="lp-container lp-split-5-7">
        <div data-reveal>
          <figure className="lp-plate">
            <img src={sanokDitherSrc(activePlate.name)} alt={activePlate.caption} />
            <figcaption className="lp-mono">
              <strong>{activePlate.stage} · {activePlate.title}:</strong> {activePlate.caption}
            </figcaption>
          </figure>

          <div className="lp-photo-strip" role="group" aria-label="Sanok bridge load-test photographs">
            {SANOK_PLATES.map((p, idx) => (
              <button
                key={p.name}
                type="button"
                className="lp-photo-thumb"
                aria-pressed={idx === plateIdx}
                onClick={() => setPlateIdx(idx)}
              >
                <img src={sanokDitherSrc(p.name)} alt="" aria-hidden="true" />
                <span className="lp-mono">{p.title}</span>
              </button>
            ))}
          </div>
        </div>

        <div data-reveal data-i="1">
          <h2 className="lp-h2">On-device AI when available. Measured numbers always.</h2>
          <p className="lp-lead mt-3">
            Like engineers reading deflection gauges on the Sanok bridge deck during the static test, Macro never invents capacity figures. Hybrid Inference runs Scenario Assistant and Report Q&amp;A on Chrome’s On-Device Model (Gemini Nano) first, switching to Cloud Fallback whenever the On-Device Model is not available.
          </p>

          <div className="lp-quote-box mt-5">
            <p>
              On Demo Target run <span className="lp-num-chip">d28cacd6</span>, Safe Capacity held at{' '}
              <span className="lp-num-chip">100 VUs</span> with <span className="lp-num-chip">910 ms</span> on{' '}
              <span className="lp-num-chip">store_home</span> and <span className="lp-num-chip">138 ms</span> on{' '}
              <span className="lp-num-chip">product_detail</span>. Stage 4 (<span className="lp-num-chip">200 VUs</span>) hit Breaking Point at{' '}
              <span className="lp-num-chip">1,611 ms</span> against the <span className="lp-num-chip">1,000 ms</span> stop limit.
            </p>
            <div className="mt-3">
              <span className="lp-tag lp-tag-ok">Number Guard: 6/6 figures verified against run d28cacd6</span>
            </div>
          </div>

          <div className="lp-subpanel mt-5">
            <div className="lp-subpanel-head">
              <span>Per-route p95 in Stage {stage.id} ({stage.vus} VUs)</span>
              <div className="lp-mini-stages" role="group" aria-label="Select measured stage">
                {SAMPLE_STAGES.map((s, idx) => (
                  <button
                    key={s.id}
                    type="button"
                    className="lp-mini-btn lp-mono"
                    aria-pressed={idx === stageIdx}
                    onClick={() => {
                      setStageIdx(idx);
                      setPlateIdx(idx);
                    }}
                  >
                    {s.vus}
                  </button>
                ))}
              </div>
            </div>
            <ul className="lp-kv-list lp-mono">
              {stage.routes.map((r) => (
                <li key={r.name}>
                  <span>{r.name}</span>
                  <strong className={r.p95Ms > 1000 ? 'text-bad' : ''}>{r.p95Ms.toLocaleString()} ms</strong>
                </li>
              ))}
            </ul>
            <p className="lp-mono text-[13px] text-muted">{stage.supervisorNote}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
