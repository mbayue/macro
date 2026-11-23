/**
 * Screenshots a page in headless Edge (or Chrome) over the DevTools Protocol, at several widths and
 * themes, and reports console errors. Used for UI checks on Windows, where tasteskill's inspect.mjs
 * cannot start the browser.
 *
 *   bun scripts/shots.ts <url> [--widths 390,1440,1920] [--themes dark,light] [--full]
 *                        [--scroll <css selector>] [--out <dir>] [--reduced-motion] [--port 9350]
 *
 * Files land in <out> (default $TEMP/macro-shots) as <slug>-<width>-<theme>[-full].png|jpg.
 * Exits 1 when the page logs a console error or throws. The theme is set the way theme.ts does
 * (localStorage `macro-theme` and html[data-theme]); reveal animations are skipped so nothing is
 * caught mid-fade.
 */
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { launchCdp } from './lib/cdp.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    widths: { type: 'string', default: '390,1440,1920' },
    themes: { type: 'string', default: 'dark,light' },
    full: { type: 'boolean', default: false },
    scroll: { type: 'string' },
    out: { type: 'string', default: join(process.env['TEMP'] ?? tmpdir(), 'macro-shots') },
    'reduced-motion': { type: 'boolean', default: false },
    port: { type: 'string', default: '9350' },
    help: { type: 'boolean', default: false },
  },
});

const url = positionals[0];
if (values.help || url === undefined) {
  console.log('Usage: bun scripts/shots.ts <url> [--widths 390,1440,1920] [--themes dark,light] [--full] [--scroll <selector>] [--out <dir>] [--reduced-motion] [--port 9350]');
  process.exit(url === undefined && !values.help ? 1 : 0);
}

const cdp = await launchCdp(Number(values.port), 'macro-shots-profile');
const send = cdp.send;
const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true }))?.result?.value;

await send('Runtime.enable');
await send('Page.enable');
if (values['reduced-motion']) {
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
}

mkdirSync(values.out, { recursive: true });
const slug = new URL(url).pathname.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';

try {
  for (const theme of values.themes.split(',')) {
    for (const width of values.widths.split(',').map(Number)) {
      const height = width <= 500 ? 844 : width >= 1900 ? 1080 : 900;
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 500 });
      // Reset first: navigating to the same hash URL again leaves a hash router on a stale route.
      await send('Page.navigate', { url: 'about:blank' });
      await Bun.sleep(200);
      await send('Page.navigate', { url });
      await Bun.sleep(1500);
      await evaluate(
        `localStorage.setItem('macro-theme', '${theme}');` +
          (theme === 'light' ? 'delete document.documentElement.dataset.theme;' : "document.documentElement.dataset.theme = 'dark';") +
          "document.documentElement.classList.remove('js');",
      );
      await Bun.sleep(400);
      if (values.scroll !== undefined) {
        await evaluate(`document.querySelector(${JSON.stringify(values.scroll)})?.scrollIntoView(); scrollBy(0, -80);`);
        await Bun.sleep(400);
      }
      let shot: { data: string };
      let ext = 'png';
      if (values.full) {
        const total = Math.min(16000, Number(await evaluate('document.documentElement.scrollHeight')));
        // Scroll through once so lazy images load before the capture.
        for (let y = 0; y < total; y += height) {
          await evaluate(`scrollTo(0, ${y})`);
          await Bun.sleep(200);
        }
        await evaluate('scrollTo(0, 0)');
        await Bun.sleep(600);
        ext = 'jpg';
        shot = await send('Page.captureScreenshot', {
          format: 'jpeg',
          quality: 70,
          captureBeyondViewport: true,
          clip: { x: 0, y: 0, width, height: total, scale: width > 500 ? 0.5 : 1 },
        });
      } else {
        shot = await send('Page.captureScreenshot', { format: 'png' });
      }
      const file = join(values.out, `${slug}-${width}-${theme}${values.full ? '-full' : ''}.${ext}`);
      await Bun.write(file, Buffer.from(shot.data, 'base64'));
      console.log(file);
    }
  }
} finally {
  await cdp.close();
}

if (cdp.errors.length > 0) {
  console.error(`Console errors (${cdp.errors.length}):\n${cdp.errors.slice(0, 10).join('\n')}`);
  process.exit(1);
}
console.log('No console errors.');
