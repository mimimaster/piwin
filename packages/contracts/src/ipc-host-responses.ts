/** HostResponse, server messages, and command result payloads. */

import type { HostMode, SessionSummary } from './host.js';
import type { PiwinConfig } from './config.js';
import type { SkillSummary } from './skills.js';
import type { ExtensionSummary } from './extensions.js';
import type { PromptTemplateSummary } from './prompts.js';
import type {
  McpConfigApplyReport,
  McpConfigDocument,
  McpServerHealth,
  McpToolSummary,
} from './mcp.js';
import type {
  GitBranchList,
  GitCommitGraph,
  GitDiffSummary,
  GitMutationResult,
  GitStatusSnapshot,
} from './git.js';
import type { ThemeManifest, ThemeSummary } from './theme.js';
import type {
  SessionSearchResult,
  SessionTruncateFromResult,
  SessionExportData,
  SessionCompactExportData,
} from './session-ops.js';
import type { HostHydrationFrame, HostSnapshotFrame } from './remote-protocol.js';
import type { HostProblem } from './host-problem.js';
import type { HostPush, HostPushBatchFrame } from './ipc-host-push.js';

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
  /**
   * Product-owned General Chat workspace (`~/.piwin/workspace`). Not a
   * registered user project. Desktop uses this as the file-browse root when
   * no project is open so generated files can still be previewed.
   */
  generalWorkspacePath: string;
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
    /** Host exposes `flashcards/study/*` rounds. Absent on old Hosts. */
    flashcardStudy?: boolean;
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

export type {
  FlashcardStudyCatalogPage as FlashcardStudyCatalogData,
  FlashcardStudyOperationResult as FlashcardStudyOperationLookupData,
  FlashcardStudySnapshot as FlashcardStudySnapshotData,
} from './flashcard-study.js';

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
