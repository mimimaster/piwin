import type { ReactElement } from 'react';
import { Button, Notice } from '@piwin/ui-kit';
import {
  ContextMenuFromCatalog,
  useDesktopContextMenu,
  type ContextMenuTarget,
} from './context-menu';

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
 *
 * CM-13: right-click offers the `error` surface menu (Add to Chat / Explain
 * failure / Fix this error / Copy / Side Chat) so the user can hand the
 * failure straight to the agent.
 */
export function MainErrorBanner(props: MainErrorBannerProps): ReactElement | null {
  const contextMenu = useDesktopContextMenu();
  if (!props.message) {
    return null;
  }

  const errorTarget: ContextMenuTarget | null = contextMenu
    ? {
        surface: 'error',
        title: 'Action failed',
        detail: props.message,
        label: 'Action failed',
      }
    : null;

  const banner = (
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

  if (!errorTarget || !contextMenu) {
    return banner;
  }
  return (
    <ContextMenuFromCatalog
      testId="error-context-menu"
      target={errorTarget}
      caps={contextMenu.caps}
      dispatchers={contextMenu.dispatchers}
    >
      {banner}
    </ContextMenuFromCatalog>
  );
}
