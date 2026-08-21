/**
 * Pure notification queue and dispatcher for desktop feedback (PD-UX-01).
 * Bridges desktop actions directly to `@piwin/ui-kit` (Mantine Notifications)
 * while maintaining a pure reducer for headless/testing state tracking.
 */
import {
  hideUiNotification,
  showUiNotification,
  type UiNotificationTone,
} from '@piwin/ui-kit';

export type NotificationLevel = 'info' | 'success' | 'warning' | 'error';

export type AppNotification = {
  id: string;
  level: NotificationLevel;
  message: string;
  createdAt: number;
  /** Auto-dismiss ms; 0 = sticky until user dismisses. */
  ttlMs: number;
};

export type NotificationState = {
  items: AppNotification[];
};

export type NotificationPushInput = {
  id?: string;
  level: NotificationLevel;
  message: string;
  /** Override default TTL for level; omit to use level defaults. */
  ttlMs?: number;
};

export type NotificationAction =
  | { type: 'notify/push'; notification: NotificationPushInput }
  | { type: 'notify/dismiss'; id: string }
  | { type: 'notify/clear' };

const DEFAULT_TTL: Record<NotificationLevel, number> = {
  info: 3000,
  success: 2200,
  warning: 5000,
  // Errors are important, but should not permanently cover the workspace.
  error: 6000,
};

const MAX_ITEMS = 5;

export function createEmptyNotificationState(): NotificationState {
  return { items: [] };
}

/**
 * Emit a toast notification through `@piwin/ui-kit` (Mantine Notifications).
 * Safely guards against non-DOM environments (e.g. tests without DOM).
 */
export function emitDesktopNotification(input: NotificationPushInput): string {
  const level = input.level;
  const ttlMs =
    typeof input.ttlMs === 'number' ? input.ttlMs : DEFAULT_TTL[level];

  try {
    return showUiNotification({
      tone: level as UiNotificationTone,
      message: input.message,
      autoClose: ttlMs > 0 ? ttlMs : false,
    });
  } catch {
    return input.id ?? `n-${Date.now()}`;
  }
}

export function dismissDesktopNotification(id: string): void {
  try {
    hideUiNotification(id);
  } catch {
    // Ignore if not in DOM or already dismissed
  }
}

export function notificationReducer(
  state: NotificationState,
  action: NotificationAction,
): NotificationState {
  switch (action.type) {
    case 'notify/push': {
      const level = action.notification.level;
      const ttlMs =
        typeof action.notification.ttlMs === 'number'
          ? action.notification.ttlMs
          : DEFAULT_TTL[level];
      const item: AppNotification = {
        id: action.notification.id ?? `n-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        level,
        message: action.notification.message,
        createdAt: Date.now(),
        ttlMs,
      };
      const items = [item, ...state.items].slice(0, MAX_ITEMS);
      return { items };
    }
    case 'notify/dismiss':
      return { items: state.items.filter((item) => item.id !== action.id) };
    case 'notify/clear':
      return { items: [] };
    default:
      return state;
  }
}

export function pushError(message: string): NotificationAction {
  return { type: 'notify/push', notification: { level: 'error', message } };
}

export function pushSuccess(message: string): NotificationAction {
  return { type: 'notify/push', notification: { level: 'success', message } };
}

export function pushInfo(message: string): NotificationAction {
  return { type: 'notify/push', notification: { level: 'info', message } };
}

export function pushWarning(message: string): NotificationAction {
  return { type: 'notify/push', notification: { level: 'warning', message } };
}
