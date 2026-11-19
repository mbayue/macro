import { afterEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateWebDist } from '../scripts/build-web-check.ts';

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
