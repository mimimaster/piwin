import type { ReactElement, ReactNode, SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'stroke'> & {
  size?: number | string | undefined;
  stroke?: number | string | undefined;
};

function createIcon(children: ReactNode): (props: IconProps) => ReactElement {
  return function ShellIcon(props: IconProps): ReactElement {
    const { className = '', children: overrideChildren, size, stroke, strokeWidth, width, height, ...rest } = props;
    const computedStrokeWidth = typeof stroke === 'number' ? stroke : (strokeWidth ?? 1.6);
    const computedStroke = typeof stroke === 'string' ? stroke : 'currentColor';
    const computedWidth = size ?? width ?? '1em';
    const computedHeight = size ?? height ?? '1em';

    return (
      <svg
        viewBox="0 0 24 24"
        width={computedWidth}
        height={computedHeight}
        fill="none"
        stroke={computedStroke}
        strokeWidth={computedStrokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className={`tabler-icon ${className}`.trim()}
        {...rest}
      >
        {overrideChildren ?? children}
      </svg>
    );
  };
}

/* ── G1 Chrome & Navigation ── */
export const IconPanelLeft = createIcon(
  <>
    <rect x="3.25" y="4.5" width="17.5" height="15" rx="3" />
    <path d="M9.75 4.5v15" />
    <path d="M6.1 8.25h1.3M6.1 11.25h1.3" opacity=".45" />
  </>,
);

export const IconPanelRight = createIcon(
  <>
    <rect x="3.25" y="4.5" width="17.5" height="15" rx="3" />
    <path d="M14.25 4.5v15" />
    <path d="M16.6 8.25h1.3M16.6 11.25h1.3" opacity=".45" />
  </>,
);

export const IconClose = createIcon(
  <path d="M6.75 6.75l10.5 10.5M17.25 6.75l-10.5 10.5" />,
);

export const IconBack = createIcon(
  <>
    <path d="M19.25 12H4.75" />
    <path d="M10.5 6.25 4.75 12l5.75 5.75" />
  </>,
);

export const IconChevronLeft = createIcon(
  <path d="M14.5 6.5 9 12l5.5 5.5" />,
);

export const IconChevronRight = createIcon(
  <path d="M9.5 6.5 15 12l-5.5 5.5" />,
);

export const IconChevronUp = createIcon(
  <path d="M6.5 14.75 12 9.25l5.5 5.5" />,
);

export const IconChevronDown = createIcon(
  <path d="M6.5 9.25 12 14.75l5.5-5.5" />,
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
    <circle cx="12" cy="5.75" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none" />
    <circle cx="12" cy="18.25" r="1.35" fill="currentColor" stroke="none" />
  </>,
);

export const IconMenuList = createIcon(
  <path d="M4.5 7h15M4.5 12h15M4.5 17h15" />,
);

export const IconExpand = createIcon(
  <>
    <path d="M14.75 4.75h4.5v4.5" />
    <path d="M9.25 19.25h-4.5v-4.5" />
    <path d="M19.25 4.75 13.5 10.5" />
    <path d="M4.75 19.25l5.75-5.75" />
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
    <circle cx="10.9" cy="10.9" r="6.15" />
    <path d="M15.4 15.4l4.1 4.1" />
    <path d="M8 8.6a3.7 3.7 0 0 1 2.6-1.4" opacity=".45" />
  </>,
);

export const IconPlus = createIcon(
  <path d="M12 5.25v13.5M5.25 12h13.5" />,
);

export const IconRefresh = createIcon(
  <>
    <path d="M4.75 9.25a8 8 0 0 1 13.9-2.2l1.6 1.7" />
    <path d="M20.25 4.5v4.25H16" />
    <path d="M19.25 14.75a8 8 0 0 1-13.9 2.2l-1.6-1.7" />
    <path d="M3.75 19.5v-4.25H8" />
  </>,
);

export const IconSettings = createIcon(
  <>
    <path d="M4.5 8.25h15M4.5 15.75h15" />
    <circle cx="9.75" cy="8.25" r="1.9" fill="currentColor" stroke="none" />
    <circle cx="14.25" cy="15.75" r="1.9" fill="currentColor" stroke="none" />
  </>,
);

export const IconSliders = createIcon(
  <path d="M4.75 7h14.5M7.75 12h8.5M10.75 17h2.5" />,
);

/* ── G2 Conversation & Input ── */
export const IconChat = createIcon(
  <path d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v5a2.75 2.75 0 0 1-2.75 2.75H11l-3.75 3.4v-3.4h.25A2.75 2.75 0 0 1 4.75 12.5v-5A2.75 2.75 0 0 1 7.5 4.75Z" />,
);

export const IconSideChat = createIcon(
  <>
    <path d="M7.25 4.75h7a2.5 2.5 0 0 1 2.5 2.5v3.5a2.5 2.5 0 0 1-2.5 2.5h-3.3l-3.2 2.9v-2.9h-.5a2.5 2.5 0 0 1-2.5-2.5v-3.5a2.5 2.5 0 0 1 2.5-2.5Z" />
    <path d="M19.25 9.25v3.4a4.6 4.6 0 0 1-4.6 4.6h-3.3l-2.5 2.25" opacity=".45" />
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
  <path d="M7.5 4.75h9a2.75 2.75 0 0 1 2.75 2.75v5a2.75 2.75 0 0 1-2.75 2.75H11l-3.75 3.4v-3.4h.25A2.75 2.75 0 0 1 4.75 12.5v-5A2.75 2.75 0 0 1 7.5 4.75Z" fill="currentColor" />,
);

export const IconCommentAction = createIcon(
  <>
    <rect x="4.25" y="4.75" width="15.5" height="12.5" rx="2.6" />
    <path d="M8.25 9.25h7.5M8.25 12.5h4.25" />
    <path d="M9.5 17.25v2.9l3.4-2.9" />
  </>,
);

export const IconSend = createIcon(
  <>
    <path d="M12 19.25V5.25" />
    <path d="M5.9 11.35 12 5.25l6.1 6.1" />
  </>,
);

export const IconPaperPlane = createIcon(
  <>
    <path d="M19.75 4.25 4.5 10.9l6.35 2.25L13.1 19.5Z" />
    <path d="M19.75 4.25 10.85 13.15" opacity=".45" />
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
    <rect x="9" y="3.75" width="6" height="10.5" rx="3" />
    <path d="M5.75 11.5a6.25 6.25 0 0 0 12.5 0" />
    <path d="M12 17.75v2.5" />
  </>,
);

export const IconStop = createIcon(
  <rect x="4.75" y="4.75" width="14.5" height="14.5" rx="2.8" fill="currentColor" stroke="none" />,
);

export const IconPause = createIcon(
  <path d="M9.25 6.75v10.5M14.75 6.75v10.5" />,
);

export const IconSpark = createIcon(
  <>
    <path d="M11 7.4c.5 3.1 2.1 4.7 5.2 5.2-3.1.5-4.7 2.1-5.2 5.2-.5-3.1-2.1-4.7-5.2-5.2 3.1-.5 4.7-2.1 5.2-5.2Z" />
    <path d="M17.9 3.9c.25 1.55 1.05 2.35 2.6 2.6-1.55.25-2.35 1.05-2.6 2.6-.25-1.55-1.05-2.35-2.6-2.6 1.55-.25 2.35-1.05 2.6-2.6Z" opacity=".45" />
  </>,
);

export const IconBrain = createIcon(
  <>
    <rect x="6.25" y="6.25" width="11.5" height="11.5" rx="2.5" />
    <path d="M9.5 4.5v1.75M14.5 4.5v1.75M9.5 17.75v1.75M14.5 17.75v1.75M4.5 9.5h1.75M4.5 14.5h1.75M17.75 9.5h1.75M17.75 14.5h1.75" opacity=".45" />
    <path d="M12 8.85c.32 1.85 1.33 2.86 3.18 3.18-1.85.32-2.86 1.33-3.18 3.18-.32-1.85-1.33-2.86-3.18-3.18 1.85-.32 2.86-1.33 3.18-3.18Z" />
  </>,
);

export const IconAgent = createIcon(
  <>
    <path d="M12 3.6c.62 3.9 2.66 5.94 6.56 6.56-3.9.62-5.94 2.66-6.56 6.56-.62-3.9-2.66-5.94-6.56-6.56 3.9-.62 5.94-2.66 6.56-6.56Z" />
    <rect x="10.5" y="18.4" width="3" height="2.6" rx=".8" fill="currentColor" stroke="none" />
  </>,
);

/* ── G3 Files & Knowledge ── */
export const IconFolder = createIcon(
  <path d="M3.75 6.9c0-1.2.95-2.15 2.15-2.15h3.2c.57 0 1.12.23 1.52.63l1.3 1.32h6.18c1.2 0 2.15.96 2.15 2.15v8.35c0 1.2-.96 2.15-2.15 2.15H5.9c-1.2 0-2.15-.96-2.15-2.15Z" />,
);

export const IconFolderOpen = createIcon(
  <>
    <path d="M3.75 16V6.9c0-1.2.95-2.15 2.15-2.15h3.2c.57 0 1.12.23 1.52.63l1.3 1.32h5.43c1.19 0 2.15.96 2.15 2.15v1.15" opacity=".45" />
    <path d="M6.35 10h11.5a1.9 1.9 0 0 1 1.85 2.33l-1.15 4.9a1.9 1.9 0 0 1-1.85 1.47H5.15c-.8 0-1.43-.68-1.36-1.48l.68-5.48A1.9 1.9 0 0 1 6.35 10Z" />
  </>,
);

export const IconFolderPlus = createIcon(
  <>
    <path d="M12.4 19.35H5.9c-1.2 0-2.15-.96-2.15-2.15V6.9c0-1.2.95-2.15 2.15-2.15h3.2c.57 0 1.12.23 1.52.63l1.3 1.32h6.18c1.2 0 2.15.96 2.15 2.15v3.4" />
    <path d="M17.25 14.5v5.5M14.5 17.25H20" />
  </>,
);

export const IconFile = createIcon(
  <>
    <path d="M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z" />
    <path d="M13.6 3.75V8.1h4.35" opacity=".45" />
  </>,
);

export const IconFileDiff = createIcon(
  <>
    <path d="M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z" />
    <path d="M13.6 3.75V8.1h4.35" opacity=".45" />
    <path d="M12 10.9v4.6M9.7 13.2h4.6" />
  </>,
);

export const IconDocument = createIcon(
  <>
    <path d="M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z" />
    <path d="M13.6 3.75V8.1h4.35" opacity=".45" />
    <path d="M9.4 12.75h5.2M9.4 16h3.4" />
  </>,
);

export const IconNote = createIcon(
  <>
    <path d="M19.25 13.1V7.15c0-1.33-1.07-2.4-2.4-2.4H7.15c-1.33 0-2.4 1.07-2.4 2.4v9.7c0 1.33 1.07 2.4 2.4 2.4h5.95Z" />
    <path d="M13.1 19.25v-3.75c0-1.33 1.07-2.4 2.4-2.4h3.75" opacity=".45" />
    <path d="M8.4 9.4h7.2M8.4 12.65h3.7" />
  </>,
);

export const IconBook = createIcon(
  <>
    <path d="M12 6.4C10.55 5.1 8.6 4.55 5.5 4.55c-.4 0-.75.33-.75.74v11.9c0 .41.34.74.75.74 3.1 0 5.05.56 6.5 1.85 1.45-1.3 3.4-1.85 6.5-1.85.4 0 .75-.33.75-.74V5.3c0-.41-.34-.74-.75-.74-3.1 0-5.05.56-6.5 1.85Z" />
    <path d="M12 6.4v12.6" opacity=".45" />
  </>,
);

export const IconCards = createIcon(
  <>
    <rect x="4.5" y="7.1" width="12.4" height="12.4" rx="2.25" />
    <path d="M8.9 4.5h8.35c1.24 0 2.25 1 2.25 2.25v8.35" opacity=".45" />
  </>,
);

export const IconCanvas = createIcon(
  <>
    <rect x="3.75" y="4.5" width="16.5" height="15" rx="2.6" />
    <path d="M12 8.5c.4 2.3 1.6 3.5 3.9 3.9-2.3.4-3.5 1.6-3.9 3.9-.4-2.3-1.6-3.5-3.9-3.9 2.3-.4 3.5-1.6 3.9-3.9Z" />
  </>,
);

export const IconImage = createIcon(
  <>
    <rect x="3.75" y="4.75" width="16.5" height="14.5" rx="2.6" />
    <circle cx="9.1" cy="9.5" r="1.5" fill="currentColor" stroke="none" opacity=".45" />
    <path d="M4.6 17.75l4.5-4.5a1.55 1.55 0 0 1 2.2 0l5.2 5.2" />
    <path d="M14.6 15.9l1.4-1.4a1.55 1.55 0 0 1 2.2 0l2 2" opacity=".45" />
  </>,
);

export const IconListTree = createIcon(
  <>
    <path d="M4.75 5.9h14.5" />
    <path d="M10 12h9.25M10 18.1h9.25" />
    <path d="M6.6 8.4v7.45c0 1.25 1 2.25 2.25 2.25M6.6 12h2.3" opacity=".45" />
  </>,
);

/* ── G4 Dev & System ── */
export const IconTerminal = createIcon(
  <>
    <rect x="3.25" y="4.75" width="17.5" height="14.5" rx="2.75" />
    <path d="M7.1 9.25l3.1 2.75-3.1 2.75" />
    <rect x="12.9" y="13.15" width="3.9" height="1.9" rx=".95" fill="currentColor" stroke="none" />
  </>,
);

export const IconGit = createIcon(
  <>
    <circle cx="6.25" cy="6" r="2.1" />
    <circle cx="6.25" cy="18" r="2.1" />
    <circle cx="17.75" cy="8" r="2.1" />
    <path d="M6.25 8.1v7.8" />
    <path d="M17.75 10.1c0 4.35-5.35 4.3-8.9 6.5" />
  </>,
);

export const IconArrowFork = createIcon(
  <>
    <path d="M12 20.25v-6.7" />
    <path d="M12 13.55 6.7 8.25M12 13.55l5.3-5.3" />
    <path d="M6.7 11.15V8.25h2.9M17.3 11.15V8.25h-2.9" />
  </>,
);

export const IconSessionTree = createIcon(
  <>
    <circle cx="6.4" cy="5.75" r="1.9" />
    <circle cx="17.6" cy="12" r="1.9" />
    <circle cx="17.6" cy="18.25" r="1.9" />
    <path d="M8.3 5.75H10a3.25 3.25 0 0 1 3.25 3.25v6.8c0 1.35 1.1 2.45 2.45 2.45" />
    <path d="M13.25 12h2.45" />
  </>,
);

export const IconBrowser = createIcon(
  <>
    <circle cx="12" cy="12" r="8.25" />
    <path d="M3.75 12h16.5" />
    <path d="M12 3.75c2.55 2.2 3.85 4.95 3.85 8.25S14.55 18.05 12 20.25c-2.55-2.2-3.85-4.95-3.85-8.25S9.45 5.95 12 3.75Z" opacity=".45" />
  </>,
);

export const IconMcp = createIcon(
  <>
    <circle cx="12" cy="12" r="2.25" />
    <path d="M12 9.75V6.4M13.95 13.1l2.9 1.7M10.05 13.1l-2.9 1.7" />
    <circle cx="12" cy="4.9" r="1.5" opacity=".45" />
    <circle cx="18.15" cy="15.55" r="1.5" opacity=".45" />
    <circle cx="5.85" cy="15.55" r="1.5" opacity=".45" />
  </>,
);

export const IconPlug = createIcon(
  <>
    <path d="M9.4 3.75V7.4M14.6 3.75V7.4" />
    <path d="M6.9 7.4h10.2v2.5a5.1 5.1 0 0 1-10.2 0Z" />
    <path d="M12 15v5.25" />
  </>,
);

export const IconExtension = createIcon(
  <path d="M5.75 9.25a1.5 1.5 0 0 1 1.5-1.5H9.9V7.6a2.1 2.1 0 0 1 4.2 0v.15h2.65a1.5 1.5 0 0 1 1.5 1.5v2.65h.15a2.1 2.1 0 0 1 0 4.2h-.15v2.65a1.5 1.5 0 0 1-1.5 1.5H7.25a1.5 1.5 0 0 1-1.5-1.5Z" />,
);

export const IconSkill = createIcon(
  <path d="M13.4 3.75 6.25 12.8h4.4l-1.05 7.45 7.15-9.05h-4.4Z" />,
);

export const IconActivity = createIcon(
  <path d="M3.75 12h3.35l2.4-5.7 4.05 11.4 2.35-5.7h4.35" />,
);

export const IconChartBar = createIcon(
  <>
    <rect x="5.15" y="13.4" width="3.2" height="5.85" rx="1.1" />
    <rect x="10.4" y="7.6" width="3.2" height="11.65" rx="1.1" />
    <rect x="15.65" y="10.5" width="3.2" height="8.75" rx="1.1" />
  </>,
);

export const IconLaptop = createIcon(
  <>
    <rect x="4.75" y="5" width="14.5" height="11" rx="1.9" />
    <path d="M2.9 18.25h18.2" />
    <path d="M8.6 8.5l2 1.9-2 1.9" opacity=".45" />
  </>,
);

export const IconCloud = createIcon(
  <path d="M7.1 17.9h9.6a3.9 3.9 0 0 0 .5-7.77 5.3 5.3 0 0 0-10.3-1.45A3.85 3.85 0 0 0 7.1 17.9Z" />,
);

export const IconKeyboard = createIcon(
  <>
    <rect x="3.25" y="6.75" width="17.5" height="10.5" rx="2.4" />
    <path d="M6.6 10.15h.05M10.2 10.15h.05M13.8 10.15h.05M17.4 10.15h.05M6.6 13.85h.05M17.4 13.85h.05" opacity=".45" />
    <path d="M9.7 13.85h4.6" />
  </>,
);

/* ── G5 Actions & Feedback ── */
export const IconCheck = createIcon(
  <path d="M4.9 12.9l4.95 4.7L19.1 7.3" />,
);

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
    <rect x="8.75" y="8.75" width="11" height="11" rx="2.25" />
    <path d="M5.4 15.25c-.63 0-1.15-.51-1.15-1.15V5.4c0-.63.51-1.15 1.15-1.15h8.7c.63 0 1.15.51 1.15 1.15" />
  </>,
);

export const IconEdit = createIcon(
  <>
    <path d="M16.9 3.95a2.25 2.25 0 0 1 3.15 3.15L8.6 18.55l-4.35 1.2 1.2-4.35Z" />
    <path d="M14.9 5.95l3.15 3.15" opacity=".45" />
  </>,
);

export const IconTrash = createIcon(
  <>
    <path d="M4.75 7.25h14.5" />
    <path d="M9.75 7.25V6c0-.7.55-1.25 1.25-1.25h2c.7 0 1.25.55 1.25 1.25v1.25" />
    <path d="M6.75 7.25l.65 10.9a2.1 2.1 0 0 0 2.1 1.98h4.99a2.1 2.1 0 0 0 2.1-1.98l.66-10.9" />
    <path d="M10.25 11.25v5M13.75 11.25v5" opacity=".45" />
  </>,
);

export const IconArchive = createIcon(
  <>
    <rect x="3.75" y="4.75" width="16.5" height="4.25" rx="1.4" />
    <path d="M5.75 9v8.1c0 1.19.96 2.15 2.15 2.15h8.2c1.19 0 2.15-.96 2.15-2.15V9" />
    <path d="M12 12v4.4M9.9 14.35 12 16.4l2.1-2.05" />
  </>,
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
    <path d="M9.65 4.75h4.7l-.55 5.2 3 2.8H7.2l3-2.8Z" />
    <path d="M12 12.75v6.5" />
  </>,
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
    <path d="M3.75 12c2.3-3.85 5.05-5.8 8.25-5.8s5.95 1.95 8.25 5.8c-2.3 3.85-5.05 5.8-8.25 5.8S6.05 15.85 3.75 12Z" opacity=".45" />
    <circle cx="12" cy="12" r="2.4" opacity=".45" />
    <path d="M4.75 4.75l14.5 14.5" />
  </>,
);

/* ── G6 Identity & Theme ── */
export const IconUser = createIcon(
  <>
    <circle cx="12" cy="7.9" r="3.4" />
    <path d="M5.5 19.5c.4-3.4 3.1-5.4 6.5-5.4s6.1 2 6.5 5.4" />
  </>,
);

export const IconUsers = createIcon(
  <>
    <circle cx="9.25" cy="8.4" r="3.1" />
    <path d="M3.75 19.25c.35-3.1 2.6-4.9 5.5-4.9s5.15 1.8 5.5 4.9" />
    <path d="M15.1 5.9a3.1 3.1 0 0 1 0 5M17.1 14.6c1.8.55 3 1.9 3.35 4.05" opacity=".45" />
  </>,
);

export const IconPet = createIcon(
  <>
    <path d="M12 19.1c-2.75-1.4-4.5-3.1-4.5-5.05 0-1.5 1.15-2.55 2.5-2.55.75 0 1.45.3 2 .85.55-.55 1.25-.85 2-.85 1.35 0 2.5 1.05 2.5 2.55 0 1.95-1.75 3.65-4.5 5.05Z" />
    <circle cx="6.6" cy="8.4" r="1.55" fill="currentColor" stroke="none" opacity=".45" />
    <circle cx="12" cy="6.6" r="1.55" fill="currentColor" stroke="none" opacity=".45" />
    <circle cx="17.4" cy="8.4" r="1.55" fill="currentColor" stroke="none" opacity=".45" />
  </>,
);

export const IconHeart = createIcon(
  <path d="M12 19.25c-4.4-2.85-7.25-5.6-7.25-8.9A4.05 4.05 0 0 1 12 7.8a4.05 4.05 0 0 1 7.25 2.55c0 3.3-2.85 6.05-7.25 8.9Z" />,
);

export const IconShield = createIcon(
  <>
    <path d="M12 3.9c2.3 1.45 4.55 2.2 6.9 2.35v5.4c0 4.25-2.75 7.2-6.9 8.8-4.15-1.6-6.9-4.55-6.9-8.8v-5.4C7.45 6.1 9.7 5.35 12 3.9Z" />
    <path d="M9.4 11.9l1.85 1.85 3.35-3.45" opacity=".45" />
  </>,
);

export const IconPower = createIcon(
  <>
    <path d="M12 4.25v7.25" />
    <path d="M8.35 6.55a6.9 6.9 0 1 0 7.3 0" />
  </>,
);

export const IconMoon = createIcon(
  <>
    <path d="M11.7 3.75a6.75 6.75 0 0 0 8.55 8.55A8.4 8.4 0 1 1 11.7 3.75Z" />
    <path d="M17.25 4.75c.2 1.2.85 1.85 2.05 2.05-1.2.2-1.85.85-2.05 2.05-.2-1.2-.85-1.85-2.05-2.05 1.2-.2 1.85-.85 2.05-2.05Z" opacity=".45" />
  </>,
);

export const IconSun = createIcon(
  <>
    <circle cx="12" cy="12" r="3.9" />
    <path d="M12 3.5v2.1M12 18.4v2.1M3.5 12h2.1M18.4 12h2.1M5.99 5.99l1.49 1.49M16.52 16.52l1.49 1.49M18.01 5.99l-1.49 1.49M7.48 16.52l-1.49 1.49" />
  </>,
);

/* ── G7 Arrows ── */
export const IconArrowUp = createIcon(
  <>
    <path d="M12 19.25V4.75M5.85 10.9 12 4.75l6.15 6.15" />
  </>,
);

export const IconArrowDown = createIcon(
  <>
    <path d="M12 4.75v14.5M5.85 13.1 12 19.25l6.15-6.15" />
  </>,
);

export const IconArrowLeft = createIcon(
  <>
    <path d="M19.25 12H4.75M10.9 5.85 4.75 12l6.15 6.15" />
  </>,
);

export const IconArrowRight = createIcon(
  <>
    <path d="M4.75 12h14.5M13.1 5.85 19.25 12l-6.15 6.15" />
  </>,
);

export const IconNarrowRight = createIcon(
  <>
    <path d="M4.75 12h14.5M14.4 7.15 19.25 12l-4.85 4.85" />
  </>,
);

export const IconNarrowLeft = createIcon(
  <>
    <path d="M19.25 12H4.75M9.6 7.15 4.75 12l4.85 4.85" />
  </>,
);
