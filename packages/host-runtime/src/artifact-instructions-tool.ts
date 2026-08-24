/** Lazy Artifact policy/runtime delivery for model turns that actually need it. */

import {
  ARTIFACT_INSTRUCTIONS_TOOL_NAME,
  formatArtifactInstructions,
  type ArtifactConfig,
  type HostToolDescriptor,
  type HostToolRegistration,
} from '@piwin/contracts';

const DEFAULT_AUTOMATIC_HINT =
  'Use an Artifact when dense, structured, visual, or interactive content is materially easier to use than Markdown.';
const DEFAULT_EXPLICIT_HINT =
  'Use an Artifact only when the user explicitly requests an artifact, visualization, interactive page, prototype, or UI.';
const MAX_TRACKED_INSTRUCTION_RUNS = 256;
const ALREADY_LOADED_OUTPUT =
  'Artifact instructions are already loaded for this run. Reuse the previous result and produce the final response without calling this tool again.';

/** Compact always-on routing hint; the full contract is loaded through the tool. */
export function formatArtifactCapabilityPrompt(config: ArtifactConfig): string | undefined {
  if (!config.enabled) {
    return undefined;
  }
  const configuredDecision =
    config.decisionPrompt.mode === 'custom' && config.decisionPrompt.customPrompt.trim().length > 0
      ? 'A custom Artifact decision policy is configured. Load it before deciding whenever an Artifact may be relevant.'
      : config.triggerMode === 'explicit-only'
        ? DEFAULT_EXPLICIT_HINT
        : DEFAULT_AUTOMATIC_HINT;
  return [
    '[piwin-prompt-meta kind="artifact:capability" version="6" applies="generation"]',
    '## Artifact capability',
    configuredDecision,
    `Before emitting an HTML or SVG Artifact, call \`${ARTIFACT_INSTRUCTIONS_TOOL_NAME}\` at most one load per run and reuse its successful result.`,
    'Use ordinary Markdown when an Artifact does not materially improve the result.',
  ].join('\n');
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
