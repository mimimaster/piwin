import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChatUiState } from './chat-ui-types.js';
import type { DesktopLocale } from './desktop-locale.js';
import type { HostClient } from './host-client.js';
import { resolveActiveComposerAgentId } from './composer-dock-assembly.js';
import { ConversationShellSwitch } from './conversation-shell-switch.js';
import { WorkbenchTuiStage, useWorkbenchTui } from './workbench-tui.js';
import { canOpenEmbeddedTui, isTerminalFeatureEnabled } from './terminal-feature.js';
import { prefetchTuiPane } from './deferred-desktop-surfaces.js';
import { isTauriPtyAvailable } from './tauri-pty.js';

/** Owns shell selection and native-agent routing; the shell frame only places slots. */
export function useWorkbenchCli(input: {
  state: ChatUiState;
  hostClient: HostClient;
  terminalEnabled: boolean | undefined;
  studioOpen: boolean;
  subpageOpen: boolean;
  locale: DesktopLocale;
  appearanceMode: 'light' | 'dark';
  onResumeSession: (sessionId: string, options?: { refresh: boolean }) => void | Promise<void>;
  onError: (error: unknown) => void;
}): { active: boolean; stage: ReactElement | null; control: ReactElement | null; reset: () => void } {
  const { hostClient, state } = input;
  const [syncing, setSyncing] = useState(false);
  const latest = useRef(input);
  latest.current = input;
  const remoteTarget = hostClient.getTransport() === 'remote' ? hostClient.getRemoteTarget() : undefined;
  const hostKey = `${hostClient.getTransport()}:${remoteTarget?.endpoint ?? ''}:${hostClient.getHostInstanceId() ?? ''}`;
  const adoptedEngine = useRef<{ sessionId: string; agentId: string; hostKey: string } | null>(null);
  // Native open is authoritative while Desktop hydrates the new session's badge.
  const agentId = adoptedEngine.current?.sessionId === state.activeSessionId && adoptedEngine.current?.hostKey === hostKey
    ? adoptedEngine.current.agentId : resolveActiveComposerAgentId(state) ?? state.draftAgentId ?? 'pi';
  const available = ['pi', 'grok'].includes(agentId) && canOpenEmbeddedTui({
    terminalEnabled: isTerminalFeatureEnabled(input.terminalEnabled),
    nativePtyAvailable: isTauriPtyAvailable(), transport: hostClient.getTransport(),
    remoteTargetAvailable: hostClient.getRemoteTarget() !== undefined,
  });
  const tui = useWorkbenchTui({
    available, sessionId: state.activeSessionId, hostKey,
    scopeKey: `${hostKey}:${state.activeScope.kind === 'project' ? state.activeScope.projectPath : 'general'}`,
  });
  const selected = useRef(tui.active);
  selected.current = tui.active;
  const currentHostKey = useRef(hostKey);
  currentHostKey.current = hostKey;
  const pendingSync = useRef<{ host: HostClient; sessionId: string; again: boolean } | null>(null);
  const reset = (): void => { adoptedEngine.current = null; tui.reset(); };
  const lastHostTurn = useRef(state.lastTerminalRunId);
  const staleNativeView = useRef(false);
  useEffect(() => {
    // Grok resumes a native snapshot. After a Desktop/other Host-client turn,
    // its cached interactive view must reload before it can be used again.
    if (agentId === 'grok' && tui.mounted) {
      if (state.activeRunId !== null || lastHostTurn.current !== state.lastTerminalRunId) staleNativeView.current = true;
      if (!tui.active && staleNativeView.current) tui.reset();
    } else staleNativeView.current = false;
    lastHostTurn.current = state.lastTerminalRunId;
  }, [agentId, tui.mounted, tui.active, state.activeRunId, state.lastTerminalRunId]);
  const close = (): void => {
    selected.current = false;
    tui.close();
    const sessionId = state.activeSessionId;
    if (agentId !== 'grok' || sessionId === null) return;
    if (pendingSync.current?.host === hostClient && pendingSync.current.sessionId === sessionId) {
      // A second return during replay may include another native turn. Coalesce
      // clicks, then take one more snapshot instead of concurrent rebuilds.
      pendingSync.current.again = true;
      return;
    }
    const operation = { host: hostClient, sessionId, again: true };
    pendingSync.current = operation;
    const current = (): boolean => latest.current.hostClient === hostClient &&
      currentHostKey.current === hostKey && latest.current.state.activeSessionId === sessionId;
    setSyncing(true);
    void (async () => {
      while (operation.again && current() && !selected.current) {
        operation.again = false;
        const synced = await hostClient.request({ type: 'agents/cli-sync', sessionId });
        if (!synced.success) throw new Error(synced.error);
        if (current() && !selected.current && !operation.again) await latest.current.onResumeSession(sessionId, { refresh: true });
      }
    })().catch((error: unknown) => { if (current()) latest.current.onError(error); }).finally(() => {
      if (pendingSync.current !== operation) return;
      pendingSync.current = null;
      setSyncing(false);
    });
  };
  const visible = !input.studioOpen && !input.subpageOpen;
  return {
    active: tui.active && visible,
    reset,
    control: available && visible ? <ConversationShellSwitch cli={tui.active} locale={input.locale}
      appearanceMode={input.appearanceMode} busy={syncing} onDesktop={close}
      onCliIntent={() => { void prefetchTuiPane().catch(input.onError); }}
      onCli={() => { selected.current = true; tui.open(); }} /> : null,
    stage: tui.mounted ? <WorkbenchTuiStage visible={tui.active && visible} sessionId={state.activeSessionId} projectPath={state.activeScope.kind === 'project' ? state.activeScope.projectPath : null}
      agentId={agentId} hostClient={hostClient} hostKey={hostKey} remoteTarget={remoteTarget} locale={input.locale}
      onSessionChange={(sessionId) => {
        if (sessionId !== state.activeSessionId) {
          adoptedEngine.current = { sessionId, agentId, hostKey };
          tui.adopt(sessionId);
          void Promise.resolve(input.onResumeSession(sessionId)).catch(input.onError);
        }
      }} /> : null,
  };
}
