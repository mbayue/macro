/** Navigation and footer shared by the landing page and the legal pages. */
import { useEffect, useState } from 'react';
import { currentTheme, setTheme } from '../theme.ts';

/**
 * Dark mode on/off. On the home page React handles it; the legal pages are not hydrated, so
 * theme.ts bindThemeToggle() wires the same button there. The icon follows html[data-theme] in CSS,
 * so it is right before any script runs; aria-pressed is corrected once the script has run.
 */
function ThemeToggle() {
  const [dark, setDark] = useState(true);
  useEffect(() => setDark(currentTheme() === 'dark'), []);
  return (
    <button
      type="button"
      className="theme-toggle"
      data-theme-toggle
      aria-label="Dark mode"
      aria-pressed={dark}
      onClick={() => {
        const next = currentTheme() === 'dark' ? 'light' : 'dark';
        setTheme(next);
        setDark(next === 'dark');
      }}
    >
      <svg className="theme-toggle__moon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <svg className="theme-toggle__sun" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <path
          d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

export function Nav({ home }: { home: boolean }) {
  const anchor = (id: string) => (home ? `#${id}` : `/#${id}`);
  return (
    <header className="nav">
      <div className="wrap">
        <a className="wordmark" href="/">
          Macro
        </a>
        <ul>
          <li>
            <a href={anchor('how')}>How it works</a>
          </li>
          <li>
            <a href={anchor('containment')}>Containment</a>
          </li>
          <li>
            <a href={anchor('pricing')}>Pricing</a>
          </li>
          <li className="nav__theme">
            <ThemeToggle />
          </li>
          <li>
            <a className="btn" href="/app/">
              Try the live demo
            </a>
          </li>
        </ul>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap">
        <span>Load tests that stay contained</span>
        <nav aria-label="Footer">
          <a href="/app/">Live demo</a>
          <a href="https://github.com/mbayue/macro">GitHub</a>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </nav>
        <span className="foot__right">
          2026 <a href="mailto:hello@macro.my.id">hello@macro.my.id</a>
        </span>
      </div>
    </footer>
  );
}
