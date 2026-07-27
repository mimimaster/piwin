/**
 * Service bag for stateless/domain host command handlers.
 * HostRuntime fills this; handlers must not import HostRuntime.
 */
import type {
  HostPush,
  PermissionDecision,
  SessionHandle,
  SessionTranscriptMessage,
} from '@piwin/contracts';
import type { McpLifecycleManager } from '@piwin/mcp';
import type { ProcessRegistry } from '@piwin/process';
import type { MemoryStore } from '@piwin/memory';
import type { SessionTodoStore } from '@piwin/automation';
import type { PtyHost } from '../pty-host.js';
import type { ExtensionUiKind, ExtensionUiResponse } from '../extension-ui-bridge.js';

export type HostCommandContext = {
  piwinRoot?: string;
  push: (message: HostPush) => void;
  requireSession: (sessionId: string) => SessionHandle;
  getMcpManager: () => McpLifecycleManager;
  getProcessRegistry: () => ProcessRegistry;
  getMemoryStore: () => MemoryStore;
  requireMemoryEnabled: () => Promise<void>;
  getPtyHost: () => PtyHost;
  todoStore: SessionTodoStore;
  runCronJob: (job: import('@piwin/contracts').CronJob) => Promise<{ ok: boolean; message?: string }>;
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
};
