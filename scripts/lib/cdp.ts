import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const BROWSERS = [
  process.env['CHROME_PATH'],
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

export function findBrowserExecutable(): string {
  const exe = BROWSERS.find((p): p is string => p !== undefined && existsSync(p));
  if (exe === undefined) throw new Error('No Edge or Chrome found; set CHROME_PATH.');
  return exe;
}

export interface CdpSession {
  send: (method: string, params?: object) => Promise<any>;
  close: () => Promise<void>;
  errors: string[];
}

export async function launchCdp(port: number, profilePrefix = 'macro-cdp'): Promise<CdpSession> {
  const exe = findBrowserExecutable();
  const profile = join(tmpdir(), `${profilePrefix}-${Date.now()}`);
  const browser = Bun.spawn([
    exe,
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--hide-scrollbars',
    '--no-first-run',
    'about:blank',
  ]);

  let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
  for (let i = 0; i < 40 && targets.length === 0; i++) {
    await Bun.sleep(250);
    try {
      targets = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as typeof targets;
    } catch {}
  }
  const page = targets.find((t) => t.type === 'page');
  if (page === undefined) {
    browser.kill();
    throw new Error(`The browser did not open a debugging port on ${port}.`);
  }

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
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push(msg.params.exceptionDetails.exception?.description ?? 'exception');
    }
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

  const close = async () => {
    browser.kill();
    await Bun.sleep(200);
  };

  return { send, close, errors };
}
