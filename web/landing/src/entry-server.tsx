/** Build-time prerender: each page's HTML is rendered once and written into its .html file. */
import { renderToString } from 'react-dom/server';
import { Privacy, Terms } from './pages/Legal.tsx';
import { Home } from './pages/Home.tsx';

export type PageName = 'home' | 'privacy' | 'terms';

export function render(page: PageName): string {
  switch (page) {
    case 'home':
      return renderToString(<Home />);
    case 'privacy':
      return renderToString(<Privacy />);
    case 'terms':
      return renderToString(<Terms />);
  }
}
