import { hydrateRoot } from 'react-dom/client';
import './styles.css';
import { Home } from './pages/Home.tsx';

hydrateRoot(document.getElementById('root')!, <Home />);
