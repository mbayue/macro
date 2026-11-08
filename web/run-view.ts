/**
 * STUB (task 8.2 replaces this file). Keep the exported name and signature:
 *
 *   export function renderRunView(
 *     root: HTMLElement,          // empty container owned by the router
 *     ctx: AppContext,            // from ./context.ts
 *     params: { id: string },     // route #/run/<id>; id is already URL-decoded
 *   ): void | (() => void);       // optional cleanup, called on navigation
 *
 * Fetch the snapshot with getRun(id) from ./api.ts, subscribe to
 * `/api/runs/<id>/events` with EventSource, close it in the cleanup function.
 * When the Run has ended and snapshot.report is set, call
 * renderReportView(container, ctx, snapshot.report, { runId, run, plan, modelCalls }).
 */
import type { AppContext, RouteParams, ViewCleanup } from './context.ts';
import { el } from './dom.ts';

export function renderRunView(root: HTMLElement, _ctx: AppContext, params: RouteParams): void | ViewCleanup {
  root.append(
    el(
      'section',
      { class: 'panel stack' },
      el('h1', null, 'Run'),
      el('p', { class: 'muted' }, 'The live run view is not built yet.'),
      el('p', null, 'Run ID: ', el('span', { class: 'mono' }, params['id'] ?? '')),
      el('p', null, el('a', { href: '#/' }, 'Back to the planner')),
    ),
  );
}
