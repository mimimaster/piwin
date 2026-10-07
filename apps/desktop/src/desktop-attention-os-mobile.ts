/**
 * Attention delivery inside the mobile shell: local notifications through the
 * Tauri notification plugin. The phone has no dock badge or window attention,
 * so those stay no-ops.
 */
import type {
  AttentionActivation,
  AttentionAuthorization,
  AttentionDeliverInput,
  AttentionDeliverResult,
  AttentionOsCapabilities,
  DesktopAttentionOs,
} from './desktop-attention-os.js';
import { openWithMobileShell } from './open-external-url.js';

const MOBILE_CAPABILITIES: AttentionOsCapabilities = {
  nativeCenter: true,
  clickActivation: true,
  // The plugin only reports granted / not granted; "not determined" is
  // indistinguishable from "denied" until permission has been requested.
  authorizationReliable: false,
};

/** Opens this app's page in the system Settings app (iOS). */
export const APP_SETTINGS_URL = 'app-settings:';

type NotificationPlugin = typeof import('@tauri-apps/plugin-notification');

async function loadPlugin(): Promise<NotificationPlugin | null> {
  try {
    return await import('@tauri-apps/plugin-notification');
  } catch (error) {
    console.warn('[piwin] notification plugin unavailable', error);
    return null;
  }
}

/** Read the session a tapped notification points at; `null` for foreign payloads. */
export function readNotificationActivation(notification: unknown): AttentionActivation | null {
  if (notification === null || typeof notification !== 'object') {
    return null;
  }
  const extra = (notification as { extra?: unknown }).extra;
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    return null;
  }
  const record = extra as Record<string, unknown>;
  const sessionId = record.sessionId;
  const attentionKey = record.attentionKey;
  if (typeof sessionId !== 'string' || sessionId.length === 0) {
    return null;
  }
  return {
    sessionId,
    attentionKey: typeof attentionKey === 'string' ? attentionKey : '',
  };
}

export function createMobileDesktopAttentionOs(): DesktopAttentionOs {
  return {
    getCapabilities(): Promise<AttentionOsCapabilities> {
      return Promise.resolve(MOBILE_CAPABILITIES);
    },
    async getAuthorization(): Promise<AttentionAuthorization> {
      const plugin = await loadPlugin();
      if (plugin === null) {
        return 'unsupported';
      }
      try {
        return (await plugin.isPermissionGranted()) ? 'granted' : 'not-determined';
      } catch {
        return 'unsupported';
      }
    },
    async requestAuthorization(): Promise<AttentionAuthorization> {
      const plugin = await loadPlugin();
      if (plugin === null) {
        return 'unsupported';
      }
      try {
        return (await plugin.requestPermission()) === 'granted' ? 'granted' : 'denied';
      } catch {
        return 'unsupported';
      }
    },
    async deliver(input: AttentionDeliverInput): Promise<AttentionDeliverResult> {
      const plugin = await loadPlugin();
      if (plugin === null) {
        return 'unsupported';
      }
      try {
        if (!(await plugin.isPermissionGranted())) {
          return 'not-authorized';
        }
        plugin.sendNotification({
          title: input.title,
          body: input.body,
          group: input.threadId,
          // `silent` on iOS also keeps the notification out of the list, so a
          // muted preference cannot be mapped onto it.
          extra: {
            sessionId: input.sessionId,
            attentionKey: input.attentionKey,
            identifier: input.identifier,
          },
        });
        return 'delivered';
      } catch (error) {
        console.warn('[piwin] notification delivery failed', error);
        return 'not-authorized';
      }
    },
    removeDelivered(): Promise<void> {
      return Promise.resolve();
    },
    setBadge(): Promise<void> {
      return Promise.resolve();
    },
    requestAttention(): Promise<void> {
      return Promise.resolve();
    },
    takePendingActivation(): Promise<null> {
      return Promise.resolve(null);
    },
    subscribeActivation(listener: (activation: AttentionActivation) => void): () => void {
      let cancelled = false;
      let unlisten: (() => void) | undefined;
      void loadPlugin()
        .then((plugin) => {
          if (plugin === null || cancelled) {
            return undefined;
          }
          return plugin.onAction((notification) => {
            const activation = readNotificationActivation(notification);
            if (activation !== null) {
              listener(activation);
            }
          });
        })
        .then((handle) => {
          if (handle === undefined) {
            return;
          }
          const stop = (): void => {
            void handle.unregister();
          };
          if (cancelled) {
            stop();
            return;
          }
          unlisten = stop;
        })
        .catch((error: unknown) => {
          console.warn('[piwin] notification action listen failed', error);
        });
      return () => {
        cancelled = true;
        unlisten?.();
        unlisten = undefined;
      };
    },
    async openSystemSettings(): Promise<void> {
      // iOS resolves this URL to the app's own page in Settings, which is
      // where the notification switch lives.
      await openWithMobileShell(APP_SETTINGS_URL);
    },
  };
}
