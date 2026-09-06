import { createIcon } from './create-icon.js';
export const IconChat = createIcon(
  <path d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v5a2.75 2.75 0 0 1-2.75 2.75H11l-3.75 3.4v-3.4h.25A2.75 2.75 0 0 1 4.75 12.5v-5A2.75 2.75 0 0 1 7.5 4.75Z" />,
);

export const IconSideChat = createIcon(
  <>
    <path d="M7.25 4.75h7a2.5 2.5 0 0 1 2.5 2.5v3.5a2.5 2.5 0 0 1-2.5 2.5h-3.3l-3.2 2.9v-2.9h-.5a2.5 2.5 0 0 1-2.5-2.5v-3.5a2.5 2.5 0 0 1 2.5-2.5Z" />
    <path d="M19.25 9.25v3.4a4.6 4.6 0 0 1-4.6 4.6h-3.3l-2.5 2.25" />
  </>,
);

export const IconCommentPlus = createIcon(
  <>
    <path d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v5a2.75 2.75 0 0 1-2.75 2.75H11l-3.75 3.4v-3.4h.25A2.75 2.75 0 0 1 4.75 12.5v-5A2.75 2.75 0 0 1 7.5 4.75Z" />
    <path d="M12 7.5v5M9.5 10h5" />
  </>,
);

export const IconCommentOutline = createIcon(
  <>
    <path d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v5a2.75 2.75 0 0 1-2.75 2.75H11l-3.75 3.4v-3.4h.25A2.75 2.75 0 0 1 4.75 12.5v-5A2.75 2.75 0 0 1 7.5 4.75Z" />
    <circle cx="8.9" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="12" cy="10" r="1.05" fill="currentColor" stroke="none" />
    <circle cx="15.1" cy="10" r="1.05" fill="currentColor" stroke="none" />
  </>,
);

export const IconCommentFilled = createIcon(
  <path
    d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v5a2.75 2.75 0 0 1-2.75 2.75H11l-3.75 3.4v-3.4h.25A2.75 2.75 0 0 1 4.75 12.5v-5A2.75 2.75 0 0 1 7.5 4.75Z"
    fill="currentColor"
  />,
);

export const IconCommentAction = createIcon(
  <>
    <rect x="4.25" y="4.75" width="15.5" height="12.5" rx="2.6" />
    <path d="M8.25 9.25h7.5M8.25 12.5h4.25" />
    <path d="M9.5 17.25v2.9l3.4-2.9" />
  </>,
);

/* Send is the composer's up-arrow; it shares IconArrowUp's geometry exactly so
   the primary action never looks like a different glyph at a different size. */
export const IconSend = createIcon(
  <>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </>,
  16,
);

export const IconPaperPlane = createIcon(
  <>
    <path d="M19.75 4.25 4.5 10.9l6.35 2.25L13.1 19.5Z" />
    <path d="M19.75 4.25 10.85 13.15" />
  </>,
);

export const IconSendFilled = createIcon(
  <>
    <path d="M19.75 4.25 4.5 10.9l6.35 2.25L13.1 19.5Z" fill="currentColor" />
    <path d="M19.75 4.25 10.85 13.15" stroke="var(--bg, currentColor)" strokeWidth="1.3" />
  </>,
);

export const IconPaperclip = createIcon(
  <path d="M16.25 6.25 8.4 14.25a2.1 2.1 0 0 0 3 2.95l7.85-8a4.2 4.2 0 0 0-6-5.9L5.4 11.4a6.3 6.3 0 0 0 8.9 8.9l5.45-5.55" />,
);

export const IconMic = createIcon(
  <>
    <rect x="6" y="2" width="4" height="8" rx="2" />
    <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" />
  </>,
  16,
);

/* Stop sits inside a 28px circular button, so the filled square is drawn to
   the inner optical area rather than the full grid. */
export const IconStop = createIcon(
  <rect x="7" y="7" width="10" height="10" rx="2.4" fill="currentColor" stroke="none" />,
);

export const IconPause = createIcon(
  <>
    <path d="M6 4v8M10 4v8" strokeWidth="2" />
  </>,
  16,
);

export const IconSpark = createIcon(
  <>
    <path d="M10.25 8.2c.48 2.95 2 4.47 4.95 4.95-2.95.48-4.47 2-4.95 4.95-.48-2.95-2-4.47-4.95-4.95 2.95-.48 4.47-2 4.95-4.95Z" />
    <path d="M17.75 4.1c.24 1.48 1 2.24 2.48 2.48-1.48.24-2.24 1-2.48 2.48-.24-1.48-1-2.24-2.48-2.48 1.48-.24 2.24-1 2.48-2.48Z" />
  </>,
);

/* Two-hemisphere brain; 16-grid like search/file so 14px transcript rows share stroke weight. */
export const IconBrain = createIcon(
  <path d="M7.5 3.2A2.2 2.2 0 0 0 4 4.5a2 2 0 0 0-1 3.4A2.2 2.2 0 0 0 4.2 11.8 2.1 2.1 0 0 0 7.5 12.8zM8.5 3.2A2.2 2.2 0 0 1 12 4.5a2 2 0 0 1 1 3.4 2.2 2.2 0 0 1-1.2 3.9 2.1 2.1 0 0 1-3.3 1zM8 3v10" />,
  16,
);

export const IconAgent = createIcon(
  <>
    <path d="M12 3.6c.62 3.9 2.66 5.94 6.56 6.56-3.9.62-5.94 2.66-6.56 6.56-.62-3.9-2.66-5.94-6.56-6.56 3.9-.62 5.94-2.66 6.56-6.56Z" />
    <rect x="10.5" y="18.4" width="3" height="2.6" rx=".8" fill="currentColor" stroke="none" />
  </>,
);
