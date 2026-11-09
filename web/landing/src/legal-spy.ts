/**
 * Legal pages only: mark the "On this page" link for the section being read with aria-current.
 * The pages are fully readable without it; this only adds the highlight.
 */
const links = new Map<string, HTMLAnchorElement>();
for (const a of document.querySelectorAll<HTMLAnchorElement>('.legal__toc a[href^="#"]')) {
  links.set(a.hash.slice(1), a);
}
const sections = [...document.querySelectorAll<HTMLElement>('.legal__body section[id]')].filter((s) => links.has(s.id));

// A section counts as current once its top passes this line, measured from the top of the viewport.
const LINE = 0.3;
let current = '';
let queued = false;
// After a click on the index (or arriving with #section), keep that section highlighted until the
// reader scrolls by hand: near the bottom of a short page the clicked section may never reach the line.
let pinned = links.has(location.hash.slice(1)) ? location.hash.slice(1) : '';

function mark(id: string): void {
  if (id === current) return;
  links.get(current)?.removeAttribute('aria-current');
  links.get(id)?.setAttribute('aria-current', 'true');
  current = id;
}

function update(): void {
  queued = false;
  if (pinned) return mark(pinned);
  const line = window.innerHeight * LINE;
  let id = sections[0]?.id ?? '';
  for (const s of sections) {
    if (s.getBoundingClientRect().top <= line) id = s.id;
  }
  // At the very bottom the last sections may never reach the line; treat the last one as current.
  if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
    id = sections.at(-1)?.id ?? id;
  }
  mark(id);
}

function queue(): void {
  if (queued) return;
  queued = true;
  requestAnimationFrame(update);
}

function unpin(): void {
  if (!pinned) return;
  pinned = '';
  queue();
}

if (sections.length > 0) {
  for (const [id, a] of links) {
    a.addEventListener('click', () => {
      pinned = id;
      mark(id);
    });
  }
  addEventListener('scroll', queue, { passive: true });
  addEventListener('resize', queue);
  for (const type of ['wheel', 'touchstart', 'keydown'] as const) addEventListener(type, unpin, { passive: true });
  update();
}
