import { useEffect, type ReactElement } from 'react';
import type { AppNotification } from './notification-queue';
import { IconClose } from './shell-icons';

export type NotificationRegionProps = {
  items: AppNotification[];
  onDismiss: (id: string) => void;
};

function NotificationToastItem(props: {
  item: AppNotification;
  onDismiss: (id: string) => void;
}): ReactElement {
  const { item, onDismiss } = props;

  useEffect(() => {
    if (item.ttlMs <= 0) return;

    // Calculate remaining duration based on creation timestamp so parent re-renders don't reset timer
    const elapsed = Date.now() - item.createdAt;
    const remaining = Math.max(0, item.ttlMs - elapsed);

    const timer = window.setTimeout(() => {
      onDismiss(item.id);
    }, remaining);

    return () => {
      window.clearTimeout(timer);
    };
  }, [item.id, item.createdAt, item.ttlMs, onDismiss]);

  return (
    <div
      className={`notification-toast level-${item.level}`}
      data-testid="notification-toast"
      data-level={item.level}
      role={item.level === 'error' ? 'alert' : 'status'}
    >
      <span className="notification-message">{item.message}</span>
      <button
        type="button"
        className="notification-dismiss"
        data-testid="notification-dismiss"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(item.id)}
      >
        <IconClose width={14} height={14} />
      </button>
    </div>
  );
}

export function NotificationRegion(props: NotificationRegionProps): ReactElement | null {
  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="notification-region" data-testid="notification-region" aria-live="polite">
      {props.items.map((item) => (
        <NotificationToastItem key={item.id} item={item} onDismiss={props.onDismiss} />
      ))}
    </div>
  );
}

