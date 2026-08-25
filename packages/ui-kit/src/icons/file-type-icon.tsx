import { type ReactElement } from 'react';

export type FileTypeKind =
  | 'react'
  | 'typescript'
  | 'javascript'
  | 'python'
  | 'json'
  | 'css'
  | 'markdown'
  | 'html'
  | 'rust'
  | 'go'
  | 'shell'
  | 'image'
  | 'folder'
  | 'generic';

export type FileTypeInfo = {
  ext: string;
  label: string;
  kind: FileTypeKind;
  color: string;
};

/**
 * Semantic palette, one luminance band (every value ≥3.5:1 on light
 * backgrounds — WCAG graphics threshold is 3:1). React shares the TypeScript
 * blue on purpose: .ts/.tsx/.jsx are one language family, and a separate teal
 * used to collide with Go/Markdown hues. See
 * docs/design/2026-08-13-icon-redesign-preview.html.
 */
const KIND_COLORS: Record<FileTypeKind, string> = {
  react: '#3178C6',
  typescript: '#3178C6',
  javascript: '#A87B14',
  python: '#5468C8',
  json: '#A87614',
  css: '#9256C4',
  markdown: '#4E8A75',
  html: '#C05A1E',
  rust: '#A85A32',
  go: '#0E8FA8',
  shell: '#3F8F52',
  image: '#A05590',
  folder: '#A8823E',
  generic: '#6E7780',
};

export function resolveFileTypeInfo(filePathOrExt: string): FileTypeInfo {
  const cleanName = filePathOrExt.split(/[\\/]/).pop() || filePathOrExt;
  if (filePathOrExt.endsWith('/') || !cleanName.includes('.')) {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: KIND_COLORS.folder };
  }

  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanName);
  const extension = (extensionMatch?.[1] ?? cleanName).toLowerCase();

  switch (extension) {
    case 'tsx':
      return { ext: 'TSX', label: 'React', kind: 'react', color: KIND_COLORS.react };
    case 'jsx':
      return { ext: 'JSX', label: 'React', kind: 'react', color: KIND_COLORS.react };
    case 'ts':
    case 'cts':
    case 'mts':
      return { ext: 'TS', label: 'TypeScript', kind: 'typescript', color: KIND_COLORS.typescript };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { ext: 'JS', label: 'JavaScript', kind: 'javascript', color: KIND_COLORS.javascript };
    case 'py':
    case 'ipynb':
      return { ext: 'PY', label: 'Python', kind: 'python', color: KIND_COLORS.python };
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
      return { ext: extension.toUpperCase(), label: 'JSON', kind: 'json', color: KIND_COLORS.json };
    case 'css':
    case 'scss':
    case 'less':
      return { ext: extension.toUpperCase(), label: 'CSS', kind: 'css', color: KIND_COLORS.css };
    case 'md':
    case 'mdx':
    case 'markdown':
      return { ext: 'MD', label: 'Markdown', kind: 'markdown', color: KIND_COLORS.markdown };
    case 'html':
    case 'htm':
    case 'svg':
      return { ext: extension.toUpperCase(), label: 'HTML', kind: 'html', color: KIND_COLORS.html };
    case 'rs':
      return { ext: 'RS', label: 'Rust', kind: 'rust', color: KIND_COLORS.rust };
    case 'go':
      return { ext: 'GO', label: 'Go', kind: 'go', color: KIND_COLORS.go };
    case 'sh':
    case 'bash':
    case 'zsh':
      return { ext: 'SH', label: 'Shell', kind: 'shell', color: KIND_COLORS.shell };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return { ext: 'IMG', label: 'Image', kind: 'image', color: KIND_COLORS.image };
    default:
      return { ext: extension.toUpperCase(), label: 'File', kind: 'generic', color: KIND_COLORS.generic };
  }
}

export type FileTypeIconProps = {
  filePathOrExt: string;
  className?: string | undefined;
  size?: string | number | undefined;
};

const MONO_STACK = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";

/**
 * Badge silhouette shared by every file-type mark: a 17×17 rounded tile at 15%
 * opacity. The constant silhouette is what makes the set read as icons —
 * letter marks of different lengths stay comparable because the container,
 * not the glyph, carries the size. Folder and generic stay stroke-only to
 * separate "container / unknown leaf" from known file types.
 */
const TILE_RX = 4.5;

/** Letter sizes tuned per length so 2- and 3-letter marks sit in one optical band (was 7.4 vs 5.9). */
function letterFontSize(label: string): number {
  if (label.length <= 1) return 9;
  if (label.length === 2) return 7.4;
  return 6.5;
}

function LetterMark({ label, color }: { label: string; color: string }): ReactElement {
  return (
    <text
      x="12"
      y="12.35"
      textAnchor="middle"
      dominantBaseline="central"
      fontFamily={MONO_STACK}
      fontWeight="700"
      fontSize={letterFontSize(label)}
      fill={color}
      stroke="none"
    >
      {label}
    </text>
  );
}

function StrokedGlyph({ d, color }: { d: string; color: string }): ReactElement {
  return (
    <path
      d={d}
      stroke={color}
      strokeWidth="1.5"
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

const GLYPH_PATHS: Partial<Record<FileTypeKind, string>> = {
  json:
    'M9.6 7.2c-1.2 0-1.8.62-1.8 1.8v1.5c0 .92-.5 1.53-1.45 1.75.95.22 1.45.83 1.45 1.75v1.5c0 1.18.6 1.8 1.8 1.8M14.4 7.2c1.2 0 1.8.62 1.8 1.8v1.5c0 .92.5 1.53 1.45 1.75-.95.22-1.45.83-1.45 1.75v1.5c0 1.18-.6 1.8-1.8 1.8',
  html: 'M9.3 8.7 6.3 12l3 3.3M14.7 8.7l3 3.3-3 3.3M13.1 7.5l-2.2 9',
  shell: 'M7.2 8.5l3.4 3.5-3.4 3.5M12.8 15.5h4.2',
};

function renderInner(kind: FileTypeKind, label: string, color: string): ReactElement {
  const glyphPath = GLYPH_PATHS[kind];
  if (glyphPath !== undefined) {
    return <StrokedGlyph d={glyphPath} color={color} />;
  }

  switch (kind) {
    case 'markdown':
      return (
        <>
          <text
            x="9.7"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="7.4"
            fill={color}
            stroke="none"
          >
            M
          </text>
          <path
            d="M15.4 9.3v4.3M13.6 11.9l1.8 1.9 1.8-1.9"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'image':
      return (
        <>
          <circle cx="9.4" cy="9.4" r="1.3" fill={color} stroke="none" />
          <path
            d="M6.1 16.8l3.1-3.1a1.2 1.2 0 0 1 1.7 0l3.9 3.9M13.4 15.4l1.2-1.2a1.2 1.2 0 0 1 1.7 0l1.6 1.6"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </>
      );
    case 'folder':
      return (
        <StrokedGlyph
          color={color}
          d="M3.75 6.9c0-1.2.95-2.15 2.15-2.15h3.2c.57 0 1.12.23 1.52.63l1.3 1.32h6.18c1.2 0 2.15.96 2.15 2.15v8.35c0 1.2-.96 2.15-2.15 2.15H5.9c-1.2 0-2.15-.96-2.15-2.15Z"
        />
      );
    case 'generic':
      return (
        <>
          <path
            d="M13.6 3.75H8.15c-1.16 0-2.1.94-2.1 2.1v12.3c0 1.16.94 2.1 2.1 2.1h7.7c1.16 0 2.1-.94 2.1-2.1V8.1Z"
            stroke={color}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M13.6 3.75V8.1h4.35"
            stroke={color}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            opacity=".5"
          />
        </>
      );
    default:
      return <LetterMark label={label} color={color} />;
  }
}

const LEGACY_CLASS_BY_KIND: Record<FileTypeKind, string> = {
  react: 'react',
  typescript: 'ts',
  javascript: 'js',
  python: 'python',
  json: 'json',
  css: 'css',
  markdown: 'md',
  html: 'html',
  rust: 'rust',
  go: 'go',
  shell: 'shell',
  image: 'img',
  folder: 'folder',
  generic: 'generic',
};

export function FileTypeIcon({ filePathOrExt, className = '', size = '1.1em' }: FileTypeIconProps): ReactElement {
  const fileTypeInfo = resolveFileTypeInfo(filePathOrExt);
  const color = fileTypeInfo.color;
  const hasTile = fileTypeInfo.kind !== 'folder' && fileTypeInfo.kind !== 'generic';

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={`file-icon file-icon-${LEGACY_CLASS_BY_KIND[fileTypeInfo.kind]} ${className}`.trim()}
      aria-hidden={true}
    >
      {hasTile ? (
        <rect x="3.5" y="3.5" width="17" height="17" rx={TILE_RX} fill={color} opacity=".15" stroke="none" />
      ) : null}
      {renderInner(fileTypeInfo.kind, fileTypeInfo.ext, color)}
    </svg>
  );
}
