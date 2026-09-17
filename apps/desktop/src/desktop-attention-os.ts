import { createNoopDesktopAttentionOs } from './desktop-attention-os-noop.js';
import { createTauriDesktopAttentionOs } from './desktop-attention-os-tauri.js';
import { isTauriRuntime } from './tauri-pty.js';

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
  return isTauriRuntime() ? createTauriDesktopAttentionOs() : createNoopDesktopAttentionOs();
}
