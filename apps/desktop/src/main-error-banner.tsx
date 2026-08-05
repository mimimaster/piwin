import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';

export type MainErrorBannerProps = {
  message: string | null;
  onDismiss: () => void;
};

/**
 * Persistent main-workspace error feedback.
 *
 * Errors stay visible until dismissed because they often require an action;
 * unlike success/info feedback, they must not disappear before the user can
 * understand or recover from them.
 */
export function MainErrorBanner(props: MainErrorBannerProps): ReactElement | null {
  if (!props.message) {
    return null;
  }

  return (
    <div className="main-error-banner" data-testid="main-error-banner" aria-live="assertive">
      <Notice
        tone="error"
        title="Action failed"
        action={
          <Button
            variant="ghost"
            size="compact"
            className="main-error-dismiss"
            data-testid="main-error-dismiss"
            onClick={props.onDismiss}
          >
            Dismiss
          </Button>
        }
      >
        {props.message}
      </Notice>
    </div>
  );
}
