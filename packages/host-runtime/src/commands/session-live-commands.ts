import { randomUUID } from 'node:crypto';
/**
 * Live session IPC: create/spawn/prompt/compact/export and sub-agent lifecycle.
 * HostRuntime provides SessionLiveContext (maps + ensureLiveSession/bindSession/…).
 */
import { mkdir, writeFile } from 'node:fs/promises';
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
  PiwinConfig,
  PromptInput,
  SessionHandle,
  SessionCompactData,
  SessionCompactExportData,
  SessionCompactResult,
  SessionIndexRecord,
  SessionResumeData,
  SessionRunAcceptedData,
  SessionTranscriptMessage,
  SessionTranscriptDocument,
} from '@piwin/contracts';
import {
  formatError,
  DEFAULT_PERMISSION_PRESET,
  resolvePreset,
  resolveOrchestrationScheme,
  mergeOrchestrationSchemeIntoPrompt,
  OrchestrationSchemeError,
  type ResolvedOrchestrationScheme,
} from '@piwin/contracts';
import type { RunAbortReason } from '../run-abort-reason.js';
import {
  createSupersededByNewPromptAbortReason,
  createUserStopAbortReason,
  formatRunAbortReason,
} from '../run-abort-reason.js';
import {
  buildSessionOutline,
  buildProductHistoryContext,
  clearSessionPlan,
  createSessionRecord,
  exportTranscript,
  getSessionRecord,
  listChildSessions,
  listTranscriptMessages,
  loadSessionPlan,
  mergeProductHistoryIntoPrompt,
  saveSessionPlan,
  exportCompactionMarkdown,
  buildCompactionSeedMessages,
  cloneTranscriptForDuplicate,
  suggestSessionExportBasename,
  suggestCompactionExportBasename,
  truncateTranscriptFrom,
  upsertSessionRecord,
} from '@piwin/session';
import {
  formatSideChatContextBlock,
  mergeSideChatContextIntoPrompt,
} from '@piwin/session';
import { extractFileOpsFromUnknown, formatFilesTouchedBlock } from '../compaction-file-ops.js';
import { formatPlanForModelContext } from '../format-plan-context.js';
import { createProductShellSession } from '../product-shell-session.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionPlanPath,
  getPiwinSessionTranscriptPath,
} from '../paths.js';
import type { createTranscriptRecorder } from '../transcript-recorder.js';
import { SessionRuntimeController } from '../sessions/session-runtime-controller.js';
import {
  indexProjectPathForScope,
  resolveSessionLocation,
  scopeFromIndexRecord,
} from '../session-scope.js';

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
  sessionAutoCompactionOverrides: Map<string, boolean>;
  unsubscribers: Map<string, () => void>;
  transcriptRecorders: Map<string, ReturnType<typeof createTranscriptRecorder>>;
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
  resolveAutoCompaction: (
    sessionId: string,
  ) => Promise<{ enabled: boolean; source: string; globalDefault: boolean }>;
  buildModelPromptInput: (input: PromptInput, signal?: AbortSignal) => Promise<PromptInput>;
  /** Sync media-root validation before accepting a run. */
  validatePromptAttachments: (input: PromptInput) => void;
  runWithContext: (runId: string, operation: () => Promise<void>) => void;
  /** RunRegistry-backed foreground lifecycle. */
  getForegroundRun: (sessionId: string) => ExecutionRunRecord | undefined;
  registerForegroundRun: (sessionId: string) => ExecutionRunRecord;
  getRunSignal: (runId: string) => AbortSignal | undefined;
  hasRunReceivedFirstToken: (runId: string) => boolean;
  requestCancelRun: (
    sessionId: string,
    runId?: string,
    reason?: RunAbortReason,
  ) => ExecutionRunRecord | undefined;
  updateRunPhase: (
    runId: string,
    phase: import('@piwin/contracts').SessionRunPhase,
    detail?: string,
  ) => void;
  terminateRun: (
    sessionId: string,
    runId: string,
    outcome: 'completed' | 'cancelled' | 'failed',
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
  'session/messages',
  'session/prompt',
  'session/abort',
  'session/steer',
  'session/follow_up',
  'session/compact',
  'session/compact-export',
  'session/compact-abort',
  'session/compaction-settings',
  'session/set-auto-compaction',
  'session/export',
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
    throw new Error(
      'compaction is not supported on this session (RPC or inactive product shell)',
    );
  }

  const startedAt = Date.now();
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
  const messages = await context.loadTranscriptMessages(record.id);
  const sourceTranscript: SessionTranscriptDocument = {
    version: 1,
    sessionId: record.id,
    projectPath: record.projectPath,
    messages,
    updatedAt: new Date().toISOString(),
    ...(record.scope ? { scope: record.scope } : {}),
    ...(record.workingDirectory ? { workingDirectory: record.workingDirectory } : {}),
  };
  const snapshotTranscript = cloneTranscriptForDuplicate(
    sourceTranscript,
    `compact-snapshot-${randomUUID()}`,
  );
  const seedMessages = buildCompactionSeedMessages(snapshotTranscript.messages);
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
        await context.host.dropSession(temporarySession.id);
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

  // Persist original user text + attachments before path-injection rewrite.
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
  throwIfPromptPreparationAborted(context, run.runId);

  const hasMedia = command.input.attachments?.some((item) => item.kind === 'media') === true;
  if (hasMedia) {
    // Surface "Describing image…" while D1 may run inside buildModelPromptInput.
    context.updateRunPhase(run.runId, 'preparing', 'Describing image…');
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
    ...(preparedFromHost.attachments
      ? { attachments: [...preparedFromHost.attachments] }
      : {}),
  };
  throwIfPromptPreparationAborted(context, run.runId);

  // A continuous Pi SDK session keeps native context itself. Inject product
  // history only when a recovered Product Shell is about to create its first
  // live handle, otherwise the model receives the same prior turns twice.
  if (context.needsProductHistoryInjection(command.sessionId)) {
    try {
      const transcriptMessages = await context.loadTranscriptMessages(command.sessionId);
      throwIfPromptPreparationAborted(context, run.runId);
      const lastMessageId = transcriptMessages[transcriptMessages.length - 1]?.id;
      const history = buildProductHistoryContext(
        transcriptMessages,
        lastMessageId ? { excludeMessageId: lastMessageId } : {},
      );
      if (history) {
        promptInput.text = mergeProductHistoryIntoPrompt(history, promptInput.text);
      }
    } catch (error) {
      if (error instanceof PromptPreparationCancelledError) {
        throw error;
      }
      const message = formatError(error);
      context.push({
        type: 'host/log',
        level: 'warn',
        message: `product history inject failed: ${message}`,
      });
    }
  }
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
        const refText = await resolvePromptContextRefs(context, sideChatSnapshot.refs);
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
        context,
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
  }
  throwIfPromptPreparationAborted(context, run.runId);
  return promptInput;
}

/**
 * Resolve structured context refs (SIDE §8.2) into a bounded, labeled context
 * block for the model prompt. The user transcript keeps the original text +
 * refs; this resolution only shapes what the model sees. File refs are
 * path-validated and size-capped by the host; the UI never reads files.
 */
async function resolvePromptContextRefs(
  context: SessionLiveContext,
  refs: import('@piwin/contracts').PromptContextRef[],
): Promise<string> {
  const blocks: string[] = [];
  for (const ref of refs) {
    switch (ref.kind) {
      case 'side-chat-message': {
        const messages = await context.loadTranscriptMessages(ref.sideChatSessionId);
        const message = messages.find((item) => item.id === ref.messageId);
        if (message) {
          blocks.push(`[side-chat-reference: ${ref.label}]\n${message.text.trim().slice(0, 8000)}`);
        }
        break;
      }
      case 'main-message': {
        const messages = await context.loadTranscriptMessages(ref.sourceSessionId);
        const message = messages.find((item) => item.id === ref.messageId);
        if (message) {
          blocks.push(`[main-message-reference: ${ref.label}]\n${message.text.trim().slice(0, 8000)}`);
        }
        break;
      }
      case 'file': {
        const content = await readBoundedFileForRef(ref.projectPath, ref.relativePath);
        if (content !== undefined) {
          const range = ref.lineStart !== undefined
            ? `:${ref.lineStart}${ref.lineEnd !== undefined ? `-${ref.lineEnd}` : ''}`
            : '';
          blocks.push(`[file-reference: ${ref.relativePath}${range}]\n${content}`);
        }
        break;
      }
      case 'diff':
        blocks.push(`[diff-reference: ${ref.label}]\n${ref.snapshotText.slice(0, 8000)}`);
        break;
      case 'terminal-output':
        blocks.push(`[terminal-output-reference: ${ref.label}]\n${ref.snapshotText.slice(0, 8000)}`);
        break;
      case 'error':
        blocks.push(`[error-reference: ${ref.title}]\n${ref.detail.slice(0, 8000)}`);
        break;
      default:
        break;
    }
  }
  return blocks.join('\n\n');
}

const MAX_CONTEXT_REF_FILE_BYTES = 32 * 1024;

/** Read a path-validated file under a project root, bounded and text-only. */
async function readBoundedFileForRef(
  projectPath: string,
  relativePath: string,
): Promise<string | undefined> {
  const { readFile, stat, realpath } = await import('node:fs/promises');
  const { resolve: resolvePath, sep } = await import('node:path');
  const rootAbsolute = resolvePath(projectPath);
  const candidate = resolvePath(rootAbsolute, relativePath);
  // Resolve symlinks before the prefix check so a project symlink that
  // points outside the project root cannot escape the traversal guard.
  let realCandidate: string;
  let realRoot: string;
  try {
    [realCandidate, realRoot] = await Promise.all([
      realpath(candidate),
      realpath(rootAbsolute),
    ]);
  } catch {
    return undefined;
  }
  if (!realCandidate.startsWith(`${realRoot}${sep}`) && realCandidate !== realRoot) {
    return undefined;
  }
  let fileStats;
  try {
    fileStats = await stat(realCandidate);
  } catch {
    return undefined;
  }
  if (!fileStats.isFile() || fileStats.size > MAX_CONTEXT_REF_FILE_BYTES) {
    return undefined;
  }
  try {
    const buffer = await readFile(realCandidate);
    if (buffer.subarray(0, 8000).includes(0)) {
      return undefined; // binary — never inject into the prompt
    }
    return buffer.toString('utf8').slice(0, MAX_CONTEXT_REF_FILE_BYTES);
  } catch {
    return undefined;
  }
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
      await context.bindSession(
        session,
        createInput.projectPath,
        command.input.sessionName,
        lineage,
      );
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
      const transcriptPath = getPiwinSessionTranscriptPath(rootDir, command.sessionId);
      const truncated = await truncateTranscriptFrom(transcriptPath, command.messageId);
      if (!truncated.found) {
        return fail(
          requestId,
          'session/truncate-from',
          `Message not found in transcript: ${command.messageId}`,
        );
      }
      const replacementCleanup = context.cancelRuntimeReplacement(command.sessionId);
      // Drop live handle so next prompt rebuilds from product transcript only.
      const live = context.sessions.get(command.sessionId);
      if (live) {
        try {
          await live.abort();
        } catch {
          // ignore
        }
        const unsub = context.unsubscribers.get(command.sessionId);
        if (unsub) {
          unsub();
          context.unsubscribers.delete(command.sessionId);
        }
        // Dispose before delete so a pending flush cannot rewrite the cut file.
        const recorder = context.transcriptRecorders.get(command.sessionId);
        if (recorder) {
          recorder.dispose();
          context.transcriptRecorders.delete(command.sessionId);
        }
      } else {
        const recorder = context.transcriptRecorders.get(command.sessionId);
        if (recorder) {
          recorder.dispose();
          context.transcriptRecorders.delete(command.sessionId);
        }
      }
      await replacementCleanup;
      context.sessions.delete(command.sessionId);
      // Clear run correlation so late events from the aborted handle cannot
      // poison the rebuilt shell's next prompt.
      context.resetSessionEventState?.(command.sessionId);
      // Invalidate the adapter's cached session handle. The Product Shell /
      // live Pi session it holds would otherwise keep the pre-truncation
      // history and be reused by ensureLiveSession on the next prompt.
      await context.host.dropSession(command.sessionId);
      // Rebuild a fresh Product Shell from the truncated transcript now so
      // the next session/prompt passes requireSession and injects the
      // truncated history (needsProductHistoryInjection) into the rebuild.
      await context.ensureLiveSession(command.sessionId);
      const remaining = truncated.document?.messages ?? [];
      record.messageCount = remaining.length;
      const last = remaining[remaining.length - 1];
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
        messages: remaining,
        session: indexRecordToSummary(record),
      });
    }
    case 'session/resume': {
      const rootDir = getPiwinRoot(context.piwinRoot);
      const existing = await getSessionRecord(getPiwinSessionIndexPath(rootDir), command.sessionId);
      if (!existing) {
        return fail(requestId, 'session/resume', `Unknown session: ${command.sessionId}`);
      }
      const messages = await context.loadTranscriptMessages(command.sessionId);
      let session: SessionHandle;
      let live = true;
      try {
        session = await context.host.resumeSession(command.sessionId);
      } catch (error) {
        // Cross-process: adapter may not hold the Pi handle. Bind a product shell
        // that keeps stable id + transcript and creates a live session on first prompt.
        const message = formatError(error);
        context.push({
          type: 'host/log',
          level: 'info',
          message: `resume fallback to product shell: ${message}`,
        });
        const shellOptions: Parameters<typeof createProductShellSession>[0] = {
          sessionId: command.sessionId,
          projectPath: existing.projectPath,
          seedMessages: messages,
          createLiveSession: async (input: CreateSessionInput) => context.createSession(input),
        };
        if (existing.name) {
          shellOptions.sessionName = existing.name;
        }
        session = createProductShellSession(shellOptions);
        live = true;
      }
      await context.bindSession(session, existing.projectPath, existing.name);
      const data: SessionResumeData = {
        sessionId: session.id,
        live,
        messages,
        projectPath: existing.projectPath,
        outline: buildSessionOutline(messages),
      };
      if (existing.name) {
        data.name = existing.name;
      }
      return ok(requestId, 'session/resume', data);
    }
    case 'session/runtime-status': {
      context.requireSession(command.sessionId);
      const status = context.runtimeController.getStatus(command.sessionId);
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
      const messages = await context.loadTranscriptMessages(command.sessionId);
      return ok(requestId, 'session/messages', {
        sessionId: command.sessionId,
        messages,
      });
    }
    case 'session/prompt': {
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

      // Validate the session before registering ownership. Everything after
      // this point is tracked preparation and must not delay the ack.
      try {
        context.requireSession(command.sessionId);
      } catch (error) {
        const message = formatError(error);
        return fail(requestId, 'session/prompt', message);
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
              globalMaxConcurrency: subagents?.maxConcurrency,
              globalMaxTasksPerRun: subagents?.maxTasksPerRun,
            },
          );
        } catch (error) {
          const message =
            error instanceof OrchestrationSchemeError
              ? error.message
              : formatError(error);
          return fail(requestId, 'session/prompt', message);
        }
      }
      let run: ExecutionRunRecord;
      try {
        run = context.registerForegroundRun(command.sessionId);
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
            await finalizeCancelledRun(context, command.sessionId, run.runId);
            return;
          }

          // Ensure a live session exists after truncate (product shell rebuild).
          const liveSession = await context.ensureLiveSession(command.sessionId);
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeCancelledRun(context, command.sessionId, run.runId);
            return;
          }

          await liveSession.prompt(promptInput);
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeCancelledRun(context, command.sessionId, run.runId);
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

          // Touch the index BEFORE the terminal event so the auto-name trigger
          // (fired from terminateRun) sees messageCount for the run that just
          // completed. Otherwise naming is delayed until the next exchange.
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
          await context.terminateRun(command.sessionId, run.runId, 'completed');
        } catch (error) {
          if (context.getRunSignal(run.runId)?.aborted) {
            await finalizeCancelledRun(context, command.sessionId, run.runId);
            return;
          }
          const message = formatError(error);
          await context.terminateRun(command.sessionId, run.runId, 'failed', undefined, message);
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
        // Idempotent: no active run to cancel. Cleanup is best-effort and
        // deliberately detached so a stale control request stays quick.
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
      if (command.runId !== undefined && command.runId !== active.runId) {
        return fail(
          requestId,
          'session/steer',
          `run-mismatch: requested ${command.runId}, active ${active.runId}`,
        );
      }
      await context.requireSession(command.sessionId).steer(command.message);
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

      const result = await compactTranscriptSnapshot(
        context,
        record,
        command.customInstructions,
      );
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
        ...(typeof result.tokensBefore === 'number'
          ? { tokensBefore: result.tokensBefore }
          : {}),
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
      const format = command.format === 'html' ? 'html' : 'md';
      const redactTools = command.redactTools === true;
      const messages = await context.loadTranscriptMessages(command.sessionId);
      const exported = exportTranscript(messages, {
        format,
        redactTools,
        sessionId: command.sessionId,
        projectPath: record.projectPath,
        ...(record.name ? { title: record.name } : {}),
      });
      const outputPath = resolveSessionOutputPath(
        rootDir,
        command.sessionId,
        command.outputPath,
        suggestSessionExportBasename(command.sessionId, format),
      );
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, exported.content, 'utf8');
      const byteLength = Buffer.byteLength(exported.content, 'utf8');
      return ok(requestId, 'session/export', {
        sessionId: command.sessionId,
        format,
        redactTools,
        path: outputPath,
        byteLength,
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
