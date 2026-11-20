import { hydrateRoot } from 'react-dom/client';
import './landing.css';
import { ISLANDS, islandId } from './islands.tsx';
import { startReveal } from './reveal.ts';

// Only the interactive parts are hydrated; the rest of the prerendered page stays static HTML.
for (const [name, island] of Object.entries(ISLANDS)) {
  const root = document.getElementById(islandId(name));
  if (root) hydrateRoot(root, island());
}
startReveal();
