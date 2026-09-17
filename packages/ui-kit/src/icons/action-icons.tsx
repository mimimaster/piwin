import { createIcon } from './create-icon.js';
export const IconCheck = createIcon(<path d="M4.9 12.9l4.95 4.7L19.1 7.3" />);

export const IconCheckCircle = createIcon(
  <>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M8.4 12.35l2.55 2.55 4.65-4.9" />
  </>,
);

export const IconAlertCircle = createIcon(
  <>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M9.55 9.55l4.9 4.9M14.45 9.55l-4.9 4.9" />
  </>,
);

export const IconCopy = createIcon(
  <>
    <rect x="5.5" y="5.5" width="8" height="8" rx="2" />
    <path d="M2.5 9.5v-5a2 2 0 0 1 2-2h5" />
  </>,
  16,
);

export const IconEdit = createIcon(
  <>
    <path d="M16.9 3.95a2.25 2.25 0 0 1 3.15 3.15L8.6 18.55l-4.35 1.2 1.2-4.35Z" />
    <path d="M14.9 5.95l3.15 3.15" />
  </>,
);

export const IconTrash = createIcon(
  <>
    <path d="M4.75 7.25h14.5" />
    <path d="M9.75 7.25V6c0-.7.55-1.25 1.25-1.25h2c.7 0 1.25.55 1.25 1.25v1.25" />
    <path d="M6.75 7.25l.65 10.9a2.1 2.1 0 0 0 2.1 1.98h4.99a2.1 2.1 0 0 0 2.1-1.98l.66-10.9" />
    <path d="M10.25 11.25v5M13.75 11.25v5" />
  </>,
);

export const IconArchive = createIcon(
  <>
    <rect x="2" y="3" width="12" height="3" rx="1" />
    <path d="M3 6v6.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6M6.5 9h3" />
  </>,
  16,
);

export const IconUnarchive = createIcon(
  <>
    <rect x="3.75" y="4.75" width="16.5" height="4.25" rx="1.4" />
    <path d="M5.75 9v8.1c0 1.19.96 2.15 2.15 2.15h8.2c1.19 0 2.15-.96 2.15-2.15V9" />
    <path d="M12 16.4V12M9.9 14.05 12 12l2.1 2.05" />
  </>,
);

export const IconRevert = createIcon(
  <>
    <path d="M8.9 5.6 4.5 10l4.4 4.4" />
    <path d="M4.5 10h9.4a5.35 5.35 0 0 1 0 10.7H10.4" />
  </>,
);

export const IconLink = createIcon(
  <>
    <path d="M10.4 7.15l1.7-1.7a4.35 4.35 0 0 1 6.15 6.15l-1.7 1.7" />
    <path d="M13.6 16.85l-1.7 1.7a4.35 4.35 0 0 1-6.15-6.15l1.7-1.7" />
    <path d="M9.4 14.6l5.2-5.2" />
  </>,
);

export const IconDownload = createIcon(
  <>
    <path d="M4.75 15.4v2.35c0 1.1.9 2 2 2h10.5c1.1 0 2-.9 2-2V15.4" />
    <path d="M12 4.25v10.1M7.9 10.5l4.1 4.1 4.1-4.1" />
  </>,
);

export const IconPin = createIcon(
  <>
    <path d="M8 14V9.5M4.5 9.5h7L10 5.5V3H6v2.5z" />
  </>,
  16,
);

/**
 * Pin, as a bookmark ribbon. A pushpin silhouette collapses into a blob at the
 * 12px the sidebar hover row uses; a ribbon keeps its shape, and a bookmark in
 * a scroll is the Inkstone reading of "keep this one to hand". Pinned state
 * fills it — see .session-pin-btn.active in styles/inkstone/sidebar.css.
 */
export const IconBookmark = createIcon(
  <>
    <path d="M4.5 2.5h7v9l-3.5-2.6-3.5 2.6z" />
  </>,
  16,
);

export const IconStar = createIcon(
  <path d="M12 4.75l2.1 4.3 4.75.7-3.45 3.35.8 4.75L12 15.6l-4.2 2.25.8-4.75-3.45-3.35 4.75-.7Z" />,
);

export const IconWarn = createIcon(
  <>
    <path d="M10.2 4.9a2.05 2.05 0 0 1 3.6 0l6.5 11.25a2.05 2.05 0 0 1-1.8 3.1H5.5a2.05 2.05 0 0 1-1.8-3.1Z" />
    <path d="M12 9.4v4.1" />
    <path d="M12 16.4h.01" />
  </>,
);

export const IconEye = createIcon(
  <>
    <path d="M3.75 12c2.3-3.85 5.05-5.8 8.25-5.8s5.95 1.95 8.25 5.8c-2.3 3.85-5.05 5.8-8.25 5.8S6.05 15.85 3.75 12Z" />
    <circle cx="12" cy="12" r="2.4" />
  </>,
);

export const IconEyeOff = createIcon(
  <>
    <path d="M3.75 12c2.3-3.85 5.05-5.8 8.25-5.8s5.95 1.95 8.25 5.8c-2.3 3.85-5.05 5.8-8.25 5.8S6.05 15.85 3.75 12Z" />
    <circle cx="12" cy="12" r="2.4" />
    <path d="M4.75 4.75l14.5 14.5" />
  </>,
);
