import { useEffect, useRef } from 'react';
import { showSuccessNotification } from '@piwin/ui-kit';

/**
 * A drop shorter than this is a network hand-over (Wi-Fi ↔ cellular, a
 * backgrounded phone waking up); announcing its end would just be noise.
 */
export const HOST_RECONNECTED_NOTICE_AFTER_MS = 1_500;

/**
 * Says once that the Host link is back after an outage the reader could have
 * noticed. `down` is the same signal the reconnect banner shows on.
 */
export function useHostReconnectedNotice(down: boolean, message: string): void {
  const downSinceRef = useRef<number | null>(null);
  useEffect(() => {
    if (down) {
      downSinceRef.current ??= Date.now();
      return;
    }
    const downSince = downSinceRef.current;
    downSinceRef.current = null;
    if (downSince !== null && Date.now() - downSince >= HOST_RECONNECTED_NOTICE_AFTER_MS) {
      showSuccessNotification(message);
    }
  }, [down, message]);
}
