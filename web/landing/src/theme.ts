/**
 * Dark (the default, set as data-theme="dark" in each page's HTML) and light theme for the landing
 * and legal pages. public/landing/landing-early.js applies a saved light choice before first paint,
 * so the page never flashes the wrong theme. The choice is kept in local storage.
 */
export type Theme = 'light' | 'dark';

export const THEME_KEY = 'macro-theme';
const THEME_COLOR: Record<Theme, string> = { light: '#f2f2ed', dark: '#0f0f0f' };

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function setTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage can be blocked; the choice then lasts only for this page.
  }
}

/** For pages that are not hydrated (privacy, terms): wire up the nav's theme button by hand. */
export function bindThemeToggle(): void {
  const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (!button) return;
  button.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
  button.addEventListener('click', () => {
    const next: Theme = currentTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    button.setAttribute('aria-pressed', String(next === 'dark'));
  });
}
