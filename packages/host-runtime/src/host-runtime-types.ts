import type {
  CreateSessionInput,
  HostCommand,
  HostMode,
  HostPush,
  HostToolRegistration,
  ExtensionDeploymentRecord,
  ExtensionsApplyData,
  PermissionMode,
  SessionRunPhase,
} from '@piwin/contracts';

import { RunRegistry } from './run-registry.js';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import { type PiwinRootOwnerKind } from './piwin-root-lease.js';
import type { SubagentRuntimeSnapshot } from '@piwin/contracts';

export const TRANSCRIPT_STORE_LEASED_COMMANDS = new Set<HostCommand['type']>([
  'session/resume',
  'session/pause',
  'session/resume-run',
  'session/outline-page',
  'session/user-message-index',
  'session/transcript-page',
  'session/transcript-window',
  'session/messages',
  'session/context-get',
  'session/queued-turn-submit',
  'session/queued-turn-list',
  'session/queued-turn-edit',
  'session/queued-turn-cancel',
  'session/queued-turn-reorder',
  'session/replace-run',
  'session/export',
  'session/truncate-from',
  'session/branch-list',
  'session/branch-switch',
  'session/duplicate',
  'session/fork',
  'walkthrough/list',
  'walkthrough/generate',
]);

export type ExtensionApplyCommand = Extract<HostCommand, { type: 'extensions/apply' }> & {
  deploymentId: string;
};

export type ExtensionDeploymentPatch = {
  phase: ExtensionDeploymentRecord['phase'];
  generationId?: string;
  targetExtensionSetRevision?: string;
  expectedSettingsRevision?: string;
  error?: string;
};

/**
 * Deployment phases that still own an in-flight apply. A repeated apply for
 * the same deploymentId re-ACKs the current durable state instead of starting
 * a second, overlapping activation.
 */
/**
 * Commands that change the extension registry revision. Startup recovery
 * classifies leftover deployments against one registry read, so these must
 * not run before it settles.
 */
export const EXTENSION_REGISTRY_MUTATING_COMMANDS = new Set<HostCommand['type']>([
  'extensions/set_enabled',
  'extensions/install',
  'extensions/ensure-bundled',
]);

export const EXTENSION_DEPLOYMENT_IN_FLIGHT_PHASES = new Set<ExtensionDeploymentRecord['phase']>([
  'queued',
  'validating',
  'waiting-current-run',
  'compiling',
  'creating-runtime',
  'publishing',
]);

export function extensionApplyDataFromRecord(
  record: ExtensionDeploymentRecord,
  stateOverride?: ExtensionsApplyData['state'],
): ExtensionsApplyData {
  const state =
    stateOverride ?? (record.when === 'new-sessions-only' ? 'new-sessions-only' : 'active');
  return {
    sessionId: record.sessionId,
    deploymentId: record.deploymentId,
    state,
    when: record.when,
    registryRevision: record.targetRegistryRevision,
    ...(record.generationId ? { generationId: record.generationId } : {}),
    ...(record.expectedSettingsRevision
      ? { settingsRevision: record.expectedSettingsRevision }
      : {}),
    ...(record.targetExtensionSetRevision
      ? { extensionSetRevision: record.targetExtensionSetRevision }
      : {}),
  };
}

export type HostRuntimeOptions = {
  mode: HostMode;
  mock?: boolean;
  piwinRoot?: string;
  /**
   * Cross-process ownership of the canonical piwin data root. Production
   * defaults to enabled; tests default to disabled unless explicitly enabled.
   */
  rootOwnership?: {
    enabled: boolean;
    ownerKind?: PiwinRootOwnerKind;
    hostInstanceId?: string;
  };
  rpcCommand?: string;
  /** Explicit internal worker artifact for source-mode diagnostics/soak. */
  agentWorkerScript?: string;
  onPush?: (message: HostPush) => void;
  /**
   * Explicit test seam used only by the JSONL integration harness. Production
   * callers omit it and always create sessions through the Pi adapter.
   */
  testFixture?: HostRuntimeTestFixture;
  /**
   * Session-level permission mode override (ADR 0019 §3). Takes precedence
   * over `config.permissions.mode` without persisting to disk.
   */
  permissionModeOverride?: PermissionMode;
  /** Shared DeviceToolBroker from the composition root. */
  clientToolExecution?: import('@piwin/contracts').ClientToolExecutionPort;
};

export type HostRuntimeTestFixture =
  'hang-until-abort' | 'slow-first-token' | 'high-rate-tool-output';

/** Narrow live-run snapshot for HostServer hydration. Not a RunRegistry leak. */
export type HostForegroundRunSnapshot = {
  sessionId: string;
  runId: string;
  status: 'queued' | 'running' | 'cancelling';
  phase?: SessionRunPhase;
};

/** Narrow pending-permission snapshot for HostServer hydration. */
export type HostPendingPermissionSnapshot = {
  sessionId: string;
  requestId: string;
  action: string;
};

export type SessionLineage = {
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
  presentation?: import('@piwin/contracts').CreateSessionInput['presentation'];
};

export type ComposedSessionHostTools = {
  tools: HostToolRegistration[];
  permissionGate: import('./tools/tool-admission.js').HostToolAdmission;
  mcpCapabilityBrief: McpCapabilityBrief;
};
