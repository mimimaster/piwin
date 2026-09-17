import type { HostServerMessage } from '@piwin/contracts';
import type { AttentionPreferences, AttentionPresence } from '@piwin/host-client';
import type { DesktopAttentionOs } from './desktop-attention-os';
import type { DesktopLocale } from './desktop-locale';

export type DesktopAttentionSnapshot = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  preferences: AttentionPreferences;
  locale: DesktopLocale;
  hostReady: boolean;
  describeSession: (sessionId: string) => {
    sessionTitle?: string;
    projectName?: string;
    projectId?: string;
  };
};

export type InAppAttentionNotice = {
  title: string;
  body: string;
  action?: { label: string; sessionId: string };
};

export type DesktopAttentionControllerDeps = {
  hostClient: { subscribe(listener: (message: HostServerMessage) => void): () => void };
  os: DesktopAttentionOs;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => () => void;
  getSnapshot: () => DesktopAttentionSnapshot;
  showInAppNotice: (notice: InAppAttentionNotice) => void;
};

export type DesktopAttentionController = {
  onPresenceChanged(presence: AttentionPresence): void;
  syncAttentionSessions(sessionIds: readonly string[]): void;
  dispose(): void;
};

export function createDesktopAttentionController(
  deps: DesktopAttentionControllerDeps,
): DesktopAttentionController {
  void deps;
  throw new Error('AN-O2 not implemented');
}
