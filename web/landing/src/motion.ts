/** True when the visitor asked for reduced motion. Call it in effects only (it reads window). */
export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
