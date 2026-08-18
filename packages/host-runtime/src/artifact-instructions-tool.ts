/** Artifact policy and runtime contract prompt delivery for sessions. */

import type { ArtifactConfig } from '@piwin/contracts';
import { resolveArtifactDecisionPrompt } from '@piwin/contracts';
import { ARTIFACT_RUNTIME_CONTRACT } from '@piwin/agent-host';

const DEFAULT_EXPLICIT_HINT =
  'Use an Artifact only when the user explicitly requests an artifact, visualization, interactive page, prototype, or UI.';

/**
 * Direct system prompt injection for Artifact capability, decision policy,
 * and output runtime contract. Injected when `config.artifact.enabled` is true.
 */
export function formatArtifactCapabilityPrompt(config: ArtifactConfig): string | undefined {
  if (!config.enabled) {
    return undefined;
  }
  const triggerHint =
    config.triggerMode === 'explicit-only' ? DEFAULT_EXPLICIT_HINT : undefined;
  const decisionPrompt = resolveArtifactDecisionPrompt(config);

  const parts = [
    '[piwin-prompt-meta kind="artifact:capability" version="5" applies="generation"]',
    triggerHint,
    decisionPrompt,
    '',
    ARTIFACT_RUNTIME_CONTRACT,
  ].filter((part): part is string => part !== undefined && part.length > 0);

  return parts.join('\n');
}
