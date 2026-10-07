import { useEffect, useRef } from 'react';
import { createLiveActivityBridge } from '@piwin/host-client';
import { isMobileTauriRuntime } from '../shell-runtime.js';
import { applyLiveSystemControl, projectLiveSystemActivity } from './live-system-activity.js';
import type { LiveCallController } from './use-live-call.js';

export function useIosLiveActivity(
  live: LiveCallController,
  openSession: (sessionId: string) => void | Promise<unknown>,
): void {
  const latest = useRef({ live, openSession });
  latest.current = { live, openSession };
  const schedule = useRef<(() => void) | null>(null);
  const activity = projectLiveSystemActivity(live.call, live.peer);
  const serialized = JSON.stringify(activity);

  useEffect(() => {
    if (!isMobileTauriRuntime() || /Android/.test(navigator.userAgent)) return;
    let disposed = false;
    let release: (() => Promise<void>) | null = null;
    let chain = Promise.resolve();
    const report = (error: unknown): void => {
      console.error('[piwin-live] system activity bridge failed', error instanceof Error ? error.message : 'native-error');
    };
    const run = async (): Promise<void> => {
      const { invoke, addPluginListener } = await import('@tauri-apps/api/core');
      const bridge = createLiveActivityBridge(invoke);
      if (!(await bridge.isAvailable()) || disposed) return;
      const sync = async (): Promise<void> => {
        if (disposed) return;
        const current = latest.current.live;
        await bridge.sync(projectLiveSystemActivity(current.call, current.peer));
      };
      const drain = async (): Promise<void> => {
        if (disposed) return;
        try { for (const control of await bridge.takeControls()) {
          if (disposed) return;
          const current = latest.current;
          await applyLiveSystemControl({
            control, call: current.live.call, muted: current.live.peer.muted,
            setMuted: current.live.setMuted, end: current.live.end, openSession: current.openSession,
          });
        } } finally { await sync(); }
      };
      const enqueue = (operation: () => Promise<void>): void => {
        chain = chain.then(operation).catch(report);
      };
      schedule.current = () => enqueue(sync);
      const listener = await addPluginListener('piwin-live', 'control', () => enqueue(drain));
      if (disposed) { await listener.unregister(); return; }
      release = () => listener.unregister();
      // Drain a control that woke the app before JavaScript attached its listener.
      enqueue(drain);
      const onResume = (): void => {
        if (document.visibilityState === 'visible') enqueue(drain);
      };
      document.addEventListener('visibilitychange', onResume);
      const previousRelease = release;
      release = async () => {
        document.removeEventListener('visibilitychange', onResume);
        await previousRelease();
        await chain;
        await bridge.sync(null);
      };
    };
    void run().catch(report);
    return () => {
      disposed = true;
      schedule.current = null;
      void release?.().catch(report);
    };
  }, []);

  useEffect(() => { schedule.current?.(); }, [serialized]);
}
