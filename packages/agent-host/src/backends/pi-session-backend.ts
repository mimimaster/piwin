/**
 * Phase 7 WP5: PiSessionBackend interface.
 *
 * A backend owns the lifecycle of Pi sessions for one host mode. Both the
 * in-process SDK path and the worker RPC path implement this interface so
 * `PiSdkAdapter` / `PiRpcAdapter` become thin facades that delegate to a
 * backend instead of carrying divergent createSession mega-functions.
 *
 * The interface is intentionally minimal: create / drop / dispose. Per-turn
 * operations (prompt, steer, follow-up, abort) live on the returned handle
 * so the backend does not need to track active sessions itself.
 */

import type {
  AgentEvent,
  BackendPreparedPrompt,
  BackendSessionBlueprint,
  ExtensionUiPort,
  HostToolExecutionPort,
  SessionCompactResult,
  SessionSeedMessage,
  EphemeralProviderSecret,
} from '@piwin/contracts';
import type { SerializableProviderRuntime } from '../rpc/serializable-blueprint.js';

/**
 * Handle returned by a backend's `createSession`. Mirrors the subset of
 * `SessionHandle` that the host runtime needs to drive a Pi session.
 */
export type BackendSessionHandle = {
  id: string;
  prompt(prepared: BackendPreparedPrompt): Promise<void>;
  steer(message: string): Promise<void>;
  followUp(message: string): Promise<void>;
  abort(): Promise<void>;
  compact?(customInstructions?: string): Promise<SessionCompactResult>;
  abortCompaction?(): void;
  getAutoCompactionEnabled?(): boolean;
  setAutoCompactionEnabled?(enabled: boolean): void;
  subscribe(listener: (event: AgentEvent) => void): () => void;
};

/**
 * Input passed to `PiSessionBackend.createSession`.
 *
 * The `blueprint` is the exact parent-compiled projection. Providers remain
 * an ephemeral runtime envelope and Host-owned side effects remain ports;
 * neither backend discovers product settings or policy at this seam.
 */
export type CreateBackendSessionInput = {
  /** Exact parent-compiled projection; no product settings are re-read here. */
  blueprint: BackendSessionBlueprint;
  /** Ephemeral provider runtime data; credentials are never persisted by a backend. */
  providers: SerializableProviderRuntime[];
  /** Raw key material for an isolated worker's one-shot bootstrap channel. */
  providerSecrets?: readonly EphemeralProviderSecret[];
  /** Parent-owned execution port for descriptors in the blueprint. */
  hostToolExecution: HostToolExecutionPort;
  /** Optional parent-owned extension UI bridge. */
  extensionUi?: ExtensionUiPort;
  /** Optional non-persisted history for an ephemeral session. */
  seedMessages?: readonly SessionSeedMessage[];
  /**
   * `compaction` (default) keeps the aggressive keep-recent compaction
   * override; `replay` seeds full-fidelity history without forcing compaction.
   */
  seedMode?: 'compaction' | 'replay';
};

/**
 * Backend interface implemented by both in-process SDK and worker RPC paths.
 */
export interface PiSessionBackend {
  /** Backend mode identifier for doctor/status reporting. */
  readonly mode: 'sdk' | 'rpc-worker';

  /** True when the backend provides real process isolation. */
  readonly isolated: boolean;

  /**
   * Create a new Pi session from the compiled blueprint. The backend owns
   * the session until `dropSession` is called.
   */
  createSession(input: CreateBackendSessionInput): Promise<BackendSessionHandle>;

  /** Drop a session and release its resources. */
  dropSession(sessionId: string): Promise<void>;

  /**
   * Drop exactly one runtime generation for a stable product session.
   *
   * Runtime replacement may prepare a candidate while the previous
   * generation is still active, so a session-only drop is not precise enough
   * at that boundary.
   */
  dropSessionGeneration(sessionId: string, runtimeGenerationId: string): Promise<void>;

  /** Release all sessions and shut down the backend (worker process, etc.). */
  dispose(): Promise<void>;
}

/**
 * Validate the backend projection before any Pi module or session is created.
 * This is intentionally structural: the parent owns policy compilation, but
 * the backend still rejects malformed cross-package input at its boundary.
 */
export function isValidBackendSessionBlueprint(value: unknown): value is BackendSessionBlueprint {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    typeof record.sessionId !== 'string' ||
    record.sessionId.trim().length === 0 ||
    typeof record.runtimeGenerationId !== 'string' ||
    record.runtimeGenerationId.trim().length === 0
  ) {
    return false;
  }
  const snapshot = record.capabilitySnapshot;
  if (!snapshot || typeof snapshot !== 'object') {
    return false;
  }
  const snapshotRecord = snapshot as Record<string, unknown>;
  const inputs = snapshotRecord.inputs;
  if (
    snapshotRecord.version !== 1 ||
    typeof snapshotRecord.snapshotId !== 'string' ||
    snapshotRecord.snapshotId.trim().length === 0 ||
    typeof snapshotRecord.workingDirectory !== 'string' ||
    snapshotRecord.workingDirectory.trim().length === 0 ||
    !inputs ||
    typeof inputs !== 'object' ||
    Array.isArray(inputs)
  ) {
    return false;
  }
  const inputRevisions = inputs as Record<string, unknown>;
  const revisionKeys = [
    'rulesRevision',
    'settingsRevision',
    'projectRevision',
    'mcpRevision',
    'resourceCatalogRevision',
  ] as const;
  if (
    !revisionKeys.every(
      (key) =>
        typeof inputRevisions[key] === 'string' &&
        (inputRevisions[key] as string).trim().length > 0,
    )
  ) {
    return false;
  }
  const tools = snapshotRecord.tools;
  if (!tools || typeof tools !== 'object') {
    return false;
  }
  const toolRecord = tools as Record<string, unknown>;
  if (
    !Array.isArray(toolRecord.piBuiltinToolNames) ||
    !toolRecord.piBuiltinToolNames.every((name): name is string => typeof name === 'string') ||
    !Array.isArray(toolRecord.enabledFamilies) ||
    !Array.isArray(toolRecord.enabledMcpServerIds) ||
    !toolRecord.enabledMcpServerIds.every((id): id is string => typeof id === 'string') ||
    !Array.isArray(toolRecord.hostTools) ||
    !toolRecord.enabledFamilies.every((family): family is string => typeof family === 'string')
  ) {
    return false;
  }
  const descriptorNames = new Set<string>();
  return toolRecord.hostTools.every((tool): boolean => {
    if (!tool || typeof tool !== 'object') {
      return false;
    }
    const descriptor = tool as Record<string, unknown>;
    const name = typeof descriptor.name === 'string' ? descriptor.name.trim() : '';
    if (descriptorNames.has(name)) {
      return false;
    }
    descriptorNames.add(name);
    return (
      typeof descriptor.name === 'string' &&
      descriptor.name === name &&
      name.length > 0 &&
      typeof descriptor.description === 'string' &&
      Boolean(descriptor.parameters) &&
      typeof descriptor.parameters === 'object' &&
      !Array.isArray(descriptor.parameters)
    );
  });
}

export function assertValidBackendSessionBlueprint(
  value: unknown,
): asserts value is BackendSessionBlueprint {
  if (!isValidBackendSessionBlueprint(value)) {
    throw new Error('malformed BackendSessionBlueprint');
  }
}
