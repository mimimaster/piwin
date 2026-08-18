/**
 * Local controlled confirm dialog state for panel mutations.
 * Supports an optional "don't ask again" checkbox per skipKey —
 * once checked and confirmed, subsequent confirm() calls with the
 * same skipKey auto-resolve true for the lifetime of the component.
 */
import { useCallback, useRef, useState, type ReactElement } from 'react';
import { ConfirmDialog } from '@piwin/ui-kit';

export type ConfirmRequest = {
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  affectedObject?: string;
  tone?: 'danger' | 'default';
  /**
   * When set together with `dontAskAgainLabel`, enables the "don't ask again"
   * checkbox. After the user checks the box and confirms, future confirm()
   * calls with the same skipKey auto-resolve `true` without a dialog.
   */
  skipKey?: string | undefined;
  /** Label text for the "don't ask again" checkbox. */
  dontAskAgainLabel?: string | undefined;
};

export function useConfirmDialog() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [resolver, setResolver] = useState<((value: boolean) => void) | null>(null);
  const [busy, setBusy] = useState(false);
  /** Track which skipKeys the user opted to suppress. */
  const suppressedKeys = useRef<Set<string>>(new Set());
  /** Whether the current dialog has "don't ask again" checked. */
  const dontAskCheckedRef = useRef(false);

  const confirm = useCallback((next: ConfirmRequest): Promise<boolean> => {
    // Skip the dialog if the user already opted out for this key.
    if (next.skipKey && suppressedKeys.current.has(next.skipKey)) {
      return Promise.resolve(true);
    }
    dontAskCheckedRef.current = false;
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
      // If confirmed with "don't ask again" checked, suppress future dialogs.
      if (value && dontAskCheckedRef.current && request?.skipKey) {
        suppressedKeys.current.add(request.skipKey);
      }
      setRequest(null);
      const current = resolver;
      setResolver(null);
      current?.(value);
    },
    [busy, request, resolver],
  );

  /** Reset suppressed keys (e.g. when the user wants confirmations again). */
  const resetSuppressed = useCallback(() => {
    suppressedKeys.current.clear();
  }, []);

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
      confirmLabel={request.confirmLabel ?? 'Confirm'}
      tone={request.tone ?? 'danger'}
      busy={busy}
      onConfirm={() => close(true)}
      onDontAskAgainChange={(checked) => {
        dontAskCheckedRef.current = checked;
      }}
      {...(request.affectedObject ? { affectedObject: request.affectedObject } : {})}
      {...(request.cancelLabel ? { cancelLabel: request.cancelLabel } : {})}
      {...(request.dontAskAgainLabel ? { dontAskAgainLabel: request.dontAskAgainLabel } : {})}
    />
  ) : null;

  return {
    confirm,
    dialog,
    setBusy,
    resetSuppressed,
  };
}

