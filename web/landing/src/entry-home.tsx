import { hydrateRoot } from 'react-dom/client';
import './landing.css';
import { Home } from './pages/Home.tsx';
import { startReveal } from './reveal.ts';

hydrateRoot(document.getElementById('root')!, <Home />);
startReveal();
