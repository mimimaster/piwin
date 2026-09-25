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
import './inkstone/transcript/transcript.css';
import './inkstone/transcript/transcript-gates.css';
import './inkstone/pages/chat-review.css';
import './inkstone/pages/sessions.css';
import './inkstone/settings/settings.css';
import './inkstone/tablet.css';
import './inkstone/syntax/code-view.css';
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
