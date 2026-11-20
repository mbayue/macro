/**
 * The interactive parts of the home page. The page is prerendered whole (pages/Home.tsx), but only
 * these are hydrated, each into its own root (entry-home.tsx), so the static sections never ship as
 * JavaScript. Each island renders inside a `display: contents` wrapper, so it keeps its place in the
 * parent's layout.
 */
import type { ReactNode } from 'react';
import { Gate } from './components/Gate.tsx';
import { Hero } from './components/Hero.tsx';
import { LoadTheDeck } from './components/LoadTheDeck.tsx';
import { Waitlist } from './components/Waitlist.tsx';

export const ISLANDS = {
  hero: () => <Hero />,
  load: () => <LoadTheDeck />,
  gate: () => <Gate />,
  waitlist: () => <Waitlist className="col-span-2 split:col-span-1 split:col-start-2" />,
} as const satisfies Record<string, () => ReactNode>;

export type IslandName = keyof typeof ISLANDS;

export const islandId = (name: string) => `island-${name}`;

/** Prerenders one island in its hydration root. */
export function Island({ name }: { name: IslandName }) {
  return (
    <div id={islandId(name)} className="contents">
      {ISLANDS[name]()}
    </div>
  );
}
