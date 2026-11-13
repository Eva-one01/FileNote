import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Capture } from './components/Capture';
import 'katex/dist/katex.min.css';
import './theme.css';

// La ventana de captura rápida carga la misma app con ?capture=1.
const capture = new URLSearchParams(location.search).has('capture');

createRoot(document.getElementById('root')!).render(<StrictMode>{capture ? <Capture /> : <App />}</StrictMode>);
