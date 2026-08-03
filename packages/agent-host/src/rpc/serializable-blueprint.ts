/** Serializable SessionBlueprint projection for the RPC worker (spec §15.3). */

import type {
  ContextManifest,
  ResourceManifest,
  SessionCapabilitySnapshot,
  SessionToolPolicy,
} from '@piwin/contracts';

/**
 * JSON-safe projection of SessionBlueprint sent to the piwin SDK worker.
 * The parent keeps Settings/permissions/MCP/process/browser authority; the
 * worker only needs the exact resources/context/tools to build the Pi session.
 */
export type SerializableBlueprint = {
  snapshotId: string;
  workingDirectory: string;
  scope: { kind: 'general' } | { kind: 'project'; projectPath: string; trusted: true };
  resourceManifest: ResourceManifest;
  contextManifest: ContextManifest;
  tools: SessionToolPolicy;
  /** Subagent ceiling (empty arrays mean none allowed). */
  subagentCapabilities?: string[];
  model?: { providerId: string; modelId: string };
  thinkingLevel?: string;
};

/** Project a capability snapshot into the worker-safe frame. */
export function projectBlueprintForWorker(
  snapshot: SessionCapabilitySnapshot,
  options?: {
    model?: { providerId: string; modelId: string };
    thinkingLevel?: string;
  },
): SerializableBlueprint {
  const blueprint: SerializableBlueprint = {
    snapshotId: snapshot.snapshotId,
    workingDirectory: snapshot.workingDirectory,
    scope:
      snapshot.trust.kind === 'project'
        ? { kind: 'project', projectPath: snapshot.trust.projectPath, trusted: true }
        : { kind: 'general' },
    resourceManifest: snapshot.resourceManifest,
    contextManifest: snapshot.contextManifest,
    tools: snapshot.tools,
  };
  if (snapshot.subagentCeiling) {
    blueprint.subagentCapabilities = snapshot.subagentCeiling.allowedCapabilities;
  }
  if (options?.model) {
    blueprint.model = options.model;
  }
  if (options?.thinkingLevel) {
    blueprint.thinkingLevel = options.thinkingLevel;
  }
  return blueprint;
}

/** Assert the projection survives JSON round-trip (protocol boundary). */
export function isSerializableBlueprint(value: unknown): value is SerializableBlueprint {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.snapshotId !== 'string' || typeof record.workingDirectory !== 'string') {
    return false;
  }
  const scope = record.scope as { kind?: string } | undefined;
  if (scope?.kind === 'general') {
    return true;
  }
  return (
    scope?.kind === 'project' && typeof (scope as { projectPath?: string }).projectPath === 'string'
  );
}
