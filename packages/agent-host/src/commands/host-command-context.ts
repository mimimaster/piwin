/**
 * Service bag for stateless/domain host command handlers.
 * HostRuntime fills this; handlers must not import HostRuntime.
 */
import type {
  HostPush,
  PermissionDecision,
  SessionHandle,
  SessionTranscriptMessage,
  SubagentIsolationMode,
  SubagentApplyPolicy,
} from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { ProcessRegistry } from '@piwin/process';
import type { SessionTodoStore } from '@piwin/automation';
import type { PtyHost } from '../pty-host.js';
import type { ExtensionUiKind, ExtensionUiResponse } from '../extension-ui-bridge.js';

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
  /** Optional plan execution orchestration seam. */
  planExecution?: PlanExecutionSeam;
};
