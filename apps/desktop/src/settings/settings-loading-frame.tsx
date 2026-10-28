/**
 * What settings shows while its chunk loads the first time: the page's own
 * frame (back, title, rows) instead of a black screen with a spinner. Lives
 * outside the lazy chunk so it can paint at once.
 */
import type { ReactElement } from 'react';
import { IconButton, Skeleton } from '@piwin/ui-kit';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { IconChevronLeft } from '../tool-cards/shell-icons';

const PLACEHOLDER_ROWS = [46, 88, 72, 64, 80] as const;

export function SettingsLoadingFrame(props: {
  locale: DesktopLocale;
  onClose: () => void;
}): ReactElement {
  const zh = props.locale === 'zh-CN';
  return (
    <div className="settings-loading-frame" data-testid="settings-loading-frame">
      <header className="settings-loading-frame-header">
        <IconButton label={zh ? '返回' : 'Back'} onClick={props.onClose}>
          <IconChevronLeft width={16} height={16} />
        </IconButton>
        <span className="settings-loading-frame-title">{zh ? '设置' : 'Settings'}</span>
      </header>
      <Skeleton
        label={zh ? '正在加载设置' : 'Loading settings'}
        rows={PLACEHOLDER_ROWS}
        className="settings-loading-frame-rows"
      />
    </div>
  );
}
