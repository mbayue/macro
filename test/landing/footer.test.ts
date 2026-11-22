import { describe, expect, test } from 'bun:test';
import { home, href, select } from './helpers.ts';

describe('home page footer', () => {
  test('renders the compact brand tagline and links to Test Studio, GitHub, privacy, terms and email', async () => {
    const footer = (await select(home, 'footer'))[0]?.text ?? '';
    expect(footer).toContain('Macro. Load tests that stay contained.');
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
