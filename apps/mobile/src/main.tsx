import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@piwin/ui-kit/styles.css';
import './themes.css';
import './styles.css';
import './chat-markdown.css';
import './inkstone/inkstone-theme.css';
import './inkstone/inkstone-phone.css';
import './inkstone/inkstone-surfaces.css';
import './inkstone/inkstone-conversation.css';
import './inkstone/inkstone-workspace.css';
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
