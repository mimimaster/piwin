import { useEffect, type ReactElement } from 'react';
import type { AppNotification } from './notification-queue';
import { IconClose } from './shell-icons';

export type NotificationRegionProps = {
  items: AppNotification[];
  onDismiss: (id: string) => void;
};

export function NotificationRegion(props: NotificationRegionProps): ReactElement | null {
  useEffect(() => {
    const timers: number[] = [];
    for (const item of props.items) {
      if (item.ttlMs > 0) {
        const timer = window.setTimeout(() => {
          props.onDismiss(item.id);
        }, item.ttlMs);
        timers.push(timer);
      }
    }
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [props.items, props.onDismiss]);

  if (props.items.length === 0) {
    return null;
  }

  return (
    <div className="notification-region" data-testid="notification-region" aria-live="polite">
      {props.items.map((item) => (
        <div
          key={item.id}
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
            onClick={() => props.onDismiss(item.id)}
          >
            <IconClose width={14} height={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
