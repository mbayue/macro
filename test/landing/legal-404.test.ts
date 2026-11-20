import { describe, expect, test } from 'bun:test';
import LEGAL_TEXT from '../fixtures/legal-text.json';
import { LEGAL_PAGES, mainText } from '../legal-text.ts';
import { href, render, select, type PageName } from './helpers.ts';

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
