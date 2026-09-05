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
  | 'close'
  | 'mic'
  | 'up'
  | 'pause'
  | 'image'
  | 'cards'
  | 'gear'
  | 'sliders'
  | 'bulb'
  | 'git';

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
};

export function InkstoneIconSprite(): ReactElement {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {(Object.entries(ICON_PATHS) as [InkstoneIconName, ReactElement][]).map(
          ([name, content]) => (
            <symbol key={name} id={`ik-${name}`} viewBox="0 0 16 16">
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
