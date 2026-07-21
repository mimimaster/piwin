/** Inline outline icons for the desktop shell (no asset pipeline). */

import type { ReactElement, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function IconBase(props: IconProps): ReactElement {
  const { children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.65}
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
      <path d="M5 5h14v10H9l-4 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </IconBase>
  );
}

export function IconFolder(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 7h6l2 2h8v10H4V7Z" />
      <path d="M4 9h16" />
    </IconBase>
  );
}

export function IconSpark(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m12 3 2.2 5.5L20 11l-5.8 2.5L12 19l-2.2-5.5L4 11l5.8-2.5L12 3Z" />
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

export function IconSettings(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6" />
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
      <circle cx="10.8" cy="10.8" r="6.5" />
      <path d="m16 16 4.5 4.5" />
    </IconBase>
  );
}

export function IconSend(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m5 12 14-7-4 14-3.5-6.5L5 12Z" />
      <path d="m11.5 12.5 3.5-1.5" />
    </IconBase>
  );
}

export function IconGit(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <circle cx="6" cy="18" r="2" />
      <path d="M6 8v8M6 12h8a4 4 0 0 1 4 4" />
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
      <rect x="7" y="7" width="10" height="10" rx="1.5" fill="currentColor" stroke="none" />
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
      <path d="m7 10 5 5 5-5" />
    </IconBase>
  );
}

export function IconMore(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </IconBase>
  );
}

export function IconTerminal(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="M4 6h16v12H4z" />
      <path d="m7 10 3 2-3 2M12 14h5" />
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

export function IconClose(props: IconProps): ReactElement {
  return (
    <IconBase {...props}>
      <path d="m6 6 12 12M18 6 6 18" />
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
