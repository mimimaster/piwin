/** Artifact policy/runtime delivery for sessions that have the capability enabled. */

import {
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  formatArtifactInstructions,
  type ArtifactConfig,
  type HostToolDescriptor,
  type HostToolRegistration,
} from '@piwin/contracts';

const MAX_TRACKED_INSTRUCTION_RUNS = 256;
const ALREADY_LOADED_OUTPUT =
  'Artifact instructions are already loaded for this run. Reuse the previous result and produce the final response without calling this tool again.';

/** Resident decision policy + runtime contract. Injected when artifacts are enabled. */
export function formatArtifactCapabilityPrompt(config: ArtifactConfig): string | undefined {
  if (!config.enabled) {
    return undefined;
  }
  return formatArtifactInstructions(config);
}

/** Resident contract only when the generation surface has a concrete executor. */
export function formatResidentArtifactPrompt(
  config: ArtifactConfig,
  hostTools: readonly HostToolDescriptor[],
): string | undefined {
  const hasArtifactInstructions = hostTools.some(
    (tool) => tool.name === ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  );
  return hasArtifactInstructions ? formatArtifactCapabilityPrompt(config) : undefined;
}

export function buildArtifactInstructionsTool(config: ArtifactConfig): HostToolRegistration {
  const loadedRuns = new Set<string>();

  return {
    descriptor: {
      name: ARTIFACT_INSTRUCTIONS_TOOL_NAME,
      description:
        'Artifact decision policy and HTML/SVG output contract are already in the system prompt. Do not call this tool; emit the Artifact fence directly.',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    family: 'artifact',
    permissionSpec: {
      action: 'artifact:instructions',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    async execute(_args, _signal, context) {
      const runKey = `${context.sessionId}\u0000${context.runtimeGenerationId}\u0000${context.runId}`;
      if (loadedRuns.has(runKey)) {
        return { ok: true, output: ALREADY_LOADED_OUTPUT };
      }

      loadedRuns.add(runKey);
      if (loadedRuns.size > MAX_TRACKED_INSTRUCTION_RUNS) {
        const oldestRunKey = loadedRuns.values().next().value;
        if (oldestRunKey !== undefined) {
          loadedRuns.delete(oldestRunKey);
        }
      }

      return {
        ok: true,
        output: formatArtifactInstructions(config),
      };
    },
  };
}
