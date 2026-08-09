/** Serializable SessionBlueprint projection for the RPC worker (spec §15.3, Phase 7 plan §5). */

import type {
  BackendSessionBlueprint,
  ContextManifest,
  ResourceManifest,
  ResourceInstance,
  SessionCapabilitySnapshot,
  SessionToolPolicy,
  SubagentCapability,
  SubagentIsolationMode,
  ThinkingLevel,
} from '@piwin/contracts';

/** Protocol version spoken between parent and worker for blueprint frames. */
export const BLUEPRINT_PROTOCOL_VERSION = 1 as const;

/**
 * JSON-safe projection of SessionBlueprint sent to the piwin SDK worker.
 * The parent keeps Settings/permissions/MCP/process/browser authority; the
 * worker only needs the exact resources/context/tools to build the Pi session.
 *
 * Phase 7 plan §5: the worker must not discover resources outside these exact
 * path lists, and must not re-load `~/.piwin/config.json` for capability
 * decisions.
 */
export type SerializableBlueprint = {
  protocolVersion: typeof BLUEPRINT_PROTOCOL_VERSION;
  snapshotId: string;
  /** Settings revision the parent compiled this snapshot from (diagnostics). */
  settingsRevision: string;
  workingDirectory: string;
  scope: { kind: 'general' } | { kind: 'project'; projectPath: string; trusted: boolean };
  resourceManifest: ResourceManifest;
  contextManifest: ContextManifest;
  tools: SessionToolPolicy;
  /**
   * Exact paths the worker may load. Derived from the active ResourceManifest
   * instances; never includes disabled/shadowed resources.
   */
  activeSkillPaths: string[];
  activeExtensionPaths: string[];
  activePromptPaths: string[];
  /** Subagent ceiling (empty arrays mean none allowed). */
  subagentCeiling?: {
    allowedCapabilities: SubagentCapability[];
    allowedSkillIds: string[];
    isolation: SubagentIsolationMode;
  };
  model?: { providerId: string; modelId: string };
  thinkingLevel?: string;
  /**
   * Additional system prompt appended after all other system prompts.
   * Used for product-level contracts (artifact decision + runtime, ADR 0029).
   */
  appendSystemPrompt?: string;
};

/** Provider runtime envelope (Phase 7 plan §6): worker must not resolve secrets itself. */
export type SerializableProviderRuntime = {
  providerId: string;
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  baseUrl: string;
  headers?: Record<string, string>;
  models: Array<{
    id: string;
    label?: string;
    input?: Array<'text' | 'image'>;
    reasoning?: boolean;
    thinkingLevels?: ThinkingLevel[];
    contextWindow?: number;
    maxOutputTokens?: number;
  }>;
  auth: { kind: 'env'; envName: string } | { kind: 'inline'; apiKey: string } | { kind: 'none' };
};

function activePathsOf(instances: ResourceInstance[]): string[] {
  return instances.map((instance) => instance.path).sort();
}

/** Project a capability snapshot into the worker-safe frame. */
export function projectBlueprintForWorker(
  snapshot: SessionCapabilitySnapshot,
  options?: {
    model?: { providerId: string; modelId: string };
    thinkingLevel?: string;
    appendSystemPrompt?: string;
  },
): SerializableBlueprint {
  const blueprint: SerializableBlueprint = {
    protocolVersion: BLUEPRINT_PROTOCOL_VERSION,
    snapshotId: snapshot.snapshotId,
    settingsRevision: snapshot.inputs.settingsRevision,
    workingDirectory: snapshot.workingDirectory,
    scope:
      snapshot.trust.kind === 'project'
        ? {
            kind: 'project',
            projectPath: snapshot.trust.projectPath,
            trusted: snapshot.trust.trusted,
          }
        : { kind: 'general' },
    resourceManifest: snapshot.resourceManifest,
    contextManifest: snapshot.contextManifest,
    tools: snapshot.tools,
    activeSkillPaths: activePathsOf(snapshot.resourceManifest.skills),
    activeExtensionPaths: activePathsOf(snapshot.resourceManifest.extensions),
    activePromptPaths: activePathsOf(snapshot.resourceManifest.prompts),
  };
  if (snapshot.subagentCeiling) {
    blueprint.subagentCeiling = {
      allowedCapabilities: snapshot.subagentCeiling.allowedCapabilities,
      allowedSkillIds: snapshot.subagentCeiling.allowedSkillIds,
      isolation: snapshot.subagentCeiling.isolation,
    };
  }
  if (options?.model) {
    blueprint.model = options.model;
  }
  if (options?.thinkingLevel) {
    blueprint.thinkingLevel = options.thinkingLevel;
  }
  if (options?.appendSystemPrompt) {
    blueprint.appendSystemPrompt = options.appendSystemPrompt;
  }
  return blueprint;
}

/** Project the exact backend contract into the worker's wire representation. */
export function projectBackendBlueprintForWorker(
  backendBlueprint: BackendSessionBlueprint,
): SerializableBlueprint {
  const blueprint = projectBlueprintForWorker(backendBlueprint.capabilitySnapshot, {
    ...(backendBlueprint.model
      ? {
          model: {
            providerId: backendBlueprint.model.providerId,
            modelId: backendBlueprint.model.modelId,
          },
        }
      : {}),
    ...(backendBlueprint.thinkingLevel ? { thinkingLevel: backendBlueprint.thinkingLevel } : {}),
    ...(backendBlueprint.appendSystemPrompt
      ? { appendSystemPrompt: backendBlueprint.appendSystemPrompt }
      : {}),
  });
  return {
    ...blueprint,
    snapshotId: backendBlueprint.capabilitySnapshot.snapshotId,
    // The worker protocol keeps this revision for diagnostics. It is copied
    // from the already-compiled snapshot and is never resolved by the worker.
    settingsRevision: backendBlueprint.capabilitySnapshot.inputs.settingsRevision,
  };
}

/** Assert the projection survives JSON round-trip (protocol boundary). */
export function isSerializableBlueprint(value: unknown): value is SerializableBlueprint {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.snapshotId !== 'string' ||
    typeof record.settingsRevision !== 'string' ||
    typeof record.workingDirectory !== 'string' ||
    !record.resourceManifest ||
    typeof record.resourceManifest !== 'object' ||
    !record.contextManifest ||
    typeof record.contextManifest !== 'object'
  ) {
    return false;
  }
  if (record.protocolVersion !== BLUEPRINT_PROTOCOL_VERSION) {
    return false;
  }
  if (
    !Array.isArray(record.activeSkillPaths) ||
    !Array.isArray(record.activeExtensionPaths) ||
    !Array.isArray(record.activePromptPaths)
  ) {
    return false;
  }
  const tools = record.tools;
  if (!tools || typeof tools !== 'object') {
    return false;
  }
  const toolRecord = tools as Record<string, unknown>;
  if (
    !Array.isArray(toolRecord.piBuiltinToolNames) ||
    !toolRecord.piBuiltinToolNames.every((name): name is string => typeof name === 'string') ||
    !Array.isArray(toolRecord.enabledFamilies) ||
    !toolRecord.enabledFamilies.every((family): family is string => typeof family === 'string') ||
    !Array.isArray(toolRecord.enabledMcpServerIds) ||
    !toolRecord.enabledMcpServerIds.every((id): id is string => typeof id === 'string') ||
    !Array.isArray(toolRecord.hostTools) ||
    !toolRecord.hostTools.every((tool): boolean => {
      if (!tool || typeof tool !== 'object') {
        return false;
      }
      const descriptor = tool as Record<string, unknown>;
      return (
        typeof descriptor.name === 'string' &&
        descriptor.name.trim().length > 0 &&
        typeof descriptor.description === 'string' &&
        Boolean(descriptor.parameters) &&
        typeof descriptor.parameters === 'object' &&
        !Array.isArray(descriptor.parameters)
      );
    })
  ) {
    return false;
  }
  const descriptorNames = new Set<string>();
  if (
    !toolRecord.hostTools.every((tool): boolean => {
      if (!tool || typeof tool !== 'object') {
        return false;
      }
      const descriptor = tool as Record<string, unknown>;
      const name = typeof descriptor.name === 'string' ? descriptor.name.trim() : '';
      if (descriptorNames.has(name)) {
        return false;
      }
      descriptorNames.add(name);
      return name.length > 0;
    })
  ) {
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
