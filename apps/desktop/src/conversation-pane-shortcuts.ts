import type {
  ConversationPaneDirection,
  ConversationPaneOrientation,
} from './conversation-pane-layout.js';

export type ConversationPaneShortcutCommand =
  | { type: 'split'; orientation: ConversationPaneOrientation }
  | { type: 'focus-adjacent'; offset: -1 | 1 }
  | { type: 'focus-direction'; direction: ConversationPaneDirection }
  | { type: 'resize'; direction: ConversationPaneDirection }
  | { type: 'maximize' }
  | { type: 'close' };

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'
>;

function arrowDirection(key: string): ConversationPaneDirection | null {
  switch (key) {
    case 'ArrowLeft':
      return 'left';
    case 'ArrowRight':
      return 'right';
    case 'ArrowUp':
      return 'up';
    case 'ArrowDown':
      return 'down';
    default:
      return null;
  }
}

function hasSinglePrimaryModifier(event: ShortcutEvent): boolean {
  return event.metaKey !== event.ctrlKey;
}

export function resolveConversationPaneShortcut(
  event: ShortcutEvent,
): ConversationPaneShortcutCommand | null {
  const primary = event.metaKey || event.ctrlKey;
  if (!primary) return null;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const direction = arrowDirection(key);
  const singlePrimary = hasSinglePrimaryModifier(event);

  const macResize = event.metaKey && event.ctrlKey && !event.altKey && !event.shiftKey;
  const pcResize = !event.metaKey && event.ctrlKey && event.altKey && event.shiftKey;
  if (direction && (macResize || pcResize)) {
    return { type: 'resize', direction };
  }
  if (direction && event.altKey && singlePrimary && !event.shiftKey) {
    return { type: 'focus-direction', direction };
  }
  if (key === 'd' && !event.altKey && singlePrimary && !event.repeat) {
    return { type: 'split', orientation: event.shiftKey ? 'column' : 'row' };
  }
  if (key === '[' && !event.altKey && !event.shiftKey && singlePrimary) {
    return { type: 'focus-adjacent', offset: -1 };
  }
  if (key === ']' && !event.altKey && !event.shiftKey && singlePrimary) {
    return { type: 'focus-adjacent', offset: 1 };
  }
  if (key === 'Enter' && event.shiftKey && !event.altKey && singlePrimary && !event.repeat) {
    return { type: 'maximize' };
  }
  if (key === 'w' && event.altKey && !event.shiftKey && singlePrimary && !event.repeat) {
    return { type: 'close' };
  }
  return null;
}
