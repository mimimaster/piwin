import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type ProjectTrustNoticeProps = {
  projectPath: string;
  onTrust: () => void;
  onDismiss?: () => void;
};

export function ProjectTrustNotice(props: ProjectTrustNoticeProps): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  return (
    <Notice
      tone="warning"
      title={isChinese ? '需要信任' : 'Trust required'}
      testId="project-trust-notice"
      action={
        <div className="run-status-actions">
          <Button size="compact" variant="primary" data-testid="trust-inline-btn" onClick={props.onTrust}>
            {isChinese ? '信任此项目' : 'Trust project'}
          </Button>
          {props.onDismiss ? (
            <Button size="compact" onClick={props.onDismiss}>
              {isChinese ? '稍后再说' : 'Not now'}
            </Button>
          ) : null}
        </div>
      }
    >
      {isChinese ? (
        <>
          信任 <code>{props.projectPath}</code> 后才能运行 Agent 工具与 Shell。
        </>
      ) : (
        <>
          Trust <code>{props.projectPath}</code> to run Agent tools and Shell.
        </>
      )}
    </Notice>
  );
}
