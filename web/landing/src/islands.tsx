/**
 * The interactive parts of the home page. The page is prerendered whole (pages/Home.tsx),
 * but only these three islands are hydrated, each into its own root (entry-home.tsx),
 * so static sections (LimitsFaq, Close, SiteFooter) never ship as JavaScript.
 */
import type { ReactNode } from 'react';
import { HeroWorkbench } from './components/HeroWorkbench.tsx';
import { Pipeline } from './components/Pipeline.tsx';
import { SanokProof } from './components/SanokProof.tsx';

export const ISLANDS = {
  hero: () => <HeroWorkbench />,
  pipeline: () => <Pipeline />,
  proof: () => <SanokProof />,
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
