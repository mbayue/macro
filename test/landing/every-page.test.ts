import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { PAGES, PUBLIC_DIR, decode, home, href, render, select } from './helpers.ts';

describe('every landing page', () => {
  test.each(PAGES)('%s has no style attributes (the CSP blocks them)', (page) => {
    expect(render(page)).not.toMatch(/<[^>]*\sstyle=/i);
  });

  test('home: every in-page link points at an id on the page', async () => {
    const ids = new Set((await select(home, '[id]')).map((e) => e.attrs.get('id')));
    const anchors = (await select(home, 'a[href^="#"]')).map(href);
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) expect([a, ids.has(a.slice(1))]).toEqual([a, true]);
  });

  test.each(PAGES)('%s: every link goes to an external URL, a known route or an id on the page', async (page) => {
    const html = render(page);
    const ids = new Set((await select(html, '[id]')).map((e) => e.attrs.get('id')));
    const links = (await select(html, 'a[href]')).map(href);
    expect(links.length).toBeGreaterThan(0);
    const ok = (to: string) =>
      /^https:\/\//.test(to) ||
      /^mailto:/.test(to) ||
      ['/', '/privacy', '/terms'].includes(to) ||
      /^\/app\/(#\/[\w-]+)?$/.test(to) ||
      (to.startsWith('#') && ids.has(to.slice(1)));
    for (const to of links) expect([to, ok(to)]).toEqual([to, true]);
  });

  test.each(PAGES)('%s: every image it shows exists in the public folder', async (page) => {
    const html = render(page);
    const urls = new Set<string>();
    for (const img of await select(html, 'img')) {
      urls.add(decode(img.attrs.get('src') ?? ''));
      for (const part of decode(img.attrs.get('srcset') ?? '').split(',')) if (part.trim()) urls.add(part.trim().split(/\s+/)[0]!);
    }
    for (const url of urls) {
      expect([url, existsSync(join(PUBLIC_DIR, ...url.split('/').filter(Boolean)))]).toEqual([url, true]);
    }
  });

  test('home: no em dash characters in visible text', () => {
    const text = home.replace(/<[^>]*>/g, ' ');
    expect(text).not.toContain('\u2014');
  });
});
