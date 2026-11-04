import { createRoot } from 'react-dom/client';
import { TrayQuotaApp } from './tray-quota/TrayQuotaApp.js';
import { installDevelopmentPerformanceTimelineGuard } from './platform/development-performance-timeline.js';
import './tray-quota.css';

const disposePerformanceTimelineGuard = import.meta.env.DEV
  ? installDevelopmentPerformanceTimelineGuard()
  : undefined;
if (disposePerformanceTimelineGuard !== undefined && import.meta.hot !== undefined) {
  import.meta.hot.dispose(disposePerformanceTimelineGuard);
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('tray quota root element missing');
}

createRoot(rootElement).render(<TrayQuotaApp />);
