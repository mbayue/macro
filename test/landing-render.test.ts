/**
 * Page renderer seam: render each landing page to HTML the way the build prerenders it, and check
 * what a visitor receives. Assertions are on rendered output (text, links, ids, alt text), not on
 * components or class names.
 */
import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Pricing } from '../web/landing/src/components/Pricing.tsx';
import { render, type PageName } from '../web/landing/src/entry-server.tsx';

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

describe('home page pricing', () => {
  const PRICING = 'section[id="pricing"]';

  test('says "Free while in early access" under the pricing anchor the hero links to', async () => {
    const sections = await select(home, PRICING);
    expect(sections.length).toBe(1);
    expect((await select(home, `${PRICING} h2`)).map((h) => h.text)).toEqual(['Free while in early access']);
  });

  test('offers Self-host then Hosted early access, both $0, each ending in its action', async () => {
    expect((await select(home, `${PRICING} article h3`)).map((h) => h.text)).toEqual(['Self-host', 'Hosted early access']);
    for (const p of await select(home, `${PRICING} article`)) expect(p.text).toContain('$0');
    const links = (await select(home, `${PRICING} article a`)).map((a) => [a.text, href(a)]);
    expect(links).toEqual([
      ['View on GitHub', 'https://github.com/mbayue/macro'],
      ['Try the live demo', '/app/'],
    ]);
  });
});

describe('home page FAQ', () => {
  const QUESTIONS = [
    'Can Macro test my own site today?',
    'What stops someone using it as a DDoS tool?',
    'What does the AI decide, and what does code decide?',
    'Can the AI make up numbers in the report?',
    'Is Macro free?',
    'What runs inside the sandbox?',
    'Where does the traffic come from?',
  ];

  test('asks every existing question under "Before you ask"', async () => {
    expect((await select(home, 'h2')).map((h) => h.text)).toContain('Before you ask');
    expect((await select(home, 'details summary')).map((s) => s.text)).toEqual(QUESTIONS);
  });

  test('opens one answer at a time: native details sharing one name, the first open on load', async () => {
    const cards = await select(home, 'details');
    expect(cards.length).toBe(QUESTIONS.length);
    expect(new Set(cards.map((d) => d.attrs.get('name'))).size).toBe(1);
    expect(cards[0]?.attrs.get('name')).toBeTruthy();
    expect(cards.map((d) => d.attrs.has('open'))).toEqual(QUESTIONS.map((_, i) => i === 0));
    expect(cards[0]?.text).toContain('DNS TXT record');
  });
});

describe('paid-plan pricing (kept for when paid tiers launch, not on the page)', () => {
  const paid = renderToString(createElement(Pricing));

  test('is not rendered on the home page', () => {
    expect(home).not.toContain('Priced by site');
  });

  test('renders once, under one "Priced by site" heading', async () => {
    expect((await select(paid, 'h2')).map((h) => h.text)).toEqual(['Priced by site']);
    expect(paid).not.toMatch(/<[^>]*\sstyle=/i);
  });

  test('shows Free, Pro and Team with their prices, limits and actions', async () => {
    expect((await select(paid, 'article h3')).map((h) => h.text)).toEqual(['Free', 'Pro', 'Team']);
    const plans = (await select(paid, 'article')).map((p) => p.text);
    expect(plans.length).toBe(3);
    [['$0', 'forever'], ['$9', 'per month'], ['$29', 'per month']].forEach(([price, period], i) => {
      expect(plans[i]).toContain(`${price} ${period}`);
    });
    const labels = ['Verified sites', 'Peak virtual users', 'Runs per month', 'Run history', 'Containment probe', 'Support'];
    expect((await select(paid, 'article dt')).map((d) => d.text)).toEqual([...labels, ...labels, ...labels]);
    expect((await select(paid, 'article dd')).map((d) => d.text)).toEqual([
      ...['1', '100', '10', '7 days', 'Included', 'Community'],
      ...['3', '300', '100', '90 days', 'Included', 'Email'],
      ...['10', '500', '400', '1 year', 'Included', 'Priority email'],
    ]);
    const links = (await select(paid, 'article a')).map((a) => [a.text, href(a)]);
    expect(links).toEqual([
      ['Try the live demo', '/app/'],
      ['Join the waitlist', '#waitlist'],
      ['Join the waitlist', '#waitlist'],
    ]);
  });
});
