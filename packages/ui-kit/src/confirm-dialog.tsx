import type { ReactElement, ReactNode } from 'react';
import { Button } from './button.js';
import { Dialog } from './dialog.js';

export type ConfirmDialogTone = 'danger' | 'default';

export type ConfirmDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  /** Object name shown for destructive context, e.g. session or server id. */
  affectedObject?: string | undefined;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmDialogTone;
  busy?: boolean;
  error?: string | null | undefined;
  onConfirm: () => void;
  testId?: string;
};

/**
 * Controlled confirmation dialog. Cancel receives default focus via native
 * button order; confirm never auto-fires. Host mutation stays in the consumer.
 */
export function ConfirmDialog(props: ConfirmDialogProps): ReactElement {
  const tone = props.tone ?? 'default';
  const confirmLabel = props.confirmLabel ?? 'Confirm';
  const cancelLabel = props.cancelLabel ?? 'Cancel';
  const busy = props.busy === true;

  return (
    <Dialog
      label={props.title}
      open={props.open}
      onOpenChange={(nextOpen) => {
        if (busy) {
          return;
        }
        props.onOpenChange(nextOpen);
      }}
      testId={props.testId ?? 'confirm-dialog'}
    >
      <h3>{props.title}</h3>
      <div className="ui-confirm-description muted">{props.description}</div>
      {props.affectedObject ? (
        <p className="ui-confirm-object">
          <code>{props.affectedObject}</code>
        </p>
      ) : null}
      {props.error ? (
        <div className="ui-notice tone-error" role="alert">
          {props.error}
        </div>
      ) : null}
      <div className="modal-actions">
        <Button
          data-testid="confirm-dialog-cancel"
          disabled={busy}
          onClick={() => props.onOpenChange(false)}
        >
          {cancelLabel}
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          data-testid="confirm-dialog-confirm"
          disabled={busy}
          onClick={() => {
            if (!busy) {
              props.onConfirm();
            }
          }}
        >
          {busy ? 'Working…' : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
