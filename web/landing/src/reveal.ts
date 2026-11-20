/**
 * The entrance of every section below the hero, on the home, legal and 404 pages: each element marked
 * `data-reveal` gets `data-shown` once it scrolls into view, and landing.css fades and lifts it in
 * (staggered by `data-i`). The state is an attribute React does not render, so re-renders of a
 * hydrated island never take it away again.
 *
 * Marking the page `motion-ready` tells landing-early.js the script has started; without it the early
 * script drops the `js` class after 3 s and everything shows without an entrance.
 */
export function startReveal(): void {
  const root = document.documentElement;
  root.classList.add('motion-ready');
  const targets = document.querySelectorAll<HTMLElement>('[data-reveal]');
  const show = (el: Element) => el.setAttribute('data-shown', '');
  if (!('IntersectionObserver' in window)) {
    targets.forEach(show);
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        show(en.target);
        io.unobserve(en.target);
      }
    },
    { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
  );
  targets.forEach((el) => io.observe(el));
}
