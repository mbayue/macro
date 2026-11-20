import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureWeightBudget, validateWebDist, validateWebSource } from '../scripts/build-web-check.ts';

const dirs: string[] = [];

function makeValidDist(): string {
  const dir = mkdtempSync(join(tmpdir(), 'macro-build-web-check-'));
  dirs.push(dir);
  mkdirSync(join(dir, 'app'), { recursive: true });
  writeFileSync(
    join(dir, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/styles-abc.css"></head><body><script type="module" src="/landing/assets/index-abc.js"></script></body></html>',
  );
  writeFileSync(
    join(dir, 'privacy.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/legal-abc.css"></head><body><script type="module" src="/landing/assets/entry-legal-abc.js"></script></body></html>',
  );
  writeFileSync(
    join(dir, 'terms.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/legal-abc.css"></head><body><script type="module" src="/landing/assets/entry-legal-abc.js"></script></body></html>',
  );
  writeFileSync(
    join(dir, '404.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/styles-abc.css"></head><body><script type="module" src="/landing/assets/entry-legal-abc.js"></script></body></html>',
  );
  writeFileSync(
    join(dir, 'app', 'index.html'),
    '<!doctype html><html><head><link rel="preload" href="/landing/fonts/geist-mono-400.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/landing/assets/app-abc.css"></head><body><script type="module" src="/landing/assets/app-abc.js"></script></body></html>',
  );
  writeFileSync(join(dir, 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
  return dir;
}

afterEach(() => {
  while (dirs.length > 0) {
    const d = dirs.pop();
    if (d !== undefined) rmSync(d, { recursive: true, force: true });
  }
});

describe('validateWebDist', () => {
  test('accepts a valid web/dist directory', async () => {
    const dir = makeValidDist();
    expect(await validateWebDist(dir)).toEqual([]);
  });

  test('fails when required files are missing or /app-next/ is present', async () => {
    const dir = makeValidDist();
    rmSync(join(dir, 'privacy.html'));
    mkdirSync(join(dir, 'app-next'), { recursive: true });
    writeFileSync(join(dir, 'app-next', 'index.html'), '<!doctype html><html></html>');

    const errors = await validateWebDist(dir);
    expect(errors.some((e) => e.includes('privacy.html'))).toBe(true);
    expect(errors.some((e) => e.includes('/app-next/'))).toBe(true);
  });

  test('fails if any HTML file contains a <style> tag', async () => {
    const dir = makeValidDist();
    writeFileSync(
      join(dir, 'app', 'index.html'),
      '<!doctype html><html><head><style>body{color:red}</style><link rel="preload" href="/landing/fonts/geist-mono-400.woff2" as="font" type="font/woff2" crossorigin><link rel="stylesheet" href="/landing/assets/app-abc.css"></head><body></body></html>',
    );
    const errors = await validateWebDist(dir);
    expect(errors.some((e) => e.includes('app/index.html') && e.includes('<style>'))).toBe(true);
  });

  test('fails if any HTML file contains a style="" attribute (single or double quoted) while allowing data-style=""', async () => {
    const dir = makeValidDist();
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/styles-abc.css"></head><body><div data-style="ok" style="color:red"></div></body></html>',
    );
    writeFileSync(
      join(dir, 'terms.html'),
      "<!doctype html><html><head><link rel='stylesheet' href='/landing/assets/legal-abc.css'></head><body><div style='margin:0'></div></body></html>",
    );
    const errors = await validateWebDist(dir);
    expect(errors.some((e) => e.includes('index.html') && e.includes('style attribute'))).toBe(true);
    expect(errors.some((e) => e.includes('terms.html') && e.includes('style attribute'))).toBe(true);

    // Confirm data-style and quoted attribute text do not trigger a false positive.
    const cleanDir = makeValidDist();
    writeFileSync(
      join(cleanDir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/styles-abc.css"></head><body><div data-style="ok" data-note="style=x > y"></div></body></html>',
    );
    expect(await validateWebDist(cleanDir)).toEqual([]);
  });

  test('fails if any HTML file (including nested HTML files) contains an inline <script>', async () => {
    const dir = makeValidDist();
    mkdirSync(join(dir, 'extra'), { recursive: true });
    writeFileSync(join(dir, 'extra', 'page.html'), '<!doctype html><html><body><script data-src="x.js">alert(1)</script></body></html>');
    const errors = await validateWebDist(dir);
    expect(errors.some((e) => e.includes('extra/page.html') && e.includes('inline script'))).toBe(true);
  });

  test('fails if any landing or legal page references an app stylesheet, Tailwind CSS, or Geist Mono preload', async () => {
    const dir = makeValidDist();
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/styles-abc.css"><link rel="stylesheet" crossorigin href="/landing/assets/app-abc.css"></head><body><a href="/app/">Try demo</a></body></html>',
    );
    writeFileSync(
      join(dir, 'privacy.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/legal-abc.css"><link rel="preload" href="/landing/fonts/geist-mono-400.woff2" as="font" type="font/woff2" crossorigin></head><body></body></html>',
    );
    writeFileSync(
      join(dir, 'terms.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/tailwind-xyz.css"></head><body></body></html>',
    );
    writeFileSync(
      join(dir, '404.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/src/app/app.css"></head><body></body></html>',
    );

    const errors = await validateWebDist(dir);
    expect(errors.some((e) => e.includes('index.html') && e.includes('app stylesheet'))).toBe(true);
    expect(errors.some((e) => e.includes('privacy.html') && e.includes('geist-mono'))).toBe(true);
    expect(errors.some((e) => e.includes('terms.html') && e.includes('app stylesheet'))).toBe(true);
    expect(errors.some((e) => e.includes('404.html') && e.includes('app stylesheet'))).toBe(true);
  });

  test('fails if app/index.html is missing the Geist Mono font preload', async () => {
    const dir = makeValidDist();
    writeFileSync(
      join(dir, 'app', 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="/landing/assets/app-abc.css"></head><body></body></html>',
    );
    const errors = await validateWebDist(dir);
    expect(errors.some((e) => e.includes('app/index.html') && e.includes('geist-mono'))).toBe(true);
  });
});

function writeBytes(dir: string, path: string, bytes: number): void {
  const full = join(dir, path);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, 'x'.repeat(bytes));
}

describe('measureWeightBudget', () => {
  const budget = { jsBytes: 1000, cssBytes: 500 };

  test('measures the JS and CSS each landing page loads and reports nothing under budget', async () => {
    const dir = makeValidDist();
    writeBytes(dir, 'landing/assets/index-abc.js', 900);
    writeBytes(dir, 'landing/assets/styles-abc.css', 400);
    const result = await measureWeightBudget(dir, budget);
    expect(result.pages.find((p) => p.page === 'index.html')).toEqual({ page: 'index.html', jsBytes: 900, cssBytes: 400 });
    expect(result.overBudget).toEqual([]);
  });

  test('reports a landing page whose JS or CSS is over budget', async () => {
    const dir = makeValidDist();
    writeBytes(dir, 'landing/assets/index-abc.js', 1001);
    writeBytes(dir, 'landing/assets/legal-abc.css', 500);
    const { overBudget } = await measureWeightBudget(dir, budget);
    expect(overBudget.some((m) => m.includes('index.html') && m.includes('JS') && m.includes('1001'))).toBe(true);
    expect(overBudget.some((m) => m.includes('privacy.html') && m.includes('CSS'))).toBe(true);
    expect(overBudget.some((m) => m.includes('terms.html') && m.includes('CSS'))).toBe(true);
  });

  test('counts module preloads but not chunks the app also loads (shared React runtime)', async () => {
    const dir = makeValidDist();
    writeFileSync(
      join(dir, 'index.html'),
      '<!doctype html><html><head><link rel="modulepreload" href="/landing/assets/client-abc.js"><link rel="modulepreload" href="/landing/assets/turnstile-abc.js"><link rel="stylesheet" href="/landing/assets/styles-abc.css"></head><body><script type="module" src="/landing/assets/index-abc.js"></script></body></html>',
    );
    writeFileSync(
      join(dir, 'app', 'index.html'),
      '<!doctype html><html><head><link rel="preload" href="/landing/fonts/geist-mono-400.woff2" as="font" type="font/woff2" crossorigin><link rel="modulepreload" href="/landing/assets/client-abc.js"><link rel="stylesheet" href="/landing/assets/app-abc.css"></head><body><script type="module" src="/landing/assets/app-abc.js"></script></body></html>',
    );
    writeBytes(dir, 'landing/assets/index-abc.js', 600);
    writeBytes(dir, 'landing/assets/turnstile-abc.js', 300);
    writeBytes(dir, 'landing/assets/client-abc.js', 200_000);
    const result = await measureWeightBudget(dir, budget);
    expect(result.pages.find((p) => p.page === 'index.html')?.jsBytes).toBe(900);
    expect(result.overBudget).toEqual([]);
  });

  test('the default budget is 24 KiB of landing JS and under 36 KiB of CSS per page', async () => {
    const dir = makeValidDist();
    writeBytes(dir, 'landing/assets/index-abc.js', 24 * 1024);
    writeBytes(dir, 'landing/assets/styles-abc.css', 36 * 1024 - 1);
    expect((await measureWeightBudget(dir)).overBudget).toEqual([]);
    writeBytes(dir, 'landing/assets/index-abc.js', 24 * 1024 + 1);
    writeBytes(dir, 'landing/assets/styles-abc.css', 36 * 1024);
    const { overBudget } = await measureWeightBudget(dir);
    expect(overBudget.some((m) => m.includes('index.html') && m.includes('JS'))).toBe(true);
    expect(overBudget.some((m) => m.includes('index.html') && m.includes('CSS'))).toBe(true);
  });

  test('validateWebDist fails the build on an over-budget landing page and passes one within budget', async () => {
    const dir = makeValidDist();
    writeBytes(dir, 'landing/assets/index-abc.js', 20_000);
    writeBytes(dir, 'landing/assets/styles-abc.css', 30_000);
    writeBytes(dir, 'landing/assets/legal-abc.css', 30_000);
    expect(await validateWebDist(dir)).toEqual([]);
    writeBytes(dir, 'landing/assets/index-abc.js', 100_000);
    writeBytes(dir, 'landing/assets/legal-abc.css', 100_000);
    const errors = await validateWebDist(dir);
    expect(errors.some((m) => m.includes('index.html') && m.includes('JS') && m.includes('100000'))).toBe(true);
    expect(errors.some((m) => m.includes('privacy.html') && m.includes('CSS'))).toBe(true);
  });
});
describe('validateWebSource', () => {
  test('accepts React 19 use() and ref-as-prop files without JSX style props', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-src-ok-'));
    dirs.push(dir);
    writeFileSync(
      join(dir, 'App.tsx'),
      'import { use } from "react";\nexport function Box({ ref }: { ref?: React.Ref<HTMLDivElement> }) { return <div ref={ref} />; }\nexport function useVal(c: React.Context<string>) { return use(c); }\n',
    );
    expect(await validateWebSource(dir)).toEqual([]);
  });

  test('rejects JSX style={...}, useContext(), and forwardRef()', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'macro-src-bad-'));
    dirs.push(dir);
    writeFileSync(join(dir, 'BadStyle.tsx'), 'export function BadStyle() { return <div style={{ width: 10 }} />; }\n');
    writeFileSync(join(dir, 'BadHook.ts'), 'import { useContext } from "react";\nexport const read = (c: any) => useContext(c);\n');
    writeFileSync(join(dir, 'BadRef.tsx'), 'import { forwardRef } from "react";\nexport const Wrap = forwardRef<HTMLDivElement>((_p, ref) => <div ref={ref} />);\n');

    const errors = await validateWebSource(dir);
    expect(errors.some((e) => e.includes('BadStyle.tsx') && e.includes('style={...}'))).toBe(true);
    expect(errors.some((e) => e.includes('BadHook.ts') && e.includes('useContext()'))).toBe(true);
    expect(errors.some((e) => e.includes('BadRef.tsx') && e.includes('forwardRef()'))).toBe(true);
  });
});
