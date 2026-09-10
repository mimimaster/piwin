import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type SessionArchivedBannerProps = {
  sessionName: string;
  onRestore: () => void;
  onNewAgent: () => void;
};

export function SessionArchivedBanner(props: SessionArchivedBannerProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  return (
    <Notice
      tone="info"
      title={isChinese ? '已归档' : 'Archived'}
      testId="session-archived-banner"
      action={
        <div className="run-status-actions">
          <Button
            size="compact"
            variant="primary"
            data-testid="session-restore-active-btn"
            onClick={props.onRestore}
          >
            {isChinese ? '恢复' : 'Restore'}
          </Button>
          <Button size="compact" onClick={props.onNewAgent}>
            {isChinese ? '新建对话' : 'New Agent'}
          </Button>
        </div>
      }
    >
      {isChinese
        ? `“${props.sessionName}” 的记录仍可查看。`
        : `“${props.sessionName}” — transcript stays visible here.`}
    </Notice>
  );
}
