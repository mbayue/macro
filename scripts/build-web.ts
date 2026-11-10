/**
 * Build the whole web front end into web/dist. Run with `bun run build:web`; exits non-zero on any error.
 *
 *   /            landing site (React + Vite, web/landing), prerendered then hydrated
 *   /privacy     \ prerendered, plus a small script that highlights the section in view
 *   /terms       /
 *   /app/        the planner app (React + Vite, web/landing/app), client-rendered
 */
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild } from 'vite';

const root = resolve(import.meta.dir, '..');
const webDir = join(root, 'web');
const outDir = join(webDir, 'dist');
const landingDir = join(webDir, 'landing');
const landingConfig = join(landingDir, 'vite.config.ts');
// Outside web/ so file watchers on web/ never see it.
const ssrOut = join(root, 'node_modules', '.cache', 'macro-landing-ssr');

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

// Favicon is shared by the landing pages and the app.
await cp(join(webDir, 'favicon.svg'), join(outDir, 'favicon.svg'));

// ---- 1. landing site + app: client bundle, then a server bundle used only to prerender ----
await viteBuild({ configFile: landingConfig, logLevel: 'warn' });
await rm(ssrOut, { recursive: true, force: true });
await viteBuild({
  configFile: landingConfig,
  logLevel: 'warn',
  publicDir: false,
  build: {
    ssr: join(landingDir, 'src', 'entry-server.tsx'),
    outDir: ssrOut,
    emptyOutDir: true,
    rollupOptions: { input: join(landingDir, 'src', 'entry-server.tsx'), output: { entryFileNames: 'entry-server.mjs' } },
  },
});
const server = (await import(pathToFileURL(join(ssrOut, 'entry-server.mjs')).href)) as {
  render(page: 'home' | 'privacy' | 'terms'): string;
};

for (const [file, page] of [
  ['index.html', 'home'],
  ['privacy.html', 'privacy'],
  ['terms.html', 'terms'],
] as const) {
  const path = join(outDir, file);
  const html = await readFile(path, 'utf8');
  if (!html.includes('<!--app-->')) fail(`${file} has no <!--app--> marker.`);
  await writeFile(path, html.replace('<!--app-->', server.render(page)));
}

// ---- 2. sanity checks ----
for (const name of ['index.html', 'privacy.html', 'terms.html', join('app', 'index.html'), 'favicon.svg']) {
  if (!(await Bun.file(join(outDir, name)).exists())) fail(`Web build is missing ${name}.`);
}
if (await Bun.file(join(outDir, 'app-next', 'index.html')).exists()) {
  fail('Web build still contains /app-next/; the React app must ship at /app/ only.');
}
for (const name of ['index.html', 'privacy.html', 'terms.html', join('app', 'index.html')]) {
  const html = await readFile(join(outDir, name), 'utf8');
  if (/\sstyle="/.test(html)) fail(`${name} contains a style attribute, which the CSP blocks.`);
  if (/<script(?![^>]*\ssrc=)[^>]*>/.test(html)) fail(`${name} contains an inline script, which the CSP blocks.`);
}

console.log('Built web/dist: the planner app at /app/ and the prerendered landing site.');
