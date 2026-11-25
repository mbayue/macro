import { stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';
import { safeDecode } from './http.ts';

export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

/** Serves prerendered landing pages, `/app/` shell, and static assets from `webRoot`. */
export function createStaticHandler(webRoot: string): (req: Request, pathname: string) => Promise<Response> {
  return async function serveStatic(req: Request, pathname: string): Promise<Response> {
    const missing = async (): Promise<Response> => {
      if (req.method === 'GET' || req.method === 'HEAD') {
        const notFoundPath = join(webRoot, '404.html');
        try {
          const st = await stat(notFoundPath);
          if (st.isFile()) {
            const headers = {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-cache',
              'content-length': String(st.size),
            };
            return req.method === 'HEAD'
              ? new Response(null, { status: 404, headers })
              : new Response(Bun.file(notFoundPath), { status: 404, headers });
          }
        } catch {
          // Fall back to plain text when webDist has no 404.html (e.g. minimal test fixtures).
        }
      }
      return new Response('Not found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return new Response('Method not allowed', {
        status: 405,
        headers: { allow: 'GET, HEAD', 'content-type': 'text/plain; charset=utf-8' },
      });
    }
    let rel = safeDecode(pathname);
    if (rel === null || rel.includes('\0') || rel.includes('\\') || !rel.startsWith('/')) return await missing();
    if (rel === '/') rel = '/index.html';
    // The app shell lives at /app/ (its views are hash routes, e.g. /app/#/run/<id>).
    if (rel === '/app' || rel === '/app/') rel = '/app/index.html';
    // Old preview URL from the React rebuild; keep shared links working.
    // Relative Location: the origin request is HTTP behind Caddy, so an absolute
    // URL built from req.url would send browsers to http://.
    if (rel === '/app-next' || rel === '/app-next/') {
      const search = new URL(req.url).search;
      return new Response(null, { status: 301, headers: { location: `/app/${search}` } });
    }
    // Prerendered legal pages, served without the .html suffix.
    if (rel === '/privacy' || rel === '/terms') rel = `${rel}.html`;
    if (rel.split('/').some((seg) => seg.startsWith('.'))) return await missing(); // no dotfiles, no "..", no "."
    const abs = resolve(webRoot, `.${rel}`);
    if (abs !== webRoot && !abs.startsWith(webRoot + sep)) return await missing();

    let size: number;
    try {
      const st = await stat(abs);
      if (!st.isFile()) return await missing();
      size = st.size;
    } catch {
      return await missing();
    }

    const ext = extname(abs).toLowerCase();
    const headers: Record<string, string> = {
      'content-type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'content-length': String(size),
    };
    if (req.method === 'HEAD') return new Response(null, { status: 200, headers });
    return new Response(Bun.file(abs), { status: 200, headers });
  };
}
