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
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

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

const BROWSERS = [
  process.env['CHROME_PATH'],
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];
const exe = BROWSERS.find((p): p is string => p !== undefined && existsSync(p));
if (exe === undefined) throw new Error('No Edge or Chrome found; set CHROME_PATH.');

// A fixed port: headless Edge exits immediately when asked for a random one (--remote-debugging-port=0).
const port = Number(values.port);
const profile = join(tmpdir(), `macro-shots-profile-${Date.now()}`);
const browser = Bun.spawn([exe, '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--no-first-run', 'about:blank']);

let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
for (let i = 0; i < 40 && targets.length === 0; i++) {
  await Bun.sleep(250);
  try {
    targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof targets;
  } catch {
    // not listening yet
  }
}
const page = targets.find((t) => t.type === 'page');
if (page === undefined) throw new Error(`The browser did not open a debugging port on ${port}.`);

const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve) => (ws.onopen = resolve));
let nextId = 0;
const pending = new Map<number, (v: any) => void>();
const errors: string[] = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(String(m.data));
  if (msg.id !== undefined && pending.has(msg.id)) {
    pending.get(msg.id)!(msg.result ?? msg.error);
    pending.delete(msg.id);
  }
  if (msg.method === 'Runtime.exceptionThrown') errors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    errors.push(msg.params.args.map((a: any) => a.value ?? a.description).join(' '));
  }
};
const send = (method: string, params: object = {}) =>
  new Promise<any>((resolve) => {
    const id = ++nextId;
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
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
  ws.close();
  browser.kill();
}

if (errors.length > 0) {
  console.error(`Console errors (${errors.length}):\n${errors.slice(0, 10).join('\n')}`);
  process.exit(1);
}
console.log('No console errors.');
