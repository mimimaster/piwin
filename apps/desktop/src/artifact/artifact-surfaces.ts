/**
 * Desktop view of the Artifact capability.
 *
 * The scope key mirrors `SessionScope.kind`, which is also what Host
 * compilation uses for the resident Artifact prompt and the
 * `artifact_instructions` tool. Computing both from the same key is what keeps
 * an advertised surface and a rendered surface from disagreeing.
 */
import type {
  ArtifactConfig,
  ArtifactScopeKey,
  ResolvedArtifactCapability,
  SessionScope,
} from '@piwin/contracts';
import { resolveArtifactCapability } from '@piwin/contracts';

/**
 * Artifact scope class for a session scope. A not-yet-resolved scope (draft,
 * hydration, Home) reads as the Conversation class.
 */
export function artifactScopeKeyForScope(scope: SessionScope | undefined): ArtifactScopeKey {
  return scope?.kind === 'project' ? 'project' : 'general';
}

/** Resolve the Inline/Canvas switches for the session that owns `scope`. */
export function resolveArtifactSurfacesForScope(
  artifact: ArtifactConfig | undefined,
  scope: SessionScope | undefined,
): ResolvedArtifactCapability {
  return resolveArtifactCapability(artifact, artifactScopeKeyForScope(scope));
}

/**
 * Capability → render props. Always passes both booleans so a `false` can
 * never be dropped by a truthy spread.
 */
export function artifactSurfaceProps(capability: ResolvedArtifactCapability): {
  artifactInlineEnabled: boolean;
  artifactCanvasEnabled: boolean;
} {
  return {
    artifactInlineEnabled: capability.inline,
    artifactCanvasEnabled: capability.canvas,
  };
}
