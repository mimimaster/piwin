import { type ReactElement } from 'react';
import {
  IconBraces,
  IconBrandCss3,
  IconBrandGolang,
  IconBrandHtml5,
  IconBrandJavascript,
  IconBrandPython,
  IconBrandReact,
  IconBrandRust,
  IconFileText,
  IconFolder,
  IconHash,
  IconMarkdown,
  IconPhoto,
  IconTerminal2,
} from '@tabler/icons-react';

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
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#60a5fa' };
  }

  const extensionMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanName);
  const extension = (extensionMatch?.[1] ?? cleanName).toLowerCase();

  switch (extension) {
    case 'tsx':
    case 'jsx':
      return { ext: 'TSX', label: 'React', kind: 'react', color: '#38bdf8' };
    case 'ts':
    case 'cts':
    case 'mts':
      return { ext: 'TS', label: 'TypeScript', kind: 'typescript', color: '#3178c6' };
    case 'js':
    case 'mjs':
    case 'cjs':
      return { ext: 'JS', label: 'JavaScript', kind: 'javascript', color: '#facc15' };
    case 'py':
    case 'ipynb':
      return { ext: 'PY', label: 'Python', kind: 'python', color: '#3776ab' };
    case 'json':
    case 'jsonc':
    case 'yaml':
    case 'yml':
    case 'toml':
      return { ext: extension.toUpperCase(), label: 'JSON', kind: 'json', color: '#fbbf24' };
    case 'css':
    case 'scss':
    case 'less':
      return { ext: extension.toUpperCase(), label: 'CSS', kind: 'css', color: '#f472b6' };
    case 'md':
    case 'mdx':
    case 'markdown':
      return { ext: 'MD', label: 'Markdown', kind: 'markdown', color: '#34d399' };
    case 'html':
    case 'htm':
    case 'svg':
      return { ext: extension.toUpperCase(), label: 'HTML', kind: 'html', color: '#fb923c' };
    case 'rs':
      return { ext: 'RS', label: 'Rust', kind: 'rust', color: '#f97316' };
    case 'go':
      return { ext: 'GO', label: 'Go', kind: 'go', color: '#22d3ee' };
    case 'sh':
    case 'bash':
    case 'zsh':
      return { ext: 'SH', label: 'Shell', kind: 'shell', color: '#4ade80' };
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'webp':
    case 'gif':
      return { ext: 'IMG', label: 'Image', kind: 'image', color: '#e879f9' };
    default:
      return { ext: extension.toUpperCase(), label: 'File', kind: 'generic', color: '#94a3b8' };
  }
}

export type FileTypeIconProps = {
  filePathOrExt: string;
  className?: string | undefined;
};

export function FileTypeIcon({ filePathOrExt, className = '' }: FileTypeIconProps): ReactElement {
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
  const sharedProps = {
    className: `file-icon file-icon-${legacyClassByKind[fileTypeInfo.kind]} ${className}`,
    size: '1.1em',
    stroke: 1.8,
    color: fileTypeInfo.color,
    'aria-hidden': true,
  } as const;

  switch (fileTypeInfo.kind) {
    case 'react':
      return <IconBrandReact {...sharedProps} />;
    case 'typescript':
      return <IconHash {...sharedProps} />;
    case 'javascript':
      return <IconBrandJavascript {...sharedProps} />;
    case 'python':
      return <IconBrandPython {...sharedProps} />;
    case 'json':
      return <IconBraces {...sharedProps} />;
    case 'markdown':
      return <IconMarkdown {...sharedProps} />;
    case 'css':
      return <IconBrandCss3 {...sharedProps} />;
    case 'html':
      return <IconBrandHtml5 {...sharedProps} />;
    case 'rust':
      return <IconBrandRust {...sharedProps} />;
    case 'go':
      return <IconBrandGolang {...sharedProps} />;
    case 'shell':
      return <IconTerminal2 {...sharedProps} />;
    case 'image':
      return <IconPhoto {...sharedProps} />;
    case 'folder':
      return <IconFolder {...sharedProps} />;
    default:
      return <IconFileText {...sharedProps} />;
  }
}
