/**
 * "See the policy gate block a hostile plan" panel on the describe view.
 *
 *   export function renderGateDemoPanel(container: HTMLElement): void
 *
 * Calls POST /api/gate-demo, which parses and evaluates a fixed hostile plan with the real
 * Plan_Parser and Policy_Gate. Nothing is stored, started or sent. All API strings reach the page
 * as text nodes (see dom.ts).
 */
import type { GateDemoResponse, GateDemoScenario } from '../src/api-types.ts';
import { postGateDemo } from './api.ts';
import type { ApiError } from './api.ts';
import { clear, el, renderApiError, violationsTable } from './dom.ts';

const SCENARIOS: readonly { id: GateDemoScenario; label: string }[] = [
  { id: 'other_host', label: 'Another website' },
  { id: 'too_big', label: 'Far too much load' },
  { id: 'unknown_route', label: 'A route outside the catalog' },
];

export function renderGateDemoPanel(container: HTMLElement): void {
  let busy = false;

  const alertBox = el('div', { class: 'alert', role: 'alert' });
  const result = el('div', { class: 'stack', role: 'status' });
  const progress = el(
    'span',
    { class: 'progress', role: 'status', hidden: true },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('span', null, 'Asking the gate.'),
  );

  const buttons = SCENARIOS.map((s) =>
    el('button', { type: 'button', class: 'btn', onclick: () => void run(s.id) }, s.label),
  );

  function setBusy(value: boolean): void {
    busy = value;
    for (const b of buttons) b.disabled = value;
    progress.hidden = !value;
  }

  function showError(err: ApiError): void {
    clear(alertBox);
    alertBox.append(renderApiError(err));
  }

  function showResult(res: GateDemoResponse): void {
    clear(result);
    result.append(
      el('h3', null, res.title),
      el('p', null, res.description),
      el('div', { class: 'stack stack--tight' }, el('h4', null, 'Plan as proposed'), el('pre', { class: 'code', tabindex: 0 }, res.planText)),
      violationsTable(res.gate.violations),
      el(
        'p',
        { class: 'gate-result' },
        'Rejected by the policy gate. 0 requests were sent. No approve button exists for this plan.',
      ),
    );
  }

  async function run(scenario: GateDemoScenario): Promise<void> {
    if (busy) return;
    setBusy(true);
    clear(alertBox);
    clear(result);
    try {
      const res = await postGateDemo({ scenario });
      if (res.ok) showResult(res.data);
      else showError(res.error);
    } finally {
      setBusy(false);
    }
  }

  container.append(
    el(
      'section',
      { class: 'panel stack' },
      el('h2', null, 'See the policy gate block a hostile plan'),
      el(
        'p',
        null,
        'The agent only proposes plans. Fixed code decides. Pick a hostile plan and watch the gate reject it before anything runs.',
      ),
      el('div', { class: 'row', role: 'group', 'aria-label': 'Hostile plans' }, buttons),
      progress,
      alertBox,
      result,
    ),
  );
}
