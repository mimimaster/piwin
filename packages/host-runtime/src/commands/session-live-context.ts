import { createHash, randomUUID } from 'node:crypto';
/**
 * Live session IPC: create/spawn/prompt/compact/export and sub-agent lifecycle.
 * HostRuntime provides SessionLiveContext (maps + ensureLiveSession/bindSession/…).
 */
import { mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve as resolvePath } from 'node:path';
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
  QueuedTurnRecord,
  RunInterventionRecord,
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
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_AFTER_ITEMS,
  SESSION_TRANSCRIPT_WINDOW_DEFAULT_BEFORE_ITEMS,
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
  estimatePendingPromptTokens,
  readContextOccupiedTokens,
  resolveModelContextBudget,
  type ResolvedOrchestrationScheme,
  RUN_INTERVENTION_MAX_PENDING_BYTES_PER_RUN,
  RUN_INTERVENTION_MAX_PENDING_PER_RUN,
  RUN_INTERVENTION_MAX_TEXT_BYTES,
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
  createSubagentRunStore,
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
  openModelContextStore,
  type SessionTranscriptStore,
} from '@piwin/session';
import { formatSideChatContextBlock, mergeSideChatContextIntoPrompt } from '@piwin/session';
import { redactToolText } from '@piwin/agent-host';
import { extractFileOpsFromUnknown, formatFilesTouchedBlock } from '../compaction-file-ops.js';
import { formatPlanForModelContext } from '../format-plan-context.js';
import { createProductShellSession } from '../product-shell-session.js';
import { createModelPromptAssembly, type ModelPromptAssembly } from '../model-context-assembly.js';
import { persistAndPushAssembly } from '../model-context-record.js';
import { resolvePromptContextRefs } from '../prompt/resolve-prompt-context-refs.js';
import { fail, ok } from '../response-helpers.js';
import { indexRecordToSummary } from '../session-summary-map.js';
import {
  getPiwinProjectsPath,
  getPiwinRoot,
  getPiwinSessionDir,
  getPiwinSessionIndexPath,
  getPiwinSessionModelContextDatabasePath,
  getPiwinSessionPlanPath,
} from '../paths.js';
import { isRegisteredProjectRoot, loadProjectStore } from '@piwin/project';
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
import { findEnabledModel } from '../provider-helpers.js';

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
  /** ORCH: bind the per-turn model-facing delegation policy. */
  setRunDelegationMode?: (runId: string, mode: 'auto' | 'disabled') => void;
  /** Rebuild a warm generation when its frozen delegation surface differs. */
  prepareDelegationRuntime?: (sessionId: string, mode: 'auto' | 'disabled') => Promise<void>;
  /**
   * CHT-301: durable, Host-owned pure-chat classification for the prompt
   * path. Optional so control-only test contexts keep the agent path; the
   * real HostRuntime always provides it.
   */
  resolveIsConversationChat?: (sessionId: string) => Promise<boolean>;
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
      presentation?: import('@piwin/contracts').CreateSessionInput['presentation'];
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
  nextModelRequestOrdinal: (sessionId: string) => Promise<number>;
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
  /**
   * Active compact-export operations keyed by the source product session id.
   * Abort targets the temporary runtime registered here, not the source session.
   */
  compactExportOperations: Map<
    string,
    {
      sourceSessionId: string;
      temporarySession?: SessionHandle;
      abortRequested: boolean;
    }
  >;
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
    /** Current prompt's user row id, excluded from the native replay seed. */
    excludeSeedMessageId?: string,
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
    options?: { deferRuntimeGeneration?: boolean },
  ) => ExecutionRunRecord;
  replaceForegroundRun: (
    sessionId: string,
    previousRunId: string,
    resumeCheckpointId?: string,
    options?: { deferRuntimeGeneration?: boolean },
  ) => ExecutionRunRecord;
  tryReservePromptAdmission: (sessionId: string) => boolean;
  releasePromptAdmission: (sessionId: string) => void;
  isPromptAdmissionReserved: (sessionId: string) => boolean;
  joinRun: (runId: string) => Promise<ExecutionRunRecord | undefined>;
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
    options?: { skipJobCleanup?: boolean },
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
  /**
   * Detach a generation whose abort acknowledgement missed the Host deadline.
   * Late events/tools are rejected and the next prompt activates a fresh runtime.
   */
  quarantineSessionRuntime: (sessionId: string, runId: string) => void;
  /** Test seam; production uses the bounded default below. */
  abortCleanupTimeoutMs?: number;
  reloadRuntime: (request: {
    sessionId: string;
    expectedSettingsRevision: string;
    when: 'now' | 'after-current-run';
  }) => Promise<{ generationId: string; settingsRevision: string }>;
  /** Rebuild a resident generation when the next turn changes Provider. */
  replaceRuntimeForModel: (sessionId: string) => Promise<void>;
};
