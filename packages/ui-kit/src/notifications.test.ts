import { isValidElement, type ReactElement, type ReactNode } from 'react';
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

type ActionButtonProps = {
  type?: string;
  className?: string;
  'data-tone'?: string;
  onClick?: () => void;
  children?: ReactNode;
};

function getActionButton(message: ReactNode): ReactElement<ActionButtonProps> {
  if (!isValidElement(message)) {
    throw new Error('expected wrapped notification message');
  }
  const children = (message.props as { children?: ReactNode }).children;
  const list = Array.isArray(children) ? children : [children];
  const button = list.find(
    (child): child is ReactElement<ActionButtonProps> =>
      isValidElement(child) && child.type === 'button',
  );
  if (!button) {
    throw new Error('expected action button');
  }
  return button;
}

describe('ui-kit notifications', () => {
  it('delegates showUiNotification to @mantine/notifications with tone color', () => {
    const id = showUiNotification({ tone: 'error', message: 'Something failed' });
    expect(id).toBe('test-notification-id');
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Something failed',
        color: 'red',
        mod: { tone: 'error' },
      }),
    );
  });

  it('stamps data-tone through mod so the shared toast CSS can paint the tone', () => {
    showUiNotification({ tone: 'warning', message: 'Careful' });
    expect(notifications.show).toHaveBeenCalledWith(
      expect.objectContaining({ mod: { tone: 'warning' } }),
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

  it('renders an action button that runs onClick then closes the notification', () => {
    vi.mocked(notifications.show).mockClear();
    vi.mocked(notifications.hide).mockClear();
    const onClick = vi.fn();

    showUiNotification({
      id: 'notice-1',
      tone: 'info',
      message: 'Turn finished',
      action: { label: 'Open', onClick },
    });

    const payload = vi.mocked(notifications.show).mock.calls[0]?.[0] as {
      id?: string;
      message: ReactNode;
      color?: string;
      mod?: { tone?: string };
    };
    expect(payload.id).toBe('notice-1');
    expect(payload.color).toBe('blue');
    expect(payload.mod).toEqual({ tone: 'info' });

    const msgSpan = (payload.message as ReactElement<{ children: ReactNode[] }>).props.children.find(
      (child): child is ReactElement<{ className?: string; children?: ReactNode }> =>
        isValidElement(child) && child.type === 'span',
    );
    expect(msgSpan?.props.className).toBe('ui-notification-action-message');
    expect(msgSpan?.props.children).toBe('Turn finished');

    const button = getActionButton(payload.message);
    expect(button.props.type).toBe('button');
    expect(button.props.className).toBe('ui-notification-action');
    expect(button.props['data-tone']).toBe('info');
    expect(button.props.children).toBe('Open');

    button.props.onClick?.();
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(notifications.hide).toHaveBeenCalledTimes(1);
    expect(notifications.hide).toHaveBeenCalledWith('notice-1');
    const clickOrder = onClick.mock.invocationCallOrder[0];
    const hideOrder = vi.mocked(notifications.hide).mock.invocationCallOrder[0];
    if (clickOrder === undefined || hideOrder === undefined) {
      throw new Error('expected invocation order for onClick and hide');
    }
    expect(clickOrder).toBeLessThan(hideOrder);
  });
});
