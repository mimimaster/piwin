import { createMobileDesktopAttentionOs } from './desktop-attention-os-mobile.js';
import { createNoopDesktopAttentionOs } from './desktop-attention-os-noop.js';
import { createTauriDesktopAttentionOs } from './desktop-attention-os-tauri.js';
import { isMobileTauriRuntime } from '../tool-cards/shell-runtime.js';
import { isTauriRuntime } from '../host/tauri-pty.js';

export type AttentionAuthorization = 'granted' | 'denied' | 'not-determined' | 'unsupported';

export type AttentionOsCapabilities = {
  nativeCenter: boolean;
  clickActivation: boolean;
  authorizationReliable: boolean;
};

export type DockBadge =
  | { kind: 'clear' }
  | { kind: 'count'; value: number }
  | { kind: 'label'; value: string };

export type AttentionActivation = { sessionId: string; attentionKey: string };

export type AttentionDeliverInput = {
  identifier: string;
  threadId: string;
  title: string;
  body: string;
  sessionId: string;
  attentionKey: string;
  sound: boolean;
};

export type AttentionDeliverResult = 'delivered' | 'not-authorized' | 'unsupported';

export type DesktopAttentionOs = {
  getCapabilities(): Promise<AttentionOsCapabilities>;
  getAuthorization(): Promise<AttentionAuthorization>;
  requestAuthorization(): Promise<AttentionAuthorization>;
  deliver(input: AttentionDeliverInput): Promise<AttentionDeliverResult>;
  removeDelivered(identifiers: readonly string[]): Promise<void>;
  setBadge(badge: DockBadge): Promise<void>;
  requestAttention(): Promise<void>;
  takePendingActivation(): Promise<AttentionActivation | null>;
  subscribeActivation(listener: (activation: AttentionActivation) => void): () => void;
  openSystemSettings(): Promise<void>;
};

export function createDesktopAttentionOs(): DesktopAttentionOs {
  if (isMobileTauriRuntime()) {
    return createMobileDesktopAttentionOs();
  }
  return isTauriRuntime() ? createTauriDesktopAttentionOs() : createNoopDesktopAttentionOs();
}

/**
 * A native delivery that throws (missing command, plugin error) must not
 * vanish as an unhandled rejection: report it and take the same in-app
 * fallback path as an unsupported platform.
 */
export async function deliverSafely(
  os: DesktopAttentionOs,
  input: AttentionDeliverInput,
): Promise<AttentionDeliverResult> {
  try {
    return await os.deliver(input);
  } catch (error) {
    console.warn('[piwin] attention delivery failed', error);
    return 'unsupported';
  }
}

export function warnOsFailure(operation: string): (error: unknown) => void {
  return (error) => {
    console.warn(`[piwin] attention ${operation} failed`, error);
  };
}
