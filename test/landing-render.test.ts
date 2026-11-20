/**
 * Page renderer seam: render each landing page to HTML the way the build prerenders it, and check
 * what a visitor receives. Assertions are on rendered output (text, links, ids, alt text), not on
 * components or class names.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Pricing } from '../web/landing/src/components/Pricing.tsx';
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
const PUBLIC_DIR = join(import.meta.dir, '..', 'web', 'landing', 'public');

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

  test('not-found offers the Containment Probe, the Runs Table and sign-in at their /app/ routes', async () => {
    const links = (await select(render('not-found'), 'main a')).map((a) => [a.text, href(a)]);
    const shortcuts = links.filter(([, to]) => to?.startsWith('/app/#/'));
    const names = ['Containment Probe', 'Runs Table', 'Sign in'];
    expect(shortcuts.length).toBe(3);
    shortcuts.forEach(([text], i) => expect(text?.startsWith(names[i]!)).toBe(true));
    expect(shortcuts.map(([, to]) => to)).toEqual(['/app/#/probe', '/app/#/runs', '/app/#/sign-in']);
  });

  test('not-found says the page does not exist and links home', async () => {
    const html = render('not-found');
    expect((await select(html, 'h1'))[0]?.text).toBe('Nothing lives at this URL');
    expect((await select(html, 'main a')).map(href)).toContain('/');
  });

  test.each(OTHER)('%s has no em dash characters in visible text', (page) => {
    expect(render(page).replace(/<[^>]*>/g, ' ')).not.toContain('\u2014');
  });
});

describe('home page Load the deck', () => {
  const LOAD = 'section#load';

  test('is the #load section, headed by the first Stage clause, announced politely', async () => {
    const h2 = await select(home, `${LOAD} h2`);
    expect(h2.map((h) => h.text)).toEqual(['25 users on the deck']);
    expect(h2[0]?.attrs.get('aria-live')).toBe('polite');
  });

  test('shows the measured p95 per route at 25 users from run d28cacd6, slowest route marked', async () => {
    const text = (await select(home, LOAD))[0]?.text ?? '';
    expect(text).toContain('d28cacd6');
    const rows = await select(home, `${LOAD} [data-ui] tbody tr`);
    expect(rows.length).toBe(3);
    expect(rows[0]?.text).toMatch(/^store_home\s*575 ms\s*Slowest$/);
    expect(rows[1]?.text).toMatch(/^catalog_list\s*77 ms$/);
    expect(rows[2]?.text).toMatch(/^product_detail\s*81 ms$/);
  });

  test('is driven by a labelled range input at the first stop, with a button per Stage', async () => {
    const range = (await select(home, `${LOAD} input[type="range"]`))[0];
    expect(range?.attrs.get('min')).toBe('0');
    expect(range?.attrs.get('max')).toBe('15');
    expect(range?.attrs.get('value')).toBe('1');
    expect(range?.attrs.get('aria-valuetext')).toBe('25 users, Stage 1 of 4');
    const label = await select(home, `${LOAD} label[for="${range?.attrs.get('id')}"]`);
    expect(label.map((l) => l.text)).toEqual(['Users on the deck']);
    const stops = await select(home, `${LOAD} li button`);
    expect(stops.map((b) => b.text)).toEqual(['25', '50', '100', '200 users']);
    expect(stops.map((b) => b.attrs.get('aria-pressed'))).toEqual(['true', 'false', 'false', 'false']);
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

describe('home page containment and gate (#16)', () => {
  const PROOF = 'section#containment';

  test('Containment lists the five escape attempts the probe blocks, each contained', async () => {
    const section = (await select(home, PROOF))[0]?.text ?? '';
    expect(section).toContain('Five escapes, five blocked');
    expect(section).toContain('Containment Probe');
    for (const name of ['example.com', '169.254.169.254', 'macro-api:3000', 'KEY, SECRET, TOKEN', 'Over 1 GiB']) {
      expect(section).toContain(name);
    }
    expect(section.match(/Contained/g)?.length).toBe(5);
  });
});

describe('home page gate switch (#16)', () => {
  const GATE = 'section[aria-labelledby="gate-title"]';

  test('offers "Your site" and "Someone else\'s" as a two-option pressed-state switch, "Your site" first and pressed', async () => {
    const buttons = await select(home, `${GATE} button[aria-pressed]`);
    expect(buttons.map((b) => decode(b.text))).toEqual(['Your site', 'Someone else\u2019s']);
    expect(buttons.map((b) => b.attrs.get('aria-pressed'))).toEqual(['true', 'false']);
  });

  test('announces the answer politely and says yes for the verified demo target', async () => {
    const h2 = (await select(home, `${GATE} h2[aria-live="polite"]`))[0];
    expect(h2?.text).toBe('The gate says yes');
    const section = (await select(home, GATE))[0]?.text ?? '';
    expect(section).toContain('https://yue.macro.my.id');
    expect(section).toContain('25, 50, 100, 200 users, 240 s');
  });

  test('carries the rejection: rule 4.2, target not verified, 0 requests sent, no approve button', async () => {
    const section = (await select(home, GATE))[0]?.text ?? '';
    expect(section).toContain('Rule 4.2');
    expect(section).toContain('is not verified');
    expect(section).toContain('0 requests sent');
    expect(section).toContain('no approve button');
  });
});

describe('home page explainers: measured, then opened, and Hybrid AI', () => {
  const WHY = 'section[aria-labelledby="why-title"]';

  test('"Measured, then opened" says who decides what: the AI drafts, fixed code decides, the Number Guard checks', async () => {
    const heading = await select(home, `${WHY} h2`);
    expect(heading.map((h) => h.text)).toEqual(['Measured, then opened']);
    const points = (await select(home, `${WHY} li`)).map((li) => li.text);
    expect(points).toEqual([
      'The AI drafts the plan and writes the explanation.',
      'Fixed code decides the target, the limits, the script and the stop rule.',
      'Every number in the AI text is checked against the measurements, or the text is withheld.',
    ]);
  });

  test('"Measured, then opened" shows a credited Sanok photograph described as the bridge test', async () => {
    const imgs = await select(home, `${WHY} img`);
    expect(imgs.length).toBe(1);
    expect(imgs[0]?.attrs.get('src')).toMatch(/^\/landing\/img\/sanok\//);
    expect(imgs[0]?.attrs.get('alt')).toMatch(/Sanok bridge/);
    expect(imgs[0]?.attrs.get('srcset')).toContain('800w');
  });

  const AI = 'section[aria-labelledby="hybrid-title"]';

  test('Hybrid AI names the On-Device Model, Cloud Fallback, Scenario Assistant and Report Q&A', async () => {
    const heading = await select(home, `${AI} h2`);
    expect(heading.map((h) => h.text)).toEqual(['Hybrid AI']);
    const text = decode((await select(home, AI))[0]?.text ?? '');
    for (const term of ['Hybrid Inference', 'On-Device Model', 'Gemini Nano', 'Chrome', 'Cloud Fallback', 'Scenario Assistant', 'Report Q&A']) {
      expect(text).toContain(term);
    }
  });

  test('Hybrid AI links into the app', async () => {
    const links = (await select(home, `${AI} a`)).map(href);
    expect(links).toContain('/app/');
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

describe('home page close', () => {
  const CLOSE = 'section[aria-labelledby="close-title"]';

  test('ends on "Load your own deck" with the DNS TXT step and the live demo action', async () => {
    const h2 = await select(home, `${CLOSE} h2`);
    expect(h2.map((h) => h.text)).toEqual(['Load your own deck']);
    const text = (await select(home, CLOSE))[0]?.text ?? '';
    expect(text).toContain('DNS TXT record');
    const toApp = (await select(home, `${CLOSE} a`)).filter((a) => href(a) === '/app/');
    expect(toApp.map((a) => a.text)).toEqual(['Try the live demo']);
  });

  test('holds the waitlist form at #waitlist: a labelled email field, a submit button and a polite status line', async () => {
    const ids = (await select(home, `${CLOSE} [id="waitlist"]`)).length;
    expect(ids).toBe(1);
    const field = await select(home, `${CLOSE} #waitlist form input[type="email"]`);
    expect(field.length).toBe(1);
    expect(field[0]?.attrs.get('aria-label') ?? '').toMatch(/email/i);
    const submit = await select(home, `${CLOSE} #waitlist form button[type="submit"]`);
    expect(submit.map((b) => b.text)).toEqual(['Join the waitlist']);
    const status = await select(home, `${CLOSE} #waitlist [aria-live="polite"]`);
    expect(status[0]?.text).toContain('paid plans');
    const links = (await select(home, `${CLOSE} #waitlist a`)).map(href);
    expect(links).toContain('/privacy');
  });
});
