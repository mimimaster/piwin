/**
 * Pi model catalog projection types (static reference from @earendil-works/pi-ai).
 * Apps never import Pi packages; they query via IPC `models/catalog/search`.
 */
import type { ModelInputModality } from './config.js';

export type ModelCatalogEntry = {
  /**
   * Pi catalog provider id (anthropic / openai / …).
   * Display + filter only — never written as piwin provider id.
   */
  catalogProviderId: string;
  modelId: string;
  name: string;
  input: readonly ModelInputModality[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type ModelCatalogSearchRequest = {
  /** Model id or name substring, case-insensitive. Empty = no text filter. */
  query?: string;
  /** Match only this catalog provider (optional). */
  catalogProviderId?: string;
  /** Require input to include this modality (optional). */
  inputIncludes?: ModelInputModality;
  /** Default 50, max 200. */
  limit?: number;
};

export type ModelCatalogSearchResult = {
  entries: ModelCatalogEntry[];
  /** e.g. pi-ai package version. */
  catalogVersion: string;
};

/**
 * Pi image-generation model catalog projection.
 *
 * Pi maintains a separate `ImagesModel` catalog (35 built-in models) distinct
 * from the chat `Model` catalog.  These types mirror the shape needed by the
 * Image Generation settings page — apps fetch via IPC
 * `models/image-catalog/search`.
 */
export type ImageModelCatalogEntry = {
  catalogProviderId: string;
  modelId: string;
  name: string;
  input: readonly ModelInputModality[];
  output: readonly ModelInputModality[];
};

export type ImageModelCatalogSearchResult = {
  entries: ImageModelCatalogEntry[];
  catalogVersion: string;
};
