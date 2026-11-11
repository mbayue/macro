/** Hash routes, the same URLs as the old app so shared links keep working: /app/#/run/<id>. */

export type Route =
  | { view: 'new' }
  | { view: 'run'; id: string }
  | { view: 'probe'; id: string }
  | { view: 'probe-start' }
  | { view: 'runs' }
  | { view: 'sign-in' }
  | { view: 'notfound' };

const ID_PATTERN = /^[A-Za-z0-9._~-]{1,100}$/;

export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#/, '');
  if (path === '' || path === '/' || path === 'verify-panel') return { view: 'new' };
  const bare = path.replace(/^\//, '').split('?')[0] ?? '';
  const [kind, rawId, ...rest] = bare.split('/');
  if (kind === 'sign-in' && (rawId === undefined || rawId === '') && rest.length === 0) return { view: 'sign-in' };
  if (kind === 'runs' && (rawId === undefined || rawId === '') && rest.length === 0) return { view: 'runs' };
  if (kind === 'probe' && (rawId === undefined || rawId === '') && rest.length === 0) return { view: 'probe-start' };
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

export function routeTitle(route: Route): string {
  switch (route.view) {
    case 'new':
      return 'Macro: new load test';
    case 'run':
      return 'Macro: run';
    case 'probe':
    case 'probe-start':
      return 'Macro: containment probe';
    case 'runs':
      return 'Macro: recent runs';
    case 'sign-in':
      return 'Macro: sign in';
    case 'notfound':
      return 'Macro: page not found';
  }
}

export const runHref = (id: string): string => `#/run/${encodeURIComponent(id)}`;
export const probeHref = (id: string): string => `#/probe/${encodeURIComponent(id)}`;
