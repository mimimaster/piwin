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
  SubagentIsolationMode,
  SubagentApplyPolicy,
  ModelRef,
  ThinkingLevel,
} from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { ProcessRegistry } from '@piwin/process';
import type { SessionTodoStore } from '@piwin/automation';
import type { BrowserSession } from '@piwin/browser';
import type { PtyHost } from '../pty-host.js';
import type { ExtensionUiKind, ExtensionUiResponse } from '../extension-ui-bridge.js';
import type {
  WalkthroughCommandContext,
  WalkthroughGenerationRegistry,
} from './walkthrough-commands.js';

/**
 * Optional seam used by plan/execute to drive subagent-driven and inline
 * execution. HostRuntime provides it; mock/test contexts may omit it.
 */
export type PlanExecutionSeam = {
  /** Spawn a child subagent session for a single plan step task. */
  spawnSubagent: (input: {
    parentSessionId: string;
    task: string;
    sessionName?: string;
    mode?: SubagentIsolationMode;
    applyPolicy?: SubagentApplyPolicy;
    /** CE-SUB-PROF: profile id for plan step execution. */
    profileId?: string;
    /** CE-SUB-PROF: per-step model override. */
    model?: ModelRef;
    /** CE-SUB-PROF: per-step thinking level override. */
    thinkingLevel?: ThinkingLevel;
  }) => Promise<{ childSessionId: string }>;
  /** Merge a completed child session into its parent. */
  mergeSubagent: (childSessionId: string) => Promise<{ ok: boolean; message?: string }>;
  /** Send a prompt to a session (parent inline/verify or child task). */
  promptSession: (sessionId: string, text: string) => Promise<void>;
  /** Abort a running session (used by plan/abort). */
  abortSession: (sessionId: string) => Promise<void>;
};

export type HostCommandContext = {
  piwinRoot?: string;
  push: (message: HostPush) => void;
  requireSession: (sessionId: string) => SessionHandle;
  getMcpManager: () => McpLifecycleManager;
  getProcessRegistry: () => ProcessRegistry;
  getPtyHost: () => PtyHost;
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
  /**
   * Per-session permission mode overrides set by agent mode (Plan/Ask).
   * When a session has an entry, the gated bash/file tools use it instead
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
