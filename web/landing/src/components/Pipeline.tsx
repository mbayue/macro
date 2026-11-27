/**
 * Beat 2: 4-Node Deterministic Execution Pipeline (hydrated island).
 */
import { useState } from 'react';
import { PIPELINE_NODES } from '../data.ts';

export function Pipeline() {
  const [nodeIdx, setNodeIdx] = useState(1);
  const activeNode = PIPELINE_NODES[nodeIdx] ?? PIPELINE_NODES[1];

  return (
    <section className="lp-sec" id="vd-pipeline">
      <div className="lp-container">
        <div className="lp-head-row" data-reveal>
          <div>
            <h2 className="lp-h2">How every run stays deterministic and contained</h2>
            <p className="lp-lead mt-3">
              Select any node in the execution chain to inspect what code enforces at that boundary.
            </p>
          </div>
          <span className="lp-meta-note">Boundary {activeNode.step} of 04</span>
        </div>

        <div className="lp-node-rail mt-6" role="group" aria-label="Execution pipeline nodes">
          {PIPELINE_NODES.map((node, idx) => (
            <button
              key={node.id}
              type="button"
              className="lp-node"
              aria-pressed={idx === nodeIdx}
              onClick={() => setNodeIdx(idx)}
            >
              <span className="lp-mono lp-node-step">{node.step}</span>
              <strong>{node.title}</strong>
              <span className="lp-mono lp-node-role">{node.role}</span>
            </button>
          ))}
        </div>

        <div className="lp-node-detail mt-3.5">
          <p>{activeNode.contract}</p>
          <span className="lp-tag">{activeNode.artifact}</span>
        </div>
      </div>
    </section>
  );
}
