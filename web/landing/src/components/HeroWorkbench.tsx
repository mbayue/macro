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
      <img className="lp-atmo-bg lp-atmo-bg-light" src={sanokDitherSrc('trucks')} width={1920} height={1280} fetchPriority="high" alt="" aria-hidden="true" />
      <img className="lp-atmo-bg lp-atmo-bg-dark" src={DARK_HORIZON_SRC} width={1920} height={1280} fetchPriority="high" alt="" aria-hidden="true" />
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
              className="lp-rail-btn lp-rail-new"
              aria-label="Preview Test Studio & Policy Gate"
              title="New test"
              onClick={() => setHeroTab('gate')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              className={`lp-rail-btn ${heroTab === 'gate' ? 'lp-rail-btn-active' : ''}`}
              aria-label="Test Studio & Policy Gate"
              aria-pressed={heroTab === 'gate'}
              onClick={() => setHeroTab('gate')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M4 6h16M4 12h16M4 18h16" />
                <circle cx="9" cy="6" r="2" fill="currentColor" />
                <circle cx="15" cy="12" r="2" fill="currentColor" />
                <circle cx="11" cy="18" r="2" fill="currentColor" />
              </svg>
            </button>
            <button
              type="button"
              className={`lp-rail-btn ${heroTab === 'report' ? 'lp-rail-btn-active' : ''}`}
              aria-label="Runs Table & Capacity Report"
              aria-pressed={heroTab === 'report'}
              onClick={() => setHeroTab('report')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 10h18M9 10v10" />
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
                <path d="M9 12l2 2 4-4" />
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
                <span className="lp-tag">yue.macro.my.id</span>
                <span className="lp-tag">Demo</span>
                <span className="lp-tag lp-tag-ok">run d28cacd6</span>
              </div>
            </div>

            {heroTab === 'report' && (
              <div role="tabpanel" id="wb-panel-report" aria-labelledby="wb-tab-report" className="flex flex-col gap-3.5">
                <div className="lp-kpi-row">
                  <div className="lp-kpi lp-kpi-live">
                    <div className="lp-kpi-label">Safe Capacity (VUs)</div>
                    <div className="lp-kpi-val">100 VUs</div>
                    <div className="lp-kpi-note">Stage 3 · p95 910 ms</div>
                  </div>
                  <div className="lp-kpi lp-kpi-bad">
                    <div className="lp-kpi-label">Breaking Point (VUs)</div>
                    <div className="lp-kpi-val">200 VUs</div>
                    <div className="lp-kpi-note">Stage 4 · 1,611 ms p95</div>
                  </div>
                  <div className="lp-kpi lp-kpi-warn">
                    <div className="lp-kpi-label">First degraded route</div>
                    <div className="lp-kpi-val">store_home</div>
                    <div className="lp-kpi-note">Stop limit 1,000 ms</div>
                  </div>
                  <div className="lp-kpi">
                    <div className="lp-kpi-label">Tested up to</div>
                    <div className="lp-kpi-val">200 VUs</div>
                    <div className="lp-kpi-note">4 of 4 Stages · 2:00</div>
                  </div>
                </div>
                <div className="lp-window-split">
                  <div className="lp-subpanel">
                    <div className="lp-subpanel-head">
                      <span>Stage {stage.id} ({stage.vus} VUs · {stage.p95Ms.toLocaleString()} ms p95)</span>
                      <span className={`lp-tag ${stage.status === 'pass' ? 'lp-tag-ok' : 'lp-tag-bad'}`}>
                        {stage.status === 'pass' ? 'Supervisor: Continue' : 'Supervisor: Halt'}
                      </span>
                    </div>
                    <div className="lp-bars mt-auto">
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
                    <p className="lp-mono m-0 text-[0.72rem] text-muted">{stage.supervisorNote}</p>
                  </div>

                  <div className="lp-subpanel">
                    <div className="lp-subpanel-head">
                      <span>What happened</span>
                      <span className="lp-mono text-xs text-muted">Newest first</span>
                    </div>
                    <ul className="lp-event-list">
                      <li>
                        <div className="lp-event-row">
                          <strong>Stop after Stage 4</strong>
                          <span className="lp-tag lp-tag-bad">stop</span>
                        </div>
                        <span className="lp-event-detail">store_home p95 1,611 ms exceeded 1,000 ms limit.</span>
                      </li>
                      <li>
                        <div className="lp-event-row">
                          <strong>Stage 3 of 4 finished</strong>
                          <span className="lp-tag lp-tag-ok">pass</span>
                        </div>
                        <span className="lp-event-detail">100 VUs · p95 910 ms · errors 0.0%.</span>
                      </li>
                      <li>
                        <div className="lp-event-row">
                          <strong>Sandbox removed</strong>
                          <span className="lp-tag">Containment</span>
                        </div>
                        <span className="lp-event-detail">Number Guard: 6/6 figures matched to run d28cacd6.</span>
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {heroTab === 'gate' && (
              <div role="tabpanel" id="wb-panel-gate" aria-labelledby="wb-tab-gate" className="lp-window-split">
                <div className="lp-subpanel flex flex-col gap-3">
                  <div className="lp-subpanel-head">
                    <span>Traffic Description</span>
                    <span className="lp-tag lp-tag-ok">Cloud Model: Gemini</span>
                  </div>
                  <div className="lp-row" role="group" aria-label="Policy Gate presets">
                    {POLICY_PRESETS.map((p, idx) => (
                      <button
                        key={p.id}
                        type="button"
                        className={`lp-tab ${idx === presetIdx ? 'lp-tab-pressed' : ''}`}
                        aria-selected={idx === presetIdx}
                        aria-pressed={idx === presetIdx}
                        onClick={() => setPresetIdx(idx)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                  <p className="lp-wb-prompt">
                    {preset.id === 'demo-ramp'
                      ? 'Ramp traffic on yue.macro.my.id across store_home, catalog_list, and product_detail from 25 to 200 VUs in four 30-second stages. Stop if p95 > 1,000 ms.'
                      : preset.id === 'over-vu'
                        ? 'Spike 750 concurrent shoppers onto yue.macro.my.id immediately with no latency or error-rate stop limit.'
                        : 'Run 50 virtual users against https://shop.example.com without verifying domain ownership.'}
                  </p>
                  <div className="lp-subpanel-head mt-auto">
                    <span className="lp-mono text-xs text-muted">Scenario Assistant ready</span>
                    <button
                      type="button"
                      className="lp-btn lp-btn-ink lp-btn-compact"
                      onClick={() => setPresetIdx((presetIdx + 1) % POLICY_PRESETS.length)}
                    >
                      Draft a plan
                    </button>
                  </div>
                </div>

                <div className="lp-subpanel flex flex-col gap-3">
                  <div className="lp-wb-banner">
                    <img src={sanokDitherSrc('span')} width={1920} height={1280} loading="lazy" alt="" aria-hidden="true" />
                    <div className="lp-wb-banner-cap">
                      <span>Policy Gate</span>
                      <strong>{preset.verdict === 'approved' ? '3/3 rules PASS' : 'BLOCKED'}</strong>
                    </div>
                  </div>
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
                  {preset.verdict === 'approved' ? (
                    <button
                      type="button"
                      className="lp-btn lp-btn-primary lp-btn-compact mt-auto w-full"
                      onClick={() => setHeroTab('report')}
                    >
                      Approve &amp; Run
                    </button>
                  ) : null}
                </div>
              </div>
            )}

            {heroTab === 'probe' && (
              <div role="tabpanel" id="wb-panel-probe" aria-labelledby="wb-tab-probe" className="lp-subpanel flex flex-col gap-3">
                <div className="lp-wb-banner">
                  <img src={sanokDitherSrc('workers')} width={1920} height={1280} loading="lazy" alt="" aria-hidden="true" />
                  <div className="lp-wb-banner-cap">
                    <span>Containment Probe · gVisor runsc + Egress Proxy</span>
                    <strong>5 / 5 contained</strong>
                  </div>
                </div>
                <div className="lp-subpanel-head">
                  <div className="lp-row">
                    <span className="lp-tag">Runtime: runsc</span>
                    <span className="lp-tag">Time cap: 60 s</span>
                    <span className="lp-tag">Memory cap: 1 GiB</span>
                    <span className="lp-tag">Allowlist: yue.macro.my.id:443</span>
                  </div>
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
