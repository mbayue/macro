import { describe, expect, test } from 'bun:test';
import { HERO, home, href, select } from './helpers.ts';

describe('home page hero', () => {
  test('leads with the one headline "Find your breaking point"', async () => {
    const h1 = await select(home, 'h1');
    expect(h1.map((h) => h.text)).toEqual(['Find your breaking point']);
  });

  test('has a single primary action, "Try the live demo", going to /app/', async () => {
    const links = await select(home, `${HERO} a`);
    const toApp = links.filter((a) => href(a) === '/app/');
    expect(toApp.map((a) => a.text)).toEqual(['Try the live demo']);
  });

  test('is the navigation: three anchor links to sections on the page and the theme toggle', async () => {
    const anchors = (await select(home, `${HERO} a`)).filter((a) => href(a).startsWith('#'));
    expect(anchors.map((a) => a.text)).toEqual(['Watch a run', 'Containment', 'Pricing']);
    const ids = new Set((await select(home, '[id]')).map((e) => e.attrs.get('id')));
    for (const a of anchors) expect(ids.has(href(a).slice(1))).toBe(true);
    const toggle = await select(home, `${HERO} button[aria-label="Dark mode"]`);
    expect(toggle.length).toBe(1);
  });

  test('shows the four Sanok load-test photographs, with the first one described', async () => {
    const imgs = await select(home, `${HERO} img`);
    expect(imgs.length).toBe(4);
    expect(imgs[0]?.attrs.get('alt')).toMatch(/Sanok/);
    for (const img of imgs) expect(img.attrs.get('src')).toMatch(/^\/landing\/img\/sanok\//);
  });

  test('serves the photographs at sizes for their slot, not only the 1920 px originals', async () => {
    for (const img of await select(home, `${HERO} img`)) {
      const set = img.attrs.get('srcset') ?? '';
      for (const w of ['800w', '1280w', '1920w']) expect(set).toContain(w);
      expect(img.attrs.get('sizes')).toBeTruthy();
    }
  });

  test('keeps a skip link to the main content', async () => {
    const skip = (await select(home, 'a')).find((a) => a.text === 'Skip to content');
    expect(skip).toBeDefined();
    const ids = new Set((await select(home, 'main[id]')).map((e) => e.attrs.get('id')));
    expect(ids.has(href(skip!).slice(1))).toBe(true);
  });

  test('replaces the separate top navigation', async () => {
    expect((await select(home, 'header')).length).toBe(0);
  });
});
