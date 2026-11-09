/**
 * Build the whole web front end into web/dist. Run with `bun run build:web`; exits non-zero on any error.
 *
 *   /            landing site (React + Vite, web/landing), prerendered then hydrated
 *   /privacy     \ prerendered, no client JS
 *   /terms       /
 *   /app/        the planner app (web/app.ts bundled by Bun, its shell copied from web/index.html)
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

// ---- 1. the app at /app/ ----
const result = await Bun.build({
  entrypoints: [join(webDir, 'app.ts')],
  outdir: outDir,
  target: 'browser',
  minify: true,
  sourcemap: 'none',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  fail('App build failed.');
}
await cp(join(webDir, 'index.html'), join(outDir, 'app', 'index.html'), { recursive: true });
await cp(join(webDir, 'style.css'), join(outDir, 'style.css'));
await cp(join(webDir, 'favicon.svg'), join(outDir, 'favicon.svg'));
await cp(join(webDir, 'fonts'), join(outDir, 'fonts'), { recursive: true });

// ---- 2. the landing site: client bundle, then a server bundle used only to prerender ----
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

// ---- 3. sanity checks ----
for (const name of ['index.html', 'privacy.html', 'terms.html', join('app', 'index.html'), 'app.js', 'style.css']) {
  if (!(await Bun.file(join(outDir, name)).exists())) fail(`Web build is missing ${name}.`);
}
const home = await readFile(join(outDir, 'index.html'), 'utf8');
if (/\sstyle="/.test(home)) fail('index.html contains a style attribute, which the CSP blocks.');
if (/<script(?![^>]*\ssrc=)[^>]*>/.test(home)) fail('index.html contains an inline script, which the CSP blocks.');

const bytes = result.outputs.reduce((sum, o) => sum + o.size, 0);
console.log(`Built web/dist: app (${bytes} bytes of JS) and the prerendered landing site.`);
