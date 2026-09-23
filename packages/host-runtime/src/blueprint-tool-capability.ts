import type {
  CreateSessionInput,
  HostToolDescriptor,
  PiwinConfig,
  SessionToolFamily,
} from '@piwin/contracts';
import {
  KNOWLEDGE_TOOL_NAMES,
  resolveArtifactCapability,
  type ResolvedArtifactCapability,
} from '@piwin/contracts';
import type { McpCapabilityBrief } from './mcp-capability-brief.js';
import { resolveGenerationArtifactCapability } from './session-scope.js';
import { buildHostToolboxDescriptor } from './tool-catalog/catalog-tool.js';
import { HOST_TOOLBOX_NAME } from './host-toolbox.js';

/**
 * Capability-exposure primitives shared by the Agent and Conversation policy
 * compilers: which concrete host tools a policy may advertise, whether the
 * knowledge family is really available, and the artifact capability for a scope.
 */
/**
 * Hide toolbox-routable tools behind the single catalog shell. A tool named in
 * `hostToolboxTargetNames` is reachable only through the toolbox descriptor, so
 * the model surface stays one entry point plus the concrete executors.
 */
export function projectModelHostTools(
  effectiveToolNames: readonly string[],
  hostToolDescriptors: readonly HostToolDescriptor[] | undefined,
  hostToolboxTargetNames: readonly string[],
  mcpBrief?: McpCapabilityBrief,
): HostToolDescriptor[] {
  const toolboxPresent = effectiveToolNames.includes(HOST_TOOLBOX_NAME);
  const hiddenBehindToolbox = toolboxPresent ? new Set(hostToolboxTargetNames) : new Set<string>();
  const modelVisibleToolNames = effectiveToolNames.filter((name) => !hiddenBehindToolbox.has(name));
  return buildHostToolsForPolicy(modelVisibleToolNames, hostToolDescriptors).map((descriptor) =>
    descriptor.name === HOST_TOOLBOX_NAME
      ? buildHostToolboxDescriptor(hostToolboxTargetNames, mcpBrief)
      : descriptor,
  );
}

/**
 * Produce the final HostToolDescriptor[] for the tool policy.
 *
 * When concrete descriptors are provided (from buildSessionHostTools),
 * filter to only those that have a matching executor — a tool name without
 * an executor must not appear in the manifest.
 *
 * When no concrete descriptors are provided (test/legacy path), return an
 * empty array. This is fail-closed: no host tools are advertised until the
 * parent composition provides real executors.
 */
export function buildHostToolsForPolicy(
  customToolNames: readonly string[],
  hostToolDescriptors?: readonly HostToolDescriptor[],
): HostToolDescriptor[] {
  if (!hostToolDescriptors || hostToolDescriptors.length === 0) {
    // Fail-closed: no concrete executors → no host tools advertised.
    return [];
  }
  const descriptorByName = new Map(
    hostToolDescriptors.map((descriptor) => [descriptor.name, descriptor]),
  );
  const selected: HostToolDescriptor[] = [];
  for (const name of customToolNames) {
    const descriptor = descriptorByName.get(name);
    if (descriptor) selected.push(descriptor);
  }
  return selected.sort((left, right) => left.name.localeCompare(right.name));
}

export function familyHasKnowledgeTools(
  index: ReadonlyMap<SessionToolFamily, readonly string[]> | undefined,
): boolean {
  if (!index) return false;
  const names = index.get('notes-read') ?? [];
  return names.some(
    (name) =>
      name === KNOWLEDGE_TOOL_NAMES.list ||
      name === KNOWLEDGE_TOOL_NAMES.search ||
      name === KNOWLEDGE_TOOL_NAMES.read,
  );
}

/**
 * Artifact capability for a Conversation (general-scope) session.
 * The scope key mirrors `SessionScope.kind`, which is also what Desktop uses to
 * resolve the same switches for rendering.
 */
export function conversationArtifactCapability(config: PiwinConfig): ResolvedArtifactCapability {
  return resolveArtifactCapability(config.artifact, 'general');
}

/** Artifact capability for an Agent (project-scope) session; none for a subagent. */
export function agentArtifactCapability(
  config: PiwinConfig,
  input: CreateSessionInput,
): ResolvedArtifactCapability {
  return resolveGenerationArtifactCapability(
    config.artifact,
    'project',
    input.subagent !== undefined,
  );
}
