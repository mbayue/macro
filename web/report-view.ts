/**
 * STUB (task 8.3 replaces this file). Keep the exported name and signature:
 *
 *   export function renderReportView(
 *     root: HTMLElement,              // container to fill (the run view passes a child element)
 *     ctx: AppContext,                // from ./context.ts
 *     report: CapacityReport,         // from ../src/report/build.ts (type only)
 *     helpers?: ReportViewHelpers,    // from ./context.ts: { runId, run?, plan?, modelCalls? }
 *   ): void | (() => void);           // optional cleanup
 *
 * The report view only renders; it does not fetch the snapshot. The Run view
 * calls it once `RunSnapshot.report` is non-null.
 */
import type { CapacityReport } from '../src/report/build.ts';
import type { AppContext, ReportViewHelpers, ViewCleanup } from './context.ts';
import { el } from './dom.ts';

export function renderReportView(
  root: HTMLElement,
  _ctx: AppContext,
  report: CapacityReport,
  _helpers?: ReportViewHelpers,
): void | ViewCleanup {
  root.append(
    el(
      'section',
      { class: 'panel stack' },
      el('h2', null, 'Capacity report'),
      el('p', { class: 'muted' }, 'The report view is not built yet.'),
      el('p', null, 'Run ID: ', el('span', { class: 'mono' }, report.runId)),
    ),
  );
}
