import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppErrorBoundary } from './AppErrorBoundary';
import { applyAppearanceToDocument, PIWIN_APPEARANCE_DARK } from './appearance-tokens';
import { PiwinUiProvider } from '@piwin/ui-kit';
import 'katex/dist/katex.min.css';
import './styles.css';

// Paint shell tokens before first paint to avoid unthemed flash.
applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('root element missing');
}

createRoot(rootElement).render(
  <StrictMode>
    <PiwinUiProvider manifest={PIWIN_APPEARANCE_DARK}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
    </PiwinUiProvider>
  </StrictMode>,
);
