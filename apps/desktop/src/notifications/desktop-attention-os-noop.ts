import type {
  AttentionAuthorization,
  AttentionDeliverResult,
  AttentionOsCapabilities,
  DesktopAttentionOs,
} from './desktop-attention-os.js';

const UNSUPPORTED_CAPABILITIES: AttentionOsCapabilities = {
  nativeCenter: false,
  clickActivation: false,
  authorizationReliable: false,
};

export function createNoopDesktopAttentionOs(): DesktopAttentionOs {
  return {
    getCapabilities(): Promise<AttentionOsCapabilities> {
      return Promise.resolve(UNSUPPORTED_CAPABILITIES);
    },
    getAuthorization(): Promise<AttentionAuthorization> {
      return Promise.resolve('unsupported');
    },
    requestAuthorization(): Promise<AttentionAuthorization> {
      return Promise.resolve('unsupported');
    },
    deliver(): Promise<AttentionDeliverResult> {
      return Promise.resolve('unsupported');
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
    subscribeActivation(): () => void {
      return () => {};
    },
    openSystemSettings(): Promise<void> {
      return Promise.resolve();
    },
  };
}
