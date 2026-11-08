/**
 * Build the Web_UI: bundle web/app.ts to web/dist/app.js and copy the static
 * files next to it. Run with `bun run scripts/build-web.ts`. Exits non-zero on
 * any build error.
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dir, '..');
const webDir = join(root, 'web');
const outDir = join(webDir, 'dist');

await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(webDir, 'app.ts')],
  outdir: outDir,
  target: 'browser',
  minify: true,
  sourcemap: 'none',
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  console.error('Web build failed.');
  process.exit(1);
}

await cp(join(webDir, 'index.html'), join(outDir, 'index.html'));
await cp(join(webDir, 'style.css'), join(outDir, 'style.css'));

for (const name of ['index.html', 'app.js', 'style.css']) {
  if (!(await Bun.file(join(outDir, name)).exists())) {
    console.error(`Web build is missing ${name}.`);
    process.exit(1);
  }
}

const bytes = result.outputs.reduce((sum, o) => sum + o.size, 0);
console.log(`Built web/dist (${result.outputs.length} bundle file(s), ${bytes} bytes of JS).`);
