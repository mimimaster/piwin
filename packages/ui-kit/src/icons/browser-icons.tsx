import { createIcon } from './create-icon.js';

/**
 * Browser workbench chrome glyphs (spec §4.2). Added here once instead of
 * hand-rolling SVGs in the Desktop app.
 */
export const IconExternalLink = createIcon(
  <>
    <path d="M12 6H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-5" />
    <path d="M12.75 11.25 20 4" />
    <path d="M15 4h5v5" />
  </>,
);

/** Arrow cursor used by the pick-element mode. */
export const IconPointer = createIcon(<path d="M6 3.2 19 12.5l-6.2.9-2.9 5.9L6 3.2Z" />);

/** Device/monitor glyph that opens the viewport menu. */
export const IconDeviceViewport = createIcon(
  <>
    <rect x="3" y="4.5" width="18" height="12" rx="2" />
    <path d="M12 16.5V20M9.5 20h5" />
  </>,
);
