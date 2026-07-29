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
  SessionSummary,
} from './host.js';
import type { ModelProviderConfig, PiwinConfig } from './config.js';
import type { SavedMediaAsset, SaveMediaInput } from './media.js';
import type { SkillSummary } from './skills.js';
import type { ExtensionSummary } from './extensions.js';
import type { PromptTemplateSummary } from './prompts.js';
import type { InstallSource } from './mcp.js';
import type { McpConfigDocument, McpServerHealth, McpToolSummary } from './mcp.js';
import type {
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
import type { SubagentSpawnOptions } from './subagent.js';
import type { PtyOpenInput } from './pty.js';
import type { CronJob, HookDefinition, SessionTodoList } from './automation.js';
import type { McpServerConfig } from './mcp.js';
import type {
  FlashcardBatchCreateInput,
  FlashcardCreateInput,
  ReviewRating,
} from './flashcards.js';
import type {
  IndexFolderOptions,
  RetrieveOptions,
} from './doc-rag.js';
import type { NoteSearchQuery, NoteUpdateInput, NoteWriteInput } from './notes.js';
import type {
  ManagedProcessLogChunk,
  ManagedProcessLogsQuery,
  ManagedProcessRecord,
  ManagedProcessStartInput,
} from './process.js';
import type {
  SessionSearchQuery,
  SessionSearchResult,
  SessionTruncateFromResult,
  SessionExportData,
  SessionExportFormat,
} from './session-ops.js';

/**
 * Bytes are base64 only while crossing the desktop-to-host transport.
 * The host persists them immediately; callers must never put this payload in a model prompt.
 */
export type MediaSaveCommandInput = {
  sessionId: string;
  mimeType: string;
  source: SaveMediaInput['source'];
  base64Data: string;
};

export type MediaSaveData = {
  asset: SavedMediaAsset;
};

/** UI / external client → host */
export type HostCommand =
  | { id?: string; type: 'host/ping' }
  | { id?: string; type: 'host/status' }
  | { id?: string; type: 'project/list' }
  | { id?: string; type: 'project/open'; path: string }
  | { id?: string; type: 'project/trust'; path: string }
  | {
      id?: string;
      type: 'project/authorize-terminal';
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
      /** Scope-based session listing. When set, filters sessions by scope. */
      scope?: import('./host.js').SessionScope;
      /** When true, include archived sessions (default: active only). */
      includeArchived?: boolean;
    }
  | { id?: string; type: 'session/create'; input: CreateSessionInput }
  | {
      id?: string;
      type: 'session/spawn';
      parentSessionId: string;
      task: string;
      sessionName?: string;
      mode?: SubagentSpawnOptions['mode'];
      applyPolicy?: SubagentSpawnOptions['applyPolicy'];
      allowedOutputPaths?: string[];
      retainWorktree?: boolean;
      role?: string;
    }
  | {
      id?: string;
      type: 'session/message-child';
      parentSessionId: string;
      childSessionId: string;
      text: string;
    }
  | { id?: string; type: 'session/list-children'; parentSessionId: string }
  | { id?: string; type: 'session/cancel-subagent'; sessionId: string }
  | {
      id?: string;
      type: 'session/complete-subagent';
      sessionId: string;
      status?: 'done' | 'failed';
    }
  | {
      id?: string;
      type: 'session/merge-subagent';
      childSessionId: string;
      force?: boolean;
    }
  | { id?: string; type: 'session/resume'; sessionId: string }
  | { id?: string; type: 'session/messages'; sessionId: string }
 | { id?: string; type: 'session/prompt'; sessionId: string; input: PromptInput }
  | { id?: string; type: 'session/abort'; sessionId: string; runId?: string }
  | { id?: string; type: 'session/steer'; sessionId: string; message: string; runId?: string }
  | { id?: string; type: 'session/follow_up'; sessionId: string; message: string; runId?: string }
  | {
      id?: string;
      type: 'session/compact';
      sessionId: string;
      customInstructions?: string;
    }
  | { id?: string; type: 'session/compact-abort'; sessionId: string }
  | { id?: string; type: 'session/compaction-settings'; sessionId: string }
  | {
      id?: string;
      type: 'session/set-auto-compaction';
      sessionId: string;
      enabled: boolean;
    }
  | { id?: string; type: 'media/save'; input: MediaSaveCommandInput }
  | { id?: string; type: 'skills/list'; projectPath?: string }
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
  | { id?: string; type: 'pet/install-local'; sourcePath: string }
  | { id?: string; type: 'pet/import-codex' }
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
  | { id?: string; type: 'config/get' }
  | { id?: string; type: 'config/set'; config: PiwinConfig }
  | {
      id?: string;
      type: 'models/discover';
      provider: ModelProviderConfig;
      /** One-shot secret for this request only — never persisted by host. */
      apiKey?: string;
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
      type: 'permission/resolve';
      requestId: string;
      decision: PermissionDecision;
      /** When decision is allow, optionally remember for this project (network tools). */
      rememberScope?: PermissionRememberScope;
    }
  /** Notes library (ADR 0018): CRUD + hybrid search + recall eval. */
  | { id?: string; type: 'notes/list'; collection?: string; tags?: string[] }
  | { id?: string; type: 'notes/read'; noteId: string }
  | { id?: string; type: 'notes/search'; query: NoteSearchQuery }
  | { id?: string; type: 'notes/write'; input: NoteWriteInput }
  | { id?: string; type: 'notes/update'; input: NoteUpdateInput }
  | { id?: string; type: 'notes/delete'; noteId: string }
  | { id?: string; type: 'notes/reindex' }
  | { id?: string; type: 'notes/eval-run'; k?: number }
  | { id?: string; type: 'notes/eval-history' }
  /** Flashcards (ADR 0018): CRUD + FSRS review, incl. artifact rate actions. */
  | { id?: string; type: 'flashcards/create'; input: FlashcardCreateInput }
  | { id?: string; type: 'flashcards/list'; deck?: string; sourceNoteId?: string; sourceFolder?: string }
  | { id?: string; type: 'flashcards/delete'; cardId: string }
  | { id?: string; type: 'flashcards/decks' }
  | { id?: string; type: 'flashcards/queue'; deck?: string }
  | { id?: string; type: 'flashcards/rate'; cardId: string; rating: ReviewRating }
  | { id?: string; type: 'flashcards/export'; deck?: string }
  | { id?: string; type: 'flashcards/batch-create'; input: FlashcardBatchCreateInput }
  /** Doc Cards (folder-sourced flashcards): scan / index / retrieve / bind. See docs/specs/doc-flashcards.md. */
  | { id?: string; type: 'doccards/scan-folder'; folderPath: string }
  | {
      id?: string;
      type: 'doccards/index-folder';
      folderPath: string;
    } & Omit<IndexFolderOptions, 'signal'>
  | {
      id?: string;
      type: 'doccards/retrieve';
      folderPath: string;
      query: string;
    } & Omit<RetrieveOptions, 'signal' | 'embeddingProvider'>
  | { id?: string; type: 'doccards/list-by-folder'; folderPath: string }
  | { id?: string; type: 'doccards/rebind-folder'; oldPath: string; newPath: string }
  | { id?: string; type: 'doccards/forget-folder'; folderPath: string }
  | { id?: string; type: 'doccards/open-source'; cardId: string; openFile?: boolean }
  /** CE-PROC: managed process registry. */
  | { id?: string; type: 'process/list'; sessionId?: string; projectPath?: string }
  | { id?: string; type: 'process/get'; processId: string }
  | { id?: string; type: 'process/start'; input: ManagedProcessStartInput }
  | { id?: string; type: 'process/logs'; query: ManagedProcessLogsQuery }
  | { id?: string; type: 'process/stop'; processId: string }
  /** CE-CHAT: pin / search / product truncate-resend. */
  | { id?: string; type: 'session/pin'; sessionId: string }
  | { id?: string; type: 'session/unpin'; sessionId: string }
  /** PD-SESS: rename / archive-first lifecycle / permanent delete. */
  | { id?: string; type: 'session/rename'; sessionId: string; name: string }
  | { id?: string; type: 'session/archive'; sessionId: string }
  | { id?: string; type: 'session/unarchive'; sessionId: string }
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
    }
  | { id?: string; type: 'session/search'; query: SessionSearchQuery }
  | {
      id?: string;
      type: 'session/truncate-from';
      sessionId: string;
      messageId: string;
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
  | { id?: string; type: 'todo/set'; sessionId: string; items: SessionTodoList['items'] }
  | {
      id?: string;
      type: 'extension/ui_resolve';
      requestId: string;
      confirmed?: boolean;
      value?: string;
      cancelled?: boolean;
    };

/** Host → UI / external client (responses + push) */
export type HostResponse =
  | { id?: string; type: 'response'; command: string; success: true; data?: unknown }
  | {
      id?: string;
      type: 'response';
      command: string;
      success: false;
      error: string;
    };

export type HostPush =
  | { type: 'event'; sessionId: string; event: AgentEvent; envelope?: AgentEventEnvelope }
  | { type: 'plan/updated'; sessionId: string; plan: SessionPlan | null }
  | {
      type: 'subagent/updated';
      parentSessionId: string;
      child: SessionSummary;
    }
  | { type: 'subagent/merged'; parentSessionId: string; childSessionId: string; messageId: string }
  | {
      type: 'transcript/append';
      sessionId: string;
      message: import('./session-transcript.js').SessionTranscriptMessage;
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
    };

/** Pi ExtensionUIContext dialog kinds bridged to Desktop. */
export type ExtensionUiKind = 'confirm' | 'select' | 'input';

export type ExtensionUiResolveData = {
  requestId: string;
  ok: boolean;
};

export type HostServerMessage = HostResponse | HostPush;

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
    /** True when hostMode rpc uses SDK session backend (not stock pi --mode rpc). */
    rpcSdkFallback?: boolean;
    /** Extension confirm/select/input routed to Desktop (D-EXT-04). */
    extensionUiBridge?: boolean;
    /** CE-PROC: managed process tools / IPC available. Default false until wired. */
    process?: boolean;
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
    /** Line-oriented shell preview available (not a full TTY emulator). */
    shellPreview?: boolean;
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
  };
};

export type SessionCreateData = {
  sessionId: string;
};

export type SessionCompactData = {
  ok: boolean;
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
};

/** Alias for CE-SHARE-01 export response payload. */
export type SessionExportResultData = SessionExportData;

export type ConfigGetData = {
  config: PiwinConfig;
  root: string;
};

/** The UI-facing form of a saved asset accepted by PromptInput.attachments. */
export function toMediaAttachmentRef(
  asset: SavedMediaAsset,
  source: SaveMediaInput['source'],
): MediaAttachmentRef {
  const attachment: MediaAttachmentRef = {
    id: asset.id,
    path: asset.absolutePath,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    source,
  };
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
};

export type ExtensionsEnsureBundledData = {
  installed: string[];
};

export type ExtensionsInstallData = {
  extensionId: string;
  targetPath: string;
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

/** CE-PROC command response payloads. */
export type ProcessListData = {
  processes: ManagedProcessRecord[];
};

export type ProcessGetData = {
  process: ManagedProcessRecord;
};

export type ProcessStartData = {
  process: ManagedProcessRecord;
};

export type ProcessLogsData = {
  processId: string;
  chunks: ManagedProcessLogChunk[];
};

export type ProcessStopData = {
  process: ManagedProcessRecord;
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
