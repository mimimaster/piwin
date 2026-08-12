/** Lazy Artifact policy/runtime delivery for model turns that actually need it. */

import type { ArtifactConfig, HostToolRegistration } from '@piwin/contracts';
import { resolveArtifactDecisionPrompt } from '@piwin/contracts';
import { ARTIFACT_RUNTIME_CONTRACT } from '@piwin/agent-host';

const DEFAULT_AUTOMATIC_HINT =
  'Use an Artifact when dense, structured, visual, or interactive content is materially easier to use than Markdown.';
const DEFAULT_EXPLICIT_HINT =
  'Use an Artifact only when the user explicitly requests an artifact, visualization, interactive page, prototype, or UI.';

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
    '[piwin-prompt-meta kind="artifact:capability" version="4" applies="generation"]',
    '## Artifact capability',
    configuredDecision,
    'Before emitting an HTML or SVG Artifact, call `artifact_instructions` and follow the returned output contract.',
    'Use ordinary Markdown when an Artifact does not materially improve the result.',
  ].join('\n');
}

export function buildArtifactInstructionsTool(config: ArtifactConfig): HostToolRegistration {
  return {
    descriptor: {
      name: 'artifact_instructions',
      description:
        'Load the full configured Artifact decision policy and HTML/SVG output contract. Call only when the response should contain an Artifact.',
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
    async execute() {
      return {
        ok: true,
        output: `${resolveArtifactDecisionPrompt(config)}\n\n${ARTIFACT_RUNTIME_CONTRACT}`,
      };
    },
  };
}
