/**
 * Inkstone call-chain glyphs — 16-grid, stroke 1.5, few paths.
 * Geometry mirrors docs/design/inkstone/proto-01-transcript.html symbols
 * so 14px rail icons share weight with search / brain / file.
 */
import type { ReactElement, ReactNode, SVGProps } from 'react';

export type ChainIconProps = SVGProps<SVGSVGElement> & {
  size?: number | string | undefined;
};

function ChainIcon(props: ChainIconProps & { children: ReactNode }): ReactElement {
  const { className = '', children, size = 14, width, height, ...rest } = props;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size ?? width ?? 14}
      height={size ?? height ?? 14}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Document with folded corner — read. */
export function ChainIconRead(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <path d="M4 2h5l3 3v9H4zM9 2v3h3" />
    </ChainIcon>
  );
}

/** Pencil — write / edit. */
export function ChainIconEdit(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <path d="M11.5 2.5l2 2L6 12H4v-2z" />
    </ChainIcon>
  );
}

/** Magnifier — grep / search / explore. */
export function ChainIconSearch(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L14 14" />
    </ChainIcon>
  );
}

/** Prompt chevron — bash / shell. Optically centered in the 16 box. */
export function ChainIconShell(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <path d="M4.5 4.5l4 3.5-4 3.5" />
      <path d="M9.5 11.5h3" />
    </ChainIcon>
  );
}

/** Two ports + bridge — MCP. */
export function ChainIconMcp(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <path d="M4 5v6M12 5v6" />
      <path d="M4 7h2.2a2 2 0 0 1 0 2H4M12 7H9.8a2 2 0 0 0 0 2H12" />
    </ChainIcon>
  );
}

/** External arrow — web fetch / browse. */
export function ChainIconWeb(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <path d="M7 3H3.5A1.5 1.5 0 0 0 2 4.5v8A1.5 1.5 0 0 0 3.5 14h8a1.5 1.5 0 0 0 1.5-1.5V9" />
      <path d="M9 2h5v5M14 2L7.5 8.5" />
    </ChainIcon>
  );
}

/** Two nodes on a stem — git. */
export function ChainIconGit(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <circle cx="8" cy="4" r="1.6" />
      <circle cx="8" cy="12" r="1.6" />
      <path d="M8 5.6v4.8" />
    </ChainIcon>
  );
}

/** Frame — image / video. */
export function ChainIconMedia(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <rect x="2.5" y="3.5" width="11" height="9" rx="1.5" />
      <path d="M2.5 10.5l3-2.5 2.5 2 3.5-3.5 2.5 2.5" />
    </ChainIcon>
  );
}

/** Compact pulse — other / unknown tool. */
export function ChainIconTool(props: ChainIconProps): ReactElement {
  return (
    <ChainIcon {...props}>
      <path d="M2.5 8h2.5l1.8-3.5L9.5 12l1.6-4H13.5" />
    </ChainIcon>
  );
}
