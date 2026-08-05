import type {
  BackendSessionBlueprint,
  ContextManifest,
  HostToolDescriptor,
  ResourceManifest,
  SessionCapabilitySnapshot,
  SessionScope,
} from '@piwin/contracts';

/**
 * Host-owned runtime decision set.
 *
 * This type is deliberately distinct from the JSON-safe backend projection:
 * HostRuntime retains the resolved registrations and snapshot it used to
 * compose the generation, while agent-host only receives `backendBlueprint`.
 */
export type SessionBlueprint = {
  sessionId: string;
  runtimeGenerationId: string;
  scope: SessionScope;
  workingDirectory: string;
  capabilitySnapshot: SessionCapabilitySnapshot;
  resourceManifest: ResourceManifest;
  contextManifest: ContextManifest;
  hostToolRegistrations: readonly HostToolDescriptor[];
  backendBlueprint: BackendSessionBlueprint;
};

