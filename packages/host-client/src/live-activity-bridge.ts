import type { LiveSystemActivity, LiveSystemControl } from '@piwin/contracts';
import { parseLiveSystemControl } from '@piwin/contracts';

export type LiveActivityInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

/** The iOS shell injects its native bridge; this package stays browser safe. */
export function createLiveActivityBridge(invoke: LiveActivityInvoke) {
  return {
    async isAvailable(): Promise<boolean> {
      const status = await invoke('plugin:piwin-live|live_activity_status');
      return Boolean(status && typeof status === 'object' &&
        (status as { enabled?: unknown }).enabled === true);
    },
    async sync(activity: LiveSystemActivity | null): Promise<void> {
      await invoke('plugin:piwin-live|live_activity_sync', { activity });
    },
    async takeControls(): Promise<LiveSystemControl[]> {
      const controls = await invoke('plugin:piwin-live|live_activity_take_controls');
      if (!Array.isArray(controls)) return [];
      return controls.flatMap((value: unknown) => {
        const control = parseLiveSystemControl(value);
        return control ? [control] : [];
      });
    },
  };
}
