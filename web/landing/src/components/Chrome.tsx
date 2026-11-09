/** Navigation and footer shared by the landing page and the legal pages. */

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
