import { StrictMode } from 'react';
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

createRoot(rootElement).render(
  <StrictMode>
    <PetOverlayApp />
  </StrictMode>,
);
