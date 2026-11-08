/**
 * Entry point: loads /api/config, then runs a hash router.
 *
 *   #/             describe + plan review      renderDescribeView (describe.ts)
 *   #/run/<id>     live run and report         renderRunView      (run-view.ts)
 *   #/probe/<id>   containment probe           renderProbeView    (probe-view.ts)
 *
 * A view is `(root, ctx, params) => void | cleanup`. The router empties `root`
 * before each render and calls the previous view's cleanup first.
 */
import { getConfig } from './api.ts';
import type { AppContext, RouteParams, ViewCleanup } from './context.ts';
import { renderDescribeView } from './describe.ts';
import { clear, el } from './dom.ts';
import { renderProbeView } from './probe-view.ts';
import { renderRunView } from './run-view.ts';

export type { AppContext, ReportViewHelpers, RouteParams, ViewCleanup } from './context.ts';

type Route =
  | { view: 'describe' }
  | { view: 'run'; id: string }
  | { view: 'probe'; id: string }
  | { view: 'notfound' };

const ID_PATTERN = /^[A-Za-z0-9._~-]{1,100}$/;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '' || path === '/') return { view: 'describe' };
  const [kind, rawId, ...rest] = path.replace(/^\//, '').split('/');
  if ((kind === 'run' || kind === 'probe') && rawId !== undefined && rest.length === 0) {
    let id: string;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      return { view: 'notfound' };
    }
    if (ID_PATTERN.test(id)) return { view: kind, id };
  }
  return { view: 'notfound' };
}

function mustFind(id: string): HTMLElement {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in index.html`);
  return node;
}

function errorPanel(message: string, action?: { label: string; run: () => void }): HTMLElement {
  return el(
    'section',
    { class: 'panel stack' },
    el('h1', null, 'Something went wrong'),
    el('div', { class: 'alert', role: 'alert' }, el('p', null, message)),
    action ? el('div', { class: 'row' }, el('button', { type: 'button', class: 'btn', onclick: action.run }, action.label)) : null,
  );
}

function main(): void {
  const root = mustFind('app');
  const live = mustFind('live-region');
  const skip = document.querySelector<HTMLAnchorElement>('.skip-link');

  let config: AppContext['config'] | null = null;
  let cleanup: ViewCleanup | null = null;
  let announceTimer: number | undefined;

  const announce = (message: string): void => {
    live.textContent = '';
    window.clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
      live.textContent = message;
    }, 50);
  };

  const runCleanup = (): void => {
    const fn = cleanup;
    cleanup = null;
    if (fn) {
      try {
        fn();
      } catch {
        // A failing cleanup must not block navigation.
      }
    }
  };

  const navigate = (path: string): void => {
    const clean = path.replace(/^#/, '');
    const target = `#${clean.startsWith('/') ? clean : `/${clean}`}`;
    if (window.location.hash === target) renderRoute(false);
    else window.location.hash = target;
  };

  const renderRoute = (initial: boolean): void => {
    if (!config) return;
    const ctx: AppContext = { config, navigate, announce };
    runCleanup();
    clear(root);
    const route = parseRoute(window.location.hash);
    const params: RouteParams = route.view === 'run' || route.view === 'probe' ? { id: route.id } : {};
    try {
      let result: void | ViewCleanup = undefined;
      switch (route.view) {
        case 'describe':
          document.title = 'Macro: describe your traffic';
          result = renderDescribeView(root, ctx, params);
          break;
        case 'run':
          document.title = 'Macro: run';
          result = renderRunView(root, ctx, params);
          break;
        case 'probe':
          document.title = 'Macro: containment probe';
          result = renderProbeView(root, ctx, params);
          break;
        default:
          document.title = 'Macro: page not found';
          root.append(
            el(
              'section',
              { class: 'panel stack' },
              el('h1', null, 'Page not found'),
              el('p', null, el('a', { href: '#/' }, 'Back to the planner')),
            ),
          );
      }
      if (typeof result === 'function') cleanup = result;
    } catch {
      clear(root);
      root.append(errorPanel('This page failed to load. Reload the page to try again.'));
    }
    if (!initial) {
      window.scrollTo(0, 0);
      root.focus({ preventScroll: true });
      announce(document.title);
    }
  };

  skip?.addEventListener('click', (ev) => {
    ev.preventDefault(); // a bare "#app" href would otherwise change the route
    root.focus();
  });

  window.addEventListener('hashchange', () => renderRoute(false));

  const start = async (): Promise<void> => {
    clear(root);
    root.append(el('p', { class: 'muted', role: 'status' }, 'Loading'));
    const res = await getConfig();
    if (!res.ok) {
      clear(root);
      root.append(
        errorPanel('Macro could not load its settings from the server. Check your connection and try again.', {
          label: 'Try again',
          run: () => void start(),
        }),
      );
      return;
    }
    config = res.data;
    renderRoute(true);
  };

  void start();
}

main();
