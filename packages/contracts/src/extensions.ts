/** Pi Extension registry contracts (product shell; Pi loads at session create). */

export type ExtensionRevisionState = 'installed' | 'quarantined';

/** Content identity of the exact extension set loaded by a Runtime. */
export type ExtensionSetRevision = string;

/** Exact code identity that a Host Runtime generation is allowed to load. */
export type ExtensionRevisionRef = {
  extensionId: string;
  contentRevision: string;
  /** Exact file or directory path passed to the Pi resource loader. */
  entryPath: string;
};

/** One immutable revision stored under ~/.piwin/extensions/revisions. */
export type ManagedExtensionRevision = ExtensionRevisionRef & {
  packageRoot: string;
  state: ExtensionRevisionState;
  installedAt: string;
  version?: string;
  sourceLocator?: string;
  integrity?: string;
};

/** Persisted user intent and revision history for one managed extension. */
export type InstalledExtensionRecord = {
  id: string;
  name: string;
  description: string;
  configuredEnabled: boolean;
  selectedRevision?: string;
  lastKnownGoodRevision?: string;
  revisions: ManagedExtensionRevision[];
};

export type ExtensionRuntimeBinding = {
  sessionId: string;
  generationId: string;
  extensionSetRevision: ExtensionSetRevision;
  extensions: ExtensionRevisionRef[];
};

export type ExtensionDeploymentPhase =
  | 'queued'
  | 'validating'
  | 'waiting-current-run'
  | 'compiling'
  | 'creating-runtime'
  | 'publishing'
  | 'active'
  | 'failed'
  | 'rolled-back'
  | 'restart-required';

export type ExtensionDeploymentRecord = {
  deploymentId: string;
  sessionId: string;
  targetRegistryRevision: string;
  targetExtensionSetRevision?: ExtensionSetRevision;
  expectedSettingsRevision?: string;
  when: 'now' | 'after-current-run' | 'new-sessions-only';
  phase: ExtensionDeploymentPhase;
  generationId?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

/** Atomic registry document owned by the Host. */
export type ExtensionRegistryDocument = {
  version: 1;
  revision: string;
  extensions: Record<string, InstalledExtensionRecord>;
};

export type ExtensionSource = 'bundled' | 'user' | 'project' | 'mapped';

/**
 * Metadata for list/enable UI. Host never executes the module for listing —
 * only Pi DefaultResourceLoader loads extensions when creating a session.
 */
export type ExtensionSummary = {
  id: string;
  name: string;
  description: string;
  source: ExtensionSource;
  /** Absolute path to the extension entry (.ts or directory with index.ts). */
  path: string;
  enabled: boolean;
  /** True when this entry is managed by the immutable revision store. */
  managed?: boolean;
  /** Exact content identity when the entry is managed or content-addressed. */
  contentRevision?: string;
  /** Display version from package metadata, when available. */
  version?: string;
  /** User intent, separated from effective/current Runtime state. */
  configuredEnabled?: boolean;
  /** Registry revision currently selected for this extension. */
  selectedRevision?: string;
};

export type ExtensionsConfig = {
  /** Extra extension entry paths (file or directory). */
  extraPaths: string[];
  /** Disabled extension ids (basename without .ts). */
  disabledIds: string[];
};
