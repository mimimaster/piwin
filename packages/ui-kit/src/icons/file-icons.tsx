import { createIcon } from './create-icon.js';
export const IconFolder = createIcon(
  <>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
  </>,
);

/** Same outline family as `IconFolder`: one stroke, tab + open flap. */
export const IconFolderOpen = createIcon(
  <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" />,
);

export const IconFolderPlus = createIcon(
  <>
    <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    <path d="M12 10v6M9 13h6" />
  </>,
);

export const IconFile = createIcon(
  <>
    <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
  </>,
  16,
);

export const IconFileDiff = createIcon(
  <>
    <path d="M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z" />
    <path d="M13.6 3.75V8.1h4.35" />
    <path d="M12 10.9v4.6M9.7 13.2h4.6" />
  </>,
);

export const IconDocument = createIcon(
  <>
    <path d="M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z" />
    <path d="M13.6 3.75V8.1h4.35" />
    <path d="M9.4 12.75h5.2M9.4 16h3.4" />
  </>,
);

export const IconNote = createIcon(
  <>
    <path d="M19.25 13.1V7.15c0-1.33-1.07-2.4-2.4-2.4H7.15c-1.33 0-2.4 1.07-2.4 2.4v9.7c0 1.33 1.07 2.4 2.4 2.4h5.95Z" />
    <path d="M13.1 19.25v-3.75c0-1.33 1.07-2.4 2.4-2.4h3.75" />
    <path d="M8.4 9.4h7.2M8.4 12.65h3.7" />
  </>,
);

export const IconBook = createIcon(
  <>
    <path d="M12 6.4C10.55 5.1 8.6 4.55 5.5 4.55c-.4 0-.75.33-.75.74v11.9c0 .41.34.74.75.74 3.1 0 5.05.56 6.5 1.85 1.45-1.3 3.4-1.85 6.5-1.85.4 0 .75-.33.75-.74V5.3c0-.41-.34-.74-.75-.74-3.1 0-5.05.56-6.5 1.85Z" />
    <path d="M12 6.4v12.6" />
  </>,
);

export const IconCards = createIcon(
  <>
    <rect x="3" y="4.5" width="8.5" height="9" rx="1.5" />
    <path d="M6 4.5V3.5A1.5 1.5 0 0 1 7.5 2h4A1.5 1.5 0 0 1 13 3.5V10" />
  </>,
  16,
);

export const IconCanvas = createIcon(
  <>
    <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.6" />
    <path d="M12 8.5c.4 2.3 1.6 3.5 3.9 3.9-2.3.4-3.5 1.6-3.9 3.9-.4-2.3-1.6-3.5-3.9-3.9 2.3-.4 3.5-1.6 3.9-3.9Z" />
  </>,
);

export const IconImage = createIcon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="1.5" />
    <circle cx="6" cy="7" r="1.2" />
    <path d="M14 11l-3.5-3.5L5 13" />
  </>,
  16,
);

export const IconVideo = createIcon(
  <>
    <rect x="3.75" y="5.75" width="12.5" height="12.5" rx="2.5" />
    <path d="M16.25 10l4-2.5v9l-4-2.5" />
  </>,
);

export const IconPlay = createIcon(
  <path d="M7 5.5l12 6.5-12 6.5V5.5Z" fill="currentColor" stroke="none" />,
);

export const IconListTree = createIcon(
  <>
    <path d="M4.75 5.9h14.5" />
    <path d="M10 12h9.25M10 18.1h9.25" />
    <path d="M6.6 8.4v7.45c0 1.25 1 2.25 2.25 2.25M6.6 12h2.3" />
  </>,
);
