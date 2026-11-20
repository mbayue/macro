/** Client script for the privacy, terms and 404 pages, which are prerendered and not hydrated. */
import './legal-spy.ts';
import { startReveal } from './reveal.ts';
import { bindThemeToggle } from './theme.ts';

bindThemeToggle();
startReveal();
