/**
 * Service bag for stateless/domain host command handlers.
 * HostRuntime fills this; handlers must not import HostRuntime.
 */
import type {
  AgentModeId,
  HostPush,
  PermissionDecision,
  PermissionMode,
  SessionHandle,
  SessionTranscriptMessage,
  SubagentBatchRequest,
  SubagentBatchResult,
  SubagentTaskResult,
} from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { SessionTodoStore } from '@piwin/automation';
import type { BrowserSession } from '@piwin/browser';
import type { ExtensionUiKind, ExtensionUiResponse } from '@piwin/agent-host';
import type {
  WalkthroughCommandContext,
  WalkthroughGenerationRegistry,
} from './walkthrough-commands.js';
import type { KnowledgeCommandContext } from './knowledge-commands.js';
import type { SubagentCommandContext } from './subagent-commands.js';

/**
 * Optional seam used by plan/execute to drive subagent-driven and inline
 * execution. HostRuntime provides it; mock/test contexts may omit it.
 */
export type PlanExecutionSeam = {
  /** Send a prompt to a session (parent inline/verify or child task). */
  promptSession: (
    sessionId: string,
    text: string,
    parentRunId?: string,
  ) => Promise<{ runId: string; finalAssistantMessageId: string }>;
  /** Abort a running session (used by plan/abort). */
  abortSession: (sessionId: string) => Promise<void>;
  /**
   * CE-SUB-ORCH: batch orchestration seam. All subagent-driven plan
   * execution routes through this (ADR 0030 Phase D).
   */
  runBatch: (request: SubagentBatchRequest, parentRunId?: string) => Promise<SubagentBatchResult>;
  /** Persist successful child summaries before parent verification. */
  mergeBatchSummaries?: (parentSessionId: string, results: SubagentTaskResult[]) => Promise<void>;
  /** RunRegistry parent for the plan execution. */
  startPlanRun?: (sessionId: string, planId: string) => { runId: string };
  finishPlanRun?: (
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
  ) => void;
  cancelPlanRun?: (runId: string) => void;
};

export type HostCommandContext = {
  piwinRoot?: string;
  push: (message: HostPush) => void;
  requireSession: (sessionId: string) => SessionHandle;
  getMcpManager: () => McpLifecycleManager;
  /** Single Host Job authority (process/* IPC adapts through this). */
  getJobController: () => import('@piwin/contracts').JobController;
  /** Browser session owned by HostRuntime; undefined when not started (ADR 0020). */
  getBrowserSession?: () => BrowserSession | undefined;
  todoStore: SessionTodoStore;
  petStateStore: import('../pet-state-store.js').PetStateStore;
  runCronJob: (
    job: import('@piwin/contracts').CronJob,
  ) => Promise<{ ok: boolean; message?: string }>;
  pendingPermissions: Map<
    string,
    {
      resolve: (decision: PermissionDecision) => void;
      sessionId: string;
      projectPath?: string;
      action: string;
      detail: string;
    }
  >;
  pendingExtensionUi: Map<
    string,
    {
      resolve: (response: ExtensionUiResponse) => void;
      kind: ExtensionUiKind;
      sessionId: string;
    }
  >;
  rememberProjectPermission: (
    sessionId: string,
    action: string,
    detail: string,
    scope?: 'project',
    projectPath?: string,
  ) => Promise<void>;
  /** ADR 0024 §4: record a session-scoped allow (in-memory, no persistence). */
  rememberSessionPermission: (sessionId: string, action: string, detail: string) => void;
  /** Optional plan execution orchestration seam. */
  planExecution?: PlanExecutionSeam;
  /** Lazy application services for notes, flashcards, and document cards. */
  knowledge?: KnowledgeCommandContext;
  /** Durable subagent batch orchestration seam. */
  subagent?: SubagentCommandContext;
  /**
   * Per-session permission mode overrides set by agent mode (Plan/Ask).
   * When a session has an entry, the parent-owned bash/file registrations use it instead
   * of the static session-level permission mode.
   */
  sessionPermissionOverrides: Map<string, PermissionMode>;
  /** Set a per-session permission mode override (agent mode Plan/Ask floor). */
  setSessionPermissionOverride: (sessionId: string, mode: PermissionMode) => void;
  /** Clear a per-session permission mode override. */
  clearSessionPermissionOverride: (sessionId: string) => void;
  /**
   * Optional walkthrough service bag (spec §11.1). Provided by HostRuntime for
   * both SDK and RPC adapters; mock/test contexts may omit it.
   */
  walkthrough?: {
    context: WalkthroughCommandContext;
    registry: WalkthroughGenerationRegistry;
  };
};
