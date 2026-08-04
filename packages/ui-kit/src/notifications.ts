import { notifications } from '@mantine/notifications';

export type UiNotificationTone = 'info' | 'success' | 'warning' | 'error';

export type UiNotificationInput = {
  tone: UiNotificationTone;
  title?: string;
  message: string;
  autoClose?: number | false;
  onClose?: () => void;
};

const MANTINE_NOTIFICATION_COLORS: Record<UiNotificationTone, string> = {
  info: 'blue',
  success: 'green',
  warning: 'yellow',
  error: 'red',
};

/**
 * Product-facing notification entry point. Keeping Mantine behind ui-kit
 * prevents app packages from coupling themselves to a notification vendor.
 */
export function showUiNotification(input: UiNotificationInput): string {
  return notifications.show({
    message: input.message,
    color: MANTINE_NOTIFICATION_COLORS[input.tone],
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.autoClose !== undefined ? { autoClose: input.autoClose } : {}),
    ...(input.onClose !== undefined ? { onClose: input.onClose } : {}),
  });
}

export function hideUiNotification(notificationId: string): void {
  notifications.hide(notificationId);
}
