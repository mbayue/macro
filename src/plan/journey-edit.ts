import { isActionPath } from './discover.ts';

export interface JourneyRow {
  id: string;
  path: string;
  kind: string;
  defaultOn: boolean;
}

export function journeyGroups(routes: readonly JourneyRow[]): {
  locked: JourneyRow[];
  on: JourneyRow[];
  off: JourneyRow[];
  overflow: boolean;
} {
  const locked = routes.filter((row) => row.path === '/');
  const rest = routes.filter((row) => row.path !== '/');
  return {
    locked,
    on: rest.filter((row) => row.defaultOn),
    off: rest.filter((row) => !row.defaultOn),
    overflow: routes.some(
      (row) =>
        !row.defaultOn &&
        (row.kind === 'script' || row.kind === 'style' || (row.kind === 'page' && !isActionPath(row.path))),
    ),
  };
}

export function journeyLabel(row: JourneyRow): string {
  if (row.kind === 'page' || row.kind === 'document') return 'Page';
  if (row.kind === 'script') return 'Script';
  if (row.kind === 'style') return 'Stylesheet';
  if (row.path.toLowerCase().endsWith('.woff2')) return 'Font';
  return 'Image';
}
