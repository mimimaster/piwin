import type { CompactionDelegationTarget } from './compaction.js';
import type { ModelRef, ThinkingLevel } from './host.js';
import type { SessionCapabilitySnapshot } from './session-capability.js';

/** JSON-safe capability projection consumed by an agent backend. */
export type BackendSessionBlueprint = {
  version: 1;
  sessionId: string;
  runtimeGenerationId: string;
  capabilitySnapshot: SessionCapabilitySnapshot;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  /**
   * Dedicated model override for context compaction summarization.
   * When set, sdk/rpc workers route `session_before_compact` through this model.
   */
  compactionDelegation?: CompactionDelegationTarget;
  /**
   * Optional override for Pi's base system prompt (used when an active
   * system-prompt preset runs in `replace` mode).
   */
  systemPromptOverride?: string;
  /**
   * Additional system prompt appended after all other system prompts.
   * Used for product-level contracts (artifact decision + runtime, ADR 0029).
   */
  appendSystemPrompt?: string;
};
