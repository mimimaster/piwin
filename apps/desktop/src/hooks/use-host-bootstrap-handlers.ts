/**
 * Push subscription + bootstrap routines extracted from `use-host-bootstrap.ts`.
 * Each routine takes an explicit runtime/context object; no React state is
 * pulled in implicitly — setters and refs are passed through `HostBootstrapRuntime`.
 */
import type { Dispatch, SetStateAction } from 'react';
import type {
  ConfiguredChatModelsData,
  ContextSummaryPush,
  HostServerMessage,
  HostStatusData,
  ModelContextSummaryData,
  PetRuntimeSnapshot,
  PiwinConfig,
  SessionPlan,
} from '@piwin/contracts';
import {
  formatError,
  isPrimarySessionRecord,
  parseSessionContextSnapshot,
} from '@piwin/contracts';
import type { HostClient } from '../host/host-client';
import { isRemoteCommandGapError } from '../host/remote-command-gap.js';
import { isWorkbenchHostTeardownError } from '../workbench/workbench-host-teardown.js';
import { toPermissionPromptUi } from '../settings/permission-queue.js';
import {
  bootstrapExternalAgents,
  handleExternalAgentPush,
  syncReadyAgentCatalogs,
} from './external-agent-bootstrap.js';
import type { ChatUiAction } from '../conversation/chat-reducer';
import { appendHostLogEntry } from '../host/HostLogPanel';
import { isAppearanceFaceId } from '../theme/appearance-tokens';
import { getDesktopCopy } from '../i18n/desktop-locale';
import type { DesktopLocale } from '../i18n/desktop-locale';
import { createStreamEventBuffer } from '../conversation/stream-event-buffer';
import {
  hydrationSessionApplyActions,
  mapListedSessionItem,
  mapListedSessionItems,
  sessionUpdateFromIndexPush,
} from '../host/remote-session-hydrate';
import { readConfiguredChatModelsData } from '../models/model-options';
import { readProjectedHostConfig } from '../host/remote-settings-hydrate.js';
import { mergeSettingsViewConfig } from '../settings/settings-view-config.js';
import { appendBoundedPtyOutput } from '../platform/record-budget';
import type { ExtensionUiRequestsController } from './use-extension-ui-requests';
import type { BackendUserInputController } from './use-backend-user-input.js';
import type { UseHostBootstrapArgs } from './use-host-bootstrap.js';
import {
  applyBootstrapSelectedModelKey,
  cacheSessionPlan,
  describeExtensionDeploymentFailure,
  hasContextTelemetryCapability,
  resolveShellHostReady,
  resolveThemeBootstrapResponse,
  shouldAnnounceExtensionDeploymentFailure,
} from './use-host-bootstrap-helpers.js';

/** Retained assembly/context summaries (keyed by runId and userMessageId).
 * Entries feed summary cards only; older ones are evicted FIFO. */
const MAX_ASSEMBLY_SUMMARIES = 64;

/**
 * Everything the extracted handlers need from the hook: the hook args plus
 * per-subscription locals (buffer, dedup sets) and React state setters/refs.
 * Constructed inside the subscribe effect so captures match the original
 * closure semantics exactly.
 */
export type HostBootstrapRuntime = {
  args: UseHostBootstrapArgs;
  /** Returns true once the effect cleanup ran; async bodies bail on it. */
  isCancelled: () => boolean;
  localeRef: { current: DesktopLocale };
  streamEventBuffer: ReturnType<typeof createStreamEventBuffer>;
  syncedReadyAgents: Set<string>;
  announcedExtensionDeployments: Set<string>;
  lastPushedHostReadyRef: { current: boolean | null };
  setHostStatus: Dispatch<SetStateAction<HostStatusData | null>>;
  setHostReadyEpoch: Dispatch<SetStateAction<number>>;
  setRemoteCatchUpEpoch: Dispatch<SetStateAction<number>>;
  setConfig: Dispatch<SetStateAction<PiwinConfig | null>>;
  setConfiguredChatModels: Dispatch<SetStateAction<ConfiguredChatModelsData>>;
  setActivePet: (update: SetStateAction<PetRuntimeSnapshot | null>) => void;
  setPlansBySessionId: Dispatch<SetStateAction<Record<string, SessionPlan | null>>>;
  setAssemblySummariesByRunId: Dispatch<SetStateAction<Record<string, ContextSummaryPush>>>;
  extensionUi: ExtensionUiRequestsController;
  backendInput: BackendUserInputController;
};

/** Dispatch one HostServerMessage push onto reducer/state surfaces. */
export function handleHostServerMessage(rt: HostBootstrapRuntime, message: HostServerMessage): void {
  const { args, streamEventBuffer } = rt;
  const { hostClient, dispatch } = args;
  if (message.type === 'hydration') {
    streamEventBuffer.reset();
    const listed = mapListedSessionItems({ sessions: message.snapshot.sessions });
    for (const action of hydrationSessionApplyActions(listed.sessions)) {
      dispatch(action);
    }
    return;
  }
  if (message.type === 'snapshot') {
    // Stale-cursor recovery without full hello hydration. Force catch-up
    // even when the shell was already "ready" (false→true epoch alone
    // would no-op).
    streamEventBuffer.reset();
    const ready = resolveShellHostReady({
      transport: args.hostClient.getTransport(),
      wireReady: args.hostClient.isReady(),
      statusSuccess: true,
      statusReady: message.status.ready,
    });
    dispatch({
      type: 'host/status',
      ready,
      mock: message.status.mock,
    });
    rt.lastPushedHostReadyRef.current = ready;
    rt.setHostReadyEpoch((current) => current + 1);
    rt.setRemoteCatchUpEpoch((current) => current + 1);
    return;
  }
  if (message.type === 'host/status') {
    const ready = resolveShellHostReady({
      transport: args.hostClient.getTransport(),
      wireReady: args.hostClient.isReady(),
      statusSuccess: true,
      statusReady: message.ready,
    });
    dispatch({ type: 'host/status', ready, mock: message.mock });
    if (!ready && message.reason !== undefined) {
      dispatch({ type: 'error', message: message.reason });
    }
    if (ready && rt.lastPushedHostReadyRef.current !== true) {
      rt.setHostReadyEpoch((current) => current + 1);
    }
    rt.lastPushedHostReadyRef.current = ready;
    return;
  }
  if (message.type === 'session/context-updated') {
    const snapshot = parseSessionContextSnapshot(message.snapshot);
    if (snapshot) {
      dispatch({
        type: 'context-telemetry/snapshot',
        snapshot,
        source: 'live',
        hostInstanceId: hostClient.getHostInstanceId(),
      });
    }
    return;
  }
  if (message.type === 'event') {
    streamEventBuffer.push(message.sessionId, message.event, message.envelope);
    return;
  }
  if (message.type === 'agent/context-summary') {
    rt.setAssemblySummariesByRunId((current) => {
      const next = { ...current, [message.runId]: message };
      if (message.userMessageId) {
        next[message.userMessageId] = message;
      }
      // Bounded FIFO: summaries accumulate for the app's whole lifetime
      // otherwise; insertion order approximates recency.
      const keys = Object.keys(next);
      if (keys.length > MAX_ASSEMBLY_SUMMARIES) {
        for (const staleKey of keys.slice(0, keys.length - MAX_ASSEMBLY_SUMMARIES)) {
          delete next[staleKey];
        }
      }
      return next;
    });
    return;
  }
  if (message.type === 'run/updated') {
    streamEventBuffer.pushAction(message.run.sessionId, {
      type: 'run/updated',
      run: message.run,
    });
    return;
  }
  if (message.type === 'run/terminal') {
    streamEventBuffer.pushAction(message.run.sessionId, {
      type: 'run/terminal',
      run: message.run,
    });
    rt.extensionUi.clearExtensionUiRequestForSession(message.run.sessionId);
    rt.backendInput.clearBackendUserInputForSession(message.run.sessionId);
    return;
  }
  // Job lifecycle pushes are top-level HostPush variants, not AgentEvent
  // envelopes. Refresh the Job list on state changes and stream logs.
  if (
    message.type === 'job/started' ||
    message.type === 'job/updated' ||
    message.type === 'job/ready' ||
    message.type === 'job/exited'
  ) {
    if (hostClient.supportsCommand('job/list')) {
      void args.refreshJobs();
    }
    return;
  }
  if (message.type === 'job/log') {
    const chunk = message.chunk;
    args.appendJobLog(chunk.jobId, chunk.text);
    return;
  }
  if (message.type === 'pty/output') {
    args.setPtyOutput((current) =>
      appendBoundedPtyOutput(current, {
        id: `${message.ptyId}:${message.at}:${current.length}`,
        data: message.data,
        at: message.at,
      }),
    );
    return;
  }
  if (message.type === 'pty/exit') {
    args.setPtyOutput((current) =>
      appendBoundedPtyOutput(current, {
        id: `${message.ptyId}:exit:${current.length}`,
        data: `\n[Shell exited${
          message.exitCode === null || message.exitCode === undefined
            ? ''
            : ` with code ${message.exitCode}`
        }]\n`,
        at: new Date().toISOString(),
      }),
    );
    return;
  }
  if (message.type === 'transcript/append') {
    dispatch({
      type: 'transcript/append',
      sessionId: message.sessionId,
      message: message.message,
    });
    return;
  }
  if (message.type === 'reply-writer/updated') {
    dispatch({
      type: 'reply-writer/updated',
      sessionId: message.sessionId,
      messageId: message.messageId,
      status: message.status,
      ...(message.model ? { model: message.model } : {}),
      ...(message.language ? { language: message.language } : {}),
      ...(message.sourceText ? { sourceText: message.sourceText } : {}),
    });
    return;
  }
  if (message.type === 'run/intervention-updated') {
    dispatch({
      type: 'run/intervention-updated',
      intervention: message.intervention,
    });
    return;
  }
  if (message.type === 'session/queued-turn-updated') {
    dispatch({ type: 'session/queued-turn-updated', queuedTurn: message.queuedTurn });
    return;
  }
  if (message.type === 'session/backend-updated') {
    dispatch({
      type: 'session/backend-updated',
      sessionId: message.sessionId,
      options: message.options,
    });
    return;
  }
  if (handleExternalAgentPush(hostClient, dispatch, message, rt.syncedReadyAgents)) return;
  if (message.type === 'agents/cli-ownership') {
    dispatch({ type: 'session/update', session: { id: message.ownership.sessionId, name: '', nativeCli: message.ownership } });
    return;
  }
  if (message.type === 'session/index-updated') {
    if (message.op === 'deleted') {
      dispatch({ type: 'session/remove', sessionId: message.sessionId });
      if (args.activeSessionId === message.sessionId) {
        args.onActiveSessionCleared?.();
        dispatch({ type: 'session/clear-active' });
      }
      return;
    }
    // Side chats and subagent children live on their own surfaces; their
    // index pushes must not add them to the main list (the Host listing
    // already excludes them, so they would vanish again on reload).
    if (message.session !== undefined && !isPrimarySessionRecord(message.session)) {
      return;
    }
    const listed =
      message.session === undefined ? undefined : mapListedSessionItem(message.session);
    if (listed) {
      dispatch(sessionUpdateFromIndexPush(message.op, listed));
    }
    return;
  }
  if (
    message.type === 'settings/updated' ||
    message.type === 'auth/updated' ||
    message.type === 'auth/login-finished'
  ) {
    void (async () => {
      const response = await hostClient.request({ type: 'settings/get' });
      if (response.success) {
        const snapshot = (response.data as { snapshot?: { config?: PiwinConfig } } | undefined)
          ?.snapshot;
        if (snapshot?.config) {
          rt.setConfig(mergeSettingsViewConfig(snapshot.config));
        }
      }
      await applyConfiguredChatModels(hostClient, rt.setConfiguredChatModels, args.setSelectedModelKey);
    })();
    return;
  }
  if (message.type === 'session/name-updated') {
    // Host named the session (text on send or LLM after complete). session/update
    // inserts the row when missing so the first text name makes it listable.
    dispatch({
      type: 'session/update',
      session: {
        id: message.sessionId,
        name: message.name,
        updatedAt: new Date().toISOString(),
      },
    });
    return;
  }
  if (message.type === 'subagent/stream') {
    dispatch({
      type: 'subagent/stream',
      parentSessionId: message.parentSessionId,
      childSessionId: message.childSessionId,
      event: message.event,
      ...(message.envelope ? { envelope: message.envelope } : {}),
    });
    return;
  }
  if (message.type === 'subagent/merged') {
    // Stream state is no longer live once the child is merged.
    dispatch({
      type: 'subagent/clear-stream',
      childSessionId: message.childSessionId,
    });
    return;
  }
  if (message.type === 'subagent/updated') {
    dispatch({
      type: 'subagent/updated',
      parentSessionId: message.parentSessionId,
      child: message.child,
    });
    return;
  }
  if (message.type === 'subagent/invocation-updated') {
    dispatch({
      type: 'subagent/invocation-updated',
      parentSessionId: message.parentSessionId,
      invocation: message.invocation,
    });
    return;
  }
  if (message.type === 'subagent/batch-updated') {
    dispatch({
      type: 'subagent/batch-updated',
      runId: message.runId,
      parentSessionId: message.parentSessionId,
      result: message.result,
    });
    return;
  }
  if (message.type === 'subagent/task-updated') {
    dispatch({
      type: 'subagent/task-updated',
      runId: message.runId,
      parentSessionId: message.parentSessionId,
      result: message.result,
    });
    return;
  }
  if (message.type === 'subagent/result-updated') {
    dispatch({
      type: 'subagent/result-updated',
      parentSessionId: message.parentSessionId,
      result: message.result,
    });
    return;
  }
  if (message.type === 'permission/request') {
    dispatch({
      type: 'permission/show',
      prompt: toPermissionPromptUi(message),
    });
    return;
  }
  if (message.type === 'permission/resolved') {
    dispatch({
      type: 'permission/clear',
      requestId: message.requestId,
    });
    return;
  }
  if (message.type === 'session/backend-input-request') {
    rt.backendInput.showBackendUserInput({
      sessionId: message.sessionId,
      requestId: message.requestId,
      generationId: message.generationId,
      request: message.request,
      ...(message.runId === undefined ? {} : { runId: message.runId }),
    });
    return;
  }
  if (message.type === 'session/backend-input-settled') {
    rt.backendInput.clearBackendUserInput(message.requestId);
    return;
  }
  if (message.type === 'extension/ui_request') {
    rt.extensionUi.showExtensionUiRequest({
      sessionId: message.sessionId,
      requestId: message.requestId,
      kind: message.kind,
      title: message.title,
      ...(message.message !== undefined ? { message: message.message } : {}),
      ...(message.options !== undefined ? { options: message.options } : {}),
      ...(message.placeholder !== undefined ? { placeholder: message.placeholder } : {}),
    });
    return;
  }
  if (message.type === 'extension/deployment-updated') {
    const copy = getDesktopCopy(rt.localeRef.current);
    if (
      !shouldAnnounceExtensionDeploymentFailure(
        rt.announcedExtensionDeployments,
        message.deployment,
        copy,
      )
    ) {
      return;
    }
    const failure = describeExtensionDeploymentFailure(message.deployment, copy);
    if (failure) {
      dispatch({ type: 'error', message: failure });
    }
    return;
  }
  if (message.type === 'plan/updated') {
    rt.setPlansBySessionId((current) =>
      cacheSessionPlan(current, message.sessionId, message.plan, args.activeSessionId),
    );
    return;
  }
  if (message.type === 'plan/execution-updated') {
    // Execution state is already embedded in the latest plan/updated push;
    // no separate state update needed here. This handler exists so the
    // push is not logged as unhandled.
    return;
  }
  if (message.type === 'walkthrough/updated') {
    dispatch({ type: 'walkthrough/updated', artifact: message.artifact });
    return;
  }
  if (message.type === 'pet/state') {
    // Overlay has no Host connection; the setter publishes to it.
    rt.setActivePet(message.pet);
    return;
  }
  if (message.type === 'host/log') {
    args.setHostLogEntries((current) =>
      appendHostLogEntry(current, {
        level: message.level,
        message: message.message,
        at: new Date().toISOString(),
      }),
    );
    return;
  }
  if (message.type === 'response' && !message.success) {
    // Settings / discovery surface errors in-panel. Do not spam global sticky toasts.
    if (
      message.command === 'models/discover' ||
      message.command === 'models/test-connection' ||
      message.command === 'config/get' ||
      message.command === 'settings/get' ||
      message.command === 'settings/apply' ||
      isRemoteCommandGapError(message.error)
    ) {
      return;
    }
    dispatch({ type: 'error', message: message.error });
  }
}

/**
 * Connect, read host/status, then bootstrap config (local) or the projected
 * config (remote), configured models, theme and the active pet.
 */
export async function runHostBootstrap(rt: HostBootstrapRuntime): Promise<void> {
  const { args } = rt;
  const { hostClient, dispatch } = args;
  try {
    await hostClient.connect();
    if (rt.isCancelled()) {
      return;
    }
    const statusResponse = await hostClient.request({ type: 'host/status' });
    if (rt.isCancelled()) {
      return;
    }
    const ready = resolveShellHostReady({
      transport: hostClient.getTransport(),
      wireReady: hostClient.isReady(),
      statusSuccess: statusResponse.success,
      ...(statusResponse.success === true
        ? { statusReady: (statusResponse.data as HostStatusData).ready === true }
        : {}),
    });
    if (statusResponse.success) {
      const statusData = statusResponse.data as HostStatusData;
      rt.setHostStatus(statusData);
      dispatch({
        type: 'context-telemetry/capability',
        supported: hasContextTelemetryCapability(statusResponse.data),
      });
      void bootstrapExternalAgents(hostClient, dispatch, { refresh: true }).then((agents) => {
        syncReadyAgentCatalogs(hostClient, agents, rt.syncedReadyAgents);
      });
    }
    // Request path must update the shell pill; push-only left UI stuck offline after HMR.
    dispatch({
      type: 'host/status',
      ready,
      mock:
        statusResponse.success === true
          ? (statusResponse.data as HostStatusData).mock === true
          : false,
    });
  } catch (error) {
    if (rt.isCancelled() || isWorkbenchHostTeardownError(formatError(error))) {
      return;
    }
    dispatch({
      type: 'host/status',
      ready: resolveShellHostReady({
        transport: hostClient.getTransport(),
        wireReady: hostClient.isReady(),
        statusSuccess: false,
      }),
      mock: false,
    });
    dispatch({
      type: 'error',
      message: formatError(error),
    });
  }
  if (rt.isCancelled()) {
    return;
  }
  try {
    // Remote Hosts do not allow config/get (secrets). Skip it so General
    // session hydrate is not gated on a null config.
    if (hostClient.getTransport() !== 'remote') {
      const configResponse = await hostClient.request({ type: 'config/get' });
      if (configResponse.success) {
        const data = configResponse.data as { config?: PiwinConfig } | undefined;
        const nextConfig = data?.config;
        if (nextConfig !== undefined) {
          rt.setConfig(nextConfig);
        }
      }
      await applyConfiguredChatModels(
        hostClient,
        rt.setConfiguredChatModels,
        args.setSelectedModelKey,
      );
    } else {
      await applyConfiguredChatModels(
        hostClient,
        rt.setConfiguredChatModels,
        args.setSelectedModelKey,
      );
      const projected = await readProjectedHostConfig(hostClient);
      if (projected !== undefined) {
        rt.setConfig(projected);
        applyBootstrapSelectedModelKey(
          args.setSelectedModelKey,
          projected.defaultProviderId,
          projected.defaultModelId,
        );
      }
    }
  } catch {
    // Retry on hostReadyEpoch below; do not take down the shell.
  }
  if (hostClient.supportsCommand('theme/get-active')) {
    const themeResponse = await hostClient.request({ type: 'theme/get-active' });
    // DesktopThemeRoot already applied Appearance prefs at mount. Only push
    // library / installed packages from the host; Inkstone faces and the
    // three-color Appearance overrides must not stomp the user's mode
    // (that was a second theme flash). Retired ids are migrated first —
    // resolveDesktopAppearance rewrites retired defaults to Inkstone, so a
    // literal id check against the old names would miss and re-apply.
    const bootstrappedTheme = resolveThemeBootstrapResponse(themeResponse);
    if (!isAppearanceFaceId(bootstrappedTheme.id)) {
      args.onThemeResolved(bootstrappedTheme);
    }
  }
  if (hostClient.supportsCommand('pet/get-active')) {
    const petResponse = await hostClient.request({ type: 'pet/get-active' });
    if (petResponse.success) {
      const petData = petResponse.data as { pet: PetRuntimeSnapshot };
      rt.setActivePet(petData.pet);
    }
  }
}

/** Same class of bug as project/list: a cold sidecar makes the first
 * config/get fail; this retry runs when the Host actually becomes ready. */
export async function reloadConfigAfterHostReady(input: {
  hostClient: HostClient;
  isCancelled: () => boolean;
  setConfig: Dispatch<SetStateAction<PiwinConfig | null>>;
  setConfiguredChatModels: Dispatch<SetStateAction<ConfiguredChatModelsData>>;
  setSelectedModelKey: Dispatch<SetStateAction<string>>;
}): Promise<void> {
  const { hostClient } = input;
  try {
    if (hostClient.getTransport() === 'remote') {
      await applyConfiguredChatModels(
        hostClient,
        input.setConfiguredChatModels,
        input.setSelectedModelKey,
      );
      const projected = await readProjectedHostConfig(hostClient);
      if (!input.isCancelled() && projected !== undefined) {
        input.setConfig(projected);
        applyBootstrapSelectedModelKey(
          input.setSelectedModelKey,
          projected.defaultProviderId,
          projected.defaultModelId,
        );
      }
      return;
    }
    const configResponse = await hostClient.request({ type: 'config/get' });
    if (input.isCancelled() || !configResponse.success) {
      return;
    }
    const data = configResponse.data as { config?: PiwinConfig } | undefined;
    const nextConfig = data?.config;
    if (nextConfig !== undefined) {
      input.setConfig(nextConfig);
    }
    await applyConfiguredChatModels(
      hostClient,
      input.setConfiguredChatModels,
      input.setSelectedModelKey,
    );
  } catch {
    // Keep the shell up; the next ready epoch retries.
  }
}

/** Load historical assembly/context summaries for the active session. */
export async function fetchModelContextSummaries(input: {
  hostClient: HostClient;
  sessionId: string;
  isCancelled: () => boolean;
  setAssemblySummariesByRunId: Dispatch<SetStateAction<Record<string, ContextSummaryPush>>>;
}): Promise<void> {
  try {
    const response = await input.hostClient.request({
      type: 'session/model-context-summary',
      sessionId: input.sessionId,
    });
    if (input.isCancelled() || !response.success) return;
    const data = response.data as ModelContextSummaryData;
    input.setAssemblySummariesByRunId((current) => {
      const next = { ...current };
      for (const summary of data.summaries) {
        next[summary.runId] = summary;
        if (summary.userMessageId) {
          next[summary.userMessageId] = summary;
        }
      }
      return next;
    });
  } catch {
    // Historical assembly is best-effort; live pushes still populate the map.
  }
}

/** Restore the persisted session plan for the active session. */
export async function fetchSessionPlan(input: {
  hostClient: HostClient;
  sessionId: string;
  activeSessionId: string | null;
  isCancelled: () => boolean;
  setPlansBySessionId: Dispatch<SetStateAction<Record<string, SessionPlan | null>>>;
  dispatch: Dispatch<ChatUiAction>;
}): Promise<void> {
  if (input.hostClient.supportsCommand?.('plan/get') === false) {
    return;
  }
  try {
    const response = await input.hostClient.request({ type: 'plan/get', sessionId: input.sessionId });
    if (input.isCancelled() || !response.success) return;
    const data = response.data as { sessionId: string; plan: SessionPlan | null };
    input.setPlansBySessionId((current) =>
      cacheSessionPlan(current, data.sessionId, data.plan, input.activeSessionId),
    );
  } catch (error) {
    if (!input.isCancelled() && !isRemoteCommandGapError(formatError(error))) {
      input.dispatch({
        type: 'error',
        message: `Failed to restore session plan: ${formatError(error)}`,
      });
    }
  }
}

async function applyConfiguredChatModels(
  hostClient: HostClient,
  setConfiguredChatModels: Dispatch<SetStateAction<ConfiguredChatModelsData>>,
  setSelectedModelKey: Dispatch<SetStateAction<string>>,
): Promise<void> {
  const response = await hostClient.request({ type: 'models/configured' });
  if (!response.success) {
    return;
  }
  const next = readConfiguredChatModelsData(response.data);
  setConfiguredChatModels(next);
  applyBootstrapSelectedModelKey(setSelectedModelKey, next.defaultProviderId, next.defaultModelId);
}
