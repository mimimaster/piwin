import { useEffect, type ReactElement, type RefObject } from 'react';
import type { FlashcardTutorFace } from '@piwin/contracts';
import { IconSpark, Popover } from '@piwin/ui-kit';
import { shouldHandleSelectionInvokeKey, type CardTutorInvokeSource } from './card-selection-keys';
import { cardTutorCopy, primaryActionLabel } from './card-tutor-copy';

export function CardSelectionPopover(props: {
  open: boolean;
  locale: 'zh-CN' | 'en';
  face: FlashcardTutorFace;
  getAnchorRect: () => DOMRect;
  onInvoke: (source: CardTutorInvokeSource) => void;
  onDismiss: () => void;
  restoreFocus?: () => void;
  scopeRef?: RefObject<Element | null>;
}): ReactElement | null {
  const copy = cardTutorCopy(props.locale);
  const label = primaryActionLabel(props.locale, props.face);

  const { open, onInvoke, onDismiss, restoreFocus, scopeRef } = props;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
        restoreFocus?.();
        return;
      }
      if (!shouldHandleSelectionInvokeKey(event, scopeRef?.current ?? null)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onInvoke('keyboard');
    };
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target instanceof Element && target.closest('[data-testid="card-selection-popover"]')) {
        return;
      }
      onDismiss();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open, onDismiss, onInvoke, restoreFocus, scopeRef]);

  if (!props.open) return null;

  return (
    <Popover
      open={true}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          props.onDismiss();
          props.restoreFocus?.();
        }
      }}
      virtualAnchor={{ getBoundingClientRect: props.getAnchorRect }}
      side="top"
      align="center"
      contentClassName="fc-sel-popover"
      testId="card-selection-popover"
      label={copy.selectionPopover}
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        props.restoreFocus?.();
      }}
    >
      <button
        type="button"
        className="fc-sel-primary"
        data-testid="card-selection-primary"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          props.onInvoke('pointer');
        }}
      >
        <IconSpark width={14} height={14} />
        <span>{label}</span>
      </button>
    </Popover>
  );
}
