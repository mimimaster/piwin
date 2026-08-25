import { type ReactElement } from 'react';
import { DropdownMenu, DropdownMenuItem, FileTypeIcon, IconButton } from '@piwin/ui-kit';
import { IconArrowLeft, IconCopy, IconLink, IconMore } from './shell-icons';
import {
  formatDisplayPathParts,
  resolveChangeStatusInfo,
} from './truncate-relative-path';

export type ChangeFileHeaderProps = {
  relativePath: string;
  projectPath: string;
  status?: string | undefined;
  additions?: number | undefined;
  deletions?: number | undefined;
  locale?: 'zh-CN' | 'en' | undefined;
  onBack: () => void;
};

export function ChangeFileHeader(props: ChangeFileHeaderProps): ReactElement {
  const isZh = props.locale === 'zh-CN';
  const parts = formatDisplayPathParts(props.relativePath, props.projectPath);
  const statusInfo = props.status ? resolveChangeStatusInfo(props.status, props.locale) : null;
  const adds = props.additions ?? 0;
  const dels = props.deletions ?? 0;

  const absolutePath = props.projectPath
    ? `${props.projectPath.replace(/[\\/]+$/, '')}/${props.relativePath}`
    : props.relativePath;

  function handleCopyRelative(): void {
    void navigator.clipboard?.writeText(props.relativePath);
  }

  function handleCopyAbsolute(): void {
    void navigator.clipboard?.writeText(absolutePath);
  }

  return (
    <header className="change-file-header" data-testid="change-file-header">
      <div className="change-file-header-left">
        <IconButton
          label={isZh ? '返回全部变更' : 'Back to all changes'}
          title={isZh ? '返回全部变更' : 'Back to all changes'}
          data-testid="change-file-back"
          onClick={props.onBack}
        >
          <IconArrowLeft width={14} height={14} />
        </IconButton>

        <FileTypeIcon filePathOrExt={props.relativePath} className="change-file-icon" />

        <div className="change-file-path-group" title={props.relativePath}>
          {parts.dirPath ? (
            <span className="change-file-path-dir">{parts.dirPath}</span>
          ) : null}
          <span className="change-file-path-name">{parts.fileName}</span>
        </div>

        {adds > 0 || dels > 0 ? (
          <span className="change-file-stats" data-testid="change-file-stats">
            {adds > 0 ? <span className="add">+{adds}</span> : null}
            {dels > 0 ? <span className="del">−{dels}</span> : null}
          </span>
        ) : null}

        {statusInfo ? (
          <span
            className={`change-file-status-badge status-${props.status}`}
            data-testid="change-file-status-badge"
          >
            {statusInfo.label}
          </span>
        ) : null}
      </div>

      <div className="change-file-header-actions">
        <DropdownMenu
          trigger={
            <IconButton
              label={isZh ? '更多选项' : 'More options'}
              title={isZh ? '更多选项' : 'More options'}
              data-testid="change-file-menu-trigger"
            >
              <IconMore width={14} height={14} />
            </IconButton>
          }
        >
          <DropdownMenuItem onSelect={handleCopyRelative} testId="change-file-menu-copy-relative">
            <span className="doc-menu-item-content">
              <IconCopy width={14} height={14} /> {isZh ? '复制相对路径' : 'Copy Relative Path'}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleCopyAbsolute} testId="change-file-menu-copy-absolute">
            <span className="doc-menu-item-content">
              <IconLink width={14} height={14} /> {isZh ? '复制绝对路径' : 'Copy Absolute Path'}
            </span>
          </DropdownMenuItem>
        </DropdownMenu>
      </div>
    </header>
  );
}
