/**
 * Page renderer seam: render each landing page to HTML the way the build prerenders it, and check
 * what a visitor receives. Assertions are on rendered output (text, links, ids, alt text), not on
 * components or class names.
 */
import { describe, expect, test } from 'bun:test';
import { render, type PageName } from '../web/landing/src/entry-server.tsx';
import LEGAL_TEXT from './fixtures/legal-text.json';
import { LEGAL_PAGES, mainText } from './legal-text.ts';

interface Found {
  attrs: Map<string, string>;
  text: string;
}

/** Every element matching `selector`, with its attributes and its text content. */
async function select(html: string, selector: string): Promise<Found[]> {
  const found: Found[] = [];
  const open: Found[] = [];
  await new HTMLRewriter()
    .on(selector, {
      element(el) {
        const item: Found = { attrs: new Map(el.attributes), text: '' };
        found.push(item);
        open.push(item);
        if (el.canHaveContent && !el.selfClosing) {
          el.onEndTag(() => {
            open.splice(open.indexOf(item), 1);
          });
        } else {
          open.splice(open.indexOf(item), 1);
        }
      },
      text(chunk) {
        for (const item of open) item.text += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();
  for (const item of found) item.text = item.text.replace(/\s+/g, ' ').trim();
  return found;
}

const decode = (s: string) => s.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
const href = (f: Found) => decode(f.attrs.get('href') ?? '');

const PAGES: PageName[] = ['home', 'privacy', 'terms', 'not-found'];
const home = render('home');
const HERO = 'section[aria-labelledby="hero-title"]';

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

describe('home page footer', () => {
  test('spells MACRO in blocks, named Macro for assistive technology', async () => {
    const mark = await select(home, 'footer [aria-label="Macro"]');
    expect(mark.length).toBe(1);
    expect(mark[0]?.text.replace(/\s/g, '')).toBe('MACRO');
  });

  test('links to the live demo, GitHub, privacy, terms and email', async () => {
    const links = (await select(home, 'footer a')).map(href);
    for (const target of ['/app/', 'https://github.com/mbayue/macro', '/privacy', '/terms', 'mailto:hello@macro.my.id']) {
      expect(links).toContain(target);
    }
  });

  test('credits the four Marsilar photographs with their sources and the CC BY-SA 4.0 licence', async () => {
    const footer = (await select(home, 'footer'))[0]?.text ?? '';
    expect(footer).toContain('Marsilar');
    expect(footer).toContain('CC BY-SA 4.0');
    expect(footer).toContain('Wikimedia Commons');
    const links = (await select(home, 'footer a')).map(href);
    for (const curid of ['192922595', '192922490', '192922542', '192924850']) {
      expect(links).toContain(`https://commons.wikimedia.org/w/index.php?curid=${curid}`);
    }
    expect(links).toContain('https://creativecommons.org/licenses/by-sa/4.0/');
  });
});

describe('privacy, terms and 404 pages', () => {
  const OTHER: PageName[] = ['privacy', 'terms', 'not-found'];
  test.each(LEGAL_PAGES)('%s keeps its legal wording word for word', (page) => {
    expect(mainText(render(page))).toBe(LEGAL_TEXT[page]);
  });

  test.each(OTHER)('%s has the site header: wordmark home link, theme toggle, "Try the live demo"', async (page) => {
    const html = render(page);
    const header = await select(html, 'header[aria-label="Site"]');
    expect(header.length).toBe(1);
    const links = await select(html, 'header[aria-label="Site"] a');
    expect(links.map((a) => [a.text, href(a)])).toEqual([
      ['Macro', '/'],
      ['Try the live demo', '/app/'],
    ]);
    expect((await select(html, 'header[aria-label="Site"] button[aria-label="Dark mode"][data-theme-toggle]')).length).toBe(1);
  });

  test.each(OTHER)('%s has the shared footer: the MACRO block mark, the links and the photo credits', async (page) => {
    const html = render(page);
    const mark = await select(html, 'footer [aria-label="Macro"]');
    expect(mark[0]?.text.replace(/\s/g, '')).toBe('MACRO');
    const footer = (await select(html, 'footer'))[0]?.text ?? '';
    expect(footer).toContain('Marsilar');
    expect(footer).toContain('CC BY-SA 4.0');
    const links = (await select(html, 'footer a')).map(href);
    for (const target of ['/app/', 'https://github.com/mbayue/macro', '/privacy', '/terms', 'mailto:hello@macro.my.id']) {
      expect(links).toContain(target);
    }
  });

  test.each(OTHER)('%s keeps a skip link to its main content', async (page) => {
    const html = render(page);
    const skip = (await select(html, 'a')).find((a) => a.text === 'Skip to content');
    const main = (await select(html, 'main[id]'))[0]?.attrs.get('id');
    expect(skip && href(skip)).toBe(`#${main}`);
  });
});

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

  test('home: no em dash characters in visible text', () => {
    const text = home.replace(/<[^>]*>/g, ' ');
    expect(text).not.toContain('\u2014');
  });
});
