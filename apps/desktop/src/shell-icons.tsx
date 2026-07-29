/** Inline outline icons for the desktop shell (no asset pipeline). */

import type { ReactElement, SVGProps, ImgHTMLAttributes } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

type ImageIconProps = ImgHTMLAttributes<HTMLImageElement>;

function IconBase(props: IconProps): ReactElement {
  const { children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconChat(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M6 5h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-6l-4 3v-3H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
    </IconBase>
  );
}

export function IconSideChat(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="3" y="4" width="14" height="12" rx="1.5" />
      <path d="M7 16v4l4-4h7a1.5 1.5 0 0 0 1.5-1.5V6.5A1.5 1.5 0 0 0 18 5H7a1.5 1.5 0 0 0-1.5 1.5v9c0 .8.7 1.5 1.5 1.5Z" />
    </IconBase>
  );
}

export function IconBrowser(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <ellipse cx="12" cy="12" rx="8.5" ry="3.2" />
      <path d="M12 3.5v17" />
    </IconBase>
  );
}

export function IconCanvas(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="3.5" width="14" height="14" rx="2" />
      <path d="M17.5 6.5l3-3" />
      <path d="M16 8l1.5-1.5" />
      <path d="M7 17l3-3 2.5 2.5" />
    </IconBase>
  );
}

export function IconFolder(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
    </IconBase>
  );
}

/** Folder with a plus badge — Cursor-style open workspace control. */
export function IconFolderPlus(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 7h6l2 2h8v10H4V7Z" />
      <path d="M12 12v5M9.5 14.5h5" />
    </IconBase>
  );
}

export function IconSpark(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      {/* Agent / product mark — prototype role icon */}
      <path d="M12 4c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z" />
    </IconBase>
  );
}

export function IconPlug(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M7 4v8a5 5 0 0 0 10 0V4" />
      <path d="M4 4v7a8 8 0 0 0 16 0V4M7 20h10" />
    </IconBase>
  );
}

/** Puzzle / extension pack */
export function IconExtension(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M8 4h3v3h2V4h3v5h-3v2h3v5h-3v3h-2v-3H8v-5h3V9H8V4Z" />
      <path d="M4 9h4v2H4V9Zm12 0h4v2h-4V9ZM4 14h4v2H4v-2Zm12 0h4v2h-4v-2Z" />
    </IconBase>
  );
}

/** Raster product icons generated for the desktop shell. These are kept
 * alongside the outline SVG set so existing call sites can swap cleanly. */
export function IconSkill(props: ImageIconProps): ReactElement {
  return (
    <img
      src="/ui/skill-icon.png"
      alt=""
      {...props}
      style={{ display: 'block', ...props.style }}
    />
  );
}

export function IconMcp(props: ImageIconProps): ReactElement {
  return (
    <img
      src="/ui/mcp-icon.png"
      alt=""
      {...props}
      style={{ display: 'block', ...props.style }}
    />
  );
}

export function IconSettings(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      {/* Sliders — product “tools / tuning” semantics (prototype §05). */}
      <path d="M4 7.5h16M4 16.5h16" />
      <circle cx="9.5" cy="7.5" r="2.4" fill="var(--canvas, currentColor)" stroke="currentColor" />
      <circle cx="15" cy="16.5" r="2.4" fill="var(--canvas, currentColor)" stroke="currentColor" />
    </IconBase>
  );
}

export function IconPlus(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M12 5v14M5 12h14" />
    </IconBase>
  );
}

export function IconSearch(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="10.5" cy="10.5" r="5.5" />
      <path d="M15 15l4.5 4.5" />
    </IconBase>
  );
}

export function IconSend(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M12 19V6M6.5 11.5 12 6l5.5 5.5" />
    </IconBase>
  );
}

export function IconGit(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="6" r="2.2" />
      <circle cx="6" cy="18" r="2.2" />
      <circle cx="18" cy="7" r="2.2" />
      <path d="M6 8.2v7.6" />
      <path d="M17.9 9.2c-.4 4.2-6.6 3.1-9.5 6.3" />
    </IconBase>
  );
}

export function IconPet(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="13" r="5" />
      <circle cx="7" cy="8" r="1.6" />
      <circle cx="12" cy="6" r="1.6" />
      <circle cx="17" cy="8" r="1.6" />
    </IconBase>
  );
}

export function IconPaperclip(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m9 8 6 6a3 3 0 0 1-4.2 4.2l-6.6-6.6a4.5 4.5 0 0 1 6.4-6.4l7.4 7.4a2 2 0 0 1-2.8 2.8L9 9" />
    </IconBase>
  );
}

export function IconStop(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="7.5" y="7.5" width="9" height="9" rx="2" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconMoon(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M19 14.5A7.5 7.5 0 1 1 9.5 5 6 6 0 0 0 19 14.5Z" />
    </IconBase>
  );
}

export function IconSun(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v1.5M12 19.5V21M3 12h1.5M19.5 12H21M5.6 5.6l1.1 1.1M17.3 17.3l1.1 1.1M18.4 5.6l-1.1 1.1M6.7 17.3l-1.1 1.1" />
    </IconBase>
  );
}

export function IconListTree(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
    </IconBase>
  );
}

export function IconUsers(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19c0-2.8 2.7-5 6-5s6 2.2 6 5" />
      <circle cx="17" cy="9" r="2.2" />
      <path d="M16 19c0-1.8 1.3-3.3 3-4" />
    </IconBase>
  );
}

export function IconCompress(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M8 4H4v4M16 4h4v4M8 20H4v-4M16 20h4v-4M9 9h6v6H9z" />
    </IconBase>
  );
}

export function IconChevronDown(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </IconBase>
  );
}

export function IconMore(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="5.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconTerminal(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5" />
    </IconBase>
  );
}

export function IconCopy(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="8" y="8" width="10" height="11" rx="1.5" />
      <path d="M16 8V6.5A1.5 1.5 0 0 0 14.5 5h-8A1.5 1.5 0 0 0 5 6.5v8A1.5 1.5 0 0 0 6.5 16H8" />
    </IconBase>
  );
}

export function IconRefresh(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M19 8a7 7 0 0 0-12.2-2L5 8" />
      <path d="M5 4v4h4M5 16a7 7 0 0 0 12.2 2L19 16" />
      <path d="M19 20v-4h-4" />
    </IconBase>
  );
}

export function IconPanelRight(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M14.5 5v14" />
    </IconBase>
  );
}

/** Window with an emphasized left navigator, used by the titlebar sidebar control. */
export function IconPanelLeft(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M9.5 5v14" />
    </IconBase>
  );
}

export function IconClose(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
    </IconBase>
  );
}

export function IconBack(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m14 5-7 7 7 7" />
      <path d="M7 12h12" />
    </IconBase>
  );
}

/** Compact titlebar history navigation controls. */
export function IconChevronLeft(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M14 6l-6 6 6 6" />
    </IconBase>
  );
}

export function IconChevronRight(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M10 6l6 6-6 6" />
    </IconBase>
  );
}


export function IconNote(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
    </IconBase>
  );
}

export function IconBook(props: IconProps): ReactElement {
  // Open-book / knowledge center glyph: two facing pages with a center seam.
  return (
    <IconBase {...props}>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5v-13Z" />
      <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5A1.5 1.5 0 0 0 20 18.5v-13Z" />
      <path d="M12 4v16" />
    </IconBase>
  );
}

export function IconCards(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <rect x="4" y="7" width="11.5" height="12.5" rx="1.5" />
      <path d="M8.5 4.5H18a1.5 1.5 0 0 1 1.5 1.5v9.5" />
    </IconBase>
  );
}

export function IconActivity(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M3.5 12h4l2.5-6 4 12 2.5-6h4" />
    </IconBase>
  );
}

export function IconPin(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M9.5 4.5h5l-.7 5.4 3.2 3.1H7l3.2-3.1z" />
      <path d="M12 13v6.5" />
    </IconBase>
  );
}

export function IconAgent(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M12 4c.6 3.6 2.4 5.4 6 6-3.6.6-5.4 2.4-6 6-.6-3.6-2.4-5.4-6-6 3.6-.6 5.4-2.4 6-6Z" />
    </IconBase>
  );
}

/** File leaf in trees (stroke only). */
export function IconFile(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M7 3.5h7l4.5 4.5V19a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h4.5" />
    </IconBase>
  );
}

/** Default / favorite mark (stroke star). */
export function IconStar(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m12 4.5 1.9 3.9 4.3.6-3.1 3 0.7 4.3L12 14.5l-3.8 2 0.7-4.3-3.1-3 4.3-.6z" />
    </IconBase>
  );
}
