import { createRoot } from 'react-dom/client';
import { PetOverlayApp } from './pet-overlay-app';
import { installDevelopmentPerformanceTimelineGuard } from './development-performance-timeline';
import './pet-overlay.css';

const disposePerformanceTimelineGuard = import.meta.env.DEV
  ? installDevelopmentPerformanceTimelineGuard()
  : undefined;
if (disposePerformanceTimelineGuard !== undefined && import.meta.hot !== undefined) {
  import.meta.hot.dispose(disposePerformanceTimelineGuard);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('pet overlay root element missing');
}

// Do not remount this tree in development: a second boot effect used to
// recreate a pet the user just hid. Main window follows the same rule.
createRoot(rootElement).render(<PetOverlayApp />);
