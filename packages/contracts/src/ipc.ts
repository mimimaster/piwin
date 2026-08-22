/** Desktop/CLI host IPC surface (M2 bridge). Transport-agnostic. */

import type {
  AgentEvent,
  AgentEventEnvelope,
  CreateSessionInput,
  HostMode,
  MediaAttachmentRef,
  PermissionDecision,
  PermissionRememberScope,
  PromptInput,
  SessionScope,
  SessionSummary,
} from './host.js';
import type { ExtensionUiKind } from './extension-ui.js';
import type {
  BrowserControllerPush,
  BrowserInputEvent,
  WebElementPickResult,
} from './browser.js';
import type { ModelProviderConfig, PiwinConfig } from './config.js';
import type { SavedMediaAsset, SaveMediaInput } from './media.js';
import type { LocalFilePreviewCommandInput, TrustedTextReadCommandInput } from './preview.js';
import type { SpeechTranscribeInput } from './speech.js';
import type { SessionListOrder, SessionListPageQuery } from './session-list-page.js';
import type {
  SessionMessageProjection,
  SessionTranscriptPageQuery,
  SessionTranscriptWindowQuery,
  } from './session-transcript-page.js';
import type { SessionUserMessageIndexQuery } from './session-user-message-index.js';
import type { ContextSummaryPush } from './model-context.js';
import type { SkillSummary } from './skills.js';
import type { ExtensionDeploymentRecord, ExtensionSummary } from './extensions.js';
import type { PromptTemplateSummary } from './prompts.js';
import type { InstallSource } from './mcp.js';
import type {
  McpConfigApplyReport,
  McpConfigDocument,
  McpServerHealth,
  McpToolSummary,
} from './mcp.js';
import type {
  GitBranchList,
  GitBranchCreateInput,
  GitCheckoutInput,
  GitCommitGraph,
  GitCommitInput,
  GitDiffSummary,
  GitMutationResult,
  GitStageInput,
  GitStatusSnapshot,
  GitUnstageInput,
} from './git.js';
import type { ThemeManifest, ThemeSummary } from './theme.js';
import type { PlanStatus, PlanStepStatus, SessionPlan } from './plan.js';
import type { PlanExecutionRequest, PlanExecutionState } from './plan-execution.js';
import type {
  SubagentBatchProjection,
  SubagentBatchRequest,
  SubagentInvocation,
  SubagentTaskResult,
} from './subagent-orchestration.js';
import type { PtyOpenInput } from './pty.js';
import type { CronJob, HookDefinition, SessionTodoList } from './automation.js';
import type { McpServerConfig } from './mcp.js';
import type {
  FlashcardBatchCreateInput,
  FlashcardCreateInput,
  ReviewRating,
} from './flashcards.js';
import type { IndexFolderOptions, RetrieveOptions } from './doc-rag.js';
import type { GenerationJob, IngestionJob } from './doc-rag-v2.js';
import type { NoteSearchQuery, NoteUpdateInput, NoteWriteInput } from './notes.js';
import type { PetRuntimeSnapshot, PetStoreQuery } from './pet.js';
import type {
  SessionSearchQuery,
  SessionSearchResult,
  SessionTruncateFromResult,
  SessionExportData,
  SessionExportFormat,
  SessionCompactExportData,
} from './session-ops.js';
import type { WalkthroughArtifact } from './walkthrough-artifact.js';
import type { PluginInstallSource } from './plugin.js';
import type { SearchRoutePreviewInput, WebSearchTestInput } from './web.js';
import type { PermissionRulesFile } from './permission.js';
import type { ApplySettingsInput } from './settings.js';
import type {
  JobHostPush,
  JobListFilter,
  JobTerminalReason,
  ReadJobLogsInput,
  StartJobInput,
  WaitForJobInput,
} from './job.js';
import type { RunHostPush } from './run.js';
import type { QueuedTurnRecord } from './queued-turn.js';
import type { RunInterventionRecord, UserInstructionPayload } from './run-intervention.js';
import type { SessionRuntimeStatus } from './session-runtime.js';
import type { HostHydrationFrame, HostSnapshotFrame } from './remote-protocol.js';
import type { HostProblem } from './host-problem.js';
import type { PromptForegroundAdmission } from './prompt-admission.js';
import type { SessionListScopeRef } from './session-list-scope.js';

/**
 * Bytes are base64 only while crossing the desktop-to-host transport.
 * The host persists them immediately; callers must never put this payload in a model prompt.
 */
export type MediaSaveCommandInput = {
  sessionId: string;
  mimeType: string;
  name?: string;
  contentKind?: import('./attachment.js').AttachmentContentKind;
  source: SaveMediaInput['source'];
  base64Data: string;
};

export type MediaSaveData = {
  asset: SavedMediaAsset;
};

/**
 * Addressed by logical identity (sessionId + assetId) — never by a
 * host-absolute path — so remote clients can fetch vault bytes without
 * learning or forging host paths (ADR 0052).
 */
export type MediaReadCommandInput = {
  sessionId: string;
  assetId: string;
  maxBytes?: number;
};

/** UI / external client → host */
export type HostCommand =
  | { id?: string; type: 'host/ping' }
  | { id?: string; type: 'host/status' }
  | {
      id?: string;
      /** ADR 0040 §8: query-only aggregate residency/resource metrics. */
      type: 'host/runtime-resources';
    }
  | {
      id?: string;
      /**
       * Bounded Host-wide live runs + pending-permission flags.
       * Opaque session/run ids only — never Host filesystem paths.
       */
      type: 'activity/summary';
      maxItems?: number;
    }
  | {
      id?: string;
      /**
       * ADR 0027: replay buffered pushes from `sinceSeq` (exclusive) to the
       * calling sink. Only valid when the sink is sequenced and the host
       * advertised `pushSequencing`. The host re-emits pushes with their
       * original `seq`/`eventId`, then a terminal `{ type: 'host/replay-done', sinceSeq }`.
       */
      type: 'host/replay';
      sinceSeq: number;
    }
  | { id?: string; type: 'project/list' }
  | { id?: string; type: 'project/open'; path: string }
  | { id?: string; type: 'project/remove'; path: string }
  | { id?: string; type: 'project/trust'; path: string }
  | {
      id?: string;
      type: 'project/authorize-terminal';
      /** Project root for authorization. Empty/omitted = general-scope terminal. */
      projectPath: string;
      cwd?: string;
    }
  | { id?: string; type: 'project/permissions-list'; path: string }
  | { id?: string; type: 'project/permissions-revoke'; path: string; key: string }
  | {
      id?: string;
      type: 'project/list-dir';
      /** Absolute project root (must match opened workspace). */
      projectPath: string;
      /**
       * Relative path under project root (posix-style).
       * Empty / omitted = project root.
       */
      relativePath?: string;
    }
  | {
      id?: string;
      type: 'project/read-file';
      projectPath: string;
      /** Relative path under project root (posix-style). */
      relativePath: string;
      /** Soft cap in bytes (host may enforce a lower max). */
      maxBytes?: number;
    }
  | {
      id?: string;
      type: 'session/list';
      /** @deprecated Use `scope` field instead. */
      projectPath?: string;
      /**
       * Path-owning scope for local/CLI session listing.
       * Remote clients must not send Host absolute paths; use `scopeRef` instead.
       */
      scope?: import('./host.js').SessionScope;
      /**
       * Path-free logical scope for remote / multi-client shells.
       * Carries opaque projectId only — never Host filesystem paths.
       */
      scopeRef?: SessionListScopeRef;
      /** When true, lists sessions across all scopes (general and all projects). */
      allScopes?: boolean;
      /** When true, include archived sessions (default: active only). */
      includeArchived?: boolean;
      /**
       * Host-side global ordering of the filtered projection.
       * Truncation is applied after ordering. Omitted keeps the existing Host default.
       */
      order?: SessionListOrder;
      /**
       * Transport bound on the returned `sessions` array.
       * Omitted preserves the existing unbounded complete list.
       */
      maxItems?: number;
    }
  | {
      id?: string;
      type: 'session/list-page';
      query: SessionListPageQuery;
    }
  | { id?: string; type: 'session/create'; input: CreateSessionInput }
  | {
      id?: string;
      type: 'session/message-child';
      parentSessionId: string;
      childSessionId: string;
      text: string;
    }
  | { id?: string; type: 'session/list-children'; parentSessionId: string }
  | {
      id?: string;
      type: 'subagent/batch-start';
      request: SubagentBatchRequest;
      parentRunId?: string;
    }
  | { id?: string; type: 'subagent/batch-status'; runId: string }
  | { id?: string; type: 'subagent/batch-cancel'; runId: string }
  | { id?: string; type: 'subagent/continue'; childSessionId: string; text: string }
  | {
      id?: string;
      type: 'subagent/worktree-action';
      childSessionId: string;
      action: 'apply' | 'retain' | 'discard';
    }
  | { id?: string; type: 'session/resume'; sessionId: string }
  | {
      id?: string;
      /** ADR 0040 §9: bounded outline page for older outline data. */
      type: 'session/outline-page';
      query: import('./session-transcript.js').SessionOutlinePageQuery;
    }
  | { id?: string; type: 'session/user-message-index'; query: SessionUserMessageIndexQuery }
  | { id?: string; type: 'session/transcript-page'; query: SessionTranscriptPageQuery }
  | { id?: string; type: 'session/transcript-window'; query: SessionTranscriptWindowQuery }
  | { id?: string; type: 'session/runtime-status'; sessionId: string }
  | {
      id?: string;
      type: 'session/reload-runtime';
      sessionId: string;
      expectedSettingsRevision: string;
      when: 'now' | 'after-current-run';
    }
  | { id?: string; type: 'session/messages'; sessionId: string }
  | {
      id?: string;
      type: 'session/foreground-run';
      sessionId: string;
    }
  | { id?: string; type: 'session/model-context-summary'; sessionId: string }
  | {
      id?: string;
      type: 'session/prompt';
      sessionId: string;
      input: PromptInput;
      /** Internal Host admission path; remote clients must omit this. */
      admission?: 'queued-turn';
      /**
       * How to admit this prompt when a foreground run may already be active.
       * Required on remote Hosts; local JSONL may omit it (queued-turn covers
       * single-shell interruption).
       */
      foreground?: PromptForegroundAdmission;
    }
  | {
      id?: string;
      type: 'session/queued-turn-submit';
      sessionId: string;
      queuedTurnId: string;
      userMessageId: string;
      input: PromptInput;
    }
  | { id?: string; type: 'session/queued-turn-list'; sessionId: string }
  | {
      id?: string;
      type: 'session/queued-turn-edit';
      sessionId: string;
      queuedTurnId: string;
      expectedRevision: number;
      input: PromptInput;
    }
  | {
      id?: string;
      type: 'session/queued-turn-cancel';
      sessionId: string;
      queuedTurnId: string;
      expectedRevision: number;
    }
  | {
      id?: string;
      type: 'session/queued-turn-reorder';
      sessionId: string;
      expectedQueueRevision: number;
      orderedQueuedTurnIds: string[];
    }
  | {
      id?: string;
      type: 'session/replace-run';
      sessionId: string;
      runId: string;
      queuedTurnId: string;
      userMessageId: string;
      input: PromptInput;
    }
  | { id?: string; type: 'session/pause'; sessionId: string; runId?: string }
  | { id?: string; type: 'session/resume-run'; sessionId: string; checkpointId?: string }
  | { id?: string; type: 'session/abort'; sessionId: string; runId?: string }
  | {
      id?: string;
      type: 'session/steer';
      sessionId: string;
      message: string;
      runId?: string;
      /** Matches an optimistic client row to the persisted Host transcript row. */
      clientMessageId?: string;
    }
  | {
      id?: string;
      type: 'run/intervention-submit';
      sessionId: string;
      runId: string;
      interventionId: string;
      userMessageId: string;
      input: UserInstructionPayload;
      /**
       * Explicit user-initiated conversion: adopt a pending queued turn's
       * durable identity instead of creating a new user row. The Host cancels
       * the queued turn and creates the intervention in one store transaction
       * (ADR 0051 §1 — never silent, always a deliberate shell action).
       */
      adoptQueuedTurn?: {
        queuedTurnId: string;
        expectedRevision: number;
      };
    }
  | {
      id?: string;
      type: 'run/intervention-edit';
      sessionId: string;
      runId: string;
      interventionId: string;
      expectedRevision: number;
      input: UserInstructionPayload;
    }
  | {
      id?: string;
      type: 'run/intervention-cancel';
      sessionId: string;
      runId: string;
      interventionId: string;
      expectedRevision: number;
    }
  | {
      id?: string;
      type: 'session/follow_up';
      sessionId: string;
      message: string;
      runId?: string;
      /** Matches the optimistic client row to the persisted Follow-up row. */
      clientMessageId?: string;
    }
  | {
      id?: string;
      type: 'session/compact';
      sessionId: string;
      customInstructions?: string;
      /**
       * When present, compact only if needed and validate the result against
       * this configured model's Host-resolved input budget before committing a
       * client-side model selection.
       */
      targetModel?: import('./host.js').ModelRef;
    }
  | {
      id?: string;
      /** Compact an ephemeral session snapshot and export only its summary. */
      type: 'session/compact-export';
      sessionId: string;
      customInstructions?: string;
      /** Absolute path; when omitted host writes under the session exports dir. */
      outputPath?: string;
    }
  | { id?: string; type: 'session/compact-abort'; sessionId: string }
  | { id?: string; type: 'session/compaction-settings'; sessionId: string }
  | {
      id?: string;
      type: 'session/set-auto-compaction';
      sessionId: string;
      enabled: boolean;
    }
  | {
      id?: string;
      type: 'side-chat/open';
      sourceSessionId: string;
      sourceMessageId?: string;
      name?: string;
      refs?: import('./side-chat.js').SideChatContextRef[];
    }
  | {
      id?: string;
      type: 'side-chat/list';
      sourceSessionId: string;
      includeArchived?: boolean;
    }
  | {
      id?: string;
      type: 'side-chat/sync';
      sideChatSessionId: string;
      refs?: import('./side-chat.js').SideChatContextRef[];
    }
  | { id?: string; type: 'media/save'; input: MediaSaveCommandInput }
  | { id?: string; type: 'media/read'; input: MediaReadCommandInput }
  /**
   * Config-root-relative text preview (ADR 0052 Slice 3). Remote-safe:
   * callers send a path under `~/.piwin`, never a host-absolute path.
   */
  | { id?: string; type: 'preview/read-trusted-text'; input: TrustedTextReadCommandInput }
  /**
   * Local-Host only. Previews a clicked host path as media or text
   * (ADR 0052 Slice 4). Remote host-server rejects this command.
   */
  | { id?: string; type: 'preview/read-local-file'; input: LocalFilePreviewCommandInput }
  /**
   * Transient Desktop audio. Unlike media/save, Host must not write this input
   * to ~/.piwin/media, transcript, prompt attachments, or logs.
   */
  | { id?: string; type: 'speech/transcribe'; input: SpeechTranscribeInput }
  | { id?: string; type: 'skills/list'; projectPath?: string }
  | {
      id?: string;
      type: 'skills/read';
      /** Prefer logical id when known. */
      skillId?: string;
      /**
       * Local legacy transcript absolute path only.
       * Host maps it to a catalog skill; never used as a free read root.
       */
      legacyPath?: string;
      /** Optional project context for scanning project-local skills (local only). */
      projectPath?: string;
      maxBytes?: number;
    }
  | { id?: string; type: 'skills/set_enabled'; skillId: string; enabled: boolean }
  | {
      id?: string;
      type: 'skills/install';
      source: InstallSource;
      name?: string;
    }
  | { id?: string; type: 'extensions/list'; projectPath?: string }
  | {
      id?: string;
      type: 'extensions/set_enabled';
      extensionId: string;
      enabled: boolean;
    }
  | {
      id?: string;
      type: 'extensions/apply';
      sessionId: string;
      when: 'now' | 'after-current-run' | 'new-sessions-only';
      targetExtensionSetRevision?: string;
      expectedSettingsRevision?: string;
      expectedRegistryRevision?: string;
      deploymentId?: string;
    }
  | { id?: string; type: 'extensions/ensure-bundled' }
  | {
      id?: string;
      type: 'extensions/install';
      source: InstallSource;
      name?: string;
    }
  | { id?: string; type: 'prompts/list'; projectPath?: string }
  | {
      id?: string;
      type: 'prompts/set_enabled';
      promptId: string;
      enabled: boolean;
    }
  | { id?: string; type: 'mcp/get' }
  | { id?: string; type: 'mcp/validate'; document: unknown }
  | { id?: string; type: 'mcp/save'; document: unknown }
  | { id?: string; type: 'mcp/list_tools'; serverId: string }
  | { id?: string; type: 'mcp/status' }
  | { id?: string; type: 'mcp/start'; serverId: string }
  | { id?: string; type: 'mcp/stop'; serverId: string }
  | { id?: string; type: 'git/status'; projectPath: string }
  | {
      id?: string;
      type: 'git/branch-list';
      projectPath: string;
      limit?: number;
    }
  | { id?: string; type: 'git/diff-summary'; projectPath: string }
  | { id?: string; type: 'git/log-graph'; projectPath: string; limit?: number }
  | {
      id?: string;
      type: 'git/diff-file';
      projectPath: string;
      /** Path relative to repo root. */
      path: string;
      /** Default `combined` (worktree vs HEAD). */
      scope?: 'worktree' | 'staged' | 'combined';
    }
  | { id?: string; type: 'git/stage'; input: GitStageInput }
  | { id?: string; type: 'git/unstage'; input: GitUnstageInput }
  | { id?: string; type: 'git/commit'; input: GitCommitInput }
  | { id?: string; type: 'git/branch-create'; input: GitBranchCreateInput }
  | { id?: string; type: 'git/checkout'; input: GitCheckoutInput }
  | { id?: string; type: 'theme/list' }
  | { id?: string; type: 'theme/get-active' }
  | { id?: string; type: 'theme/set-active'; themeId: string }
  | { id?: string; type: 'theme/install-local'; sourcePath: string }
  | { id?: string; type: 'pet/list' }
  | { id?: string; type: 'pet/get-active' }
  | { id?: string; type: 'pet/set-active'; petId: string }
  | { id?: string; type: 'pet/scan-local'; sourcePath: string }
  | { id?: string; type: 'pet/install-local'; sourcePath: string }
  | { id?: string; type: 'pet/install-local-batch'; sourcePaths: string[] }
  | { id?: string; type: 'pet/store-query'; query: PetStoreQuery }
  | { id?: string; type: 'pet/install-registry'; url: string; sha256?: string }
  | { id?: string; type: 'pet/cancel'; requestId: string }
  | { id?: string; type: 'pet/delete'; petId: string }
  | { id?: string; type: 'plan/get'; sessionId: string }
  | { id?: string; type: 'plan/set'; sessionId: string; plan: SessionPlan }
  | { id?: string; type: 'plan/clear'; sessionId: string }
  | { id?: string; type: 'plan/approve'; sessionId: string }
  | {
      id?: string;
      type: 'plan/update-step';
      sessionId: string;
      stepId: string;
      status: PlanStepStatus;
      detail?: string;
    }
  | { id?: string; type: 'plan/set-status'; sessionId: string; status: PlanStatus }
  | { id?: string; type: 'plan/execute'; request: PlanExecutionRequest }
  | { id?: string; type: 'plan/abort'; sessionId: string; planId: string }
  | { id?: string; type: 'config/get' }
  | { id?: string; type: 'settings/get' }
  | { id?: string; type: 'settings/apply'; input: ApplySettingsInput }
  | { id?: string; type: 'permissions/get-rules'; layer: 'user' }
  | {
      id?: string;
      type: 'permissions/set-rules';
      layer: 'user';
      rules: PermissionRulesFile;
      expectedRevision?: string;
    }
  | {
      id?: string;
      type: 'models/discover';
      provider: ModelProviderConfig;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'models/catalog/search';
      input?: import('./model-catalog.js').ModelCatalogSearchRequest;
    }
  | { id?: string; type: 'models/configured' }
  | {
      id?: string;
      type: 'models/image-catalog/search';
    }
  | {
      id?: string;
      type: 'models/test';
      provider: ModelProviderConfig;
      modelId: string;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'models/image-test';
      provider: ModelProviderConfig;
      modelId: string;
      /** Optional test prompt. Host uses a deterministic smoke prompt when omitted. */
      prompt?: string;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
    }
  | {
      id?: string;
      type: 'vision/delegate';
      input: import('./vision-delegation.js').VisionDelegateInput;
    }
  | { id?: string; type: 'vision/cache/clear' }
  | {
      id?: string;
      type: 'secrets/set';
      providerId: string;
      secret: string;
    }
  | {
      id?: string;
      type: 'secrets/get';
      providerId: string;
    }
  | {
      id?: string;
      type: 'web/test-search-source';
      input: WebSearchTestInput;
    }
  | {
      id?: string;
      type: 'web/search-route-preview';
      input: SearchRoutePreviewInput;
    }
  | {
      id?: string;
      type: 'permission/resolve';
      requestId: string;
      decision: PermissionDecision;
      /** When decision is allow, optionally remember for this project (network tools). */
      rememberScope?: PermissionRememberScope;
    }
  | { id?: string; type: 'permission/pending-list' }
  /** Notes library (ADR 0018): CRUD + hybrid search + recall eval. */
  | { id?: string; type: 'notes/list'; collection?: string; tags?: string[] }
  | { id?: string; type: 'notes/read'; noteId: string }
  | { id?: string; type: 'notes/search'; query: NoteSearchQuery }
  | { id?: string; type: 'notes/write'; input: NoteWriteInput }
  | { id?: string; type: 'notes/update'; input: NoteUpdateInput }
  | { id?: string; type: 'notes/delete'; noteId: string; expectedContentHash?: string }
  | { id?: string; type: 'notes/reindex' }
  | { id?: string; type: 'notes/eval-run'; k?: number }
  | { id?: string; type: 'notes/eval-history' }
  /** Flashcards (ADR 0018): CRUD + FSRS review, incl. artifact rate actions. */
  | { id?: string; type: 'flashcards/create'; input: FlashcardCreateInput }
  | {
      id?: string;
      type: 'flashcards/list';
      deck?: string;
      sourceNoteId?: string;
      sourceFolder?: string;
      sequenceId?: string;
    }
  | { id?: string; type: 'flashcards/delete'; cardId: string }
  | { id?: string; type: 'flashcards/decks' }
  | { id?: string; type: 'flashcards/queue'; deck?: string }
  | { id?: string; type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
  | { id?: string; type: 'flashcards/export'; deck?: string }
  | { id?: string; type: 'flashcards/batch-create'; input: FlashcardBatchCreateInput }
  /** Doc Cards (folder-sourced flashcards): scan / index / retrieve / bind. See docs/specs/doc-flashcards.md. */
  | { id?: string; type: 'doccards/scan-folder'; folderPath: string }
  | ({
      id?: string;
      type: 'doccards/index-folder';
      folderPath: string;
    } & Omit<IndexFolderOptions, 'signal'>)
  | ({
      id?: string;
      type: 'doccards/retrieve';
      folderPath: string;
      query: string;
    } & Omit<RetrieveOptions, 'signal' | 'embeddingProvider'>)
  | { id?: string; type: 'doccards/list-by-folder'; folderPath: string }
  | { id?: string; type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { id?: string; type: 'doccards/forget-folder'; folderPath: string }
  | { id?: string; type: 'doccards/open-source'; cardId: string; openFile?: boolean }
  | { id?: string; type: 'doccards/index-status'; folderPath: string }
  | { id?: string; type: 'doccards/cancel-index'; folderPath: string }
  | {
      id?: string;
      type: 'doccards/generate';
      folderPath: string;
      includeFiles?: string[];
      topic?: string;
      difficulty?: 'easy' | 'medium' | 'hard';
      density?: 'concise' | 'standard' | 'detailed';
      deck?: string;
    }
  | { id?: string; type: 'doccards/generation-status'; folderPath: string }
  | { id?: string; type: 'doccards/cancel-generation'; folderPath: string }
  /** CE-CHAT: pin / search / product truncate-resend. */
  | { id?: string; type: 'session/pin'; sessionId: string }
  | { id?: string; type: 'session/unpin'; sessionId: string }
  /** PD-SESS: rename / archive-first lifecycle / permanent delete. */
  | { id?: string; type: 'session/rename'; sessionId: string; name: string }
  | {
      id?: string;
      type: 'session/auto-name';
      sessionId: string;
      /** First user message text for title generation. */
      firstMessage: string;
      /** Optional assistant reply text for richer context. */
      assistantReply?: string;
    }
  | { id?: string; type: 'session/archive'; sessionId: string }
  | { id?: string; type: 'session/unarchive'; sessionId: string }
  | { id?: string; type: 'session/lifecycle-plan' }
  | { id?: string; type: 'session/lifecycle-apply'; planId: string }
  | {
      id?: string;
      type: 'session/delete';
      sessionId: string;
      /**
       * Permanent delete normally requires the session to be archived first.
       * When true, allow delete of an active (non-archived) session after UI confirm.
       */
      force?: boolean;
    }
  /** PD-SESS-05: fork-light — copy product transcript into a new session id. */
  | {
      id?: string;
      type: 'session/duplicate';
      sessionId: string;
      /** Optional override; default "Copy of <name>". */
      name?: string;
      /**
       * Explicit destination for a safe "continue in project" copy. The
       * source session remains unchanged and auditable.
       */
      targetScope?: SessionScope;
      /** Defaults to `full` for older shells. New shells should request `none`. */
      messageProjection?: SessionMessageProjection;
    }
  /** SF-02: fork from a completed assistant response into a linked product session. */
  | {
      id?: string;
      type: 'session/fork';
      sessionId: string;
      /** The assistant response to fork from (inclusive in the new transcript). */
      messageId: string;
      /** Optional display name; default "<source name> · Branch". */
      name?: string;
      /** V1 shared workspace; worktree is a follow-up slice. */
      workspaceStrategy: 'shared' | 'worktree';
      /** Defaults to `full` for older shells. New shells should request `none`. */
      messageProjection?: SessionMessageProjection;
    }
  /** SF-04: query the product lineage (branch family) for a session. */
  | {
      id?: string;
      type: 'session/lineage';
      sessionId: string;
    }
  | { id?: string; type: 'session/search'; query: SessionSearchQuery }
  /** ADR 0055: ‹n/m› switcher data for every fork along the active path. */
  | { id?: string; type: 'session/branch-list'; sessionId: string }
  /** ADR 0055: move the active leaf into the target message's branch. */
  | {
      id?: string;
      type: 'session/branch-switch';
      sessionId: string;
      targetMessageId: string;
      /** Acknowledge a `needs-confirmation` write-boundary response. */
      confirm?: boolean;
      /** Defaults to `tail`. */
      messageProjection?: SessionMessageProjection;
    }
  /**
   * Delete the message and its entire subtree (ADR 0055 explicit gesture —
   * the daily edit/regenerate path branches via prompt instead).
   */
  | {
      id?: string;
      type: 'session/truncate-from';
      sessionId: string;
      messageId: string;
      /** Defaults to `full`; Desktop requests a bounded `tail`. */
      messageProjection?: SessionMessageProjection;
    }
  /** CE-SHARE-01: local transcript export (MD/HTML). */
  | {
      id?: string;
      type: 'session/export';
      sessionId: string;
      format?: SessionExportFormat;
      redactTools?: boolean;
      /** Absolute path; when omitted host writes under session exports dir. */
      outputPath?: string;
    }
  /** Cold Storage R1: non-destructive one-session pack backup. */
  | {
      id?: string;
      type: 'session/pack-create';
      sessionId: string;
      /**
       * Host-absolute publish directory for the pack + sidecar.
       * Must not live under the piwin root.
       */
      outputDir: string;
      /** Optional Host-safe pack id; Host generates one when omitted. */
      packId?: string;
    }
  | {
      id?: string;
      type: 'session/pack-verify';
      /** Host-absolute path to a `.piwin-pack` archive. */
      packPath: string;
    }
  | {
      id?: string;
      type: 'session/pack-list';
      /** Host-absolute directory that may contain `.piwin-pack` files. */
      directory: string;
    }
  /** Cold Storage R1: manual plan / execute / restore / reconcile. */
  | { id?: string; type: 'session/cold-storage-status' }
  | {
      id?: string;
      type: 'session/cold-storage-plan';
      /** When set, plan only these sessions (still must be eligible). */
      sessionIds?: string[];
    }
  | {
      id?: string;
      type: 'session/cold-storage-execute';
      planId: string;
      confirmationDigest: string;
    }
  | {
      id?: string;
      type: 'session/cold-storage-restore';
      sessionId: string;
      /** Host-absolute pack path. Defaults to the stub's last known packPath. */
      packPath?: string;
    }
  | {
      id?: string;
      type: 'session/cold-storage-import';
      /** Host-absolute pack path. Recreates a missing index stub from the manifest. */
      packPath: string;
    }
  | { id?: string; type: 'session/cold-storage-reconcile' }
  /**
   * Bounded on-demand read of a persisted tool output snapshot (Doc Preview
   * recovery for historical reads). Host re-checks redaction and byte caps.
   */
  | {
      id?: string;
      type: 'session/tool-output';
      sessionId: string;
      messageId: string;
      toolCallId: string;
      maxBytes?: number;
    }
  | { id?: string; type: 'pty/open'; input: PtyOpenInput }
  | { id?: string; type: 'pty/write'; ptyId: string; data: string }
  | { id?: string; type: 'pty/resize'; ptyId: string; cols: number; rows: number }
  | { id?: string; type: 'pty/close'; ptyId: string }
  | { id?: string; type: 'pty/list'; projectPath?: string }
  | { id?: string; type: 'skills/store-list' }
  | { id?: string; type: 'mcp/registry-list'; query?: string }
  | {
      id?: string;
      type: 'mcp/registry-install-draft';
      serverId: string;
      draft: McpServerConfig;
    }
  | { id?: string; type: 'cron/list' }
  | { id?: string; type: 'cron/upsert'; job: CronJob }
  | { id?: string; type: 'cron/delete'; jobId: string }
  | { id?: string; type: 'cron/run'; jobId: string }
  | { id?: string; type: 'hooks/list' }
  | { id?: string; type: 'hooks/set'; hooks: HookDefinition[] }
  | { id?: string; type: 'todo/get'; sessionId: string }
  | {
      id?: string;
      type: 'todo/set';
      sessionId: string;
      items: SessionTodoList['items'];
      expectedRevision?: string;
    }
  /** CE-OBS: token usage rollup (global / project / session). */
  | {
      id?: string;
      type: 'usage/get-rollup';
      /** When set, restrict to one project (else projectPath below). */
      scope?: import('./host.js').SessionScope;
      /** Legacy project path filter (project scope shorthand). */
      projectPath?: string;
      /** Optional ISO datetime window [from, to]. */
      window?: { from?: string; to?: string };
      /** Max number of per-session rows in the breakdown. Default 20. */
      topSessions?: number;
    }
  | {
      id?: string;
      type: 'extension/ui_resolve';
      requestId: string;
      confirmed?: boolean;
      value?: string;
      cancelled?: boolean;
    }
  | { id?: string; type: 'browser/start'; leaseId?: string }
  | { id?: string; type: 'browser/navigate'; url: string }
  | { id?: string; type: 'browser/pick-at'; x: number; y: number }
  | { id?: string; type: 'browser/screenshot'; path?: string }
  | { id?: string; type: 'browser/stop'; leaseId?: string }
  | { id?: string; type: 'browser/input'; events: BrowserInputEvent[] }
  | { id?: string; type: 'browser/lock'; owner: 'agent' | 'user' }
  | { id?: string; type: 'browser/unlock'; owner: 'agent' | 'user' }
  | {
      id?: string;
      type: 'walkthrough/list';
      sessionId: string;
      /** @deprecated Host transcript authority is queried directly; bounded shells cannot supply a complete id set. */
      knownMessageIds?: string[];
    }
  | {
      id?: string;
      type: 'walkthrough/generate';
      sessionId: string;
      messageId: string;
      runId?: string;
      force?: boolean;
    }
  | {
      id?: string;
      type: 'walkthrough/cancel';
      sessionId: string;
      messageId: string;
      generationId?: string;
    }
  /** Plugin system: install / list / uninstall / registry / secrets. */
  | {
      id?: string;
      type: 'plugins/install';
      source: PluginInstallSource;
      secrets?: Record<string, string>;
    }
  | { id?: string; type: 'plugins/list' }
  | { id?: string; type: 'plugins/uninstall'; pluginId: string }
  | { id?: string; type: 'plugins/registry/list'; registryUrl?: string }
  | {
      id?: string;
      type: 'plugins/secrets/collect';
      pluginId: string;
      secrets: Record<string, string>;
    }
  | { id?: string; type: 'job/start'; input: StartJobInput }
  | { id?: string; type: 'job/list'; filter?: JobListFilter }
  | { id?: string; type: 'job/get'; jobId: string }
  | { id?: string; type: 'job/logs'; input: ReadJobLogsInput }
  | { id?: string; type: 'job/wait'; input: WaitForJobInput }
  | { id?: string; type: 'job/stop'; jobId: string; reason?: JobTerminalReason };

/** Host → UI / external client (responses + push) */
export type HostResponse =
  | { id?: string; type: 'response'; command: string; success: true; data?: unknown }
  | {
      id?: string;
      type: 'response';
      command: string;
      success: false;
      /** Human-readable failure text; always present for failed responses. */
      error: string;
      /** Optional structured problem; does not replace `error`. */
      problem?: HostProblem;
    };

/**
 * ADR 0027: transport-level sequencing fields attached to every push when a
 * sequenced sink is attached. Optional on every variant; existing consumers
 * ignore them. Applied via intersection below so the discriminated union on
 * `type` stays intact.
 */
export type HostPushSequencing = {
  /** Monotonic per host process, not per session. Used for `host/replay`. */
  seq?: number;
  /** Stable id for idempotent delivery (distinct from AgentEventEnvelope.eventId). */
  eventId?: string;
};

export type HostPushVariant =
  | { type: 'event'; sessionId: string; event: AgentEvent; envelope?: AgentEventEnvelope }
  | {
      type: 'session/name-updated';
      sessionId: string;
      name: string;
      nameSource: 'text' | 'llm' | 'user';
    }
  | {
      type: 'session/index-updated';
      op: 'created' | 'pinned' | 'unpinned' | 'archived' | 'unarchived' | 'deleted';
      sessionId: string;
      session?: import('./host.js').SessionSummary;
    }
  | {
      type: 'settings/updated';
      revision: string;
      runtimeRevision: string;
      changedDomains: import('./settings.js').SettingsDomain[];
    }
  | { type: 'plan/updated'; sessionId: string; plan: SessionPlan | null }
  | { type: 'plan/execution-updated'; state: PlanExecutionState }
  | {
      type: 'subagent/updated';
      parentSessionId: string;
      child: SessionSummary;
    }
  | {
      type: 'subagent/invocation-updated';
      parentSessionId: string;
      invocation: SubagentInvocation;
    }
  | { type: 'subagent/merged'; parentSessionId: string; childSessionId: string; messageId: string }
  | {
      type: 'subagent/batch-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentBatchProjection;
    }
  | {
      type: 'subagent/task-updated';
      runId: string;
      parentSessionId: string;
      result: SubagentTaskResult;
    }
  | {
      type: 'subagent/stream';
      parentSessionId: string;
      childSessionId: string;
      event: AgentEvent;
      envelope?: AgentEventEnvelope;
    }
  | { type: 'session/runtime-updated'; status: SessionRuntimeStatus }
  /** ADR 0055: the active leaf moved (branch prompt/switch/subtree delete). */
  | {
      type: 'session/branch-updated';
      sessionId: string;
      activeLeafMessageId: string | null;
      branchPointCount: number;
    }
  | {
      type: 'transcript/append';
      sessionId: string;
      message: import('./session-transcript.js').SessionTranscriptMessage;
    }
  | {
      type: 'reply-writer/updated';
      sessionId: string;
      messageId: string;
      status: 'started' | 'applied' | 'failed';
      model?: import('./host.js').ModelRef;
      language?: import('./reply-writer.js').ReplyWriterLanguage;
    }
  | {
      type: 'permission/request';
      sessionId: string;
      requestId: string;
      action: string;
      detail: string;
      defaultDecision: PermissionDecision;
      context?: import('./host.js').PermissionRequestContext;
      runId?: string;
    }
  | {
      type: 'permission/resolved';
      sessionId: string;
      requestId: string;
      decision: PermissionDecision;
      runId?: string;
    }
  | { type: 'host/status'; mode: HostMode; ready: boolean; mock: boolean }
  | { type: 'host/log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'pty/output'; ptyId: string; data: string; at: string }
  | { type: 'pty/exit'; ptyId: string; exitCode?: number | null }
  | { type: 'todo/updated'; sessionId: string; items: SessionTodoList['items'] }
  | { type: 'automation/cron_finished'; jobId: string; ok: boolean; message?: string }
  | {
      type: 'extension/ui_request';
      sessionId: string;
      requestId: string;
      kind: ExtensionUiKind;
      title: string;
      message?: string;
      options?: string[];
      placeholder?: string;
    }
  | { type: 'pet/state'; pet: PetRuntimeSnapshot }
  // width/height are CSS viewport px (screencast deviceWidth/Height or
  // Playwright viewportSize), not JPEG bitmap px. The panel maps clicks
  // against these values vs img.clientWidth — never img.naturalWidth.
  | { type: 'browser/frame'; dataUrl: string; width: number; height: number; ts: number }
  | { type: 'browser/state'; url?: string; title?: string; ts: number }
  | { type: 'browser/picked'; result: WebElementPickResult }
  | {
      type: 'browser/console';
      level: 'log' | 'warning' | 'error';
      text: string;
      url: string;
      ts: number;
    }
  | {
      type: 'browser/network';
      method: string;
      url: string;
      status: number;
      resourceType: string;
      duration: number;
      ts: number;
    }
  | BrowserControllerPush
  | {
      type: 'walkthrough/updated';
      sessionId: string;
      artifact: WalkthroughArtifact;
    }
  | { type: 'extension/catalog-updated'; registryRevision: string; extensions: ExtensionSummary[] }
  | { type: 'extension/deployment-updated'; deployment: ExtensionDeploymentRecord }
  | {
      /** ADR 0027: replay buffer drained for a sequenced sink. */
      type: 'host/replay-done';
      sinceSeq: number;
      /** Last seq emitted by this replay, or sinceSeq if nothing was buffered. */
      lastSeq?: number;
    }
  | ContextSummaryPush
  | JobHostPush
  | RunHostPush
  | { type: 'run/intervention-updated'; intervention: RunInterventionRecord }
  | { type: 'session/queued-turn-updated'; queuedTurn: QueuedTurnRecord }
  | { type: 'doccards/index-progress'; job: IngestionJob }
  | { type: 'doccards/index-terminal'; job: IngestionJob }
  | { type: 'doccards/generation-progress'; job: GenerationJob }
  | {
      type: 'doccards/generation-terminal';
      job: GenerationJob;
      sessionId?: string;
      cardIds?: string[];
    };

/** ADR 0027: HostPush is the variant union plus optional transport sequencing. */
export type HostPush = HostPushVariant & HostPushSequencing;

/** One canonical sequenced push inside a cursor batch. */
export type HostSequencedPush = {
  seq: number;
  eventId: string;
  push: HostPush;
};

/** Additive bounded batch framing for local and remote Host transports. */
export type HostPushBatchFrame = {
  type: 'push/batch';
  hostInstanceId: string;
  /** Cursor the receiver must hold before applying this frame. */
  afterSeq: number;
  /** Highest canonical sequence examined for this client. */
  throughSeq: number;
  /** Ordered subset in (afterSeq, throughSeq]. */
  items: HostSequencedPush[];
};

export type HostServerMessage =
  | HostResponse
  | HostPush
  | HostPushBatchFrame
  | HostHydrationFrame
  | HostSnapshotFrame;

export type HostStatusData = {
  mode: HostMode;
  ready: boolean;
  mock: boolean;
  piwinRoot: string;
  activeSessionIds: string[];
  /**
   * Capability flags so clients never assume RPC has custom tools.
   * Stock `pi --mode rpc` does not support host-owned MCP/web tool injection.
   */
  capabilities: {
    customTools: boolean;
    mcpLifecycle: boolean;
    productTranscript: boolean;
    /** True when active sessions can invoke Pi compact(). */
    compaction: boolean;
    /** Pi Extensions mapped via ResourceLoader (SDK or RPC→SDK fallback). */
    extensions: boolean;
    /** Prompt templates under ~/.piwin/prompts. */
    prompts: boolean;
    /** Extension confirm/select/input routed to Desktop (D-EXT-04). */
    extensionUiBridge?: boolean;
    /** CE-PROC: managed process tools / IPC available. Default false until wired. */
    process?: boolean;
    /** CE-JOB: unified job control (start/list/get/logs/wait/stop) available. */
    jobs?: boolean;
    /** CE-CHAT: product session FTS search available. */
    sessionSearch?: boolean;
    /** CE-CHAT: session pin/unpin available. */
    sessionPin?: boolean;
    /** PD-SESS: rename / archive / delete / duplicate (product index). */
    sessionLifecycle?: boolean;
    /**
     * True interactive PTY (Tauri + xterm). false until ADR 0013 ships.
     * When false, desktop exposes Shell preview (line-oriented piped shell) only.
     */
    pty?: boolean;
    /** CE-SUB worktree isolation. */
    subagentWorktree?: boolean;
    /** CE-HUB registry browse. */
    marketplaceHub?: boolean;
    /** CE-CRON/HOOK automation. */
    automation?: boolean;
    /** CE-OBS: usage/update events emitted. */
    usage?: boolean;
    /** CE-SHARE-01: local session export MD/HTML. */
    sessionExport?: boolean;
    /** Resumable cooperative pause checkpoints for foreground turns. */
    sessionPause?: boolean;
    /** Host-owned, exact-Run intervention lifecycle. */
    runInterventions?: boolean;
    /** Host-owned durable next-turn queue and Replace Run workflow. */
    queuedTurns?: boolean;
    /** ADR 0027: host accepts remote gateway push sinks. */
    remoteGateway?: boolean;
    /** ADR 0027: host tags pushes with seq/eventId and supports host/replay. */
    pushSequencing?: boolean;
    /** ADR 0040: host owns session runtime residency (TTL/LRU/memory budgets). */
    runtimeResidency?: boolean;
    /** ADR 0040 §9: host supports bounded `session/outline-page` paging. */
    sessionOutlinePage?: boolean;
    /** Host maintains a bounded index of user-authored transcript messages. */
    sessionUserMessageIndex?: boolean;
    /** Host can seek to a user-message anchor and return a bounded transcript window. */
    sessionTranscriptSeek?: boolean;
  };
};

/**
 * Query-only aggregate residency/resource metrics (ADR 0040 §8).
 *
 * Returned by `host/runtime-resources`. Metrics are aggregate; per-process
 * secrets/PIDs are never exposed. Worker samples may be incomplete.
 */
export type HostRuntimeResourcesData = {
  /** Resident runtimes by residency state. */
  counts: {
    resident: number;
    idle: number;
    busy: number;
    activating: number;
    suspending: number;
  };
  /** Activations queued for capacity (FIFO waiters). */
  waiterCount: number;
  /** Effective policy budgets. */
  budget: {
    maxResidentRuntimes: number;
    maxIdleRuntimes: number;
    memoryHighWaterMiB: number;
    memoryLowWaterMiB: number;
  };
  /** Aggregate RSS in MiB. Incomplete when worker samples are missing/stale. */
  memory: {
    hostRssMiB: number;
    workerRssMiB?: number;
    /** True when every expected worker sample is fresh. */
    sampleCompleteness: 'complete' | 'partial' | 'missing';
  };
  /** Cumulative eviction/failure counters by reason. */
  counters: {
    evictedByIdleTtl: number;
    evictedByMaxIdle: number;
    evictedByMaxResident: number;
    evictedByMemoryPressure: number;
    memoryPressureFailures: number;
  };
};

export type SessionCreateData = {
  sessionId: string;
};

export type SessionCompactData = {
  ok: boolean;
  /** False when the current working set already fit the requested target. */
  compacted?: boolean;
  /** Host-authoritative input budget used for target validation. */
  targetInputBudget?: number;
  message?: string;
  summary?: string;
  tokensBefore?: number;
  tokensAfter?: number;
  durationMs?: number;
  fileOps?: import('./compaction-fileops.js').CompactionFileOps;
};

export type SessionCompactionSettingsData = {
  autoCompactionEnabled: boolean;
  supported: boolean;
  /** Where the effective auto-compact value came from. */
  source?: 'session' | 'project' | 'global' | 'unknown';
  globalDefault?: boolean;
  projectDefault?: boolean;
};

export type SessionListData = {
  sessions: SessionSummary[];
  /**
   * Size of the filtered, ordered Host projection before truncation.
   * Older Hosts may omit this field; clients fall back to `sessions.length`.
   */
  totalCount?: number;
  /**
   * True when `sessions.length < totalCount`.
   * Older Hosts may omit this field; clients fall back to `false`.
   */
  truncated?: boolean;
};

/** Alias for CE-SHARE-01 export response payload. */
export type SessionExportResultData = SessionExportData;

/** Cold Storage R1 pack command result aliases. */
export type {
  SessionPackCreateResultData,
  SessionPackVerifyResultData,
  SessionPackListData,
  SessionPackListItem,
  SessionPackManifestV1,
} from './session-pack.js';

/** Cold Storage R1 plan / execute / restore / reconcile result aliases. */
export type {
  SessionColdStorageExecuteResult,
  SessionColdStoragePlan,
  SessionColdStorageReconcileResult,
  SessionColdStorageRestoreResult,
  SessionColdStorageStatus,
} from './session-cold-storage.js';

/** Result payload for the compact-summary Markdown export command. */
export type SessionCompactExportResultData = SessionCompactExportData;

export type ConfigGetData = {
  config: PiwinConfig;
  root: string;
};

/**
 * Remote `media/save` strips Host filesystem paths. Prompt attachments must
 * then use the opaque `remote-asset:<id>` ref the Host already remaps.
 */
export const REMOTE_MEDIA_ASSET_PREFIX = 'remote-asset:';

/** Local save (has `absolutePath`) or remote projection (id only). */
export type MediaSaveAssetForPrompt = Pick<SavedMediaAsset, 'id' | 'mimeType' | 'byteSize'> &
  Partial<Pick<SavedMediaAsset, 'absolutePath' | 'name' | 'contentKind' | 'width' | 'height'>>;

/** The UI-facing form of a saved asset accepted by PromptInput.attachments. */
export function toMediaAttachmentRef(
  asset: MediaSaveAssetForPrompt,
  source: SaveMediaInput['source'],
): MediaAttachmentRef {
  const hostPath = asset.absolutePath?.trim();
  const path =
    hostPath !== undefined && hostPath.length > 0
      ? hostPath
      : `${REMOTE_MEDIA_ASSET_PREFIX}${asset.id}`;
  const attachment: MediaAttachmentRef = {
    id: asset.id,
    kind: 'media',
    path,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    source,
  };
  if (asset.name !== undefined) {
    attachment.name = asset.name;
  }
  if (asset.contentKind !== undefined) {
    attachment.contentKind = asset.contentKind;
  }
  if (asset.width !== undefined) {
    attachment.width = asset.width;
  }
  if (asset.height !== undefined) {
    attachment.height = asset.height;
  }
  return attachment;
}

export type SkillsListData = {
  skills: SkillSummary[];
};

export type ExtensionsListData = {
  extensions: ExtensionSummary[];
};

export type ExtensionsSetEnabledData = {
  extensionId: string;
  enabled: boolean;
  disabledIds: string[];
  managed?: boolean;
  registryRevision?: string;
};

export type ExtensionsEnsureBundledData = {
  installed: string[];
};

export type ExtensionsInstallData = {
  extensionId: string;
  targetPath: string;
  packageRoot?: string;
  contentRevision?: string;
  registryRevision?: string;
  configuredEnabled?: boolean;
};

export type ExtensionsApplyData = {
  sessionId: string;
  deploymentId: string;
  state: 'active' | 'pending' | 'waiting-current-run' | 'new-sessions-only';
  when: 'now' | 'after-current-run' | 'new-sessions-only';
  registryRevision: string;
  generationId?: string;
  settingsRevision?: string;
  extensionSetRevision?: string;
};

export type PromptsListData = {
  prompts: PromptTemplateSummary[];
};

export type PromptsSetEnabledData = {
  promptId: string;
  enabled: boolean;
  disabledIds: string[];
};

export type SkillsSetEnabledData = {
  skillId: string;
  enabled: boolean;
  disabledIds: string[];
};

export type McpGetData = {
  document: McpConfigDocument;
  path: string;
};

export type McpValidateData =
  | { valid: true; document: McpConfigDocument }
  | { valid: false; issues: Array<{ path: string; message: string }> };

export type McpSaveData = {
  path: string;
  document: McpConfigDocument;
  report?: McpConfigApplyReport;
};

export type McpListToolsData = {
  serverId: string;
  tools: McpToolSummary[];
};

export type McpStatusData = {
  servers: McpServerHealth[];
};

export type McpStartData = {
  health: McpServerHealth;
};

export type McpStopData = {
  health: McpServerHealth;
};

export type GitStatusData = {
  snapshot: GitStatusSnapshot;
};

export type GitBranchListData = {
  branches: GitBranchList;
};

export type GitDiffSummaryData = {
  summary: GitDiffSummary;
};

export type GitLogGraphData = {
  graph: GitCommitGraph;
};

export type GitMutationData = {
  result: GitMutationResult;
};

export type ThemeListData = {
  themes: ThemeSummary[];
  activeThemeId: string;
};

export type ThemeActiveData = {
  theme: ThemeManifest;
};

export type ThemeInstallData = {
  themeId: string;
  path: string;
};

export type SkillsInstallData = {
  skillId: string;
  targetPath: string;
};

/** CE-CHAT pin / search / truncate payloads. */
export type SessionPinData = {
  sessionId: string;
  isPinned: true;
  pinnedAt: string;
};

export type SessionUnpinData = {
  sessionId: string;
  isPinned: false;
};

export type SessionSearchData = SessionSearchResult;

export type SessionTruncateFromData = SessionTruncateFromResult;
