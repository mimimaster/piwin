import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';

export type ProjectTrustNoticeProps = {
  projectPath: string;
  onTrust: () => void;
  onDismiss?: () => void;
};

export function ProjectTrustNotice(props: ProjectTrustNoticeProps): ReactElement {
  return (
    <Notice
      tone="warning"
      title="Trust required"
      testId="project-trust-notice"
      action={
        <div className="run-status-actions">
          <Button size="compact" variant="primary" data-testid="trust-inline-btn" onClick={props.onTrust}>
            Trust project
          </Button>
          {props.onDismiss ? (
            <Button size="compact" onClick={props.onDismiss}>
              Not now
            </Button>
          ) : null}
        </div>
      }
    >
      Agent tools and Shell preview stay blocked until you trust{' '}
      <code>{props.projectPath}</code>. Trust is project-scoped.
    </Notice>
  );
}
