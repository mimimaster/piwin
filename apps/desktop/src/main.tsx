import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyAppearanceToDocument, PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import './styles.css';

// Paint shell tokens before first paint to avoid unthemed flash.
applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('root element missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
