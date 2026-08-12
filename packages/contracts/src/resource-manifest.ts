/** Active resource manifest contracts (spec §8.5). */

import type {
  ResourceId,
  ResourceKind,
  ResourceSource,
  ResourceShadowDiagnostic,
} from './resource.js';

/** One active resource instance passed to Pi. */
export type ResourceInstance = {
  resourceId: ResourceId;
  kind: ResourceKind;
  name: string;
  description?: string;
  path: string;
  source: ResourceSource;
  /** Immutable content identity when the Host can determine one. */
  contentRevision?: string;
  /** Pi-native root marker; undefined for product roots. */
  piNativeRoot?: string;
};

/** Only active instances. Blocked/shadowed entries stay in the catalog/status API. */
export type ResourceManifest = {
  skills: ResourceInstance[];
  extensions: ResourceInstance[];
  prompts: ResourceInstance[];
  diagnostics: ResourceShadowDiagnostic[];
};
