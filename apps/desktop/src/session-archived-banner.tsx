import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';

export type SessionArchivedBannerProps = {
  sessionName: string;
  onRestore: () => void;
  onNewAgent: () => void;
};

export function SessionArchivedBanner(props: SessionArchivedBannerProps): ReactElement {
  return (
    <Notice
      tone="info"
      title="Archived"
      testId="session-archived-banner"
      action={
        <div className="run-status-actions">
          <Button
            size="compact"
            variant="primary"
            data-testid="session-restore-active-btn"
            onClick={props.onRestore}
          >
            Restore
          </Button>
          <Button size="compact" onClick={props.onNewAgent}>
            New Agent
          </Button>
        </div>
      }
    >
      “{props.sessionName}” is archived. The transcript stays visible here until you restore it or start a
      new agent.
    </Notice>
  );
}
