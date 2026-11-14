import { describe, expect, test } from 'bun:test';
import type { FetchLike } from '../src/auth/verify-origin.ts';
import {
  DISCOVER_DOC_MAX_BYTES,
  DISCOVER_SCRIPT_MAX_BYTES,
  discoverOwnSite,
  extractAssetPaths,
  extractDocumentRefs,
  selectedRoutes,
} from '../src/plan/discover.ts';

const ORIGIN = 'https://sketch.my.id';

function htmlResponse(body: string, status = 200, contentType = 'text/html; charset=utf-8'): Response {
  return new Response(body, { status, headers: { 'content-type': contentType } });
}

function jsResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'content-type': 'application/javascript' } });
}

describe('extractDocumentRefs', () => {
  test('keeps same-origin script and stylesheet paths and drops other origins', () => {
    const html = [
      '<script src="/assets/app.js"></script>',
      '<link rel="stylesheet" href="/assets/app.css">',
      '<script src="https://evil.example/a.js"></script>',
      '<script src="//cdn.example/x.js"></script>',
    ].join('');
    const refs = extractDocumentRefs(html, ORIGIN);
    expect(refs.scripts).toEqual(['/assets/app.js']);
    expect(refs.styles).toEqual(['/assets/app.css']);
  });
});

describe('extractAssetPaths', () => {
  test('keeps a static suffix and drops traversal, schemes, and protocol-relative strings', () => {
    const source = '"/assets/a.webp" "/assets/../secret.webp" "https://evil.example/x.webp" "//cdn.example/x.webp"';
    expect(extractAssetPaths(source)).toEqual(['/assets/a.webp']);
  });
});

describe('discoverOwnSite', () => {
  test('returns document, script, style, and one asset in id order', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      seen.push(input);
      if (input === `${ORIGIN}/`) {
        return htmlResponse(
          '<script src="/assets/app.js"></script><link rel="stylesheet" href="/assets/app.css">',
        );
      }
      if (input === `${ORIGIN}/assets/app.js`) {
        return jsResponse('"/assets/a.webp" "/assets/../secret.webp" "https://evil.example/x.webp" "//cdn.example/x.webp"');
      }
      return new Response('no', { status: 404 });
    };
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result).toEqual({
      ok: true,
      routes: [
        { id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true },
        { id: 'r2', kind: 'script', method: 'GET', path: '/assets/app.js', defaultOn: true },
        { id: 'r3', kind: 'style', method: 'GET', path: '/assets/app.css', defaultOn: true },
        { id: 'r4', kind: 'asset', method: 'GET', path: '/assets/a.webp', defaultOn: true },
      ],
    });
    expect(seen).toEqual([`${ORIGIN}/`, `${ORIGIN}/assets/app.js`]);
  });

  test('does not fetch a script on another origin', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      seen.push(input);
      return htmlResponse('<script src="https://evil.example/a.js"></script><script src="/assets/app.js"></script>');
    };
    await discoverOwnSite(ORIGIN, fetchImpl);
    expect(seen.some((u) => u.includes('evil.example'))).toBe(false);
  });

  test('a 302 document is unreachable and its Location is not fetched', async () => {
    const seen: string[] = [];
    const fetchImpl: FetchLike = async (input) => {
      seen.push(input);
      return new Response(null, { status: 302, headers: { location: '/elsewhere' } });
    };
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'document_unreachable' });
    expect(seen).toEqual([`${ORIGIN}/`]);
  });

  test('a document over the byte cap fails as document_too_large', async () => {
    const fetchImpl: FetchLike = async () => htmlResponse('x'.repeat(DISCOVER_DOC_MAX_BYTES + 1));
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result).toEqual({ ok: false, reason: 'document_too_large' });
  });

  test('a fifth script is not fetched and an oversized script is skipped', async () => {
    const seen: string[] = [];
    const tags = [1, 2, 3, 4, 5].map((n) => `<script src="/assets/${n}.js"></script>`).join('');
    const fetchImpl: FetchLike = async (input) => {
      seen.push(input);
      if (input.endsWith('/')) return htmlResponse(tags);
      if (input.endsWith('/assets/1.js')) return jsResponse('x'.repeat(DISCOVER_SCRIPT_MAX_BYTES + 1));
      return jsResponse('"/assets/ok.webp"');
    };
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    expect(seen.filter((u) => u.endsWith('.js'))).toEqual([
      `${ORIGIN}/assets/1.js`,
      `${ORIGIN}/assets/2.js`,
      `${ORIGIN}/assets/3.js`,
      `${ORIGIN}/assets/4.js`,
    ]);
    if (result.ok) {
      expect(result.routes.some((r) => r.path === '/assets/ok.webp')).toBe(true);
      expect(result.routes.some((r) => r.path === '/assets/1.js')).toBe(true);
    }
  });

  test('33 asset literals stay in the list and start on', async () => {
    const literals = Array.from({ length: 33 }, (_, i) => `"/assets/p${String(i).padStart(2, '0')}.webp"`).join(' ');
    const fetchImpl: FetchLike = async (input) => {
      if (input.endsWith('/')) return htmlResponse('<script src="/assets/app.js"></script>');
      return jsResponse(literals);
    };
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes[0]).toMatchObject({ id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true });
    expect(result.routes.map((r) => r.id)).toEqual(result.routes.map((_, i) => `r${i + 1}`));
    expect(result.routes).toHaveLength(35);
    expect(result.routes.some((r) => r.path === '/assets/p32.webp')).toBe(true);
    expect(result.routes.filter((r) => r.defaultOn)).toHaveLength(35);
  });

  test('homepage anchors become pages in document order and start on', async () => {
    const fetchImpl: FetchLike = async () =>
      htmlResponse('<a href="/about">A</a><a href="/product">P</a>');
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes.slice(0, 3)).toEqual([
      { id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true },
      { id: 'r2', kind: 'page', method: 'GET', path: '/about', defaultOn: true },
      { id: 'r3', kind: 'page', method: 'GET', path: '/product', defaultOn: true },
    ]);
  });

  test('only the five action names start off; cart and account stay on', async () => {
    const html = [
      '<a href="/account/logout">out</a>',
      '<a href="/Cart/Log-Out">out</a>',
      '<a href="/cart">cart</a>',
      '<a href="/account">me</a>',
    ].join('');
    const fetchImpl: FetchLike = async () => htmlResponse(html);
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.routes.map((r) => [r.path, r]));
    expect(byPath.get('/account/logout')).toMatchObject({ kind: 'page', defaultOn: false });
    expect(byPath.get('/Cart/Log-Out')).toMatchObject({ kind: 'page', defaultOn: false });
    expect(byPath.get('/cart')).toMatchObject({ kind: 'page', defaultOn: true });
    expect(byPath.get('/account')).toMatchObject({ kind: 'page', defaultOn: true });
  });

  test('both script and image anchors default to on', async () => {
    const fetchImpl: FetchLike = async () =>
      htmlResponse('<a href="/assets/app.js">js</a><a href="/logo.webp">img</a>');
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byPath = new Map(result.routes.map((r) => [r.path, r]));
    expect(byPath.get('/assets/app.js')).toMatchObject({ kind: 'script', defaultOn: true });
    expect(byPath.get('/logo.webp')).toMatchObject({ kind: 'asset', defaultOn: true });
  });

  test('drops other origins, query strings, and buttons', async () => {
    const html = '<a href="https://other.example/x">x</a><a href="/out?x=1">q</a><button>Go</button>';
    const fetchImpl: FetchLike = async () => htmlResponse(html);
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes).toEqual([
      { id: 'r1', kind: 'document', method: 'GET', path: '/', defaultOn: true },
      { id: 'r2', kind: 'page', method: 'GET', path: '/out', defaultOn: true },
    ]);
  });

  test('40 safe pages all default to on', async () => {
    const links = Array.from({ length: 40 }, (_, i) => `<a href="/p${String(i).padStart(2, '0')}">p</a>`).join('');
    const fetchImpl: FetchLike = async () => htmlResponse(links);
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes).toHaveLength(41);
    expect(result.routes.filter((r) => r.defaultOn)).toHaveLength(41);
    expect(result.routes[0]).toMatchObject({ id: 'r1', path: '/', defaultOn: true });
    expect(selectedRoutes(result.routes)).toHaveLength(41);
  });

  test('200 image anchors keep 128 rows and drop assets from the end', async () => {
    const links = Array.from({ length: 200 }, (_, i) => `<a href="/i${String(i).padStart(3, '0')}.webp">i</a>`).join('');
    const fetchImpl: FetchLike = async () => htmlResponse(links);
    const result = await discoverOwnSite(ORIGIN, fetchImpl);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.routes).toHaveLength(128);
    expect(result.routes[0]).toMatchObject({ path: '/' });
    expect(result.routes.some((r) => r.path === '/i199.webp')).toBe(false);
    expect(result.routes.some((r) => r.path === '/i000.webp')).toBe(true);
  });
});
