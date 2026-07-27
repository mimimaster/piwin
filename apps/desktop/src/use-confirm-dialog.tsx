/**
 * Local controlled confirm dialog state for panel mutations.
 */
import { useCallback, useState, type ReactElement } from 'react';
import { ConfirmDialog } from '@piwin/ui-kit';

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel?: string;
  affectedObject?: string;
  tone?: 'danger' | 'default';
};

export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = useCallback((next: ConfirmRequest): Promise<boolean> => {
    return new Promise((resolve) => {
      setRequest(next);
      setResolver(() => resolve);
    });
  }, []);

  const close = useCallback(
    (value: boolean) => {
      if (busy) {
        return;
      }
      setRequest(null);
      const current = resolver;
      setResolver(null);
      current?.(value);
    },
    [busy, resolver],
  );

  const dialog: ReactElement | null = request ? (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) {
          close(false);
        }
      }}
      title={request.title}
      description={request.description}
      affectedObject={request.affectedObject}
      confirmLabel={request.confirmLabel ?? 'Confirm'}
      tone={request.tone ?? 'danger'}
      busy={busy}
      onConfirm={() => close(true)}
    />
  ) : null;

  return {
    confirm,
    dialog,
    setBusy,
  };
}
