import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@piwin/ui-kit/styles.css';
import './styles.css';
import { App } from './App.js';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('mobile root element missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
