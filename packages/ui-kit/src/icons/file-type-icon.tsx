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

export function resolveFileTypeInfo(filePathOrExt: string): FileTypeInfo {
  const cleanName = filePathOrExt.split(/[\\/]/).pop() || filePathOrExt;
  if (filePathOrExt.endsWith('/') || !cleanName.includes('.')) {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#D8B078' };
  }

  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanName);
  const extension = (extensionMatch?.[1] ?? cleanName).toLowerCase();

  switch (extension) {
    case 'tsx':
    case 'jsx':
      return { ext: 'TSX', label: 'React', kind: 'react', color: '#52C0D4' };
    case 'ts':
    case 'cts':
    case 'mts':
      return { ext: 'TS', label: 'TypeScript', kind: 'typescript', color: '#5B9DE8' };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { ext: 'JS', label: 'JavaScript', kind: 'javascript', color: '#E0BE55' };
    case 'py':
    case 'ipynb':
      return { ext: 'PY', label: 'Python', kind: 'python', color: '#7A8FE0' };
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
      return { ext: extension.toUpperCase(), label: 'JSON', kind: 'json', color: '#D9A648' };
    case 'css':
    case 'scss':
    case 'less':
      return { ext: extension.toUpperCase(), label: 'CSS', kind: 'css', color: '#BC8BE0' };
    case 'md':
    case 'mdx':
    case 'markdown':
      return { ext: 'MD', label: 'Markdown', kind: 'markdown', color: '#8FBFB0' };
    case 'html':
    case 'htm':
    case 'svg':
      return { ext: extension.toUpperCase(), label: 'HTML', kind: 'html', color: '#E0855C' };
    case 'rs':
      return { ext: 'RS', label: 'Rust', kind: 'rust', color: '#D68F6C' };
    case 'go':
      return { ext: 'GO', label: 'Go', kind: 'go', color: '#5FC4CC' };
    case 'sh':
    case 'bash':
    case 'zsh':
      return { ext: 'SH', label: 'Shell', kind: 'shell', color: '#7FC487' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return { ext: 'IMG', label: 'Image', kind: 'image', color: '#C687B6' };
    default:
      return { ext: extension.toUpperCase(), label: 'File', kind: 'generic', color: '#98A0A8' };
  }
}

export type FileTypeIconProps = {
  filePathOrExt: string;
  className?: string | undefined;
  size?: string | number | undefined;
};

const MONO_STACK = "'SF Mono', ui-monospace, Menlo, Consolas, monospace";

export function FileTypeIcon({ filePathOrExt, className = '', size = '1.1em' }: FileTypeIconProps): ReactElement {
  const fileTypeInfo = resolveFileTypeInfo(filePathOrExt);
  const legacyClassByKind: Record<FileTypeKind, string> = {
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
  const color = fileTypeInfo.color;

  const svgProps = {
    viewBox: '0 0 24 24',
    width: size,
    height: size,
    fill: 'none',
    className: `file-icon file-icon-${legacyClassByKind[fileTypeInfo.kind]} ${className}`.trim(),
    'aria-hidden': true,
  } as const;

  function renderInner(): ReactElement {
    switch (fileTypeInfo.kind) {
      case 'react':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="5.9"
            fill={color}
            stroke="none"
          >
            TSX
          </text>
        );
      case 'typescript':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="7.4"
            fill={color}
            stroke="none"
          >
            TS
          </text>
        );
      case 'javascript':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="7.4"
            fill={color}
            stroke="none"
          >
            JS
          </text>
        );
      case 'python':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="7.4"
            fill={color}
            stroke="none"
          >
            PY
          </text>
        );
      case 'rust':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="7.4"
            fill={color}
            stroke="none"
          >
            RS
          </text>
        );
      case 'go':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="7.4"
            fill={color}
            stroke="none"
          >
            GO
          </text>
        );
      case 'css':
        return (
          <text
            x="12"
            y="12.35"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily={MONO_STACK}
            fontWeight="700"
            fontSize="5.9"
            fill={color}
            stroke="none"
          >
            CSS
          </text>
        );
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
      case 'json':
        return (
          <path
            d="M9.6 7.2c-1.2 0-1.8.62-1.8 1.8v1.5c0 .92-.5 1.53-1.45 1.75.95.22 1.45.83 1.45 1.75v1.5c0 1.18.6 1.8 1.8 1.8M14.4 7.2c1.2 0 1.8.62 1.8 1.8v1.5c0 .92.5 1.53 1.45 1.75-.95.22-1.45.83-1.45 1.75v1.5c0 1.18-.6 1.8-1.8 1.8"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'html':
        return (
          <path
            d="M9.3 8.7 6.3 12l3 3.3M14.7 8.7l3 3.3-3 3.3M13.1 7.5l-2.2 9"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'shell':
        return (
          <path
            d="M7.2 8.5l3.4 3.5-3.4 3.5M12.8 15.5h4.2"
            stroke={color}
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
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
          <path
            d="M3.75 6.9c0-1.2.95-2.15 2.15-2.15h3.2c.57 0 1.12.23 1.52.63l1.3 1.32h6.18c1.2 0 2.15.96 2.15 2.15v8.35c0 1.2-.96 2.15-2.15 2.15H5.9c-1.2 0-2.15-.96-2.15-2.15Z"
            stroke={color}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'generic':
      default:
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
    }
  }

  return <svg {...svgProps}>{renderInner()}</svg>;
}
