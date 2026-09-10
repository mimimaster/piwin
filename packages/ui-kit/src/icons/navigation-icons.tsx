import { createIcon } from './create-icon.js';
export const IconPanelLeft = createIcon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M6 3v10" />
  </>,
  16,
);

export const IconPanelRight = createIcon(
  <>
    <rect x="2" y="3" width="12" height="10" rx="2" />
    <path d="M10 3v10" />
  </>,
  16,
);

export const IconClose = createIcon(
  <>
    <path d="M4 4l8 8M12 4l-8 8" />
  </>,
  16,
);

export const IconBack = createIcon(
  <>
    <path d="M19.25 12H4.75" />
    <path d="M10.5 6.25 4.75 12l5.75 5.75" />
  </>,
);

export const IconChevronLeft = createIcon(
  <>
    <path d="M10 4l-4 4 4 4" />
  </>,
  16,
);

export const IconChevronRight = createIcon(
  <>
    <path d="M6 4l4 4-4 4" />
  </>,
  16,
);

export const IconChevronUp = createIcon(<path d="M6.5 14.75 12 9.25l5.5 5.5" />);

export const IconChevronDown = createIcon(
  <>
    <path d="M4 6l4 4 4-4" />
  </>,
  16,
);

export const IconMore = createIcon(
  <>
    <circle cx="5.75" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="18.25" cy="12" r="1.35" fill="currentColor" stroke="none" />
  </>,
);

export const IconMoreVertical = createIcon(
  <>
    <path d="M8 3.5v.01M8 8v.01M8 12.5v.01" strokeWidth="2.2" />
  </>,
  16,
);

export const IconMenuList = createIcon(<path d="M4.5 7h15M4.5 12h15M4.5 17h15" />);

export const IconGrid = createIcon(
  <>
    <rect x="4.5" y="4.5" width="6.25" height="6.25" rx="1.2" />
    <rect x="13.25" y="4.5" width="6.25" height="6.25" rx="1.2" />
    <rect x="4.5" y="13.25" width="6.25" height="6.25" rx="1.2" />
    <rect x="13.25" y="13.25" width="6.25" height="6.25" rx="1.2" />
  </>,
);

export const IconListDots = createIcon(
  <>
    <circle cx="5.25" cy="7" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="5.25" cy="12" r="1.15" fill="currentColor" stroke="none" />
    <circle cx="5.25" cy="17" r="1.15" fill="currentColor" stroke="none" />
    <path d="M8.75 7h10.75M8.75 12h10.75M8.75 17h10.75" />
  </>,
);

export const IconExpand = createIcon(
  <>
    <path d="M16 4h4v4" />
    <path d="M14 10l6-6" />
    <path d="M8 20H4v-4" />
    <path d="M10 14l-6 6" />
  </>,
);

export const IconCompress = createIcon(
  <>
    <path d="M14.5 4.75v4.75h4.75" />
    <path d="M9.5 19.25v-4.75H4.75" />
    <path d="M19.6 4.4 14.5 9.5" />
    <path d="M4.4 19.6 9.5 14.5" />
  </>,
);

export const IconSearch = createIcon(
  <>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </>,
  16,
);

export const IconPlus = createIcon(
  <>
    <path d="M8 3v10M3 8h10" />
  </>,
  16,
);

export const IconRefresh = createIcon(
  <>
    <path d="M13 8A5 5 0 1 1 11.6 4.5M13.5 2.5v3h-3" />
  </>,
  16,
);

export const IconSettings = createIcon(
  <>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </>,
  16,
);

export const IconSliders = createIcon(
  <>
    <path d="M2.5 5.5h11 M5.5 3.2v4.6 M2.5 10.5h11 M10.5 8.2v4.6" />
  </>,
  16,
);

/** Descending bars — display / sort control (Inkstone sidebar). */
export const IconListFilter = createIcon(
  <>
    <path d="M3 6h18M7 12h10M10 18h4" />
  </>,
);
