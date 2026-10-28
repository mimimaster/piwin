import { useRef, useState, type ComponentProps, type ReactElement } from 'react';
import { SwipeRow, type SwipeAction } from '@piwin/ui-kit';
import type { DesktopCopy } from '../i18n/desktop-locale';
import { usesOnScreenKeyboard } from '../tool-cards/shell-runtime';
import { SessionRowItem } from './session-row-item';

type SessionRowItemProps = ComponentProps<typeof SessionRowItem>;

export type SessionSwipeActionInput = {
  sessionId: string;
  isDraft: boolean;
  isPinned: boolean;
  isArchived: boolean;
  labels: DesktopCopy['sidebar']['swipe'];
  /** Opens the row's existing session menu. */
  onMore: () => void;
  onTogglePin?: ((sessionId: string, currentlyPinned: boolean) => void) | undefined;
  onArchiveSession?: ((sessionId: string) => void) | undefined;
  onUnarchiveSession?: ((sessionId: string) => void) | undefined;
  onDeleteSession?: ((sessionId: string) => void) | undefined;
};

/**
 * The same actions the row's hover cluster offers, laid out for a thumb:
 * live rows get more · pin · archive, archived rows get restore · delete.
 * Delete keeps going through the caller's confirmation.
 */
export function buildSessionSwipeActions(input: SessionSwipeActionInput): SwipeAction[] {
  if (input.isDraft) return [];
  const { labels, sessionId } = input;
  if (input.isArchived) {
    const actions: SwipeAction[] = [];
    if (input.onUnarchiveSession) {
      const restore = input.onUnarchiveSession;
      actions.push({
        key: 'restore',
        label: labels.restore,
        tone: 'accent',
        onPress: () => restore(sessionId),
      });
    }
    if (input.onDeleteSession) {
      const remove = input.onDeleteSession;
      actions.push({
        key: 'delete',
        label: labels.delete,
        tone: 'danger',
        onPress: () => remove(sessionId),
      });
    }
    return actions;
  }
  const actions: SwipeAction[] = [
    { key: 'more', label: labels.more, tone: 'neutral', onPress: input.onMore },
  ];
  if (input.onTogglePin) {
    const togglePin = input.onTogglePin;
    actions.push({
      key: 'pin',
      label: input.isPinned ? labels.unpin : labels.pin,
      tone: 'accent',
      onPress: () => togglePin(sessionId, input.isPinned),
    });
  }
  if (input.onArchiveSession) {
    const archive = input.onArchiveSession;
    actions.push({
      key: 'archive',
      label: labels.archive,
      tone: 'danger',
      onPress: () => archive(sessionId),
    });
  }
  return actions;
}

/**
 * Touch screens have no hover to reveal the row's action cluster and iOS
 * never fires a context menu, so on a coarse pointer the row slides left to
 * reveal its actions instead. Mouse-driven layouts render the plain row.
 */
export function SwipeableSessionRow(props: SessionRowItemProps): ReactElement {
  const [touch] = useState(() => usesOnScreenKeyboard());
  const anchorRef = useRef<HTMLDivElement | null>(null);
  if (!touch) return <SessionRowItem {...props} />;
  const { session } = props;
  const actions = buildSessionSwipeActions({
    sessionId: session.id,
    isDraft: 'isDraft' in session && session.isDraft === true,
    isPinned: 'isPinned' in session && session.isPinned === true,
    isArchived: 'isArchived' in session && session.isArchived === true,
    labels: props.copy.swipe,
    onMore: () => {
      // Same placement as the row's own menu button: under its right edge.
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect === undefined) return;
      props.onOpenSessionMenu(session.id, rect.right - 8, rect.bottom + 4);
    },
    onTogglePin: props.onTogglePin,
    onArchiveSession: props.onArchiveSession,
    onUnarchiveSession: props.onUnarchiveSession,
    onDeleteSession: props.onDeleteSession,
  });
  return (
    <div ref={anchorRef} className="session-row-swipe">
      <SwipeRow rowId={session.id} actions={actions}>
        <SessionRowItem {...props} hideActionCluster />
      </SwipeRow>
    </div>
  );
}
