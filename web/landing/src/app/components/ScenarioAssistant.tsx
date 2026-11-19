import { useId, useState } from 'react';
import { useHybridPrompt } from '../hooks/useHybridPrompt.ts';
import { buildScenarioPrompt } from '../lib/hybrid-ai.ts';
import { HybridBadge } from './HybridBadge.tsx';
import { AlertRegion, Busy } from './ui.tsx';

const PRESETS = [
  'Add ramp-up and peak spike stages',
  'Target the catalog routes with realistic user mix',
  'Tighten clarity and state exact user count and duration',
] as const;

interface Props {
  draft: string;
  routes: readonly string[];
  disabled: boolean;
  onApply: (nextDraft: string) => void;
}

/** Pre-submission Scenario Assistant that refines Traffic Descriptions via Hybrid Inference. */
export function ScenarioAssistant({ draft, routes, disabled, onApply }: Props) {
  const { available, busy, error, reply, clearReply, run } = useHybridPrompt();
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState<string>(PRESETS[0]);
  const panelId = useId();
  const inputId = useId();

  if (!available) return null;

  async function refine(goal: string) {
    if (disabled) return;
    const trimmed = goal.trim() || PRESETS[0];
    await run(
      buildScenarioPrompt({ draft, instruction: trimmed, routes }),
      'Refining traffic description with Hybrid AI.',
      'Suggestion ready',
    );
  }

  return (
    <div className="hybrid-assist">
      <div className="hybrid-assist__bar">
        <button
          type="button"
          className="chip-btn"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Hide Scenario Assistant' : 'Refine with Hybrid AI'}
        </button>
        <span className="muted">Runs on-device when supported; does not use server planning quota.</span>
      </div>

      {open ? (
        <div id={panelId} className="hybrid-assist__box stack-tight">
          <div className="examples" role="group" aria-label="Refinement presets">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`chip-btn ${instruction === preset ? 'is-active' : ''}`}
                disabled={busy || disabled}
                onClick={() => {
                  setInstruction(preset);
                  void refine(preset);
                }}
              >
                {preset}
              </button>
            ))}
          </div>

          <div className="field hybrid-assist__row">
            <label htmlFor={inputId} className="visually-hidden">
              Refinement instruction
            </label>
            <input
              id={inputId}
              type="text"
              value={instruction}
              disabled={busy || disabled}
              placeholder="e.g. Ramp from 25 to 200 users over 4 minutes"
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void refine(instruction);
                }
              }}
            />
            <button
              type="button"
              className="btn btn--quiet"
              disabled={busy || disabled}
              onClick={() => void refine(instruction)}
            >
              Draft suggestion
            </button>
          </div>

          {busy ? <Busy>Refining description…</Busy> : null}
          <AlertRegion>{error ? <p>{error}</p> : null}</AlertRegion>

          {reply ? (
            <div className="hybrid-assist__result stack-tight" aria-live="polite">
              <div className="hybrid-assist__head">
                <HybridBadge origin={reply.origin} />
              </div>
              <p className="prose">{reply.text}</p>
              <div className="hybrid-assist__actions">
                <button
                  type="button"
                  className="btn"
                  disabled={disabled}
                  onClick={() => {
                    onApply(reply.text);
                    clearReply();
                    setOpen(false);
                  }}
                >
                  Apply to description
                </button>
                <button
                  type="button"
                  className="btn btn--quiet"
                  onClick={clearReply}
                >
                  Dismiss
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
