/**
 * Beat 1: Atmospheric Hero + Interactive 3-Tab Macro Workbench (hydrated island).
 * Both light (Bayer-dithered Sanok trucks) and dark (dithered horizon) backdrops render in HTML
 * and toggle via CSS (`lp-atmo-bg-light` / `lp-atmo-bg-dark`) so light mode never flashes before hydration.
 */
import { useRef, useState } from 'react';
import { CONTAINMENT_CHECKS, getPolicyPreset, getStage, POLICY_PRESETS, SAMPLE_STAGES } from '../data.ts';
import { DARK_HORIZON_SRC, sanokDitherSrc } from '../sanok.ts';
import { ThemeToggle } from './ThemeToggle.tsx';

type HeroTab = 'report' | 'gate' | 'probe';
const HERO_TABS: readonly { id: HeroTab; label: string }[] = [
  { id: 'report', label: 'Capacity Report' },
  { id: 'gate', label: 'Policy Gate' },
  { id: 'probe', label: 'Containment 5/5' },
];

export function HeroWorkbench() {
  const [heroTab, setHeroTab] = useState<HeroTab>('report');
  const [stageIdx, setStageIdx] = useState(2);
  const [presetIdx, setPresetIdx] = useState(0);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const stage = getStage(stageIdx);
  const preset = getPolicyPreset(presetIdx);

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    let nextIdx: number | null = null;
    if (e.key === 'ArrowRight') nextIdx = (idx + 1) % HERO_TABS.length;
    else if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + HERO_TABS.length) % HERO_TABS.length;
    else if (e.key === 'Home') nextIdx = 0;
    else if (e.key === 'End') nextIdx = HERO_TABS.length - 1;
    if (nextIdx === null) return;
    e.preventDefault();
    setHeroTab(HERO_TABS[nextIdx]!.id);
    tabRefs.current[nextIdx]?.focus();
  }

  return (
    <section className="lp-atmo">
      <img className="lp-atmo-bg lp-atmo-bg-light" src={sanokDitherSrc('trucks')} alt="" aria-hidden="true" />
      <img className="lp-atmo-bg lp-atmo-bg-dark" src={DARK_HORIZON_SRC} alt="" aria-hidden="true" />
      <div className="lp-scrim" aria-hidden="true" />

      <div className="lp-container lp-hero-stack">
        <header className="lp-nav" aria-label="Site">
          <a className="lp-brand" href="#top">
            <span className="lp-mark rounded" aria-hidden="true">M</span>
            <span>Macro</span>
          </a>
          <nav className="lp-nav-links" aria-label="Primary">
            <a href="#vd-pipeline">Pipeline</a>
            <a href="#vd-proof">Proof</a>
            <a href="#vd-limits">Limits</a>
            <a href="#vd-faq">FAQ</a>
          </nav>
          <div className="lp-row">
            <ThemeToggle />
            <a className="lp-btn lp-btn-ink lp-btn-compact" href="/app/">
              Open Studio
            </a>
          </div>
        </header>

        <div className="lp-hero-copy" id="hero-content" tabIndex={-1}>
          <div className="lp-stage-band" aria-hidden="true">
            <span /><span /><span /><span />
          </div>
          <h1 className="lp-display">Find your breaking point</h1>
          <p className="lp-lead lp-hero-lead">
            Describe traffic in plain English. Fixed code gates the plan, gVisor isolates each Stage, and Number Guard checks every figure.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/app/">Try the Demo Target</a>
            <a className="lp-btn lp-btn-secondary" href="/app/#/probe">Run 5/5 Containment Probe</a>
          </div>
        </div>

        <div className="lp-window" aria-label="Interactive Macro workbench">
          <aside className="lp-rail" aria-label="Workbench sections">
            <span className="lp-mark lp-mark-rail" aria-hidden="true">M</span>
            <button
              type="button"
              className={`lp-rail-btn ${heroTab === 'report' ? 'lp-rail-btn-active' : ''}`}
              aria-label="Capacity Report"
              aria-pressed={heroTab === 'report'}
              onClick={() => setHeroTab('report')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 12h4l3-7 4 14 3-7h4" />
              </svg>
            </button>
            <button
              type="button"
              className={`lp-rail-btn ${heroTab === 'gate' ? 'lp-rail-btn-active' : ''}`}
              aria-label="Policy Gate"
              aria-pressed={heroTab === 'gate'}
              onClick={() => setHeroTab('gate')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M9 12l2 2 4-4" />
                <rect x="3" y="4" width="18" height="16" rx="2" />
              </svg>
            </button>
            <button
              type="button"
              className={`lp-rail-btn ${heroTab === 'probe' ? 'lp-rail-btn-active' : ''}`}
              aria-label="Containment Probe 5 of 5"
              aria-pressed={heroTab === 'probe'}
              onClick={() => setHeroTab('probe')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M12 3l7 4v5c0 5-3.5 8-7 9-3.5-1-7-4-7-9V7l7-4z" />
              </svg>
            </button>
          </aside>

          <div className="lp-window-body">
            <div className="lp-window-bar">
              <div className="lp-tabs" role="tablist" aria-label="Workbench views">
                {HERO_TABS.map((tab, idx) => (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      tabRefs.current[idx] = el;
                    }}
                    id={`wb-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    aria-selected={heroTab === tab.id}
                    aria-controls={`wb-panel-${tab.id}`}
                    tabIndex={heroTab === tab.id ? 0 : -1}
                    className="lp-tab"
                    onClick={() => setHeroTab(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="lp-row">
                <span className="lp-tag">https://yue.macro.my.id</span>
                <span className="lp-tag lp-tag-ok">run d28cacd6</span>
              </div>
            </div>

            {heroTab === 'report' && (
              <div role="tabpanel" id="wb-panel-report" aria-labelledby="wb-tab-report" className="flex flex-col gap-3.5">
                <div className="lp-kpi-row">
                  <div className={`lp-kpi ${stage.status === 'pass' ? 'lp-kpi-live' : 'lp-kpi-bad'}`}>
                    <div className="lp-kpi-label">Stage {stage.id} ({stage.duration})</div>
                    <div className="lp-kpi-val lp-mono">{stage.vus} VUs</div>
                    <div className="lp-kpi-note">{stage.verdictLabel}</div>
                  </div>
                  <div className="lp-kpi">
                    <div className="lp-kpi-label">Peak Route p95</div>
                    <div className="lp-kpi-val lp-mono">{stage.p95Ms.toLocaleString()} ms</div>
                    <div className="lp-kpi-note">Stop limit 1,000 ms</div>
                  </div>
                  <div className="lp-kpi">
                    <div className="lp-kpi-label">Error Rate</div>
                    <div className="lp-kpi-val lp-mono">{stage.errorRate}</div>
                    <div className="lp-kpi-note">{stage.route}</div>
                  </div>
                  <div className="lp-kpi">
                    <div className="lp-kpi-label">Number Guard</div>
                    <div className="lp-kpi-val lp-mono">6 / 6</div>
                    <div className="lp-kpi-note">Matched to d28cacd6</div>
                  </div>
                </div>
                <div className="lp-window-split">
                  <div className="lp-subpanel">
                    <div className="lp-subpanel-head">
                      <span>Click a Stage bar to inspect (1 : 2 : 4 : 8)</span>
                      <span className={`lp-tag ${stage.status === 'pass' ? 'lp-tag-ok' : 'lp-tag-bad'}`}>
                        {stage.status === 'pass' ? 'Supervisor: Continue' : 'Supervisor: Halt'}
                      </span>
                    </div>
                    <div className="lp-bars">
                      {SAMPLE_STAGES.map((s, idx) => (
                        <button
                          key={s.id}
                          type="button"
                          className="lp-bar-btn"
                          aria-pressed={idx === stageIdx}
                          onClick={() => setStageIdx(idx)}
                        >
                          <span
                            className={`lp-bar-fill ${s.status === 'stop' ? 'lp-bar-fill-stop' : ''}`}
                            data-bar={s.barPct}
                          />
                          <span className="lp-mono lp-bar-label">{s.vus} VUs</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="lp-subpanel">
                    <div className="lp-subpanel-head">
                      <span>Sandbox Guarantees</span>
                      <span className="lp-tag lp-tag-ok">Approved Plan</span>
                    </div>
                    <ul className="lp-kv-list lp-mono">
                      <li><span>Origin allowlist</span><strong>1 host</strong></li>
                      <li><span>169.254.169.254</span><strong>denied</strong></li>
                      <li><span>Memory cap (1 GiB)</span><strong>enforced</strong></li>
                      <li><span>Number Guard</span><strong>verified</strong></li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {heroTab === 'gate' && (
              <div role="tabpanel" id="wb-panel-gate" aria-labelledby="wb-tab-gate" className="flex flex-col gap-3">
                <div className="lp-row" role="group" aria-label="Policy Gate presets">
                  {POLICY_PRESETS.map((p, idx) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`lp-btn lp-btn-compact ${idx === presetIdx ? 'lp-btn-ink' : 'lp-btn-secondary'}`}
                      aria-pressed={idx === presetIdx}
                      onClick={() => setPresetIdx(idx)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="lp-subpanel">
                  <div className="lp-subpanel-head">
                    <span className="lp-mono">{preset.target}</span>
                    <span className={`lp-tag ${preset.verdict === 'approved' ? 'lp-tag-ok' : 'lp-tag-bad'}`}>
                      {preset.verdict === 'approved' ? 'Approved Plan' : 'Rejected by Policy Gate'}
                    </span>
                  </div>
                  <div>
                    {preset.checks.map((c) => (
                      <div key={c.rule} className="lp-rule-row">
                        <strong>{c.rule}</strong>
                        <span className="lp-rule-detail">{c.detail}</span>
                        <span className={`lp-tag ${c.pass ? 'lp-tag-ok' : 'lp-tag-bad'}`}>{c.pass ? 'OK' : 'BLOCKED'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {heroTab === 'probe' && (
              <div role="tabpanel" id="wb-panel-probe" aria-labelledby="wb-tab-probe" className="lp-subpanel">
                <div className="lp-subpanel-head">
                  <span>Containment Probe (5 / 5 actions contained)</span>
                  <span className="lp-tag lp-tag-ok">0 egress escapes</span>
                </div>
                <div>
                  {CONTAINMENT_CHECKS.map((row) => (
                    <div key={row.code} className="lp-rule-row">
                      <span className="lp-mono">{row.code} {row.name}</span>
                      <span className="lp-rule-detail lp-mono">{row.attempt}</span>
                      <span className="lp-tag lp-tag-ok">{row.result}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
