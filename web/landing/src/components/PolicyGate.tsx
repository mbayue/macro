import { useState } from 'react';

/** The same limits the product's Policy_Gate enforces (src/plan/policy.ts). */
const ALLOW = ['https://yue.macro.my.id'];
const MAX_VUS = 500;
const MIN_DURATION = 30;
const MAX_DURATION = 600;

const fmt = (n: number): string => n.toLocaleString('en-US');

export function gateProblems(target: string, vusText: string, durText: string): string[] {
  const problems: string[] = [];
  try {
    const u = new URL(target.trim());
    const origin = `${u.protocol}//${u.host}`;
    if (u.protocol !== 'https:') problems.push('target must be an https:// origin');
    else if (/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || u.hostname.startsWith('[')) problems.push('IP addresses are refused as targets');
    else if (!ALLOW.includes(origin)) problems.push(`target origin ${origin} is not in the Target_Allowlist`);
  } catch {
    problems.push('target is not a valid URL');
  }
  const vus = Number.parseInt(vusText, 10);
  const dur = Number.parseInt(durText, 10);
  if (!(vus >= 1)) problems.push('peak virtual users must be at least 1');
  else if (vus > MAX_VUS) problems.push(`peak virtual users ${fmt(vus)} is above the limit of ${MAX_VUS}`);
  if (!(dur >= MIN_DURATION)) problems.push(`total duration must be at least ${MIN_DURATION} seconds`);
  else if (dur > MAX_DURATION) problems.push(`total duration ${fmt(dur)} s is above the limit of ${MAX_DURATION} s`);
  return problems;
}

const PRESETS = {
  site: { target: 'https://shop.example.com', vus: '200', dur: '240' },
  load: { target: 'https://yue.macro.my.id', vus: '50000', dur: '240' },
  ok: { target: 'https://yue.macro.my.id', vus: '200', dur: '240' },
} as const;

export function PolicyGate() {
  const [target, setTarget] = useState<string>(PRESETS.ok.target);
  const [vus, setVus] = useState<string>(PRESETS.ok.vus);
  const [dur, setDur] = useState<string>(PRESETS.ok.dur);
  const problems = gateProblems(target, vus, dur);
  const accepted = problems.length === 0;

  const preset = (key: keyof typeof PRESETS) => () => {
    setTarget(PRESETS[key].target);
    setVus(PRESETS[key].vus);
    setDur(PRESETS[key].dur);
  };

  return (
    <form className="gate" data-ui aria-label="Policy gate, try a plan" noValidate onSubmit={(e) => e.preventDefault()}>
      <div className="gate__head">
        <span className="gate__title">
          Policy gate <span>checks every plan before it runs</span>
        </span>
        <span className={accepted ? 'chip chip--ok' : 'chip chip--bad'}>{accepted ? 'Passed' : 'Rejected'}</span>
      </div>
      <div className="gate__body">
        <div>
          <label htmlFor="g-target">Target</label>
          <input id="g-target" type="url" value={target} spellCheck={false} autoComplete="off" onChange={(e) => setTarget(e.target.value)} />
          <p className="gate__hint">Verified for this workspace: yue.macro.my.id</p>
        </div>
        <div className="gate__row">
          <div>
            <label htmlFor="g-vus">Peak virtual users</label>
            <input id="g-vus" type="number" inputMode="numeric" min={1} value={vus} onChange={(e) => setVus(e.target.value)} />
          </div>
          <div>
            <label htmlFor="g-dur">Total duration (seconds)</label>
            <input id="g-dur" type="number" inputMode="numeric" min={1} value={dur} onChange={(e) => setDur(e.target.value)} />
          </div>
        </div>
        <div className="gate__presets">
          Try:
          <button type="button" onClick={preset('site')}>Another website</button>
          <button type="button" onClick={preset('load')}>50,000 users</button>
          <button type="button" onClick={preset('ok')}>A safe plan</button>
        </div>
        <div className={accepted ? 'gate__verdict gate__verdict--ok' : 'gate__verdict gate__verdict--bad'} aria-live="polite">
          {accepted ? (
            <>
              <strong>Ready for your approval.</strong> Nothing has run yet.
            </>
          ) : (
            <>
              <strong>Rejected by the policy gate. 0 requests were sent.</strong>
              <ul>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </form>
  );
}
