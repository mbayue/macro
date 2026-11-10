/**
 * Landing site (React + Vite). Pages are prerendered at build time by scripts/build-web.ts,
 * then hydrated; the output lands in web/dist next to the app at /app/.
 *
 *   bun run dev:landing   # Vite dev server with hot reload; /api goes to the local Macro API
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

/**
 * Dev server only: prerender each page the same way the production build does, so the dev
 * pages match production (the legal pages are not hydrated and would otherwise be empty),
 * and serve /privacy and /terms without the .html suffix like the Macro API does.
 */
function devPrerender(): Plugin {
  return {
    name: 'macro-dev-prerender',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const [path, query] = (req.url ?? '').split('?');
        if (path === '/privacy' || path === '/terms') req.url = `${path}.html${query !== undefined ? `?${query}` : ''}`;
        next();
      });
    },
    async transformIndexHtml(html, ctx) {
      if (!ctx.server) return html;
      if (!html.includes('<!--app-->')) return html; // the planner app at /app/ is client-rendered
      const page = ctx.path === '/privacy.html' ? 'privacy' : ctx.path === '/terms.html' ? 'terms' : 'home';
      const mod = (await ctx.server.ssrLoadModule('/src/entry-server.tsx')) as { render(p: string): string };
      return html.replace('<!--app-->', mod.render(page));
    },
  };
}

export default defineConfig({
  root,
  plugins: [react(), devPrerender()],
  publicDir: 'public',
  build: {
    outDir: fileURLToPath(new URL('../dist', import.meta.url)),
    emptyOutDir: false,
    assetsDir: 'landing/assets',
    // No inline module-preload polyfill or data: URLs: the CSP allows 'self' only.
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        privacy: fileURLToPath(new URL('./privacy.html', import.meta.url)),
        terms: fileURLToPath(new URL('./terms.html', import.meta.url)),
        app: fileURLToPath(new URL('./app/index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      // MACRO_API points the dev server at another Macro API (e.g. production, read-only review).
      '/api': { target: process.env['MACRO_API'] ?? 'http://localhost:3100', changeOrigin: true },
    },
  },
});
