/**
 * Cheap browser-activity observer for surfaces that must react to the shared
 * Chromium without holding a mirror lease (the collapsed-panel mini, agent
 * attention). Subscribes to Host pushes only — it never calls `browser/start`.
 */
import { useEffect, useState } from 'react';
import type { BrowserController } from '@piwin/contracts';
import type { HostClient } from '../host/host-client';

export type BrowserActivitySignal = {
  url: string;
  title: string;
  owner: BrowserController;
  /** Bumped whenever a push says the page or controller changed. */
  revision: number;
};

const IDLE_SIGNAL: BrowserActivitySignal = {
  url: '',
  title: '',
  owner: 'idle',
  revision: 0,
};

export function useBrowserActivitySignal(
  hostClient: HostClient,
  sessionId?: string | null,
  hostInstanceId?: string | null,
): BrowserActivitySignal {
  const [cache, setCache] = useState(() => ({
    hostClient, hostInstanceId, signals: new Map<string, BrowserActivitySignal>(),
  }));
  if (cache.hostClient !== hostClient || cache.hostInstanceId !== hostInstanceId) {
    setCache({ hostClient, hostInstanceId, signals: new Map() });
  }

  useEffect(() => {
    return hostClient.subscribe((message) => {
      if (message.type !== 'browser/state' && message.type !== 'browser/controller') return;
      const key = message.sessionId ?? '';
      setCache((current) => {
        if (current.hostClient !== hostClient || current.hostInstanceId !== hostInstanceId) return current;
        const previous = current.signals.get(key) ?? IDLE_SIGNAL;
        const signal = message.type === 'browser/state'
          ? { url: message.url ?? '', title: message.title ?? '', owner: previous.owner, revision: previous.revision + 1 }
          : { ...previous, owner: message.owner, revision: previous.revision + 1 };
        const signals = new Map(current.signals);
        signals.set(key, signal);
        return { ...current, signals };
      });
    });
  }, [hostClient, hostInstanceId]);

  if (sessionId === null || cache.hostClient !== hostClient || cache.hostInstanceId !== hostInstanceId) return IDLE_SIGNAL;
  return cache.signals.get(sessionId ?? '') ?? IDLE_SIGNAL;
}
