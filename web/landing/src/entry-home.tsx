import { hydrateRoot } from 'react-dom/client';
import './landing.css';
import { Home } from './pages/Home.tsx';

hydrateRoot(document.getElementById('root')!, <Home />);
