import { createRoot } from 'react-dom/client';
import { ScreenCaptureOverlayApp } from './screen-capture/overlay/ScreenCaptureOverlayApp';
import './screen-capture-overlay.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('screen capture overlay root element missing');
}

createRoot(rootElement).render(<ScreenCaptureOverlayApp />);
