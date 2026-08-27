import { type ReactElement } from 'react';
import { getIcon, type Icon } from 'material-file-icons';

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

const DEFAULT_FOLDER_SVG =
  '<svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="none"><path d="M2 4.2c0-.7.6-1.2 1.2-1.2h2.8c.4 0 .8.2 1 .5l.9 1h4.9c.7 0 1.2.6 1.2 1.2v5.9c0 .7-.6 1.2-1.2 1.2H3.2c-.7 0-1.2-.6-1.2-1.2V4.2Z" stroke="#A8823E" stroke-width="1.2" stroke-linejoin="round"/></svg>';

export function resolveFileTypeInfo(filePathOrExt: string): FileTypeInfo {
  const cleanPath = filePathOrExt.replace(/\\/g, '/');
  const cleanName = cleanPath.split('/').pop() || filePathOrExt;

  if (filePathOrExt.endsWith('/')) {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#A8823E', iconName: 'folder' };
  }

  const icon = getIcon(cleanName);
  if (!cleanName.includes('.') && icon.name === 'file') {
    return { ext: 'DIR', label: 'Folder', kind: 'folder', color: '#A8823E', iconName: 'folder' };
  }
  const extMatch = /\.([a-zA-Z0-9]+)$/.exec(cleanName);
  const ext = (extMatch?.[1] ?? cleanName).toUpperCase();

  let kind: FileTypeKind = 'generic';
  if (icon.name === 'react' || icon.name === 'react_ts') kind = 'react';
  else if (icon.name === 'typescript' || icon.name === 'tsconfig') kind = 'typescript';
  else if (icon.name === 'javascript' || icon.name === 'jsconfig') kind = 'javascript';
  else if (icon.name === 'python') kind = 'python';
  else if (icon.name === 'json' || icon.name === 'yaml') kind = 'json';
  else if (icon.name === 'css' || icon.name === 'sass' || icon.name === 'less') kind = 'css';
  else if (icon.name === 'markdown' || icon.name === 'readme') kind = 'markdown';
  else if (icon.name === 'html') kind = 'html';
  else if (icon.name === 'rust') kind = 'rust';
  else if (icon.name === 'go' || icon.name === 'go-mod') kind = 'go';
  else if (icon.name === 'console' || icon.name === 'powershell') kind = 'shell';
  else if (icon.name === 'image' || icon.name === 'favicon') kind = 'image';
  else if (icon.name === 'git') kind = 'git';
  else if (icon.name === 'npm' || icon.name === 'nodejs') kind = 'npm';
  else if (icon.name === 'pnpm') kind = 'pnpm';
  else if (icon.name === 'yarn') kind = 'yarn';
  else if (icon.name === 'eslint') kind = 'eslint';
  else if (icon.name === 'prettier') kind = 'prettier';
  else if (icon.name === 'settings' || icon.name === 'tune') kind = 'env';
  else if (icon.name === 'docker') kind = 'docker';
  else if (icon.name === 'test-ts' || icon.name === 'test-js') kind = 'vitest';
  else if (icon.name === 'svg') kind = 'svg';

  return {
    ext,
    label: icon.name,
    kind,
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
  const cleanPath = filePathOrExt.replace(/\\/g, '/');
  const cleanName = cleanPath.split('/').pop() || filePathOrExt;
  const isFolder = filePathOrExt.endsWith('/') || !cleanName.includes('.');

  const icon: Icon = isFolder
    ? { name: 'folder', svg: DEFAULT_FOLDER_SVG }
    : getIcon(cleanName);

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
