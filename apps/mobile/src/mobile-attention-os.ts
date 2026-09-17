import { isNativeTauriRuntime } from './mobile-device-credential-vault.js';

export type MobileNotificationPermission = 'granted' | 'denied' | 'unsupported';

export type MobileLocalNotificationInput = {
  identifier: string;
  title: string;
  body: string;
  sessionId: string;
  attentionKey: string;
};

export type MobileLocalNotificationResult = 'delivered' | 'not-authorized' | 'unsupported';

type NotificationPlugin = {
  isPermissionGranted: () => Promise<boolean>;
  requestPermission: () => Promise<string>;
  sendNotification: (input: {
    title: string;
    body: string;
    extra?: Record<string, string>;
  }) => Promise<unknown> | unknown;
  onAction?: (listener: (notification: unknown) => void) => Promise<() => void> | (() => void);
};

async function loadPlugin(): Promise<NotificationPlugin | null> {
  if (!isNativeTauriRuntime()) {
    return null;
  }
  try {
    const loaded: unknown = await import('@tauri-apps/plugin-notification');
    if (loaded === null || typeof loaded !== 'object') {
      return null;
    }
    const record = loaded as Record<string, unknown>;
    if (typeof record.isPermissionGranted !== 'function') {
      return null;
    }
    if (typeof record.requestPermission !== 'function') {
      return null;
    }
    if (typeof record.sendNotification !== 'function') {
      return null;
    }
    return loaded as NotificationPlugin;
  } catch {
    return null;
  }
}

export async function getMobileNotificationPermission(): Promise<MobileNotificationPermission> {
  const plugin = await loadPlugin();
  if (plugin === null) {
    return 'unsupported';
  }
  try {
    const granted = await plugin.isPermissionGranted();
    return granted ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function requestMobileNotificationPermission(): Promise<MobileNotificationPermission> {
  const plugin = await loadPlugin();
  if (plugin === null) {
    return 'unsupported';
  }
  try {
    const result = await plugin.requestPermission();
    return result === 'granted' ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export async function sendMobileLocalNotification(
  input: MobileLocalNotificationInput,
): Promise<MobileLocalNotificationResult> {
  const plugin = await loadPlugin();
  if (plugin === null) {
    return 'unsupported';
  }
  try {
    await plugin.sendNotification({
      title: input.title,
      body: input.body,
      extra: {
        sessionId: input.sessionId,
        attentionKey: input.attentionKey,
        identifier: input.identifier,
      },
    });
    return 'delivered';
  } catch {
    return 'not-authorized';
  }
}

export async function subscribeMobileNotificationAction(
  listener: (sessionId: string) => void,
): Promise<() => void> {
  const plugin = await loadPlugin();
  if (plugin === null || plugin.onAction === undefined) {
    return () => {};
  }
  const unsub = await plugin.onAction((notification) => {
    const sessionId = readExtraSessionId(notification);
    if (sessionId !== null) {
      listener(sessionId);
    }
  });
  return typeof unsub === 'function' ? unsub : () => {};
}

function readExtraSessionId(notification: unknown): string | null {
  if (notification === null || typeof notification !== 'object') {
    return null;
  }
  const record = notification as Record<string, unknown>;
  const extra = record.extra;
  if (extra === null || typeof extra !== 'object' || Array.isArray(extra)) {
    return typeof record.sessionId === 'string' ? record.sessionId : null;
  }
  const sessionId = (extra as Record<string, unknown>).sessionId;
  return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
}
