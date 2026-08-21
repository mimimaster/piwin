import { describe, expect, it, vi } from 'vitest';
import { notifications } from '@mantine/notifications';
import {
  hideUiNotification,
  showErrorNotification,
  showInfoNotification,
  showSuccessNotification,
  showUiNotification,
  showWarningNotification,
} from './notifications.js';

vi.mock('@mantine/notifications', () => ({
  notifications: {
    show: vi.fn(() => 'test-notification-id'),
    hide: vi.fn(),
  },
}));

describe('ui-kit notifications', () => {
  it('delegates showUiNotification to @mantine/notifications with tone color', () => {
    const id = showUiNotification({ tone: 'error', message: 'Something failed' });
    expect(id).toBe('test-notification-id');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Something failed',
        color: 'red',
      }),
    );
  });

  it('provides convenience helpers for error, success, info, and warning', () => {
    showErrorNotification('Error message', 'Error title');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Error message',
        title: 'Error title',
        color: 'red',
      }),
    );

    showSuccessNotification('Success message');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Success message',
        color: 'green',
      }),
    );

    showInfoNotification('Info message');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Info message',
        color: 'blue',
      }),
    );

    showWarningNotification('Warning message');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Warning message',
        color: 'yellow',
      }),
    );
  });

  it('delegates hideUiNotification to @mantine/notifications', () => {
    hideUiNotification('test-id');
    expect(notifications.hide).toHaveBeenCalledWith('test-id');
  });
});
