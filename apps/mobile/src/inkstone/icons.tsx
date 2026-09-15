import type { ReactElement } from 'react';

export type InkstoneIconName =
  | 'panel'
  | 'panelr'
  | 'folder'
  | 'folderp'
  | 'branch'
  | 'search'
  | 'plus'
  | 'chevd'
  | 'chevr'
  | 'chevl'
  | 'more'
  | 'pin'
  | 'archive'
  | 'copy'
  | 'fork'
  | 'refresh'
  | 'file'
  | 'term'
  | 'globe'
  | 'expand'
  | 'pip'
  | 'close'
  | 'mic'
  | 'up'
  | 'pause'
  | 'image'
  | 'cards'
  | 'gear'
  | 'sliders'
  | 'bulb'
  | 'git'
  | 'bell'
  | 'book'
  | 'desk'
  | 'target'
  | 'list'
  | 'drop'
  | 'shield'
  | 'grid'
  | 'chat'
  | 'edit'
  | 'check'
  | 'undo'
  | 'stop'
  | 'alert'
  | 'clock'
  | 'puzzle'
  | 'chart'
  | 'key'
  | 'bolt'
  | 'mobile-device'
  | 'pointer'
  | 'scan'
  | 'model-claude'
  | 'model-openai'
  | 'model-gemini';

const ICON_VIEWBOXES: Partial<Record<InkstoneIconName, string>> = {
  'model-claude': '0 0 24 24',
  'model-openai': '0 0 24 24',
  'model-gemini': '0 0 24 24',
};

const ICON_PATHS: Record<InkstoneIconName, ReactElement> = {
  panel: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M6 3v10" />
    </>
  ),
  panelr: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="2" />
      <path d="M10 3v10" />
    </>
  ),
  folder: (
    <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H6l1.5 1.5h5A1.5 1.5 0 0 1 14 7v4.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5z" />
  ),
  folderp: (
    <path d="M2 5.5A1.5 1.5 0 0 1 3.5 4H6l1.5 1.5h5A1.5 1.5 0 0 1 14 7v4.5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5zM8 7.5v3M6.5 9h3" />
  ),
  branch: (
    <>
      <circle cx="4.5" cy="3.5" r="1.5" />
      <circle cx="4.5" cy="12.5" r="1.5" />
      <circle cx="11.5" cy="5.5" r="1.5" />
      <path d="M4.5 5v6M11.5 7c0 2.5-3 3-7 3.5" />
    </>
  ),
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  chevd: <path d="M4 6l4 4 4-4" />,
  chevr: <path d="M6 4l4 4-4 4" />,
  chevl: <path d="M10 4l-4 4 4 4" />,
  more: <path d="M8 3.5v.01M8 8v.01M8 12.5v.01" strokeWidth={2.2} />,
  pin: <path d="M8 14V9.5M4.5 9.5h7L10 5.5V3H6v2.5z" />,
  archive: (
    <>
      <rect x="2" y="3" width="12" height="3" rx="1" />
      <path d="M3 6v6.5A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5V6M6.5 9h3" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
      <path d="M3 10.5V4a1.5 1.5 0 0 1 1.5-1.5H10.5" />
    </>
  ),
  fork: (
    <>
      <circle cx="8" cy="3" r="1.5" />
      <circle cx="4" cy="13" r="1.5" />
      <circle cx="12" cy="13" r="1.5" />
      <path d="M8 4.5v2c0 1.5-4 1.5-4 5M8 6.5c0 1.5 4 1.5 4 5" />
    </>
  ),
  refresh: <path d="M13 8A5 5 0 1 1 11.6 4.5M13.5 2.5v3h-3" />,
  file: <path d="M4 2h5l3 3v9H4zM9 2v3h3" />,
  term: <path d="M3 4l4 4-4 4M8.5 12h4.5" />,
  globe: (
    <>
      <circle cx="8" cy="8" r="6" />
      <path d="M2 8h12M8 2c2.5 3 2.5 9 0 12M8 2c-2.5 3-2.5 9 0 12" />
    </>
  ),
  expand: <path d="M9.5 2H14v4.5M6.5 14H2V9.5M14 2L9 7M2 14l5-5" />,
  pip: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <rect x="8" y="7" width="5" height="5" rx="1" />
    </>
  ),
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  mic: (
    <>
      <rect x="6" y="2" width="4" height="8" rx="2" />
      <path d="M3.5 8a4.5 4.5 0 0 0 9 0M8 12.5V14" />
    </>
  ),
  up: <path d="M8 13V3M4 7l4-4 4 4" />,
  pause: <path d="M6 4v8M10 4v8" strokeWidth={2} />,
  image: (
    <>
      <rect x="2" y="3" width="12" height="10" rx="1.5" />
      <circle cx="6" cy="7" r="1.2" />
      <path d="M14 11l-3.5-3.5L5 13" />
    </>
  ),
  cards: (
    <>
      <rect x="3" y="4.5" width="8.5" height="9" rx="1.5" />
      <path d="M6 4.5V3.5A1.5 1.5 0 0 1 7.5 2h4A1.5 1.5 0 0 1 13 3.5V10" />
    </>
  ),
  gear: (
    <>
      <circle cx="8" cy="8" r="2.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
    </>
  ),
  sliders: (
    <>
      <path d="M2 4h12M2 8h12M2 12h12" />
      <circle cx="10" cy="4" r="1.5" />
      <circle cx="5" cy="8" r="1.5" />
      <circle cx="11" cy="12" r="1.5" />
    </>
  ),
  bulb: (
    <path d="M8 2.5A4.2 4.2 0 0 0 3.8 6.7c0 1.7 1 2.6 1.7 3.4.4.5.5.9.5 1.4h4c0-.5.1-.9.5-1.4.7-.8 1.7-1.7 1.7-3.4A4.2 4.2 0 0 0 8 2.5zM6.5 13.5h3" />
  ),
  git: (
    <>
      <circle cx="8" cy="4" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <path d="M8 5.6v4.8" />
    </>
  ),
  bell: (
    <>
      <path d="M4 11.5V7a4 4 0 0 1 8 0v4.5l1 1.5H3zM6.5 14h3" />
    </>
  ),
  book: (
    <>
      <path d="M2.5 3.5H6a2 2 0 0 1 2 1.2 2 2 0 0 1 2-1.2h3.5V13H10a2 2 0 0 0-2 .8 2 2 0 0 0-2-.8H2.5zM8 4.7v9" />
    </>
  ),
  desk: (
    <>
      <path d="M2 5.5h12v4H2zM4 9.5v4M12 9.5v4M6.5 7.5h3" />
    </>
  ),
  target: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <circle cx="8" cy="8" r="2.4" />
    </>
  ),
  list: (
    <path d="M6 4h7M6 8h7M6 12h7M3 4h.01M3 8h.01M3 12h.01" strokeWidth={1.7} />
  ),
  drop: (
    <path d="M8 2.5c2.2 2.8 4 5 4 7a4 4 0 0 1-8 0c0-2 1.8-4.2 4-7z" />
  ),
  shield: (
    <path d="M8 2l5 2v4.5c0 3.2-2.3 5.5-5 6.5-2.7-1-5-3.3-5-6.5V4z" />
  ),
  grid: (
    <>
      <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
      <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
      <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
    </>
  ),
  chat: (
    <path d="M3 3.5h10v7H7.5L4.5 13v-2.5H3z" />
  ),
  edit: (
    <>
      <path d="M3 13l1-3.5L10.5 3 13 5.5 6.5 12zM9 4.5l2.5 2.5" />
    </>
  ),
  check: (
    <path d="M3.5 8.5l3 3 6-7" />
  ),
  undo: (
    <path d="M5.5 4L2.5 7l3 3M2.5 7h6.5a3.5 3.5 0 0 1 0 7H6" />
  ),
  stop: (
    <rect x="4" y="4" width="8" height="8" rx="1.5" />
  ),
  alert: (
    <>
      <path d="M8 2.5l6 10.5H2zM8 6.5v3M8 11.3v.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.3" />
    </>
  ),
  puzzle: (
    <path d="M3 5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 1 0 3v2H3z" />
  ),
  chart: (
    <path d="M2.5 13.5h11M4 11V8M7.5 11V4M11 11V6" />
  ),
  key: (
    <>
      <circle cx="5.5" cy="5.5" r="2.8" />
      <path d="M7.5 7.5L14 14M11 11l1.5 1.5M12.5 9.5l1.5 1.5" />
    </>
  ),
  bolt: (
    <path d="M9 2L4 8.5h4L7 14l6-6.5h-4z" />
  ),
  'mobile-device': (
    <>
      <rect x="4.5" y="2" width="7" height="12" rx="1.5" />
      <path d="M7.5 12h1" />
    </>
  ),
  pointer: (
    <path d="M4 3l8 4-3.5 1.2L7 12z" />
  ),
  scan: (
    <path d="M2.5 5.5v-2h2M11.5 3.5h2v2M13.5 10.5v2h-2M4.5 12.5h-2v-2M5 8h6" />
  ),
  'model-claude': (
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M4.71 15.95l4.72-2.65.08-.23-.08-.12H9.2l-.79-.05-2.7-.08-2.34-.1-2.26-.12-.57-.12L0 11.78l.05-.35.48-.32.69.06 1.52.1 2.28.16 1.65.1 2.45.25h.39l.05-.16-.13-.1-.1-.1L6.96 9.8 4.41 8.12 3.07 7.15l-.72-.5-.37-.46-.16-1 .66-.73.88.06.23.06.89.69 1.9 1.47 2.5 1.84.36.3.15-.1.02-.07-.17-.28L7.6 5.99l-1.44-2.5-.65-1.02-.17-.62a2.97 2.97 0 0 1-.1-.73L6.28.13 6.7 0l1 .13.41.37.62 1.41 1 2.23 1.56 3.03.46.9.24.83.09.25h.16V9l.13-1.7.23-2.1.23-2.7.08-.75.38-.91.75-.5.58.3.48.68-.07.45-.28 1.85-.56 2.9-.37 1.94h.22l.24-.24 1-1.3 1.65-2.07.73-.82.85-.9.55-.44h1.03l.76 1.13-.34 1.17-1.06 1.35-.89 1.14-1.26 1.7-.79 1.36.07.11.19-.02 2.86-.6 1.54-.28 1.84-.32.84.4.09.39-.33.8-1.97.5-2.3.46-3.45.81-.04.03.05.06 1.55.15.66.03h1.62l3.02.23.8.52.47.64-.08.48-1.2.62-1.65-.39-3.83-.9-1.31-.33h-.19v.1l1.1 1.07 2 1.81 2.52 2.33.12.58-.32.45-.34-.05-2.2-1.65-.86-.75-1.92-1.62h-.13v.17l.44.65 2.35 3.52.12 1.08-.17.35-.6.22-.68-.13-1.37-1.92-1.42-2.17-1.14-1.94-.14.08-.67 7.25-.32.37-.73.28-.6-.46-.33-.75.33-1.47.38-1.93.32-1.53.29-1.9.17-.63-.02-.04-.14.02-1.43 1.96-2.18 2.95-1.73 1.85-.41.16-.72-.37.07-.66.4-.6 2.39-3.03 1.44-1.88.93-1.09v-.15h-.05L4.13 18.56l-1.13.15-.49-.46.06-.75.23-.24 1.9-1.31z"
    />
  ),
  'model-openai': (
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M9.2 8.66v-2.26c0-.2.08-.34.24-.43l4.54-2.62c.62-.36 1.36-.52 2.12-.52 2.85 0 4.66 2.21 4.66 4.57 0 .16 0 .35-.02.54l-4.71-2.76a.8.8 0 0 0-.86 0L9.2 8.66zm10.61 8.8V12.06c0-.33-.14-.57-.43-.74l-5.97-3.47 1.95-1.12a.43.433 0 0 1 .48 0l4.54 2.62c1.3.76 2.19 2.38 2.19 3.95 0 1.8-1.07 3.47-2.76 4.16zM7.8 12.7L5.85 11.56c-.17-.1-.24-.24-.24-.43V5.9c0-2.55 1.95-4.47 4.59-4.47 1 0 1.93.33 2.71.93L8.23 5.07c-.28.16-.43.4-.43.74v6.9zM12 15.13l-2.8-1.57v-3.33L12 8.66l2.8 1.57v3.33L12 15.13zm1.8 7.23c-1 0-1.93-.33-2.72-.93l4.69-2.71c.28-.17.43-.4.43-.74v-6.9l1.97 1.14c.17.1.24.24.24.43v5.23c0 2.55-1.97 4.48-4.61 4.48zm-5.64-5.3L3.62 14.44c-1.3-.76-2.19-2.38-2.19-3.95A4.48 4.48 0 0 1 4.21 6.33v5.42c0 .33.14.57.43.74l5.95 3.45-1.95 1.12a.43.43 0 0 1-.48 0zm-.26 3.9c-2.69 0-4.66-2.02-4.66-4.52 0-.19.02-.38.05-.57l4.68 2.71c.29.17.57.17.86 0l5.97-3.45v2.26c0 .2-.07.33-.24.43l-4.54 2.62c-.62.35-1.36.52-2.12.52zm5.9 2.83a5.95 5.95 0 0 0 5.83-4.76C22.29 18.34 24 15.84 24 13.3c0-1.67-.71-3.28-2-4.45.12-.5.2-1 .2-1.5 0-3.4-2.76-5.95-5.95-5.95-.64 0-1.26.1-1.88.31A5.96 5.96 0 0 0 10.2 0a5.95 5.95 0 0 0-5.82 4.76C1.71 5.45 0 7.95 0 10.49c0 1.67.71 3.28 2 4.45-.12.5-.2 1-.2 1.5 0 3.4 2.76 5.95 5.95 5.95.64 0 1.26-.1 1.88-.31a5.96 5.96 0 0 0 4.16 1.71z"
    />
  ),
  'model-gemini': (
    <path
      fill="currentColor"
      fillRule="evenodd"
      d="M20.62 10.84a14.15 14.15 0 0 1-4.45-3 14.11 14.11 0 0 1-3.68-6.45.5.5 0 0 0-.98 0 14.13 14.13 0 0 1-3.68 6.45 14.16 14.16 0 0 1-4.45 3c-.65.28-1.32.5-2 .68a.5.5 0 0 0 0 .98c.68.17 1.35.4 2 .68a14.15 14.15 0 0 1 4.45 3 14.11 14.11 0 0 1 3.68 6.45.5.5 0 0 0 .98 0c.17-.68.4-1.35.68-2a14.15 14.15 0 0 1 3-4.45 14.11 14.11 0 0 1 6.45-3.68.5.5 0 0 0 0-.98 13.25 13.25 0 0 1-2-.68z"
    />
  ),
};

export function InkstoneIconSprite(): ReactElement {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {(Object.entries(ICON_PATHS) as [InkstoneIconName, ReactElement][]).map(
          ([name, content]) => (
            <symbol
              key={name}
              id={`ik-${name}`}
              viewBox={ICON_VIEWBOXES[name] ?? '0 0 16 16'}
            >
              {content}
            </symbol>
          ),
        )}
      </defs>
    </svg>
  );
}

export function Icon({
  name,
  extra = '',
}: {
  name: InkstoneIconName;
  extra?: string;
}): ReactElement {
  return (
    <svg className={`icon ${extra}`.trim()} aria-hidden="true">
      <use href={`#ik-${name}`} />
    </svg>
  );
}
