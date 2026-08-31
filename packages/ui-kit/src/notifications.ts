import { createElement, type ReactNode } from 'react';
import { notifications } from '@mantine/notifications';

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

function renderToneIcon(tone: UiNotificationTone): ReactNode {
  switch (tone) {
    case 'error':
      return createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        createElement('circle', { cx: 12, cy: 12, r: 10 }),
        createElement('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
        createElement('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }),
      );
    case 'success':
      return createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2.2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        createElement('path', { d: 'M20 6 9 17l-5-5' }),
      );
    case 'warning':
      return createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        createElement('path', {
          d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z',
        }),
        createElement('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        createElement('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      );
    case 'info':
    default:
      return createElement(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: 16,
          height: 16,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        createElement('circle', { cx: 12, cy: 12, r: 10 }),
        createElement('line', { x1: 12, y1: 16, x2: 12, y2: 12 }),
        createElement('line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }),
      );
  }
}

/**
 * Product-facing notification entry point. Keeping Mantine behind ui-kit
 * prevents app packages from coupling themselves to a notification vendor.
 */
export function showUiNotification(input: UiNotificationInput): string {
  return notifications.show({
    ...(input.id !== undefined ? { id: input.id } : {}),
    message: input.message,
    color: MANTINE_NOTIFICATION_COLORS[input.tone],
    icon: input.icon ?? renderToneIcon(input.tone),
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
