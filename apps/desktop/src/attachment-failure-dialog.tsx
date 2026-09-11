import type { ReactElement } from 'react';
import { Button, Dialog } from '@piwin/ui-kit';
import type { getDesktopCopy } from './desktop-locale';

export interface AttachmentFailureDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  failedCount: number;
  copy: ReturnType<typeof getDesktopCopy>['composer'];
  onDiscardAndSend: () => void;
  onRetryAndSend: () => void;
}

export function AttachmentFailureDialog({
  open,
  onOpenChange,
  failedCount,
  copy,
  onDiscardAndSend,
  onRetryAndSend,
}: AttachmentFailureDialogProps): ReactElement {
  return (
    <Dialog
      label={copy.attachmentFailureDialogTitle}
      open={open}
      onOpenChange={onOpenChange}
      testId="composer-attachment-failure-dialog"
    >
      <h3>{copy.attachmentFailureDialogTitle}</h3>
      <div className="ui-confirm-description muted">
        {copy.attachmentFailureDialogBody(failedCount)}
      </div>
      <div className="modal-actions">
        <Button
          data-testid="attachment-failure-cancel"
          onClick={() => onOpenChange(false)}
        >
          {copy.attachmentFailureBack}
        </Button>
        <Button
          data-testid="attachment-failure-send-rest"
          onClick={() => {
            onOpenChange(false);
            onDiscardAndSend();
          }}
        >
          {copy.attachmentFailureSendRest}
        </Button>
        <Button
          variant="primary"
          data-testid="attachment-failure-retry-send"
          autoFocus
          onClick={() => {
            onOpenChange(false);
            onRetryAndSend();
          }}
        >
          {copy.attachmentFailureRetrySend}
        </Button>
      </div>
    </Dialog>
  );
}
