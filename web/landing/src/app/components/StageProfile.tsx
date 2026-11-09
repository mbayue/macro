/**
 * The plan's load profile as bars standing on a baseline, the same gesture as the landing page's
 * latency bars: width by duration, height by virtual users. Decorative; a stage list or table
 * beside it holds the same numbers for assistive technology.
 */
import { useEffect, useRef } from 'react';

export type StageState = 'planned' | 'running' | 'pass' | 'fail' | 'error' | 'skipped';

export interface ProfileStage {
  vus: number;
  durationSec: number;
  state: StageState;
  /** 0..1 progress through a running stage. */
  progress?: number;
}

export function StageProfile({ stages, compact = false }: { stages: readonly ProfileStage[]; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const max = Math.max(1, ...stages.map((s) => s.vus));

  // Sizes go through the CSSOM: the CSP forbids style attributes.
  useEffect(() => {
    const cells = ref.current?.querySelectorAll<HTMLElement>('[data-stage]') ?? [];
    cells.forEach((el) => {
      const s = stages[Number(el.dataset['stage'])];
      if (!s) return;
      el.style.setProperty('--h', String(Math.max(0.06, s.vus / max)));
      el.style.setProperty('--w', String(Math.max(1, s.durationSec)));
      el.style.setProperty('--p', String(s.progress ?? 0));
    });
  }, [stages, max]);

  return (
    <div ref={ref} className={compact ? 'profile profile--compact' : 'profile'} aria-hidden="true">
      {stages.map((s, i) => (
        <div key={i} data-stage={i} className={`profile__stage profile__stage--${s.state}`}>
          <span className="profile__bar">
            {s.state === 'running' ? <span className="profile__fill" /> : null}
          </span>
          <span className="profile__label">
            <span>
              <b>{s.vus.toLocaleString('en-US')}</b> VUs
            </span>
            {compact ? null : <span>{s.durationSec} s</span>}
          </span>
        </div>
      ))}
    </div>
  );
}
