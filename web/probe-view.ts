/**
 * STUB (task 8.4 replaces this file). Keep the exported name and signature:
 *
 *   export function renderProbeView(
 *     root: HTMLElement,          // empty container owned by the router
 *     ctx: AppContext,            // from ./context.ts
 *     params: { id: string },     // route #/probe/<id>; id is already URL-decoded
 *   ): void | (() => void);       // optional cleanup, called on navigation
 *
 * Starting a probe uses postProbe({ turnstileToken }) from ./api.ts and then
 * navigates to `/probe/<runId>`; the result is RunView.probeResult (see
 * src/k6/probe-result.ts).
 */
import type { AppContext, RouteParams, ViewCleanup } from './context.ts';
import { el } from './dom.ts';

export function renderProbeView(root: HTMLElement, _ctx: AppContext, params: RouteParams): void | ViewCleanup {
  root.append(
    el(
      'section',
      { class: 'panel stack' },
      el('h1', null, 'Containment probe'),
      el('p', { class: 'muted' }, 'The probe view is not built yet.'),
      el('p', null, 'Probe ID: ', el('span', { class: 'mono' }, params['id'] ?? '')),
      el('p', null, el('a', { href: '#/' }, 'Back to the planner')),
    ),
  );
}
