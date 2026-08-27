/** Lazy Artifact policy/runtime delivery for model turns that actually need it. */

import {
  ARTIFACT_EXPLICIT_ONLY_HINT,
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  formatArtifactInstructions,
  type ArtifactConfig,
  type HostToolDescriptor,
  type HostToolRegistration,
} from '@piwin/contracts';

const MAX_TRACKED_INSTRUCTION_RUNS = 256;
const ALREADY_LOADED_OUTPUT =
  'Artifact instructions are already loaded for this run. Reuse the previous result and produce the final response without calling this tool again.';

const ARTIFACT_POLICY_BODY = [
  'Emit HTML/SVG Artifacts only when interactive or visual content substantially outperforms Markdown.',
  `Before generating, invoke \`${ARTIFACT_INSTRUCTIONS_TOOL_NAME}\` once to retrieve the specification, then reuse the result.`,
].join('\n');

/** Compact always-on routing hint; the full contract is loaded through the tool. */
export function formatArtifactCapabilityPrompt(config: ArtifactConfig): string | undefined {
  if (!config.enabled) {
    return undefined;
  }
  const hasCustomDecision =
    config.decisionPrompt.mode === 'custom' && config.decisionPrompt.customPrompt.trim().length > 0;
  const lines = [
    config.triggerMode === 'explicit-only' ? ARTIFACT_EXPLICIT_ONLY_HINT : undefined,
    ARTIFACT_POLICY_BODY,
    hasCustomDecision
      ? 'A custom Artifact decision policy is configured. Load it before deciding whenever an Artifact may be relevant.'
      : undefined,
  ].filter((part): part is string => part !== undefined && part.length > 0);
  return `<artifact_policy>\n${lines.join('\n')}\n</artifact_policy>`;
}

/** Compact routing hint only when the generation surface has a concrete executor. */
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
        'Load the full configured Artifact decision policy and HTML/SVG output contract. Call at most once per run, only when the response should contain an Artifact.',
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
