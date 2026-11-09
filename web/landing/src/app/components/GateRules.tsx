/**
 * What the policy gate allows, stated from the fixed rules in src/plan/policy.ts, plus the
 * routes a plan may use (from /api/config). Shown beside the New test form so people write
 * descriptions that can pass.
 */
import { useApp } from '../context.tsx';
import { KeyValues, Panel } from './ui.tsx';

export function GateRules() {
  const { config } = useApp();
  return (
    <>
      <Panel title="What the policy gate allows" id="gate-rules-heading" note="Fixed code checks every plan against these rules before it can be approved. The AI cannot change them.">
        <KeyValues
          items={[
            ['Target', <span className="code">{config.webOrigin}</span>],
            ['Stages', '1 to 6, each with more users than the one before'],
            ['Users per stage', '1 to 500'],
            ['Stage length', '30 to 180 s, at most 600 s in total'],
            ['Routes', 'Only the routes listed below'],
          ]}
        />
      </Panel>
      <Panel title="Routes a plan can use" id="gate-routes-heading">
        <ul className="routes">
          {config.catalog.map((r) => (
            <li key={r.id}>
              <span className="code">{r.id}</span>
              <span className="muted">
                <span className="code">{r.method}</span> {r.path}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
