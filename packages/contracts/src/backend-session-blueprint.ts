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
};
