import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChatUiState } from './chat-ui-types.js';
import type { DesktopLocale } from './desktop-locale.js';
import type { HostClient } from './host-client.js';
import { resolveActiveComposerAgentId } from './composer-dock-assembly.js';
import { ConversationShellSwitch } from './conversation-shell-switch.js';
import { WorkbenchTuiStage, useWorkbenchTui } from './workbench-tui.js';
import {
  canOfferConversationCli,
  canOpenEmbeddedTui,
  isNativeCliEligible,
} from './terminal-feature.js';
import { prefetchTuiPane } from './deferred-desktop-surfaces.js';
import { isTauriPtyAvailable } from './tauri-pty.js';
import { useCliImagePreview } from './cli-image-preview.js';
import { backendCapabilitiesFor } from './agent-backend-state.js';

/**
 * Renders a split pane's session as the terminal shell. Terminal mode is one
 * toggle per window: while it is on, every pane showing a piwin or grok session
 * shows that session in the TUI, not only the primary (focused-session) pane.
 * Returns null when the session's agent has no embedded TUI.
 */
export type SessionTuiRenderer = (sessionId: string, agentId: string | undefined) => ReactElement | null;

/** Owns shell selection and native-agent routing; the shell frame only places slots. */
export function useWorkbenchCli(input: {
  state: ChatUiState;
  hostClient: HostClient;
  studioOpen: boolean;
  subpageOpen: boolean;
  locale: DesktopLocale;
  appearanceMode: 'light' | 'dark';
  onResumeSession: (sessionId: string, options?: { refresh: boolean; nativeHistorySynced?: true }) => void | Promise<void>;
  onError: (error: unknown) => void;
  onWriterBusy?: (busy: boolean) => void;
}): {
  active: boolean;
  sendBlocked: boolean;
  stage: ReactElement | null;
  control: ReactElement | null;
  reset: () => void;
  renderSessionTui: SessionTuiRenderer | null;
} {
  const { hostClient, state } = input;
  const [syncing, setSyncing] = useState(false);
  const hostTurnView = useRef(false);
  const routedSessionId = useRef(state.activeSessionId);
  if (routedSessionId.current !== state.activeSessionId) {
    routedSessionId.current = state.activeSessionId;
    hostTurnView.current = state.activeRunId !== null;
  }
  const latest = useRef(input);
  latest.current = input;
  const onWriterBusyRef = useRef(input.onWriterBusy);
  onWriterBusyRef.current = input.onWriterBusy;
  const remoteTarget = hostClient.getTransport() === 'remote' ? hostClient.getRemoteTarget() : undefined;
  const hostKey = `${hostClient.getTransport()}:${remoteTarget?.endpoint ?? ''}:${hostClient.getHostInstanceId() ?? ''}`;
  const adoptedEngine = useRef<{ sessionId: string; agentId: string; hostKey: string } | null>(null);
  // Native open is authoritative while Desktop hydrates the new session's badge.
  const agentId = adoptedEngine.current?.sessionId === state.activeSessionId && adoptedEngine.current?.hostKey === hostKey
    ? adoptedEngine.current.agentId : resolveActiveComposerAgentId(state) ?? state.draftAgentId ?? 'pi';
  const capabilities = backendCapabilitiesFor(state.backendCapabilitiesBySession, state.activeSessionId);
  const agentStatus = state.externalAgents.find((agent) => agent.agentId === agentId);
  const transportOk = canOpenEmbeddedTui({
    nativePtyAvailable: isTauriPtyAvailable(), transport: hostClient.getTransport(),
    remoteTargetAvailable: hostClient.getRemoteTarget() !== undefined,
  });
  const available = canOfferConversationCli({
    agentId,
    nativePtyAvailable: isTauriPtyAvailable(),
    transport: hostClient.getTransport(),
    remoteTargetAvailable: hostClient.getRemoteTarget() !== undefined,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(agentStatus === undefined ? {} : { agentStatus }),
  });
  const usesNativeHandoff = transportOk && isNativeCliEligible({
    agentId,
    ...(capabilities === undefined ? {} : { capabilities }),
    ...(agentStatus === undefined ? {} : { agentStatus }),
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
    // Native CLI resumes a snapshot. After a Desktop/other Host-client turn,
    // its cached interactive view must reload before it can be used again.
    if (usesNativeHandoff && tui.mounted) {
      if (state.activeRunId !== null || lastHostTurn.current !== state.lastTerminalRunId) staleNativeView.current = true;
      if (!tui.active && staleNativeView.current) tui.reset();
    } else staleNativeView.current = false;
    lastHostTurn.current = state.lastTerminalRunId;
  }, [usesNativeHandoff, tui.mounted, tui.active, state.activeRunId, state.lastTerminalRunId]);
  const close = (): void => {
    selected.current = false;
    tui.close();
    const sessionId = state.activeSessionId;
    if (!usesNativeHandoff || sessionId === null || hostTurnView.current) return;
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
        const synced = await hostClient.request({ type: 'agents/cli-snapshot', sessionId });
        if (!synced.success) throw new Error(synced.error);
        if (current() && !selected.current && !operation.again) {
          await latest.current.onResumeSession(sessionId, { refresh: true, nativeHistorySynced: true });
        }
      }
    })().catch((error: unknown) => { if (current()) latest.current.onError(error); }).finally(() => {
      if (pendingSync.current !== operation) return;
      pendingSync.current = null;
      setSyncing(false);
    });
  };
  const sendBlocked = usesNativeHandoff && (tui.active || syncing) && !hostTurnView.current;
  useEffect(() => {
    onWriterBusyRef.current?.(sendBlocked);
  }, [sendBlocked]);
  useEffect(() => () => { onWriterBusyRef.current?.(false); }, []);
  const imagePreview = useCliImagePreview({ hostClient, sessionId: state.activeSessionId, locale: input.locale });
  const visible = !input.studioOpen && !input.subpageOpen;
  const projectPath = state.activeScope.kind === 'project' ? state.activeScope.projectPath : null;
  const renderSessionTui: SessionTuiRenderer | null = tui.active && visible
    ? (sessionId, paneAgentId) => {
      const engine = paneAgentId ?? 'pi';
      if (!['pi', 'grok'].includes(engine)) return null;
      // The pane is bound to its session; it keeps the process it started.
      return <WorkbenchTuiStage visible sessionId={sessionId} projectPath={projectPath} agentId={engine}
        hostClient={hostClient} hostKey={hostKey} remoteTarget={remoteTarget} locale={input.locale}
        onSessionChange={() => undefined} />;
    }
    : null;
  return {
    active: tui.active && visible,
    renderSessionTui,
    sendBlocked,
    reset,
    control: available && visible ? <ConversationShellSwitch cli={tui.active} locale={input.locale}
      appearanceMode={input.appearanceMode} busy={syncing} onDesktop={close}
      onCliIntent={() => { void prefetchTuiPane().catch(input.onError); }}
      onCli={() => { hostTurnView.current = usesNativeHandoff && state.activeRunId !== null; selected.current = true; tui.open(); }} /> : null,
    stage: tui.mounted ? <>{imagePreview.element}<WorkbenchTuiStage visible={tui.active && visible} sessionId={state.activeSessionId} projectPath={state.activeScope.kind === 'project' ? state.activeScope.projectPath : null}
      agentId={hostTurnView.current ? 'pi' : agentId} hostClient={hostClient} hostKey={hostKey} remoteTarget={remoteTarget} locale={input.locale}
      onOpenImage={imagePreview.open}
      onSessionChange={(sessionId) => {
        if (sessionId !== state.activeSessionId) {
          adoptedEngine.current = { sessionId, agentId, hostKey };
          tui.adopt(sessionId);
          void Promise.resolve(input.onResumeSession(sessionId)).catch(input.onError);
        }
      }} /></> : null,
  };
}
