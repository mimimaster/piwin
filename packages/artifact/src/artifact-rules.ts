import type { ArtifactDescriptor, ArtifactRules } from './types.js';

/**
 * Runtime contract v14 asks every fence to declare `style`. Fences without it
 * were written for the older contract and keep its rendering (for example the
 * derived `on-accent` ink), so replaying an old session never repaints it.
 */
export function resolveArtifactRules(descriptor: Pick<ArtifactDescriptor, 'style'>): ArtifactRules {
  return descriptor.style === undefined ? 'legacy' : 'v14';
}
