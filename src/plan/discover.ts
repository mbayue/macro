/**
 * Own-site route discovery. Reads the verified origin's `/`, its script and
 * stylesheet URLs, homepage links, and static paths quoted in those scripts. Never follows
 * redirects, never requests another origin, never executes script text.
 */

import type { FetchLike } from '../auth/verify-origin.ts';

export const DISCOVER_TIMEOUT_MS = 5000;
export const DISCOVER_DOC_MAX_BYTES = 262144;
export const DISCOVER_SCRIPT_MAX_BYTES = 524288;
export const DISCOVER_MAX_SCRIPTS = 4;
export const DISCOVER_MAX_ROUTES = 32;
export const DISCOVER_LIST_MAX = 128;
export const DISCOVER_PATH_MAX = 200;
export const ACTION_SEGMENTS = ['logout', 'log-out', 'signout', 'sign-out', 'unsubscribe'] as const;

export type DiscoveredKind = 'document' | 'script' | 'style' | 'asset' | 'page';

export interface DiscoveredRoute {
  id: string;
  kind: DiscoveredKind;
  method: 'GET';
  path: string;
  defaultOn: boolean;
}

export function isActionPath(path: string): boolean {
  const segment = path.split('/').pop() ?? '';
  const lower = segment.toLowerCase();
  return (ACTION_SEGMENTS as readonly string[]).includes(lower);
}

export function selectedRoutes(routes: readonly DiscoveredRoute[]): DiscoveredRoute[] {
  return routes.filter((r) => r.defaultOn);
}

const ASSET_SUFFIX = /\.(?:js|css|webp|png|jpg|jpeg|svg|woff2)$/i;
const ASSET_LITERAL =
  /["'`](\/[A-Za-z0-9._~/-]{0,199}\.(?:js|css|webp|png|jpg|jpeg|svg|woff2))["'`]/gi;

export function isStaticAssetPath(path: string): boolean {
  return acceptPath(path) && ASSET_SUFFIX.test(path);
}

/** True for a same-origin path the discovery rules allow. */
export function acceptPath(path: string): boolean {
  if (!path.startsWith('/')) return false;
  if (path.length < 1 || path.length > DISCOVER_PATH_MAX) return false;
  if (path.includes('//') || path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('..')) return false;
  if (path.includes('://')) return false;
  const segments = path.split('/');
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return false;
  }
  return true;
}

function pathFromUrl(value: string, origin: string): string | null {
  const raw = value.trim();
  if (raw === '' || raw.startsWith('data:') || raw.startsWith('javascript:') || raw.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(raw, `${origin}/`);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const path = url.pathname;
  return acceptPath(path) ? path : null;
}

function attr(tag: string, name: string): string | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = re.exec(tag);
  return m?.[1] ?? m?.[2] ?? m?.[3] ?? null;
}

export function extractDocumentRefs(html: string, origin: string): { scripts: string[]; styles: string[]; pages: string[] } {
  const scripts: string[] = [];
  const styles: string[] = [];
  const pages: string[] = [];
  const seenS = new Set<string>();
  const seenC = new Set<string>();
  const seenP = new Set<string>();
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const src = attr(m[0], 'src');
    if (src === null) continue;
    const path = pathFromUrl(src, origin);
    if (path === null || seenS.has(path)) continue;
    seenS.add(path);
    scripts.push(path);
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const rel = attr(m[0], 'rel') ?? '';
    if (!/\bstylesheet\b/i.test(rel)) continue;
    const href = attr(m[0], 'href');
    if (href === null) continue;
    const path = pathFromUrl(href, origin);
    if (path === null || seenC.has(path)) continue;
    seenC.add(path);
    styles.push(path);
  }
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], 'href');
    if (href === null) continue;
    const path = pathFromUrl(href, origin);
    if (path === null || seenP.has(path)) continue;
    seenP.add(path);
    pages.push(path);
  }
  return { scripts, styles, pages };
}

function anchorKind(path: string): DiscoveredKind {
  if (isActionPath(path)) return 'page';
  if (/\.js$/i.test(path)) return 'script';
  if (/\.css$/i.test(path)) return 'style';
  if (/\.(?:webp|png|jpg|jpeg|svg|woff2)$/i.test(path)) return 'asset';
  return 'page';
}

export function extractAssetPaths(source: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of source.matchAll(ASSET_LITERAL)) {
    const path = m[1] ?? '';
    if (!isStaticAssetPath(path) || seen.has(path)) continue;
    seen.add(path);
    out.push(path);
  }
  return out;
}

async function readCapped(res: Response, max: number): Promise<{ ok: true; text: string } | { ok: false; tooLarge: boolean }> {
  const reader = res.body?.getReader();
  if (reader === undefined) {
    const text = await res.text();
    if (text.length > max) return { ok: false, tooLarge: true };
    return { ok: true, text };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, tooLarge: false };
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(buf) };
}

function contentType(res: Response): string {
  return (res.headers.get('content-type') ?? '').toLowerCase();
}

export async function discoverOwnSite(
  origin: string,
  fetchImpl: FetchLike,
): Promise<
  | { ok: true; routes: DiscoveredRoute[] }
  | { ok: false; reason: 'document_unreachable' | 'document_not_html' | 'document_too_large' }
> {
  let doc: Response;
  try {
    doc = await fetchImpl(`${origin}/`, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
      headers: { accept: 'text/html' },
    });
  } catch {
    return { ok: false, reason: 'document_unreachable' };
  }
  if (doc.status !== 200) return { ok: false, reason: 'document_unreachable' };
  if (!contentType(doc).includes('text/html')) return { ok: false, reason: 'document_not_html' };
  const body = await readCapped(doc, DISCOVER_DOC_MAX_BYTES);
  if (!body.ok) return { ok: false, reason: body.tooLarge ? 'document_too_large' : 'document_unreachable' };

  const refs = extractDocumentRefs(body.text, origin);
  const scriptPaths = refs.scripts.slice(0, DISCOVER_MAX_SCRIPTS);
  const fetchedScripts: string[] = [];
  const assets = new Set<string>();
  for (const path of scriptPaths) {
    let res: Response;
    try {
      res = await fetchImpl(`${origin}${path}`, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(DISCOVER_TIMEOUT_MS),
        headers: { accept: 'text/javascript,*/*' },
      });
    } catch {
      continue;
    }
    if (res.status !== 200) continue;
    const type = contentType(res);
    if (!type.includes('javascript') && !type.includes('ecmascript')) continue;
    fetchedScripts.push(path);
    const text = await readCapped(res, DISCOVER_SCRIPT_MAX_BYTES);
    if (!text.ok) continue;
    for (const asset of extractAssetPaths(text.text)) assets.add(asset);
  }

  const pageList: string[] = [];
  const extraScripts: string[] = [];
  const extraStyles: string[] = [];
  for (const path of refs.pages) {
    const kind = anchorKind(path);
    if (kind === 'page') pageList.push(path);
    else if (kind === 'script') extraScripts.push(path);
    else if (kind === 'style') extraStyles.push(path);
    else assets.add(path);
  }

  const scripts = [...new Set([...fetchedScripts, ...extraScripts])].sort();
  const styles = [...new Set([...refs.styles, ...extraStyles])].sort();
  const assetList = [...assets].sort();

  const rows: { kind: DiscoveredKind; path: string }[] = [{ kind: 'document', path: '/' }];
  for (const path of pageList) rows.push({ kind: 'page', path });
  for (const path of scripts) rows.push({ kind: 'script', path });
  for (const path of styles) rows.push({ kind: 'style', path });
  for (const path of assetList) rows.push({ kind: 'asset', path });

  const kept: { kind: DiscoveredKind; path: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.path)) continue;
    seen.add(row.path);
    kept.push(row);
  }
  const trimmed = trimDiscoveryList(kept);

  let onCount = 0;
  const routes: DiscoveredRoute[] = trimmed.map((row, i) => {
    let defaultOn = row.kind === 'document' || row.kind === 'script' || row.kind === 'style'
      || (row.kind === 'page' && !isActionPath(row.path));
    if (defaultOn) {
      onCount += 1;
      if (onCount > DISCOVER_MAX_ROUTES) defaultOn = false;
    }
    return { id: `r${i + 1}`, kind: row.kind, method: 'GET' as const, path: row.path, defaultOn };
  });

  return { ok: true, routes };
}

function trimDiscoveryList(rows: { kind: DiscoveredKind; path: string }[]): { kind: DiscoveredKind; path: string }[] {
  const kept = [...rows];
  const dropOrder: DiscoveredKind[] = ['asset', 'style', 'script', 'page'];
  while (kept.length > DISCOVER_LIST_MAX) {
    let dropped = false;
    for (const kind of dropOrder) {
      const idx = kept.findLastIndex((row) => row.kind === kind);
      if (idx > 0) {
        kept.splice(idx, 1);
        dropped = true;
        break;
      }
    }
    if (!dropped) break;
  }
  return kept;
}
