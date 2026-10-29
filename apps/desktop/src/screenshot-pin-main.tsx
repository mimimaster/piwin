import { createRoot } from 'react-dom/client';
import { ScreenshotPinApp } from './screen-capture/pin/ScreenshotPinApp';
import './screenshot-pin.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('screenshot pin root element missing');
}

createRoot(rootElement).render(<ScreenshotPinApp />);
