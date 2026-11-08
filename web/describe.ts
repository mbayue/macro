/**
 * Describe view (`#/`): Traffic_Event input, plan review, approval.
 *
 *   export function renderDescribeView(root, ctx, params): ViewCleanup
 *
 * Requirements: 1.1, 1.2, 1.5-1.8, 2.3, 2.5, 2.6, 2.8, 4.8, 5.1.
 * All API strings are set as text nodes (see dom.ts).
 */
import type { CatalogRouteView, ModelCallView, PlanResponse } from '../src/api-types.ts';
import { fmtMs } from '../src/run/format.ts';
import type { TestPlan } from '../src/types.ts';
import { type ApiError, type ApiResult, VERIFICATION_ERROR, postApprove, postPlan, postProbe } from './api.ts';
import type { AppContext, RouteParams, ViewCleanup } from './context.ts';
import { clear, el, parseErrorText, renderApiError, scrollRegion, violationsTable } from './dom.ts';
import { renderGateDemoPanel } from './gate-demo.ts';
import { disposeWidget, getToken, resetWidget } from './turnstile.ts';

/** Unicode code points of the trimmed text (requirement 1.1). */
export function countCodePoints(text: string): number {
  return [...text.trim()].length;
}

/** Static introduction above the form: what Macro does, the three steps, and the safety guarantees. */
function introSection(): HTMLElement {
  const step = (n: number, label: string): HTMLElement =>
    el('li', { class: 'intro__step' }, el('span', { class: 'intro__num', 'aria-hidden': 'true' }, n), el('span', null, label));
  return el(
    'section',
    { class: 'intro', 'aria-label': 'About Macro' },
    el(
      'div',
      { class: 'intro__main' },
      el(
        'p',
        { class: 'intro__lead' },
        'Describe a traffic spike in plain words. Macro plans a load test, you approve it, and k6 runs it inside throwaway sandboxes that can only reach the demo store. You get the point where it breaks.',
      ),
      el(
        'ol',
        { class: 'intro__steps' },
        step(1, 'Describe'),
        step(2, 'Review and approve'),
        step(3, 'Watch it run and read the report'),
      ),
    ),
    el(
      'div',
      { class: 'intro__safe' },
      el('h2', { class: 'intro__heading' }, 'Safe by design'),
      el(
        'ul',
        { class: 'intro__list' },
        el('li', null, 'Only the demo store can be tested.'),
        el('li', null, 'The AI proposes; fixed rules approve.'),
        el('li', null, 'Every stage runs in its own gVisor sandbox with no secrets and an egress allowlist.'),
        el('li', null, 'Every number in the report is measured by k6. AI text is checked against those numbers.'),
      ),
    ),
  );
}

type Busy = 'planning' | 'approving' | 'probing' | null;

export function renderDescribeView(root: HTMLElement, ctx: AppContext, _params: RouteParams = {}): ViewCleanup {
  const { config } = ctx;
  const min = config.trafficEventMin;
  const max = config.trafficEventMax;
  const catalog = new Map<string, CatalogRouteView>(config.catalog.map((r) => [r.id, r]));

  let disposed = false;
  let busy: Busy = null;
  let lastSubmitted: string | null = null;

  // ---- Form -------------------------------------------------------------
  const textarea = el('textarea', {
    id: 'traffic-event',
    class: 'textarea',
    rows: 7,
    autocomplete: 'off',
    'aria-describedby': 'traffic-event-hint traffic-event-count traffic-event-problem',
  });
  const counter = el('span', { id: 'traffic-event-count', class: 'counter mono' });
  const problem = el('span', { id: 'traffic-event-problem', class: 'muted' });
  const planAlert = el('div', { class: 'alert', role: 'alert' });
  const planProgress = el(
    'span',
    { class: 'progress', role: 'status', hidden: true },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('span', null, 'Drafting a plan. This can take up to a minute.'),
  );
  const submitBtn = el('button', { type: 'submit', class: 'btn btn--primary' }, 'Draft a plan');
  const retryBtn = el(
    'button',
    {
      type: 'button',
      class: 'btn',
      hidden: true,
      onclick: () => {
        if (lastSubmitted !== null) void startPlanning(lastSubmitted);
      },
    },
    'Retry planning',
  );
  const turnstileBox = el('div', { class: 'turnstile' });

  const exampleButtons = config.examples.map((ex) =>
    el(
      'button',
      {
        type: 'button',
        class: 'btn',
        onclick: () => {
          if (busy !== null) return;
          textarea.value = ex.text; // fills only; never submits
          refresh();
          textarea.focus();
        },
      },
      ex.label,
    ),
  );

  const form = el(
    'form',
    {
      class: 'panel stack',
      novalidate: true,
      onsubmit: (ev: Event) => {
        ev.preventDefault();
        void startPlanning(textarea.value.trim());
      },
    },
    el('label', { for: 'traffic-event', class: 'label' }, 'Describe the traffic you expect'),
    el(
      'p',
      { id: 'traffic-event-hint', class: 'muted' },
      `Say who arrives, when, and what they do. ${min} to ${max.toLocaleString('en-US')} characters.`,
    ),
    textarea,
    el('div', { class: 'row row--between' }, counter, problem),
    exampleButtons.length > 0
      ? el(
          'div',
          { class: 'stack stack--tight', role: 'group', 'aria-label': 'Examples' },
          el('span', { class: 'muted' }, 'Examples (fill the text box only):'),
          el('div', { class: 'row' }, exampleButtons),
        )
      : null,
    el(
      'dl',
      { class: 'kv' },
      el('dt', null, 'Target'),
      el('dd', { class: 'mono' }, config.webOrigin),
    ),
    el('p', { class: 'muted' }, 'This is the only target. It cannot be changed.'),
    turnstileBox,
    el('div', { class: 'row' }, submitBtn, retryBtn, planProgress),
    planAlert,
  );

  const runtimeNotice = config.runtimeError
    ? el(
        'div',
        { class: 'panel panel--warn stack stack--tight' },
        el('p', null, el('span', { class: 'badge badge--bad' }, 'Runtime problem')),
        el('p', null, `Runs cannot start until this is fixed: ${config.runtimeError}`),
      )
    : null;

  const reviewHost = el('div', { class: 'stack' });

  // Secondary panel: run the Containment_Probe (no plan needed).
  const probeAlert = el('div', { class: 'alert', role: 'alert' });
  const probeBox = el('div', { class: 'turnstile' });
  const probeBtn = el(
    'button',
    { type: 'button', class: 'btn', onclick: () => void startProbe() },
    'Run containment probe',
  );
  const probeProgress = el(
    'span',
    { class: 'progress', role: 'status', hidden: true },
    el('span', { class: 'spinner', 'aria-hidden': 'true' }),
    el('span', null, 'Starting the probe.'),
  );
  const probePanel = el(
    'section',
    { class: 'panel stack' },
    el('h2', null, 'See containment work: run the sandbox probe'),
    el(
      'p',
      null,
      'The probe tries to escape the sandbox with five attempts, such as reaching the internet and the cloud metadata address, and the sandbox blocks each one.',
    ),
    probeBox,
    el('div', { class: 'row' }, probeBtn, probeProgress),
    probeAlert,
  );

  // Approval controls exist only while an accepted plan is shown.
  let approveBtn: HTMLButtonElement | null = null;
  let approveProgress: HTMLElement | null = null;
  let staleNote: HTMLElement | null = null;

  const gateDemoHost = el('div');

  root.append(
    el(
      'div',
      { class: 'stack stack--loose' },
      el('h1', null, 'Plan a load test'),
      introSection(),
      runtimeNotice,
      form,
      reviewHost,
      probePanel,
      gateDemoHost,
    ),
  );
  renderGateDemoPanel(gateDemoHost);

  // ---- State -> DOM -----------------------------------------------------
  function refresh(): void {
    const n = countCodePoints(textarea.value);
    const inRange = n >= min && n <= max;
    counter.textContent = `${n.toLocaleString('en-US')} / ${max.toLocaleString('en-US')}`;
    counter.classList.toggle('counter--bad', n > 0 && !inRange);
    if (n === 0) problem.textContent = '';
    else if (n < min) problem.textContent = `Needs at least ${min} characters.`;
    else if (n > max) problem.textContent = `${(n - max).toLocaleString('en-US')} over the limit.`;
    else problem.textContent = '';

    const idle = busy === null;
    submitBtn.disabled = !inRange || !idle;
    for (const b of exampleButtons) b.disabled = !idle;
    retryBtn.disabled = !idle;
    textarea.readOnly = !idle;
    planProgress.hidden = busy !== 'planning';
    if (approveBtn) approveBtn.disabled = !idle;
    if (approveProgress) approveProgress.hidden = busy !== 'approving';
    probeBtn.disabled = !idle;
    probeProgress.hidden = busy !== 'probing';
    if (lastSubmitted !== null && textarea.value.trim() !== lastSubmitted) retryBtn.hidden = true;
    if (staleNote) staleNote.hidden = textarea.value.trim() === lastSubmitted;
  }

  textarea.addEventListener('input', refresh);

  function showError(region: HTMLElement, err: ApiError): void {
    clear(region);
    region.append(renderApiError(err));
  }

  // ---- Planning -----------------------------------------------------------
  async function startPlanning(text: string): Promise<void> {
    if (busy !== null || disposed) return;
    const n = countCodePoints(text);
    if (n < min || n > max) return;

    busy = 'planning';
    lastSubmitted = text;
    approveBtn = null;
    approveProgress = null;
    staleNote = null;
    clear(planAlert);
    clear(reviewHost);
    retryBtn.hidden = true;
    refresh();
    ctx.announce('Drafting a plan.');

    let result: ApiResult<PlanResponse>;
    try {
      const token = await getToken(config.turnstileSiteKey, turnstileBox);
      result = await postPlan({ trafficEvent: text, turnstileToken: token });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      resetWidget();
    }
    if (disposed) return;

    busy = null;
    if (result.ok) {
      renderReview(result.data);
    } else {
      showError(planAlert, result.error);
      retryBtn.hidden = result.error.code !== 'planning_failed';
      ctx.announce(result.error.message);
    }
    refresh();
  }

  // ---- Approval -----------------------------------------------------------
  async function approve(planText: string, errorRegion: HTMLElement, box: HTMLElement): Promise<void> {
    if (busy !== null || disposed) return;
    busy = 'approving';
    clear(errorRegion);
    refresh();
    ctx.announce('Starting the run.');

    let result: Awaited<ReturnType<typeof postApprove>>;
    try {
      const token = await getToken(config.turnstileSiteKey, box);
      result = await postApprove({ planText, turnstileToken: token });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      resetWidget();
    }
    if (disposed) return;

    if (result.ok) {
      // Stay busy: no second submission while the page changes.
      ctx.navigate(`/run/${encodeURIComponent(result.data.runId)}`);
      return;
    }
    busy = null;
    showError(errorRegion, result.error);
    ctx.announce(result.error.message);
    refresh();
  }

  // ---- Containment probe ----------------------------------------------------
  async function startProbe(): Promise<void> {
    if (busy !== null || disposed) return;
    busy = 'probing';
    clear(probeAlert);
    refresh();
    ctx.announce('Starting the containment probe.');

    let result: Awaited<ReturnType<typeof postProbe>>;
    try {
      const token = await getToken(config.turnstileSiteKey, probeBox);
      result = await postProbe({ turnstileToken: token });
    } catch {
      result = { ok: false, error: VERIFICATION_ERROR };
    } finally {
      resetWidget();
    }
    if (disposed) return;

    if (result.ok) {
      // Stay busy: no second start while the page changes.
      ctx.navigate(`/probe/${encodeURIComponent(result.data.runId)}`);
      return;
    }
    busy = null;
    showError(probeAlert, result.error);
    ctx.announce(result.error.message);
    refresh();
  }

  // ---- Plan review --------------------------------------------------------
  function renderReview(res: PlanResponse): void {
    clear(reviewHost);
    const heading = el('h2', { tabindex: -1 }, 'Draft plan');
    reviewHost.append(heading);
    staleNote = el(
      'p',
      { class: 'muted', hidden: true },
      'The text above changed after this plan was drafted. The plan below is for the earlier text.',
    );
    reviewHost.append(staleNote);

    if (res.parseError) {
      reviewHost.append(
        el(
          'section',
          { class: 'panel stack' },
          el('p', null, el('span', { class: 'badge badge--bad' }, 'Not approvable')),
          el('p', null, 'The plan could not be read, so it cannot be approved.'),
          el('p', { class: 'mono' }, parseErrorText(res.parseError)),
        ),
        modelCallsSection(res.modelCalls),
      );
      ctx.announce('The drafted plan could not be read. It cannot be approved.');
      heading.focus();
      return;
    }

    const plan = res.plan;
    if (plan === null) {
      reviewHost.append(
        el('section', { class: 'panel stack' }, el('p', null, 'No plan was returned.')),
        modelCallsSection(res.modelCalls),
      );
      heading.focus();
      return;
    }

    const gate = res.gate;
    const rejected = gate !== null && gate.status === 'rejected';
    if (rejected) {
      reviewHost.append(
        el(
          'section',
          { class: 'panel stack' },
          el('p', null, el('span', { class: 'badge badge--bad' }, 'Rejected by the policy gate')),
          el('p', null, 'This plan breaks the rules below, so it cannot be approved.'),
          violationsTable(gate.violations),
        ),
      );
    }

    reviewHost.append(planSection(plan, res.rationale), modelCallsSection(res.modelCalls));

    const approvable = gate !== null && gate.status === 'accepted' && res.planText !== null;
    if (approvable && res.planText !== null) {
      reviewHost.append(approvalPanel(plan, res.planText));
      ctx.announce('Plan ready for review.');
    } else if (!rejected) {
      reviewHost.append(
        el('section', { class: 'panel' }, el('p', null, 'This plan has no policy result, so it cannot be approved.')),
      );
    } else {
      ctx.announce('The plan was rejected by the policy gate.');
    }
    heading.focus();
  }

  function planSection(plan: TestPlan, rationale: string | null): HTMLElement {
    return el(
      'section',
      { class: 'panel stack' },
      el('h3', null, 'Plan'),
      el('p', { class: 'plan-name' }, plan.name),
      rationale !== null && rationale !== ''
        ? el('div', { class: 'stack stack--tight' }, el('h4', null, 'Why this plan'), el('p', { class: 'prose' }, rationale))
        : null,
      stagesTable(plan),
      journeyTable(plan),
      el(
        'div',
        { class: 'stack stack--tight' },
        el('h4', null, 'Stop thresholds'),
        el(
          'dl',
          { class: 'kv' },
          el('dt', null, 'p95 latency limit'),
          el('dd', { class: 'mono' }, `${plan.stopThresholds.p95Ms} ms`),
          el('dt', null, 'Error rate limit'),
          el('dd', { class: 'mono' }, `${plan.stopThresholds.errorRatePct}%`),
        ),
      ),
    );
  }

  function stagesTable(plan: TestPlan): HTMLElement {
    return scrollRegion(
      'Stages',
      el(
        'table',
        { class: 'table' },
        el('caption', null, 'Stages'),
        el(
          'thead',
          null,
          el(
            'tr',
            null,
            el('th', { scope: 'col' }, 'Stage'),
            el('th', { scope: 'col', class: 'num' }, 'Virtual users'),
            el('th', { scope: 'col', class: 'num' }, 'Duration (s)'),
          ),
        ),
        el(
          'tbody',
          null,
          plan.stages.map((s, i) =>
            el(
              'tr',
              null,
              el('th', { scope: 'row', class: 'mono' }, i + 1),
              el('td', { class: 'num mono' }, s.vus),
              el('td', { class: 'num mono' }, s.durationSec),
            ),
          ),
        ),
      ),
    );
  }

  function journeyTable(plan: TestPlan): HTMLElement {
    return scrollRegion(
      'Journey',
      el(
        'table',
        { class: 'table' },
        el('caption', null, 'Journey'),
        el(
          'thead',
          null,
          el(
            'tr',
            null,
            el('th', { scope: 'col' }, 'Route'),
            el('th', { scope: 'col' }, 'Method'),
            el('th', { scope: 'col' }, 'Path'),
            el('th', { scope: 'col', class: 'num' }, 'Probability (%)'),
            el('th', { scope: 'col', class: 'num' }, 'Think time (ms)'),
          ),
        ),
        el(
          'tbody',
          null,
          plan.journey.map((step) => {
            const route = catalog.get(step.route);
            return el(
              'tr',
              null,
              el('th', { scope: 'row', class: 'mono' }, step.route),
              route ? el('td', { class: 'mono' }, route.method) : el('td', { class: 'muted', colspan: 2 }, 'Not in the route catalog'),
              route ? el('td', { class: 'mono' }, route.path) : null,
              el('td', { class: 'num mono' }, step.probability),
              el('td', { class: 'num mono' }, step.thinkMs),
            );
          }),
        ),
      ),
    );
  }

  function modelCallsSection(calls: readonly ModelCallView[]): HTMLElement {
    if (calls.length === 0) {
      return el(
        'section',
        { class: 'panel stack stack--tight' },
        el('h3', null, 'Model calls'),
        el('p', { class: 'muted' }, 'No model calls were recorded.'),
      );
    }
    return el(
      'section',
      { class: 'panel stack stack--tight' },
      el('h3', null, 'Model calls'),
      scrollRegion(
        'Model calls',
        el(
          'table',
          { class: 'table' },
          el('caption', null, 'Model calls in request order'),
          el(
            'thead',
            null,
            el(
              'tr',
              null,
              el('th', { scope: 'col', class: 'num' }, '#'),
              el('th', { scope: 'col' }, 'Agent'),
              el('th', { scope: 'col' }, 'Model'),
              el('th', { scope: 'col' }, 'Outcome'),
              el('th', { scope: 'col', class: 'num' }, 'Latency (ms)'),
              el('th', { scope: 'col' }, 'Tokens'),
            ),
          ),
          el(
            'tbody',
            null,
            calls.map((c, i) =>
              el(
                'tr',
                null,
                el('th', { scope: 'row', class: 'num mono' }, i + 1),
                el('td', { class: 'mono' }, c.agent),
                el('td', { class: 'mono' }, c.model),
                el('td', null, outcomeBadge(c.outcome)),
                el('td', { class: 'num mono' }, fmtMs(c.latencyMs)),
                el('td', { class: 'mono' }, tokensText(c)),
              ),
            ),
          ),
        ),
      ),
    );
  }

  function outcomeBadge(outcome: ModelCallView['outcome']): HTMLElement {
    const cls = outcome === 'success' ? 'badge--ok' : outcome === 'timeout' ? 'badge--warn' : 'badge--bad';
    return el('span', { class: `badge ${cls}` }, outcome);
  }

  function tokensText(c: ModelCallView): string {
    if (c.promptTokens === null && c.completionTokens === null) return 'not reported';
    const part = (n: number | null): string => (n === null ? 'not reported' : String(n));
    return `prompt ${part(c.promptTokens)}, completion ${part(c.completionTokens)}`;
  }

  function approvalPanel(plan: TestPlan, planText: string): HTMLElement {
    const maxVus = plan.stages.reduce((m, s) => Math.max(m, s.vus), 0);
    const totalSec = plan.stages.reduce((sum, s) => sum + s.durationSec, 0);
    const approveAlert = el('div', { class: 'alert', role: 'alert' });
    const box = el('div', { class: 'turnstile' });
    const btn = el(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary',
        onclick: () => void approve(planText, approveAlert, box),
      },
      'Approve and run',
    );
    const progress = el(
      'span',
      { class: 'progress', role: 'status', hidden: true },
      el('span', { class: 'spinner', 'aria-hidden': 'true' }),
      el('span', null, 'Starting the run.'),
    );
    approveBtn = btn;
    approveProgress = progress;
    return el(
      'section',
      { class: 'panel panel--accent stack' },
      el('h3', null, 'Approve this plan'),
      el('p', null, 'Nothing is sent until you approve. Approving starts the run right away.'),
      el(
        'dl',
        { class: 'kv' },
        el('dt', null, 'Target'),
        el('dd', { class: 'mono' }, plan.target),
        el('dt', null, 'Maximum virtual users'),
        el('dd', { class: 'mono' }, maxVus),
        el('dt', null, 'Total stage duration'),
        el('dd', { class: 'mono' }, `${totalSec} s`),
      ),
      box,
      el('div', { class: 'row' }, btn, progress),
      approveAlert,
    );
  }

  refresh();

  return () => {
    disposed = true;
    disposeWidget();
  };
}
