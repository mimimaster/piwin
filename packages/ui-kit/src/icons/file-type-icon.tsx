import { useEffect, useState, type ReactElement } from 'react';

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
  | 'generic'
  | 'git'
  | 'npm'
  | 'pnpm'
  | 'yarn'
  | 'eslint'
  | 'prettier'
  | 'env'
  | 'docker'
  | 'vitest'
  | 'svg';

export type FileTypeInfo = {
  ext: string;
  label: string;
  kind: FileTypeKind;
  color: string;
  iconName: string;
};

type MaterialIcon = { name: string; svg: string };
type GetIcon = (fileName: string) => MaterialIcon;

const DEFAULT_FOLDER_SVG =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none"><path d="M2 4.2c0-.7.6-1.2 1.2-1.2h2.8c.4 0 .8.2 1 .5l.9 1h4.9c.7 0 1.2.6 1.2 1.2v5.9c0 .7-.6 1.2-1.2 1.2H3.2c-.7 0-1.2-.6-1.2-1.2V4.2Z" stroke="#A8823E" stroke-width="1.2" stroke-linejoin="round"/></svg>';

const DEFAULT_FILE_SVG =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none"><path d="M4 1.5h5.2L12.5 5v9.5H4V1.5Z" stroke="#64748b" stroke-width="1.2" stroke-linejoin="round"/><path d="M9 1.5V5h3.5" stroke="#64748b" stroke-width="1.2" stroke-linejoin="round"/></svg>';

let getIconImpl: GetIcon | null = null;
let iconsLoad: Promise<GetIcon> | null = null;

/** Load material-file-icons once. Tests call this before sync renderToStaticMarkup. */
export function loadMaterialFileIcons(): Promise<GetIcon> {
  if (getIconImpl) return Promise.resolve(getIconImpl);
  if (!iconsLoad) {
    iconsLoad = import('material-file-icons').then((module) => {
      getIconImpl = module.getIcon as GetIcon;
      return getIconImpl;
    });
  }
  return iconsLoad;
}

export function areMaterialFileIconsReady(): boolean {
  return getIconImpl !== null;
}

function kindFromIconName(name: string): FileTypeKind {
  if (name === 'react' || name === 'react_ts') return 'react';
  if (name === 'typescript' || name === 'tsconfig') return 'typescript';
  if (name === 'javascript' || name === 'jsconfig') return 'javascript';
  if (name === 'python') return 'python';
  if (name === 'json' || name === 'yaml') return 'json';
  if (name === 'css' || name === 'sass' || name === 'less') return 'css';
  if (name === 'markdown' || name === 'readme') return 'markdown';
  if (name === 'html') return 'html';
  if (name === 'rust') return 'rust';
  if (name === 'go' || name === 'go-mod') return 'go';
  if (name === 'console' || name === 'powershell') return 'shell';
  if (name === 'image' || name === 'favicon') return 'image';
  if (name === 'git') return 'git';
  if (name === 'npm' || name === 'nodejs') return 'npm';
  if (name === 'pnpm') return 'pnpm';
  if (name === 'yarn') return 'yarn';
  if (name === 'eslint') return 'eslint';
  if (name === 'prettier') return 'prettier';
  if (name === 'settings' || name === 'tune') return 'env';
  if (name === 'docker') return 'docker';
  if (name === 'test-ts' || name === 'test-js') return 'vitest';
  if (name === 'svg') return 'svg';
  return 'generic';
}

export function resolveFileTypeInfo(filePathOrExt: string): FileTypeInfo {
  const cleanPath = filePathOrExt.replace(/\\/g, '/');
  const cleanName = cleanPath.split('/').pop() || filePathOrExt;

  if (filePathOrExt.endsWith('/')) {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#A8823E', iconName: 'folder' };
  }

  if (!getIconImpl) {
    void loadMaterialFileIcons();
    const extMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanName);
    const ext = (extMatch?.[1] ?? cleanName).toUpperCase();
    if (!cleanName.includes('.')) {
      return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#A8823E', iconName: 'folder' };
    }
    return { ext, label: cleanName, kind: 'generic', color: '#3178C6', iconName: 'file' };
  }

  const icon = getIconImpl(cleanName);
  if (!cleanName.includes('.') && icon.name === 'file') {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#A8823E', iconName: 'folder' };
  }
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanName);
  const ext = (extMatch?.[1] ?? cleanName).toUpperCase();

  return {
    ext,
    label: icon.name,
    kind: kindFromIconName(icon.name),
    color: '#3178C6',
    iconName: icon.name,
  };
}

export type FileTypeIconProps = {
  filePathOrExt: string;
  className?: string | undefined;
  size?: string | number | undefined;
};

export function FileTypeIcon({
  filePathOrExt,
  className = '',
  size = '1.1em',
}: FileTypeIconProps): ReactElement {
  const [, setReady] = useState(() => areMaterialFileIconsReady());
  useEffect(() => {
    if (areMaterialFileIconsReady()) return undefined;
    let cancelled = false;
    void loadMaterialFileIcons().then(() => {
      if (!cancelled) setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const cleanPath = filePathOrExt.replace(/\\/g, '/');
  const cleanName = cleanPath.split('/').pop() || filePathOrExt;
  const isFolder = filePathOrExt.endsWith('/') || !cleanName.includes('.');

  const icon: MaterialIcon = isFolder
    ? { name: 'folder', svg: DEFAULT_FOLDER_SVG }
    : getIconImpl
      ? getIconImpl(cleanName)
      : { name: 'file', svg: DEFAULT_FILE_SVG };

  const styleSize = typeof size === 'number' ? `${size}px` : size;

  return (
    <span
      className={`file-icon file-icon-${icon.name} ${className}`.trim()}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: styleSize,
        height: styleSize,
        flexShrink: 0,
      }}
      aria-hidden={true}
      dangerouslySetInnerHTML={{ __html: icon.svg }}
    />
  );
}
