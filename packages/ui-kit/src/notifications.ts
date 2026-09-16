import type { ReactNode } from 'react';
import { notifications } from '@mantine/notifications';
import { renderToneSealIcon } from './tone-icon.js';

export type UiNotificationTone = 'info' | 'success' | 'warning' | 'error';

export type UiNotificationInput = {
  id?: string;
  tone: UiNotificationTone;
  title?: string;
  message: string;
  icon?: ReactNode;
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
 *
 * `mod` stamps `data-tone` on the notification root so the shared toast CSS
 * can paint the Inkstone tone palette. It goes through `mod` rather than
 * `className` because a caller-supplied className replaces the one the
 * Notifications container assigns.
 */
export function showUiNotification(input: UiNotificationInput): string {
  return notifications.show({
    ...(input.id !== undefined ? { id: input.id } : {}),
    message: input.message,
    color: MANTINE_NOTIFICATION_COLORS[input.tone],
    mod: { tone: input.tone },
    icon: input.icon ?? renderToneSealIcon(input.tone),
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.autoClose !== undefined ? { autoClose: input.autoClose } : {}),
    ...(input.onClose !== undefined ? { onClose: input.onClose } : {}),
  });
}

export function hideUiNotification(notificationId: string): void {
  notifications.hide(notificationId);
}

export function showErrorNotification(message: string, title?: string): string {
  return showUiNotification({
    tone: 'error',
    message,
    ...(title !== undefined ? { title } : {}),
    autoClose: 6000,
  });
}

export function showSuccessNotification(message: string, title?: string): string {
  return showUiNotification({
    tone: 'success',
    message,
    ...(title !== undefined ? { title } : {}),
    autoClose: 2500,
  });
}

export function showInfoNotification(message: string, title?: string): string {
  return showUiNotification({
    tone: 'info',
    message,
    ...(title !== undefined ? { title } : {}),
    autoClose: 3500,
  });
}

export function showWarningNotification(message: string, title?: string): string {
  return showUiNotification({
    tone: 'warning',
    message,
    ...(title !== undefined ? { title } : {}),
    autoClose: 5000,
  });
}
