import { useState } from 'react';

interface PreviewCase {
  id: 'safe' | 'host' | 'load';
  label: string;
  prompt: string;
  target: string;
  stages: string;
  accepted: boolean;
  verdictTitle: string;
  violations?: readonly string[];
}

const CASES: readonly PreviewCase[] = [
  {
    id: 'safe',
    label: 'Campaign spike',
    prompt: 'Flash sale at noon; 200 visitors browse the catalog, open items, and 10% place an order.',
    target: 'https://yue.macro.my.id',
    stages: '25 → 50 → 100 → 200 VUs (240 s total)',
    accepted: true,
    verdictTitle: 'Accepted by policy gate — ready to Approve and run.',
  },
  {
    id: 'host',
    label: 'Unverified host',
    prompt: 'Send 150 users to https://shop.example.com for two minutes.',
    target: 'https://shop.example.com',
    stages: '50 → 150 VUs (120 s total)',
    accepted: false,
    verdictTitle: 'Rejected by policy gate. 0 requests sent; Approve button hidden.',
    violations: ['Rule 4.2: target origin https://shop.example.com is not verified'],
  },
  {
    id: 'load',
    label: 'Over 500 VUs',
    prompt: 'Hammer the storefront with 50,000 concurrent users for 4 minutes.',
    target: 'https://yue.macro.my.id',
    stages: '1,000 → 50,000 VUs (240 s total)',
    accepted: false,
    verdictTitle: 'Rejected by policy gate. 0 requests sent; Approve button hidden.',
    violations: ['Rule 4.4: peak virtual users 50,000 is above the limit of 500'],
  },
];

export function PolicyGate() {
  const [selected, setSelected] = useState<PreviewCase['id']>('safe');
  const current = CASES.find((c) => c.id === selected) ?? CASES[0]!;

  return (
    <section className="gate" data-ui aria-label="Example AI plan and policy gate check">
      <div className="gate__head">
        <span className="gate__title">
          Drafted plan <span>checked by policy gate</span>
        </span>
        <span className={current.accepted ? 'chip chip--ok' : 'chip chip--bad'}>
          {current.accepted ? 'Accepted' : 'Rejected'}
        </span>
      </div>
      <div className="gate__body">
        <div className="gate__presets" role="group" aria-label="Sample plans">
          Example:
          {CASES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={c.id === current.id ? 'is-active' : undefined}
              aria-pressed={c.id === current.id}
              onClick={() => setSelected(c.id)}
            >
              {c.label}
            </button>
          ))}
        </div>
        <div className="gate__prompt">
          <span className="gate__k">Prompt</span>
          <p>{current.prompt}</p>
        </div>
        <div className="gate__row">
          <div className="gate__kv">
            <span className="gate__k">Target</span>
            <code>{current.target}</code>
          </div>
          <div className="gate__kv">
            <span className="gate__k">AI-drafted stages</span>
            <span>{current.stages}</span>
          </div>
        </div>
        <div className={current.accepted ? 'gate__verdict gate__verdict--ok' : 'gate__verdict gate__verdict--bad'} aria-live="polite">
          <strong>{current.verdictTitle}</strong>
          {current.violations ? (
            <ul>
              {current.violations.map((v) => (
                <li key={v}>{v}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </section>
  );
}
