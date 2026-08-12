import { randomUUID } from 'node:crypto';
/**
 * Live session IPC: create/spawn/prompt/compact/export and sub-agent lifecycle.
 * HostRuntime provides SessionLiveContext (maps + ensureLiveSession/bindSession/…).
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve as resolvePath } from 'node:path';
import type {
  AgentHost,
  CreateSessionInput,
  CreateSessionOptions,
  ExecutionRunRecord,
  RunTerminalCode,
  HostCommand,
  HostPush,
  HostResponse,
  ModelRef,
  ThinkingLevel,
  PiwinConfig,
  PromptInput,
  SessionHandle,
  SessionCompactData,
  SessionCompactExportData,
  SessionCompactResult,
  SessionIndexRecord,
  SessionResumeData,
  SessionRunAcceptedData,
  SessionPauseAcceptedData,
  SessionPauseCheckpoint,
  SessionPauseCheckpointInput,
  SessionResumeRunAcceptedData,
  SessionTranscriptPageData,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import {
  SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
  SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
  formatError,
  DEFAULT_PERMISSION_PRESET,
  resolvePreset,
  mergeAgentModeIntoPrompt,
  resolveOrchestrationScheme,
  mergeOrchestrationSchemeIntoPrompt,
  OrchestrationSchemeError,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type ResolvedOrchestrationScheme,
} from '@piwin/contracts';
import type { RunAbortReason } from '../run-abort-reason.js';
import {
  createPauseRequestedAbortReason,
  createSupersededByNewPromptAbortReason,
  createUserStopAbortReason,
  formatRunAbortReason,
} from '../run-abort-reason.js';
import {
  clearSessionPlan,
  createSessionRecord,
  streamTranscriptExport,
  getSessionRecord,
  listChildSessions,
  loadSessionPlan,
  mergeProductHistoryIntoPrompt,
  saveSessionPlan,
  exportCompactionMarkdown,
  buildCompactionSeedMessages,
  suggestSessionExportBasename,
  suggestCompactionExportBasename,
  upsertSessionRecord,
  readToolOutputSnapshot,
  type SessionTranscriptStore,
} from '@piwin/session';
import { formatSideChatContextBlock, mergeSideChatContextIntoPrompt } from '@piwin/session';
import { redactToolText } from '@piwin/agent-host';
import { extractFileOpsFromUnknown, formatFilesTouchedBlock } from '../compaction-file-ops.js';
import { formatPlanForModelContext } from '../format-plan-context.js';
import { createProductShellSession } from '../product-shell-session.js';
import { resolvePromptContextRefs } from '../prompt/resolve-prompt-context-refs.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
} from '../paths.js';
import type { TranscriptRecorder } from '../transcript-recorder.js';
import { SessionRuntimeController } from '../sessions/session-runtime-controller.js';
import { createSessionMessageResponse } from '../session-message-response.js';
import {
  indexProjectPathForScope,
  resolveSessionLocation,
  scopeFromIndexRecord,
  workingDirectoryFromIndexRecord,
} from '../session-scope.js';
import { repairLegacySessionNames } from '../session-name-repair.js';

function listKnownChatModelKeys(config: PiwinConfig): string[] {
  return (config.providers ?? [])
    .filter((provider) => isProviderEnabled(provider))
    .flatMap((provider) =>
      provider.models
        .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
        .map((model) => `${provider.id}::${model.id}`),
    );
}

export type SessionLiveContext = {
  piwinRoot?: string;
  host: AgentHost;
  /** Loads the full piwin config from disk. Used by preparePromptInput for walkthrough config. */
  loadConfig: () => Promise<PiwinConfig>;
  /** ORCH: bind resolved scheme to a run (turn-scoped). */
  setRunOrchestrationScheme: (
    runId: string,
    scheme: ResolvedOrchestrationScheme | undefined,
  ) => void;
  /** ORCH: read scheme for the active/parent run (soft-generic spawn). */
  getRunOrchestrationScheme: (runId: string) => ResolvedOrchestrationScheme | undefined;
  /** Builtin + settings profile ids for scheme resolve validation. */
  listKnownSubagentProfileIds: () => Promise<string[]>;
  /** HostRuntime-owned creation seam for explicit integration fixtures. */
  createSession: (
    input: CreateSessionInput,
    options?: CreateSessionOptions,
  ) => Promise<SessionHandle>;
  sessions: Map<string, SessionHandle>;
  sessionFilesTouched: Map<string, string>;
  sessionLastPromptText: Map<string, string>;
  sessionModels: Map<string, ModelRef>;
  loadSessionUsage: (
    sessionId: string,
  ) => Promise<import('@piwin/contracts').ContextUsageSnapshot | null>;
  sessionAutoCompactionOverrides: Map<string, boolean>;
  unsubscribers: Map<string, () => void>;
  transcriptRecorders: Map<string, TranscriptRecorder>;
  /**
   * Session runtime generation registry (spec §12). Reports stale/live state
   * and validates explicit reloads; HostRuntime owns one instance.
   */
  runtimeController: SessionRuntimeController;
  push: (message: HostPush) => void;
  pushStatus: () => void;
  requireSession: (sessionId: string) => SessionHandle;
  bindSession: (
    session: SessionHandle,
    projectPath?: string,
    sessionName?: string,
    lineage?: {
      parentSessionId?: string;
      kind?: 'main' | 'subagent' | 'side-chat';
      depth?: number;
      subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
      task?: string;
      subagentMode?: 'readonly' | 'worktree';
      subagentApplyPolicy?: 'none' | 'auto' | 'explicit';
      subagentAllowedOutputPaths?: string[];
      subagentRetainWorktree?: boolean;
      subagentRole?: string;
      worktreePath?: string;
      worktreeBranch?: string;
      /** CE-SUB-PROF: immutable runtime snapshot (source of truth for resume). */
      subagentRuntime?: import('@piwin/contracts').SubagentRuntimeSnapshot;
      /** CE-SUB-LIFE: orthogonal execution/summary/integration state axes. */
      subagentLifecycle?: import('@piwin/contracts').SubagentLifecycleState;
    },
  ) => Promise<void>;
  loadTranscriptMessages: (sessionId: string) => Promise<SessionTranscriptMessage[]>;
  getTranscriptStore: (sessionId: string) => Promise<SessionTranscriptStore>;
  withTranscriptStore: <T>(
    sessionId: string,
    operation: (store: SessionTranscriptStore) => Promise<T>,
  ) => Promise<T>;
  /** SIDE: resolved inherited context snapshot for a side-chat session (undefined otherwise). */
  loadSideChatSnapshot: (
    sessionId: string,
  ) => Promise<import('@piwin/contracts').SideChatContextSnapshot | undefined>;
  /**
   * SIDE: last side-chat context version injected into a session's prompt.
   * Host injects the snapshot whenever the stored version is newer than the
   * injected one, so an explicit sync actually reaches the next prompt
   * (SIDE §7.5(5)) while a version-stable session stays untouched.
   */
  sideChatSnapshotInjectedVersions: Map<string, number>;
  stopProcessesForSession: (sessionId: string) => Promise<void>;
  recordUserPrompt: (sessionId: string, input: PromptInput) => Promise<void>;
  touchSession: (sessionId: string, previewText: string) => Promise<void>;
  needsProductHistoryInjection: (sessionId: string) => boolean;
  ensureLiveSession: (sessionId: string) => Promise<SessionHandle>;
  /**
   * ADR 0040 §7: Host-owned cold activation. Returns the resident handle,
   * creating a fresh runtime generation for the stable product session id
   * when the session is cold. Deduplicated by session id. `runId` attaches
   * the new generation to the already accepted Run before tool admission.
   */
  activateSessionRuntime: (
    sessionId: string,
    runId?: string,
    signal?: AbortSignal,
  ) => Promise<SessionHandle>;
  /** Clear the one-shot product-history injection for a reconstructed runtime. */
  markProductHistoryInjected: (sessionId: string) => void;
  /**
   * ADR 0040 §5: acquire an explicit residency protection lease (compaction
   * or any backend operation not represented in RunRegistry). Returns false
   * when no resident runtime exists for the session.
   */
  protectRuntime: (sessionId: string) => boolean;
  /** Release one residency protection lease. */
  releaseRuntimeProtection: (sessionId: string) => void;
  resolveAutoCompaction: (
    sessionId: string,
  ) => Promise<{ enabled: boolean; source: string; globalDefault: boolean }>;
  buildModelPromptInput: (input: PromptInput, signal?: AbortSignal) => Promise<PromptInput>;
  /** Sync media-root validation before accepting a run. */
  validatePromptAttachments: (input: PromptInput) => void;
  runWithContext: (runId: string, operation: () => Promise<void>) => void;
  /** Flush queued transcript rows before a checkpoint is made durable. */
  flushTranscriptRecorder?: (sessionId: string) => Promise<void>;
  /** RunRegistry-backed foreground lifecycle. */
  getForegroundRun: (sessionId: string) => ExecutionRunRecord | undefined;
  registerForegroundRun: (
    sessionId: string,
    resumeCheckpointId?: string,
  ) => ExecutionRunRecord;
  getRunSignal: (runId: string) => AbortSignal | undefined;
  hasRunReceivedFirstToken: (runId: string) => boolean;
  requestCancelRun: (
    sessionId: string,
    runId?: string,
    reason?: RunAbortReason,
  ) => ExecutionRunRecord | undefined;
  requestPauseRun: (
    sessionId: string,
    runId?: string,
    reason?: RunAbortReason,
  ) => ExecutionRunRecord | undefined;
  isPauseRequested: (runId: string) => boolean;
  hasActiveDescendants: (runId: string) => boolean;
  attachResumeCheckpoint: (runId: string, checkpointId: string) => void;
  getActivePauseCheckpoint: (sessionId: string) => Promise<SessionPauseCheckpoint | undefined>;
  getPauseCheckpoint: (
    sessionId: string,
    checkpointId: string,
  ) => Promise<SessionPauseCheckpoint | undefined>;
  createPauseCheckpoint: (
    sessionId: string,
    input: SessionPauseCheckpointInput,
  ) => Promise<SessionPauseCheckpoint>;
  consumePauseCheckpoint: (sessionId: string, checkpointId: string) => Promise<boolean>;
  clearPauseCheckpoint: (sessionId: string, checkpointId?: string) => Promise<boolean>;
  updateRunPhase: (
    runId: string,
    phase: import('@piwin/contracts').SessionRunPhase,
    detail?: string,
  ) => void;
  terminateRun: (
    sessionId: string,
    runId: string,
    outcome: 'completed' | 'cancelled' | 'failed' | 'paused',
    code?: RunTerminalCode,
    message?: string,
  ) => boolean | Promise<boolean>;
  settlePendingPermissionsForSession: (sessionId: string) => void;
  /** Resolve Extension UI waits so Stop cannot leave a Pi prompt suspended. */
  settlePendingExtensionUiForSession: (sessionId: string) => void;
  setSessionPermissionOverride: (
    sessionId: string,
    mode: import('@piwin/contracts').PermissionMode,
  ) => void;
  clearSessionPermissionOverride: (sessionId: string) => void;
  /**
   * Clear run correlator / terminal-run memory for a session after truncate so
   * rebuilt shells do not inherit stale ownership from the aborted handle.
   */
  resetSessionEventState?: (sessionId: string) => void;
  /** Cancel an in-flight runtime replacement before dropping the live session. */
  cancelRuntimeReplacement: (sessionId: string) => Promise<void>;
  /** Drop runtime-only state while preserving durable session/index data. */
  disposeLiveSession: (
    sessionId: string,
    reason?: import('@piwin/contracts').SessionRuntimeEvictionReason,
  ) => Promise<void>;
  reloadRuntime: (request: {
    sessionId: string;
    expectedSettingsRevision: string;
    when: 'now' | 'after-current-run';
  }) => Promise<{ generationId: string; settingsRevision: string }>;
};

const TYPES = new Set<HostCommand['type']>([
  'session/create',
  'session/list-children',
  'session/truncate-from',
  'session/resume',
  'session/outline-page',
  'session/transcript-page',
  'session/messages',
  'session/prompt',
  'session/pause',
  'session/resume-run',
  'session/abort',
  'session/steer',
  'session/follow_up',
  'session/compact',
  'session/compact-export',
  'session/compact-abort',
  'session/compaction-settings',
  'session/set-auto-compaction',
  'session/export',
  'session/tool-output',
  'session/message-child',
  'session/runtime-status',
  'session/reload-runtime',
]);

export function isSessionLiveCommand(command: HostCommand): boolean {
  return TYPES.has(command.type);
}

/**
 * One compaction implementation shared by the slash command and compact
 * export. The export flow uses the same Pi compact operation, but suppresses
 * live-session bookkeeping when it runs on an ephemeral snapshot.
 */
async function compactLiveSession(
  context: SessionLiveContext,
  sessionId: string,
  customInstructions?: string,
): Promise<SessionCompactResult> {
  const session = context.requireSession(sessionId);
  return compactSessionHandle(context, sessionId, session, customInstructions, true);
}

async function compactSessionHandle(
  context: SessionLiveContext,
  sessionId: string,
  session: SessionHandle,
  customInstructions: string | undefined,
  emitSessionFacts: boolean,
): Promise<SessionCompactResult> {
  const compact = session.compact;
  if (!compact) {
    throw new Error('compaction is not supported on this session (RPC or inactive product shell)');
  }

  const startedAt = Date.now();
  // ADR 0040 §5: compaction is a backend operation outside RunRegistry, so it
  // takes an explicit residency protection lease — a compacting runtime is
  // never evicted.
  const protectedRuntime = context.protectRuntime(sessionId);
  try {
    const result = customInstructions ? await compact(customInstructions) : await compact();
    const durationMs =
      typeof result.durationMs === 'number' ? result.durationMs : Date.now() - startedAt;
    const fileOps =
      result.fileOps ??
      extractFileOpsFromUnknown(result) ??
      extractFileOpsFromUnknown({ summary: result.summary });
    const enrichedResult: SessionCompactResult = {
      ...result,
      durationMs,
      ...(fileOps ? { fileOps } : {}),
    };

    if (emitSessionFacts && fileOps) {
      const block = formatFilesTouchedBlock(fileOps);
      context.sessionFilesTouched.set(sessionId, block);
      context.push({
        type: 'event',
        sessionId,
        event: {
          type: 'compaction/end',
          ok: enrichedResult.ok,
          ...(enrichedResult.message ? { message: enrichedResult.message } : {}),
          ...(enrichedResult.summary ? { summary: enrichedResult.summary } : {}),
          ...(typeof enrichedResult.tokensBefore === 'number'
            ? { tokensBefore: enrichedResult.tokensBefore }
            : {}),
          ...(typeof enrichedResult.tokensAfter === 'number'
            ? { tokensAfter: enrichedResult.tokensAfter }
            : {}),
          durationMs,
          fileOps,
        },
      });
    }

    return enrichedResult;
  } finally {
    if (protectedRuntime) {
      context.releaseRuntimeProtection(sessionId);
    }
  }
}

/**
 * Compact a disposable copy of the product transcript. `duplicate`'s public
 * command persists a new session, so this flow reuses its pure clone
 * primitive and only passes the clone into Pi's in-memory session manager.
 */
async function compactTranscriptSnapshot(
  context: SessionLiveContext,
  record: SessionIndexRecord,
  customInstructions?: string,
): Promise<SessionCompactResult> {
  const history = await context.withTranscriptStore(record.id, (store) =>
    store.buildHistoryWindow({ maxMessages: 200, maxChars: 200_000 }),
  );
  const snapshotMessages: SessionTranscriptMessage[] = history.map((message, index) => ({
    id: `compact-history-${index}`,
    role: message.role as SessionTranscriptMessage['role'],
    text: message.text,
    createdAt: new Date().toISOString(),
    status: 'done',
  }));
  const seedMessages = buildCompactionSeedMessages(snapshotMessages);
  if (seedMessages.length === 0) {
    return { ok: false, message: 'Session has no messages to summarize' };
  }
  seedMessages.push({
    role: 'user',
    text: '[Internal snapshot boundary: summarize the preceding conversation.]',
    timestamp: Date.now(),
  });

  const createInput: CreateSessionInput = {
    projectPath: record.projectPath,
    ...(record.scope ? { scope: record.scope } : {}),
    ...(record.workingDirectory ? { cwd: record.workingDirectory } : {}),
    ...(record.name ? { sessionName: record.name } : {}),
  };
  let temporarySession: SessionHandle | undefined;
  let operationFailed = false;
  let operationError: unknown;
  try {
    temporarySession = await context.createSession(createInput, { seedMessages });
    return await compactSessionHandle(
      context,
      temporarySession.id,
      temporarySession,
      customInstructions,
      false,
    );
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    if (temporarySession) {
      try {
        await context.disposeLiveSession(temporarySession.id);
      } catch (cleanupError) {
        if (operationFailed) {
          throw new AggregateError(
            [operationError, cleanupError],
            `failed to clean up compact snapshot ${temporarySession.id}`,
          );
        }
        throw cleanupError;
      }
    }
  }
}

function toSessionCompactData(result: SessionCompactResult): SessionCompactData {
  const data: SessionCompactData = { ok: result.ok };
  if (result.message) data.message = result.message;
  if (result.summary) data.summary = result.summary;
  if (typeof result.tokensBefore === 'number') data.tokensBefore = result.tokensBefore;
  if (typeof result.tokensAfter === 'number') data.tokensAfter = result.tokensAfter;
  if (typeof result.durationMs === 'number') data.durationMs = result.durationMs;
  if (result.fileOps) data.fileOps = result.fileOps;
  return data;
}

function resolveSessionOutputPath(
  rootDir: string,
  sessionId: string,
  requestedPath: string | undefined,
  defaultBasename: string,
): string {
  if (requestedPath && requestedPath.trim()) {
    const candidate = requestedPath.trim();
    return isAbsolute(candidate) ? candidate : resolvePath(candidate);
  }
  return resolvePath(getPiwinSessionDir(rootDir, sessionId), 'exports', defaultBasename);
}

type PromptCommand = Extract<HostCommand, { type: 'session/prompt' }>;

const RESUME_CONTINUATION_PROMPT =
  'Continue the interrupted task from the current transcript and tool state. First inspect what has already been completed and any partial output; do not repeat successful side effects. Then continue only the unfinished work and report what remains.';

class PromptPreparationCancelledError extends Error {
  constructor() {
    super('prompt preparation cancelled');
    this.name = 'PromptPreparationCancelledError';
  }
}

function throwIfPromptPreparationAborted(context: SessionLiveContext, runId: string): void {
  if (context.getRunSignal(runId)?.aborted) {
    throw new PromptPreparationCancelledError();
  }
}

async function preparePromptInput(
  context: SessionLiveContext,
  command: PromptCommand,
  run: ExecutionRunRecord,
): Promise<PromptInput> {
  throwIfPromptPreparationAborted(context, run.runId);

  // Persist ordinary user text + attachments before path-injection rewrite.
  // A resume continuation is Host-authored and must not create a fake user row.
  if (command.input.source !== 'resume') {
    try {
      await context.recordUserPrompt(command.sessionId, command.input);
    } catch (error) {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `transcript user write failed: ${message}`,
      });
    }
  }
  throwIfPromptPreparationAborted(context, run.runId);

  const hasImage =
    command.input.attachments?.some(
      (item) =>
        item.kind === 'media' &&
        (item.contentKind === 'image' ||
          (item.contentKind === undefined && item.mimeType.toLowerCase().startsWith('image/'))),
    ) === true;
  if (hasImage) {
    // Surface image preparation while vision delegation may run inside buildModelPromptInput.
    context.updateRunPhase(run.runId, 'preparing', 'Preparing image…');
  }

  // Always clone before model-facing rewrites. buildModelPromptInput may return
  // the same object when there are no attachments; mutating that would poison
  // command.input (transcript path, touchSession preview, last-prompt text).
  const preparedFromHost = await context.buildModelPromptInput(
    command.input,
    context.getRunSignal(run.runId),
  );
  const promptInput: PromptInput = {
    ...preparedFromHost,
    text: preparedFromHost.text,
    ...(preparedFromHost.attachments ? { attachments: [...preparedFromHost.attachments] } : {}),
  };
  throwIfPromptPreparationAborted(context, run.runId);

  // SIDE §7.5(5)/§9.2: inject the side chat's inherited context snapshot
  // whenever the stored context version is newer than the version already
  // injected into this session. This covers the first prompt after
  // open/resume (no injected version yet) AND every explicit sync afterwards —
  // a version-stable session is never re-injected. The side chat's own
  // transcript is handled separately by product-history injection.
  const sideChatSnapshot = await context.loadSideChatSnapshot(command.sessionId);
  throwIfPromptPreparationAborted(context, run.runId);
  if (sideChatSnapshot) {
    const injectedVersion = context.sideChatSnapshotInjectedVersions.get(command.sessionId);
    if (injectedVersion === undefined || injectedVersion < sideChatSnapshot.version) {
      const sideBlock = formatSideChatContextBlock(sideChatSnapshot);
      promptInput.text = mergeSideChatContextIntoPrompt(sideBlock, promptInput.text);
      context.sideChatSnapshotInjectedVersions.set(command.sessionId, sideChatSnapshot.version);
      // SIDE §7.2: refs captured at open/sync are part of the shared context —
      // resolve them alongside the snapshot block on injection.
      if (sideChatSnapshot.refs.length > 0) {
        const refText = await resolvePromptContextRefs(
          { loadTranscriptMessages: context.loadTranscriptMessages },
          sideChatSnapshot.refs,
        );
        throwIfPromptPreparationAborted(context, run.runId);
        if (refText) {
          promptInput.text = `${refText}\n\n${promptInput.text}`;
        }
      }
    }
  }
  throwIfPromptPreparationAborted(context, run.runId);

  // SIDE §8.2: resolve handoff context refs (side-chat-message / main-message
  // / file / diff / terminal-output / error) into the model prompt without
  // mutating the recorded user transcript.
  if (command.input.contextRefs && command.input.contextRefs.length > 0) {
    try {
      const resolvedContext = await resolvePromptContextRefs(
        { loadTranscriptMessages: context.loadTranscriptMessages },
        command.input.contextRefs,
      );
      if (resolvedContext) {
        promptInput.text = `${resolvedContext}\n\n${promptInput.text}`;
      }
    } catch (error) {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `context ref resolve failed: ${message}`,
      });
    }
  }
  throwIfPromptPreparationAborted(context, run.runId);

  // Agent mode permission floor: when plan/ask mode is active, raise the
  // permission floor to ask-all + read-only so parent-owned registrations enforce it.
  const agentMode = command.input.agentMode;
  if (agentMode === 'plan' || agentMode === 'ask') {
    try {
      const config = await context.loadConfig();
      const preset = config.permissions?.preset ?? DEFAULT_PERMISSION_PRESET;
      const resolved = resolvePreset(preset, agentMode);
      context.setSessionPermissionOverride(command.sessionId, resolved.mode);
    } catch {
      // Best-effort: config load failure should not block the prompt.
    }
  } else {
    context.clearSessionPermissionOverride(command.sessionId);
  }

  // Agent mode operating contract: model-facing only. Transcript already
  // recorded the original command.input (user text only) so naming stays clean.
  if (command.input.agentMode) {
    promptInput.text = mergeAgentModeIntoPrompt(command.input.agentMode, promptInput.text);
  }

  // ORCH: per-send orchestration scheme — inject model-facing preamble only.
  // Transcript already recorded original command.input (user text only).
  const schemeIdRaw = command.input.orchestrationSchemeId;
  if (schemeIdRaw && schemeIdRaw.trim() && schemeIdRaw.trim() !== 'off') {
    const config = await context.loadConfig();
    const knownProfileIds = await context.listKnownSubagentProfileIds();
    const subagents = config.subagents;
    const resolved = resolveOrchestrationScheme(
      {
        schemes: subagents?.schemes,
        maxConcurrency: subagents?.maxConcurrency,
        maxTasksPerRun: subagents?.maxTasksPerRun,
      },
      schemeIdRaw,
      {
        knownProfileIds,
        knownModelKeys: listKnownChatModelKeys(config),
        globalMaxConcurrency: subagents?.maxConcurrency,
        globalMaxTasksPerRun: subagents?.maxTasksPerRun,
      },
    );
    if (resolved) {
      context.setRunOrchestrationScheme(run.runId, resolved);
      promptInput.text = mergeOrchestrationSchemeIntoPrompt(resolved, promptInput.text);
    }
  } else {
    context.setRunOrchestrationScheme(run.runId, undefined);
  }

  const planPath = getPiwinSessionPlanPath(getPiwinRoot(context.piwinRoot), command.sessionId);
  const activePlan = await loadSessionPlan(planPath);
  throwIfPromptPreparationAborted(context, run.runId);
  if (activePlan && (activePlan.status === 'approved' || activePlan.status === 'executing')) {
    promptInput.text = `${formatPlanForModelContext(activePlan)}\n\n${promptInput.text}`;
  }

  throwIfPromptPreparationAborted(context, run.runId);

  const filesTouched = context.sessionFilesTouched.get(command.sessionId);
  if (filesTouched) {
    promptInput.text = `${filesTouched}\n\n${promptInput.text}`;
  }

  // ADR 0026: concisePrompt injection retired with walkthrough generation.
  throwIfPromptPreparationAborted(context, run.runId);
  context.sessionLastPromptText.set(command.sessionId, command.input.text);
  if (command.input.model) {
    context.sessionModels.set(command.sessionId, command.input.model);
    // Persist the composer model on the session index so resume/open restores
    // the last-used model instead of falling back to the desktop default.
    await persistSessionComposerProfile(context, command.sessionId, {
      model: command.input.model,
      ...(command.input.thinkingLevel !== undefined
        ? { thinkingLevel: command.input.thinkingLevel }
        : {}),
    });
  }
  throwIfPromptPreparationAborted(context, run.runId);
  return promptInput;
}

/**
 * ADR 0040 §7(6): inject bounded product history into the model prompt exactly
 * once for a reconstructed runtime generation. Called after cold activation so
 * the marker set by activation is honored; later turns reuse the backend's own
 * conversation state and never see duplicate history.
 */
async function injectProductHistoryOnce(
  context: SessionLiveContext,
  sessionId: string,
  promptInput: PromptInput,
): Promise<void> {
  if (!context.needsProductHistoryInjection(sessionId)) {
    return;
  }
  try {
    const store = await context.getTranscriptStore(sessionId);
    const historyRows = await store.buildHistoryWindow({
      maxMessages: 40,
      maxChars: 24_000,
      ...(promptInput.clientMessageId !== undefined
        ? { excludeMessageId: promptInput.clientMessageId }
        : {}),
    });
    const history = formatBoundedHistory(historyRows);
    if (history) {
      promptInput.text = mergeProductHistoryIntoPrompt(history, promptInput.text);
    }
  } catch (error) {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `product history inject failed: ${message}`,
    });
  }
  context.markProductHistoryInjected(sessionId);
}

function formatBoundedHistory(rows: ReadonlyArray<{ role: string; text: string }>): string {
  if (rows.length === 0) {
    return '';
  }
  const lines = [
    '[piwin-product-history]',
    'Prior conversation (product transcript; not Pi JSONL):',
  ];
  for (const row of rows) {
    const role = row.role === 'user' ? 'User' : row.role === 'assistant' ? 'Assistant' : 'System';
    lines.push(`${role}: ${row.text.trim()}`);
  }
  lines.push('[/piwin-product-history]');
  return lines.join('\n');
}

/**
 * Persist the last composer model/thinking onto the product session index so
 * resume and session switch can restore them after process restart.
 */
async function persistSessionComposerProfile(
  context: SessionLiveContext,
  sessionId: string,
  profile: { model?: ModelRef; thinkingLevel?: ThinkingLevel },
): Promise<void> {
  if (!profile.model && profile.thinkingLevel === undefined) {
    return;
  }
  const rootDir = getPiwinRoot(context.piwinRoot);
  const indexPath = getPiwinSessionIndexPath(rootDir);
  const record = await getSessionRecord(indexPath, sessionId);
  if (!record) {
    return;
  }
  let changed = false;
  if (profile.model) {
    const previous = record.model;
    const sameModel =
      previous &&
      previous.protocol === profile.model.protocol &&
      previous.providerId === profile.model.providerId &&
      previous.modelId === profile.model.modelId;
    if (!sameModel) {
      record.model = profile.model;
      changed = true;
    }
  }
  if (profile.thinkingLevel !== undefined && record.thinkingLevel !== profile.thinkingLevel) {
    record.thinkingLevel = profile.thinkingLevel;
    changed = true;
  }
  if (!changed) {
    return;
  }
  record.updatedAt = new Date().toISOString();
  await upsertSessionRecord(indexPath, record);
}

/** Recover the last assistant model snapshot from transcript (legacy sessions). */
function recoverModelFromTranscript(
  messages: readonly SessionTranscriptMessage[],
): ModelRef | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === 'assistant' && message.model) {
      return message.model;
    }
  }
  return undefined;
}

export async function handleSessionLiveCommand(
  command: HostCommand,
  requestId: string | undefined,
  context: SessionLiveContext,
): Promise<HostResponse | null> {
  if (!TYPES.has(command.type)) {
    return null;
  }
  switch (command.type) {
    case 'session/create': {
      let createInput = command.input;
      try {
        const location = await resolveSessionLocation(command.input, context.piwinRoot);
        createInput = {
          ...command.input,
          scope: location.scope,
          // Index field: empty for general. Adapters re-resolve workingDirectory.
          projectPath: indexProjectPathForScope(location.scope),
        };
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/create', message);
      }
      const session = await context.createSession(createInput);
      const lineage: {
        parentSessionId?: string;
        kind?: 'main' | 'subagent';
        depth?: number;
        subagentStatus?: 'running' | 'done' | 'failed' | 'cancelled';
        task?: string;
      } = {
        kind: command.input.parentSessionId ? 'subagent' : 'main',
        depth: command.input.parentSessionId ? 1 : 0,
      };
      if (command.input.parentSessionId) {
        lineage.parentSessionId = command.input.parentSessionId;
        lineage.subagentStatus = 'running';
      }
      if (command.input.task) {
        lineage.task = command.input.task;
      }
      try {
        await context.bindSession(
          session,
          createInput.projectPath,
          command.input.sessionName,
          lineage,
        );
      } catch (error) {
        await context.disposeLiveSession(session.id).catch(() => undefined);
        throw error;
      }
      // Seed the session composer profile at create time so a new session
      // remembers the model even before the first prompt is sent.
      if (command.input.model || command.input.thinkingLevel !== undefined) {
        if (command.input.model) {
          context.sessionModels.set(session.id, command.input.model);
        }
        await persistSessionComposerProfile(context, session.id, {
          ...(command.input.model ? { model: command.input.model } : {}),
          ...(command.input.thinkingLevel !== undefined
            ? { thinkingLevel: command.input.thinkingLevel }
            : {}),
        });
      }
      context.pushStatus();
      return ok(requestId, 'session/create', {
        sessionId: session.id,
      });
    }
    case 'session/list-children': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const children = await listChildSessions(
        getPiwinSessionIndexPath(rootDir),
        command.parentSessionId,
      );
      return ok(requestId, 'session/list-children', {
        parentSessionId: command.parentSessionId,
        sessions: children,
      });
    }
    case 'session/truncate-from': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/truncate-from', `Unknown session: ${command.sessionId}`);
      }
      const store = await context.getTranscriptStore(command.sessionId);
      if ((await store.getMessage(command.messageId)) === undefined) {
        return fail(
          requestId,
          'session/truncate-from',
          `Message not found in transcript: ${command.messageId}`,
        );
      }
      // Runtime reset is a Host lifecycle transaction: it cancels replacement
      // and active work, flushes/detaches the generation, releases residency,
      // and preserves the durable session record that is about to be cut.
      await context.disposeLiveSession(command.sessionId, 'manual');
      const truncated = await store.truncateFrom(command.messageId);
      if (!truncated.found) {
        throw new Error(`Transcript changed before truncate: ${command.messageId}`);
      }
      // ADR 0040 §7: no eager rebuild. The next session/prompt activates a
      // fresh runtime generation for the stable product session id and
      // injects the truncated product history exactly once. Keep the durable
      // history requirement pending so a cold prompt rebuilds from the cut
      // transcript only.
      const remaining = await store.listTail(50);
      record.messageCount = truncated.remainingCount;
      const last = remaining.at(-1);
      if (last?.text) {
        record.lastPreview = last.text.slice(0, 160);
      } else {
        delete record.lastPreview;
      }
      record.updatedAt = new Date().toISOString();
      await upsertSessionRecord(indexPath, record);
      return ok(requestId, 'session/truncate-from', {
        sessionId: command.sessionId,
        removedCount: truncated.removedCount,
        remainingCount: truncated.remainingCount,
        ...createSessionMessageResponse(command.sessionId, remaining, command.messageProjection),
        session: indexRecordToSummary(record),
      });
    }
    case 'session/resume': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      let existing = await getSessionRecord(indexPath, command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/resume', `Unknown session: ${command.sessionId}`);
      }
      const store = await context.getTranscriptStore(command.sessionId);
      const transcriptPage = await store.transcriptPage({
        sessionId: command.sessionId,
        limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
        maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
      });
      if (transcriptPage.status !== 'page') {
        throw new Error('Cursorless transcript tail unexpectedly returned stale');
      }
      const firstUserMessage = await store.firstMessageByRole('user');
      const [repairedExisting] = await repairLegacySessionNames({
        indexPath,
        records: [existing],
        loadTranscriptMessages: async () =>
          firstUserMessage === undefined ? [] : [firstUserMessage],
        onRepaired: (record) => {
          if (record.name) {
            context.push({
              type: 'session/name-updated',
              sessionId: record.id,
              name: record.name,
              nameSource: 'text',
            });
          }
        },
        onWarning: (message) => {
          context.push({ type: 'host/log', level: 'warn', message });
        },
      });
      existing = repairedExisting ?? existing;
      // Durable read (ADR 0040 §1): selecting a chat must not allocate a Pi
      // session or worker. Only a bounded newest page is returned; older
      // history stays Host-owned and is paged on demand.
      // Residency is actual bound-handle state, not product-session existence.
      const live = context.sessions.has(command.sessionId);
      // Restore the last composer model into the in-memory map so subsequent
      // host features (walkthrough, naming, transcript snapshot) see it even
      // before the next prompt. Prefer index, then last assistant message.
      const restoredModel = existing.model ?? (await store.recentModel()) ?? undefined;
      if (restoredModel) {
        context.sessionModels.set(command.sessionId, restoredModel);
      }
      const restoredUsage = await context.loadSessionUsage(command.sessionId);
      const data: SessionResumeData = {
        sessionId: command.sessionId,
        live,
        messages: transcriptPage.messages,
        transcriptPage: transcriptPage.page,
        projectPath: existing.projectPath,
        // ADR 0040 §9: bounded recent window, never the complete outline.
        outline: (await store.outlinePage({ sessionId: command.sessionId, limit: 40 })).nodes,
      };
      const pauseCheckpoint = await store.getActivePauseCheckpoint();
      if (pauseCheckpoint !== undefined) {
        data.pauseCheckpoint = pauseCheckpoint;
      }
      const resumeScope = scopeFromIndexRecord(existing);
      data.scope = resumeScope;
      const resumeWorkingDirectory = workingDirectoryFromIndexRecord(existing);
      if (resumeWorkingDirectory) {
        data.workingDirectory = resumeWorkingDirectory;
      }
      if (existing.name) {
        data.name = existing.name;
      }
      if (restoredModel) {
        data.model = restoredModel;
      }
      if (existing.thinkingLevel) {
        data.thinkingLevel = existing.thinkingLevel;
      }
      if (restoredUsage) {
        data.contextUsage = restoredUsage;
      }
      return ok(requestId, 'session/resume', data);
    }
    case 'session/outline-page': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.query.sessionId,
      );
      if (!existing) {
        return fail(
          requestId,
          'session/outline-page',
          `Unknown session: ${command.query.sessionId}`,
        );
      }
      try {
        const page = await (
          await context.getTranscriptStore(command.query.sessionId)
        ).outlinePage(command.query);
        return ok(requestId, 'session/outline-page', page);
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/outline-page', error.message);
        }
        throw error;
      }
    }
    case 'session/transcript-page': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(
        getPiwinSessionIndexPath(rootDir),
        command.query.sessionId,
      );
      if (!existing) {
        return fail(
          requestId,
          'session/transcript-page',
          `Unknown session: ${command.query.sessionId}`,
        );
      }
      try {
        const page = await (
          await context.getTranscriptStore(command.query.sessionId)
        ).transcriptPage(command.query);
        return ok(requestId, 'session/transcript-page', page);
      } catch (error) {
        if (error instanceof RangeError) {
          return fail(requestId, 'session/transcript-page', error.message);
        }
        throw error;
      }
    }
    case 'session/runtime-status': {
      // ADR 0040: cold sessions have no live handle but still need truthful
      // residency diagnostics (Cold + lastEvictionReason). Accept any durable
      // product session id; do not require a resident runtime.
      const rootDir = getPiwinRoot(context.piwinRoot);
      const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), command.sessionId);
      if (!record && !context.sessions.has(command.sessionId)) {
        return fail(requestId, 'session/runtime-status', `Unknown session: ${command.sessionId}`);
      }
      const status = context.runtimeController.getStatus(command.sessionId);
      const pauseCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
      if (pauseCheckpoint !== undefined) {
        status.pauseCheckpoint = pauseCheckpoint;
      }
      return ok(requestId, 'session/runtime-status', { status });
    }
    case 'session/reload-runtime': {
      context.requireSession(command.sessionId);
      try {
        const result = await context.reloadRuntime({
          sessionId: command.sessionId,
          expectedSettingsRevision: command.expectedSettingsRevision,
          when: command.when,
        });
        return ok(requestId, 'session/reload-runtime', {
          sessionId: command.sessionId,
          generationId: result.generationId,
          settingsRevision: result.settingsRevision,
          state: 'active' as const,
        });
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/reload-runtime', message);
      }
    }
    case 'session/messages': {
      const page = await (
        await context.getTranscriptStore(command.sessionId)
      ).transcriptPage({
        sessionId: command.sessionId,
        limit: SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS,
        maximumBytes: SESSION_TRANSCRIPT_PAGE_DEFAULT_BYTES,
      });
      if (page.status !== 'page') {
        throw new Error('Cursorless transcript tail unexpectedly returned stale');
      }
      return ok(requestId, 'session/messages', {
        sessionId: command.sessionId,
        messages: page.messages,
      });
    }
    case 'session/pause': {
      const activeCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        if (activeCheckpoint !== undefined) {
          const data: SessionPauseAcceptedData = {
            sessionId: command.sessionId,
            state: 'paused',
            checkpointId: activeCheckpoint.checkpointId,
          };
          return ok(requestId, 'session/pause', data);
        }
        context.settlePendingExtensionUiForSession(command.sessionId);
        const data: SessionPauseAcceptedData = {
          sessionId: command.sessionId,
          state: 'paused',
          reason: 'no-active-run',
        };
        return ok(requestId, 'session/pause', data);
      }
      if (command.runId !== undefined && command.runId !== active.runId) {
        const data: SessionPauseAcceptedData = {
          sessionId: command.sessionId,
          runId: active.runId,
          state: 'pausing',
          reason: 'run-mismatch',
        };
        return ok(requestId, 'session/pause', data);
      }
      if (context.isPauseRequested(active.runId)) {
        const data: SessionPauseAcceptedData = {
          sessionId: command.sessionId,
          runId: active.runId,
          state: 'pausing',
        };
        return ok(requestId, 'session/pause', data);
      }
      if (context.hasActiveDescendants(active.runId)) {
        return fail(
          requestId,
          'session/pause',
          'pause-unsupported-active-descendants: foreground run owns active child runs',
        );
      }
      const pauseReason = createPauseRequestedAbortReason();
      context.updateRunPhase(active.runId, 'pausing', 'Saving a resumable checkpoint');
      const requested = context.requestPauseRun(command.sessionId, active.runId, pauseReason);
      if (!requested) {
        return ok(requestId, 'session/pause', {
          sessionId: command.sessionId,
          state: 'paused',
          reason: 'no-active-run',
        } satisfies SessionPauseAcceptedData);
      }
      context.settlePendingPermissionsForSession(command.sessionId);
      context.settlePendingExtensionUiForSession(command.sessionId);
      schedulePauseCleanup(context, command.sessionId, active.runId);
      return ok(requestId, 'session/pause', {
        sessionId: command.sessionId,
        runId: active.runId,
        state: 'pausing',
      } satisfies SessionPauseAcceptedData);
    }
    case 'session/resume-run': {
      const active = context.getForegroundRun(command.sessionId);
      if (active) {
        return fail(
          requestId,
          'session/resume-run',
          `run-active: session ${command.sessionId} already has foreground run ${active.runId}`,
        );
      }
      const checkpoint =
        command.checkpointId === undefined
          ? await context.getActivePauseCheckpoint(command.sessionId)
          : await context.getPauseCheckpoint(command.sessionId, command.checkpointId);
      if (checkpoint === undefined || checkpoint.status !== 'active') {
        return fail(
          requestId,
          'session/resume-run',
          `no-active-checkpoint: session ${command.sessionId} has no resumable checkpoint`,
        );
      }
      const resumePrompt: HostCommand = {
        ...(command.id !== undefined ? { id: command.id } : {}),
        type: 'session/prompt',
        sessionId: command.sessionId,
        input: {
          text: RESUME_CONTINUATION_PROMPT,
          source: 'resume',
          resumeCheckpointId: checkpoint.checkpointId,
        },
      };
      const response = await handleSessionLiveCommand(resumePrompt, requestId, context);
      if (response === null) {
        return fail(requestId, 'session/resume-run', 'resume prompt was not accepted');
      }
      if (!response.success) {
        return fail(requestId, 'session/resume-run', response.error);
      }
      const accepted = response.data as SessionRunAcceptedData | undefined;
      if (accepted === undefined || typeof accepted.runId !== 'string') {
        return fail(requestId, 'session/resume-run', 'resume prompt acknowledgement was invalid');
      }
      const data: SessionResumeRunAcceptedData = {
        sessionId: command.sessionId,
        runId: accepted.runId,
        checkpointId: checkpoint.checkpointId,
        acceptedAt: accepted.acceptedAt,
      };
      return ok(requestId, 'session/resume-run', data);
    }
    case 'session/prompt': {
      const persistedPlanIntent =
        command.input.skillId === 'writing-plans'
          ? ('writing-plans-skill' as const)
          : command.input.agentMode === 'plan'
            ? ('plan-mode' as const)
            : null;
      const planPath = persistedPlanIntent
        ? getPiwinSessionPlanPath(getPiwinRoot(context.piwinRoot), command.sessionId)
        : undefined;
      const startingPlan = planPath ? await loadSessionPlan(planPath) : null;
      const startingPlanRevision = startingPlan?.revision ?? -1;
      const activeCheckpoint = await context.getActivePauseCheckpoint(command.sessionId);
      if (command.input.source !== 'resume' && activeCheckpoint !== undefined) {
        return fail(
          requestId,
          'session/prompt',
          `paused-run: session ${command.sessionId} has resumable checkpoint ${activeCheckpoint.checkpointId}`,
        );
      }
      if (command.input.source === 'resume') {
        if (
          command.input.resumeCheckpointId === undefined ||
          activeCheckpoint?.checkpointId !== command.input.resumeCheckpointId
        ) {
          return fail(
            requestId,
            'session/prompt',
            'resume-checkpoint-mismatch: continuation does not own the active checkpoint',
          );
        }
      }
      // Product: a newer user message supersedes an in-flight run (Stop is
      // optional). Still one *registered* foreground run after this block.
      const existingRun = context.getForegroundRun(command.sessionId);
      if (existingRun) {
        const supersedeReason = createSupersededByNewPromptAbortReason();
        context.updateRunPhase(
          existingRun.runId,
          'cancelling',
          'Superseded by a newer user message',
        );
        context.requestCancelRun(command.sessionId, existingRun.runId, supersedeReason);
        context.settlePendingPermissionsForSession(command.sessionId);
        context.settlePendingExtensionUiForSession(command.sessionId);
        // Join the cancelled session operation and cleanup before publishing
        // terminal state. This keeps the old run exact while the new prompt
        // waits for ownership to be released.
        await finalizeCancelledRun(
          context,
          command.sessionId,
          existingRun.runId,
          formatRunAbortReason(supersedeReason),
        );
      }

      // Validate the durable session record before registering ownership
      // (ADR 0040 §1). A bound live handle is already validated; a cold
      // prompt must pass a durable index record — prompting must not require
      // an already-bound handle, since the detached Run activates it on
      // demand. Everything after this point is tracked preparation and must
      // not delay the ack.
      if (!context.sessions.has(command.sessionId)) {
        const durableRecord = await getSessionRecord(
          getPiwinSessionIndexPath(getPiwinRoot(context.piwinRoot)),
          command.sessionId,
        );
        if (!durableRecord) {
          return fail(requestId, 'session/prompt', `Unknown session: ${command.sessionId}`);
        }
      }
      // Validate synchronous security-sensitive input before accepting the
      // run. Preparation may move to the background, but invalid media
      // paths must still fail the request instead of becoming an async
      // terminal error after the UI has shown an accepted run.
      try {
        context.validatePromptAttachments(command.input);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/prompt', message);
      }
      // ORCH: fail closed on unknown/invalid scheme before accepting the run.
      const orchId = command.input.orchestrationSchemeId?.trim();
      if (orchId && orchId !== 'off') {
        try {
          const config = await context.loadConfig();
          const knownProfileIds = await context.listKnownSubagentProfileIds();
          const subagents = config.subagents;
          resolveOrchestrationScheme(
            {
              schemes: subagents?.schemes,
              maxConcurrency: subagents?.maxConcurrency,
              maxTasksPerRun: subagents?.maxTasksPerRun,
            },
            orchId,
            {
              knownProfileIds,
              knownModelKeys: listKnownChatModelKeys(config),
              globalMaxConcurrency: subagents?.maxConcurrency,
              globalMaxTasksPerRun: subagents?.maxTasksPerRun,
            },
          );
        } catch (error) {
          const message =
            error instanceof OrchestrationSchemeError ? error.message : formatError(error);
          return fail(requestId, 'session/prompt', message);
        }
      }
      let run: ExecutionRunRecord;
      try {
        run = context.registerForegroundRun(
          command.sessionId,
          command.input.source === 'resume' ? command.input.resumeCheckpointId : undefined,
        );
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/prompt', message);
      }

      const acceptedAt = new Date().toISOString();
      context.updateRunPhase(run.runId, 'accepted');
      context.updateRunPhase(run.runId, 'preparing');

      // Preparation and the provider turn are deliberately detached from the
      // request path. runWithContext owns the async context, while this
      // callback owns the run's single terminal transition.
      context.runWithContext(run.runId, async () => {
        try {
          const promptInput = await preparePromptInput(context, command, run);
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          // ADR 0040 §7: activate a cold runtime for the stable product
          // session id. The new generation is attached to this Run before
          // tool execution is admitted, so Host tool frames pass admission.
          const liveSession = await context.activateSessionRuntime(
            command.sessionId,
            run.runId,
            context.getRunSignal(run.runId),
          );
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          // A reconstructed generation owns no native context: inject bounded
          // product history exactly once before provider execution. Later
          // turns reuse the backend's own conversation state.
          await injectProductHistoryOnce(context, command.sessionId, promptInput);
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          await liveSession.prompt(promptInput);
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }

          // Detect silent completion: prompt() resolved without throwing but
          // the model produced no assistant output (no text/thinking deltas).
          // This happens when the model is unavailable, the API key is
          // invalid, or the provider returned an empty response without
          // surfacing an error through the event stream. Without this check
          // the host emits a failed terminal Run and the user sees
          // nothing — no output, no error.
          const currentRun = context.getForegroundRun(command.sessionId);
          if (currentRun && !context.hasRunReceivedFirstToken(run.runId)) {
            const emptyMessage =
              'The model produced no response. This may indicate an unavailable ' +
              'model, invalid API key, or provider error. Check your provider ' +
              'configuration and try again.';
            await context.terminateRun(
              command.sessionId,
              run.runId,
              'failed',
              undefined,
              emptyMessage,
            );
            context.push({
              type: 'event',
              sessionId: command.sessionId,
              event: { type: 'error', message: emptyMessage, retriable: true, runId: run.runId },
            });
            return;
          }

          if (planPath) {
            const completedPlan = await loadSessionPlan(planPath);
            if (
              !completedPlan ||
              completedPlan.revision <= startingPlanRevision ||
              (persistedPlanIntent === 'writing-plans-skill' &&
                (completedPlan.source !== 'skill' ||
                  completedPlan.skillId !== 'writing-plans'))
            ) {
              throw new Error(
                'plan-not-persisted: Plan mode and writing-plans must finish by creating or revising the durable SessionPlan with piwin_plan_create',
              );
            }
          }

          // Touch the index BEFORE the terminal event so the auto-name trigger
          // (fired from terminateRun) sees messageCount for the run that just
          // completed. Otherwise naming is delayed until the next exchange.
          if (command.input.source !== 'resume') {
            try {
              await context.touchSession(command.sessionId, command.input.text);
            } catch (error) {
              const message = formatError(error);
              context.push({
                type: 'host/log',
                level: 'warn',
                message: `session index touch failed: ${message}`,
              });
            }
          }
          await context.terminateRun(command.sessionId, run.runId, 'completed');
        } catch (error) {
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeAbortedRun(context, command.sessionId, run.runId);
            return;
          }
          const message = formatError(error);
          // ADR 0040 §4: a memory-pressure admission failure terminalizes the
          // Run with the stable code so clients can distinguish it from an
          // ordinary provider failure.
          const terminalCode =
            (error as { code?: string } | null)?.code === 'runtime-memory-pressure'
              ? ('runtime-memory-pressure' as const)
              : undefined;
          await context.terminateRun(command.sessionId, run.runId, 'failed', terminalCode, message);
          context.push({
            type: 'event',
            sessionId: command.sessionId,
            event: { type: 'error', message, retriable: true, runId: run.runId },
          });
        }
      });

      const accepted: SessionRunAcceptedData = {
        sessionId: command.sessionId,
        runId: run.runId,
        acceptedAt,
      };
      return ok(requestId, 'session/prompt', accepted);
    }
    case 'session/abort': {
      const requestedRunId =
        'runId' in command && typeof command.runId === 'string' ? command.runId : undefined;
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        // An orphaned Extension UI request must not survive after its run has
        // already disappeared, even though there is no active run left to
        // cancel.
        context.settlePendingExtensionUiForSession(command.sessionId);
        // Idempotent: no active run to cancel. Clear the durable checkpoint
        // before acknowledging so a subsequent prompt cannot race the Stop.
        try {
          await context.clearPauseCheckpoint(command.sessionId);
        } catch (error) {
          context.push({
            type: 'host/log',
            level: 'warn',
            message: `pause checkpoint clear failed: ${formatError(error)}`,
          });
        }
        scheduleAbortCleanup(context, command.sessionId);
        return ok(requestId, 'session/abort', {
          sessionId: command.sessionId,
          cancelled: false,
          reason: 'no-active-run',
        });
      }
      if (requestedRunId !== undefined && active.runId !== requestedRunId) {
        return ok(requestId, 'session/abort', {
          sessionId: command.sessionId,
          cancelled: false,
          reason: 'run-mismatch',
          activeRunId: active.runId,
        });
      }
      // Extension UI waits are not governed by the run AbortSignal. Resolve
      // them explicitly after validating run ownership; a stale abort must
      // never cancel a newer run's questionnaire.
      context.settlePendingExtensionUiForSession(command.sessionId);

      context.updateRunPhase(active.runId, 'cancelling', 'User stopped the run');
      const cancellationRequested = context.requestCancelRun(
        command.sessionId,
        active.runId,
        createUserStopAbortReason(),
      );
      if (!cancellationRequested) {
        return ok(requestId, 'session/abort', {
          sessionId: command.sessionId,
          cancelled: false,
          reason: 'no-active-run',
        });
      }
      context.settlePendingPermissionsForSession(command.sessionId);

      // The background prompt owns terminal confirmation. Neither provider
      // abort nor process cleanup is allowed to delay this acknowledgement.
      scheduleAbortCleanup(context, command.sessionId, active.runId);

      return ok(requestId, 'session/abort', {
        sessionId: command.sessionId,
        runId: active.runId,
        cancelled: true,
      });
    }
    case 'session/steer': {
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        return fail(
          requestId,
          'session/steer',
          `no-active-run: session ${command.sessionId} has no foreground run`,
        );
      }
      if (context.isPauseRequested(active.runId) || active.phase === 'pausing') {
        return fail(requestId, 'session/steer', 'run-pausing: steer is unavailable while pausing');
      }
      if (command.runId !== undefined && command.runId !== active.runId) {
        return fail(
          requestId,
          'session/steer',
          `run-mismatch: requested ${command.runId}, active ${active.runId}`,
        );
      }
      await context.requireSession(command.sessionId).steer(command.message);
      await context.recordUserPrompt(command.sessionId, {
        text: command.message,
        ...(command.clientMessageId ? { clientMessageId: command.clientMessageId } : {}),
      });
      return ok(requestId, 'session/steer', {
        sessionId: command.sessionId,
        runId: active.runId,
      });
    }
    case 'session/follow_up': {
      const active = context.getForegroundRun(command.sessionId);
      if (!active) {
        return fail(
          requestId,
          'session/follow_up',
          `no-active-run: session ${command.sessionId} has no foreground run`,
        );
      }
      if (context.isPauseRequested(active.runId) || active.phase === 'pausing') {
        return fail(
          requestId,
          'session/follow_up',
          'run-pausing: follow-up is unavailable while pausing',
        );
      }
      // Follow-up starts work through the live session, so it must carry
      // an explicit owner. This prevents events from an unowned request
      // being correlated with whichever run happens to be current later.
      if (command.runId !== active.runId) {
        return fail(
          requestId,
          'session/follow_up',
          `run-mismatch: requested ${command.runId ?? '<missing>'}, active ${active.runId}`,
        );
      }
      await context.requireSession(command.sessionId).followUp(command.message);
      return ok(requestId, 'session/follow_up', {
        sessionId: command.sessionId,
        runId: active.runId,
      });
    }
    case 'session/compact': {
      const result = await compactLiveSession(
        context,
        command.sessionId,
        command.customInstructions,
      );
      return ok(requestId, 'session/compact', toSessionCompactData(result));
    }
    case 'session/compact-export': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/compact-export', `Unknown session: ${command.sessionId}`);
      }

      const result = await compactTranscriptSnapshot(context, record, command.customInstructions);
      if (!result.ok) {
        return fail(
          requestId,
          'session/compact-export',
          result.message ?? 'Session compaction failed',
        );
      }

      const content = exportCompactionMarkdown({ summary: result.summary ?? '' });
      const outputPath = resolveSessionOutputPath(
        rootDir,
        command.sessionId,
        command.outputPath,
        suggestCompactionExportBasename(command.sessionId),
      );
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, content, 'utf8');
      const data: SessionCompactExportData = {
        sessionId: command.sessionId,
        format: 'md',
        path: outputPath,
        byteLength: Buffer.byteLength(content, 'utf8'),
        ...(result.summary ? { summary: result.summary } : {}),
        ...(typeof result.tokensBefore === 'number' ? { tokensBefore: result.tokensBefore } : {}),
        ...(typeof result.tokensAfter === 'number' ? { tokensAfter: result.tokensAfter } : {}),
        ...(typeof result.durationMs === 'number' ? { durationMs: result.durationMs } : {}),
      };
      return ok(requestId, 'session/compact-export', data);
    }
    case 'session/compact-abort': {
      const session = context.requireSession(command.sessionId);
      if (session.abortCompaction) {
        session.abortCompaction();
      }
      return ok(requestId, 'session/compact-abort', { sessionId: command.sessionId });
    }
    case 'session/compaction-settings': {
      const session = context.requireSession(command.sessionId);
      const supported = typeof session.getAutoCompactionEnabled === 'function';
      const resolved = await context.resolveAutoCompaction(command.sessionId);
      return ok(requestId, 'session/compaction-settings', {
        supported,
        autoCompactionEnabled: supported
          ? Boolean(session.getAutoCompactionEnabled?.())
          : resolved.enabled,
        source: resolved.source,
        globalDefault: resolved.globalDefault,
      });
    }
    case 'session/set-auto-compaction': {
      const session = context.requireSession(command.sessionId);
      if (!session.setAutoCompactionEnabled) {
        return fail(
          requestId,
          'session/set-auto-compaction',
          'auto-compaction settings not supported on this session',
        );
      }
      context.sessionAutoCompactionOverrides.set(command.sessionId, command.enabled);
      session.setAutoCompactionEnabled(command.enabled);
      return ok(requestId, 'session/set-auto-compaction', {
        enabled: command.enabled,
        source: 'session' as const,
      });
    }

    case 'session/export': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const record = await getSessionRecord(indexPath, command.sessionId);
      if (!record) {
        return fail(requestId, 'session/export', `Unknown session: ${command.sessionId}`);
      }
      const format: 'html' | 'md' = command.format === 'html' ? 'html' : 'md';
      const redactTools = command.redactTools === true;
      const store = await context.getTranscriptStore(command.sessionId);
      const exportOptions = {
        format,
        redactTools,
        sessionId: command.sessionId,
        projectPath: record.projectPath,
        ...(record.name ? { title: record.name } : {}),
        exportedAt: new Date().toISOString(),
      };
      const outputPath = resolveSessionOutputPath(
        rootDir,
        command.sessionId,
        command.outputPath,
        suggestSessionExportBasename(command.sessionId, format),
      );
      await mkdir(dirname(outputPath), { recursive: true });
      const output = await open(outputPath, 'w');
      let byteLength = 0;
      try {
        for await (const chunk of streamTranscriptExport(store.iterateAll(100), exportOptions)) {
          await output.write(chunk, undefined, 'utf8');
          byteLength += Buffer.byteLength(chunk, 'utf8');
        }
      } finally {
        await output.close();
      }
      return ok(requestId, 'session/export', {
        sessionId: command.sessionId,
        format,
        redactTools,
        path: outputPath,
        byteLength,
      });
    }

    case 'session/tool-output': {
      const store = await context.getTranscriptStore(command.sessionId);
      const message = await store.getMessage(command.messageId);
      if (!message) {
        return ok(requestId, 'session/tool-output', {
          status: 'unavailable' as const,
          reason: 'not-found' as const,
        });
      }
      const snapshot = readToolOutputSnapshot({
        message,
        toolCallId: command.toolCallId,
        ...(typeof command.maxBytes === 'number' ? { maxBytes: command.maxBytes } : {}),
      });
      if (snapshot.status === 'unavailable') {
        return ok(requestId, 'session/tool-output', snapshot);
      }
      // Redact secrets again at read time (transcript may predate stricter
      // patterns); re-bound so the response is always bounded.
      const redacted = redactToolText(snapshot.output);
      const redactionMarked = redacted.redacted || snapshot.redacted;
      return ok(requestId, 'session/tool-output', {
        ...snapshot,
        output: redacted.text,
        redacted: redactionMarked,
      });
    }

    case 'session/message-child': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const indexPath = getPiwinSessionIndexPath(rootDir);
      const child = await getSessionRecord(indexPath, command.childSessionId);
      if (!child || child.parentSessionId !== command.parentSessionId) {
        return fail(requestId, 'session/message-child', 'Invalid parent/child relationship');
      }
      const text = command.text.trim();
      if (!text) {
        return fail(requestId, 'session/message-child', 'text is required');
      }
      const live = await context.ensureLiveSession(command.childSessionId);
      await context.recordUserPrompt(command.childSessionId, { text });
      await live.prompt({ text });
      return ok(requestId, 'session/message-child', {
        childSessionId: command.childSessionId,
      });
    }
    default:
      return null;
  }
}

/**
 * Start cancellation side effects without making the control response depend
 * on provider or process-manager latency. The foreground prompt remains the
 * only owner allowed to emit the run terminal event.
 */
function scheduleAbortCleanup(
  context: SessionLiveContext,
  sessionId: string,
  runId?: string,
): void {
  if (runId === undefined) {
    void Promise.all([
      abortLiveSession(context, sessionId),
      context.stopProcessesForSession(sessionId),
    ]).catch((error: unknown) => {
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `session abort cleanup failed: ${message}`,
      });
    });
    return;
  }
  void finalizeCancelledRun(context, sessionId, runId).catch((error: unknown) => {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort cleanup failed: ${message}`,
    });
  });
}

function schedulePauseCleanup(context: SessionLiveContext, sessionId: string, runId: string): void {
  void finalizePausedRun(context, sessionId, runId).catch((error: unknown) => {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session pause cleanup failed: ${message}`,
    });
  });
}

async function finalizeAbortedRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
): Promise<void> {
  if (context.isPauseRequested(runId)) {
    await finalizePausedRun(context, sessionId, runId);
    return;
  }
  await finalizeCancelledRun(context, sessionId, runId);
}

/**
 * Join the actual session operation and host-owned cleanup before publishing
 * the cancellation terminal. The run ID guard prevents a stale abort from
 * terminating a newer foreground run for the same session.
 */
async function finalizeCancelledRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
  message?: string,
): Promise<void> {
  if (context.getForegroundRun(sessionId)?.runId !== runId) {
    return;
  }
  const cleanupResults = await Promise.allSettled([
    abortLiveSession(context, sessionId),
    context.stopProcessesForSession(sessionId),
  ]);
  for (const cleanupResult of cleanupResults) {
    if (cleanupResult.status === 'rejected') {
      const detail = formatError(cleanupResult.reason);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `session abort cleanup failed: ${detail}`,
      });
    }
  }
  if (context.getForegroundRun(sessionId)?.runId !== runId) {
    return;
  }
  await context.terminateRun(sessionId, runId, 'cancelled', 'cancelled', message);
}

/** Persist the partial transcript before publishing the paused terminal. */
async function finalizePausedRun(
  context: SessionLiveContext,
  sessionId: string,
  runId: string,
): Promise<void> {
  if (context.getForegroundRun(sessionId)?.runId !== runId) {
    return;
  }
  if (!context.isPauseRequested(runId)) {
    await finalizeCancelledRun(context, sessionId, runId);
    return;
  }
  const cleanupResults = await Promise.allSettled([
    abortLiveSession(context, sessionId),
    context.stopProcessesForSession(sessionId),
  ]);
  for (const cleanupResult of cleanupResults) {
    if (cleanupResult.status === 'rejected') {
      const detail = formatError(cleanupResult.reason);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `session pause cleanup failed: ${detail}`,
      });
    }
  }
  if (context.getForegroundRun(sessionId)?.runId !== runId) {
    return;
  }
  try {
    if (context.flushTranscriptRecorder) {
      await context.flushTranscriptRecorder(sessionId);
    }
    const run = context.getForegroundRun(sessionId);
    if (run === undefined || run.runId !== runId || !context.isPauseRequested(runId)) {
      return;
    }
    const checkpoint = await context.withTranscriptStore(sessionId, async (store) => {
      const sourceUserMessage = await store.lastMessageByRole('user');
      const lastAssistantMessage = await store.lastMessageByRole('assistant');
      return store.createPauseCheckpoint({
        sessionId,
        sourceRunId: runId,
        ...(run.resumeCheckpointId !== undefined
          ? { checkpointId: run.resumeCheckpointId }
          : {}),
        ...(run.runtimeGenerationId !== undefined
          ? { runtimeGenerationId: run.runtimeGenerationId }
          : {}),
        createdAt: new Date().toISOString(),
        ...(sourceUserMessage?.id !== undefined
          ? { sourceUserMessageId: sourceUserMessage.id }
          : {}),
        ...(lastAssistantMessage?.id !== undefined
          ? { lastAssistantMessageId: lastAssistantMessage.id }
          : {}),
        transcriptRevision: await store.getRevision(),
      });
    });
    context.attachResumeCheckpoint(runId, checkpoint.checkpointId);
    await context.terminateRun(
      sessionId,
      runId,
      'paused',
      'paused',
      'Run paused; a resumable checkpoint was saved.',
    );
  } catch (error) {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'error',
      message: `pause checkpoint creation failed: ${message}`,
    });
    await context.terminateRun(
      sessionId,
      runId,
      'failed',
      'failed',
      `Pause could not be saved: ${message}`,
    );
  }
}

async function abortLiveSession(context: SessionLiveContext, sessionId: string): Promise<void> {
  try {
    await context.requireSession(sessionId).abort();
  } catch (error) {
    const message = formatError(error);
    context.push({
      type: 'host/log',
      level: 'warn',
      message: `session abort failed: ${message}`,
    });
  }
}
