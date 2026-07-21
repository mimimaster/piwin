/**
 * Cross-session memory contracts (CE-MEM).
 * Domain package `@piwin/memory` implements storage; host wires tools/IPC.
 */

/** Memory visibility / isolation boundary. */
export type MemoryScope = 'global' | 'project';

/** Product memory kinds under `~/.piwin/memory/`. */
export type MemoryType = 'user' | 'feedback' | 'project' | 'reference' | 'daily';

/**
 * Confidence for injection ranking / high-confidence downgrade rules.
 * High typically needs quote length >= 5 or explicit review.
 */
export type MemoryConfidence = 'high' | 'medium' | 'low' | 'unknown';

/** Persisted memory entry (markdown + FTS index projection). */
export type MemoryRecord = {
  id: string;
  scope: MemoryScope;
  /** Stable project key when `scope` is `project`. */
  projectKey?: string;
  type: MemoryType;
  title?: string;
  content: string;
  confidence: MemoryConfidence;
  /** Supporting quote used for confidence policy. */
  quote?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
  /** When set, high confidence may be retained without quote length. */
  reviewedAt?: string;
  /** Relative path under `~/.piwin/memory/` when stored as markdown. */
  relativePath?: string;
};

export type MemoryWriteInput = {
  scope: MemoryScope;
  projectKey?: string;
  type: MemoryType;
  title?: string;
  content: string;
  confidence?: MemoryConfidence;
  quote?: string;
  tags?: string[];
};

export type MemoryUpdateInput = {
  id: string;
  title?: string;
  content?: string;
  confidence?: MemoryConfidence;
  quote?: string;
  tags?: string[];
  type?: MemoryType;
};

export type MemoryListFilter = {
  scope?: MemoryScope;
  projectKey?: string;
  type?: MemoryType;
  limit?: number;
  offset?: number;
};

export type MemorySearchQuery = {
  query: string;
  scope?: MemoryScope;
  projectKey?: string;
  limit?: number;
};

export type MemorySearchHit = {
  record: MemoryRecord;
  score?: number;
  snippet?: string;
};

/** Ordinary-entry quota vs unlimited daily notes. */
export type MemoryQuotaSummary = {
  scope: MemoryScope;
  projectKey?: string;
  ordinaryCount: number;
  ordinaryLimit: number;
  dailyCount: number;
};

/** Product config under `PiwinConfig.memory`. */
export type MemoryConfig = {
  enabled?: boolean;
  /** Inject overview into host system/reminder each prompt when trusted. */
  injectOverview?: boolean;
  /** Opt-in silent extract after settle (CE-MEM-05; default off). */
  autoExtract?: boolean;
  /** Cap for overview text builder (default ~16KB in package). */
  maxOverviewChars?: number;
};

export function createDefaultMemoryConfig(): MemoryConfig {
  return {
    enabled: false,
    injectOverview: true,
    autoExtract: false,
  };
}
