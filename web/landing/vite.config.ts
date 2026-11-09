/**
 * Landing site (React + Vite). Pages are prerendered at build time by scripts/build-web.ts,
 * then hydrated; the output lands in web/dist next to the app at /app/.
 *
 *   bun run dev:landing   # Vite dev server with hot reload; /api goes to the local Macro API
 */
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react()],
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
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3100',
      '/app': 'http://localhost:3100',
    },
  },
});
