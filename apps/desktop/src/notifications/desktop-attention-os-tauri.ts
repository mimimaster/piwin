import type {
  AttentionActivation,
  AttentionAuthorization,
  AttentionDeliverInput,
  AttentionDeliverResult,
  AttentionOsCapabilities,
  DesktopAttentionOs,
  DockBadge,
} from './desktop-attention-os.js';

const ATTENTION_ACTIVATION_TOKEN = /^[A-Za-z0-9:_-]{1,128}$/;

async function invokeAttention<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return args === undefined ? invoke<T>(command) : invoke<T>(command, args);
}

function parseAttentionActivation(payload: unknown): AttentionActivation | null {
  if (payload == null || typeof payload !== 'object') {
    console.warn('[piwin] ignored invalid attention activation', payload);
    return null;
  }
  const record = payload as { sessionId?: unknown; attentionKey?: unknown };
  const sessionId = record.sessionId;
  const attentionKey = record.attentionKey;
  if (
    typeof sessionId !== 'string' ||
    typeof attentionKey !== 'string' ||
    !ATTENTION_ACTIVATION_TOKEN.test(sessionId) ||
    !ATTENTION_ACTIVATION_TOKEN.test(attentionKey)
  ) {
    console.warn('[piwin] ignored invalid attention activation', payload);
    return null;
  }
  return { sessionId, attentionKey };
}

export function createTauriDesktopAttentionOs(): DesktopAttentionOs {
  return {
    getCapabilities(): Promise<AttentionOsCapabilities> {
      return invokeAttention<AttentionOsCapabilities>('attention_capabilities');
    },
    getAuthorization(): Promise<AttentionAuthorization> {
      return invokeAttention<AttentionAuthorization>('attention_authorization_status');
    },
    requestAuthorization(): Promise<AttentionAuthorization> {
      return invokeAttention<AttentionAuthorization>('attention_request_authorization');
    },
    deliver(input: AttentionDeliverInput): Promise<AttentionDeliverResult> {
      return invokeAttention<AttentionDeliverResult>('attention_deliver', { input });
    },
    removeDelivered(identifiers: readonly string[]): Promise<void> {
      return invokeAttention<void>('attention_remove_delivered', {
        identifiers: [...identifiers],
      });
    },
    async setBadge(badge: DockBadge): Promise<void> {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const current = getCurrentWindow();
      if (badge.kind === 'clear') {
        await current.setBadgeCount();
        await current.setBadgeLabel();
        return;
      }
      if (badge.kind === 'count') {
        await current.setBadgeCount(badge.value);
        return;
      }
      await current.setBadgeLabel(badge.value);
    },
    async requestAttention(): Promise<void> {
      const { getCurrentWindow, UserAttentionType } = await import('@tauri-apps/api/window');
      await getCurrentWindow().requestUserAttention(UserAttentionType.Informational);
    },
    async takePendingActivation(): Promise<AttentionActivation | null> {
      const pending = await invokeAttention<unknown>('attention_take_pending_activation');
      if (pending == null) return null;
      return parseAttentionActivation(pending);
    },
    subscribeActivation(listener: (activation: AttentionActivation) => void): () => void {
      let cancelled = false;
      let unlisten: (() => void) | undefined;
      void import('@tauri-apps/api/event')
        .then(({ listen }) => {
          if (cancelled) return undefined;
          return listen('attention://activate', (event) => {
            if (cancelled) return;
            const activation = parseAttentionActivation(event.payload);
            if (activation) listener(activation);
          });
        })
        .then((fn) => {
          if (!fn) return;
          if (cancelled) {
            fn();
            return;
          }
          unlisten = fn;
        })
        .catch((error: unknown) => {
          console.warn('[piwin] attention activation listen failed', error);
        });
      return () => {
        cancelled = true;
        unlisten?.();
        unlisten = undefined;
      };
    },
    openSystemSettings(): Promise<void> {
      return invokeAttention<void>('attention_open_system_settings');
    },
  };
}
