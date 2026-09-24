/** Pi Extension registry contracts (product shell; Pi loads at session create). */
import type { ExtensionCompatibility } from './extension-compatibility.js';

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
  /**
   * `pending-removal` keeps the record (and its revisions) until no live
   * runtime references them; absent means `installed`.
   */
  installationState?: 'installed' | 'pending-removal';
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
  | 'restart-required'
  | 'superseded';

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

export type ExtensionSource = 'bundled' | 'user' | 'project' | 'mapped' | 'pi-native';

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
  /** Pi `pi.on(event)` names detected from source without executing the module. */
  hookEvents?: string[];
  /** Detailed 4-tier static Agent-vs-TUI compatibility report. */
  compatibility?: ExtensionCompatibility;
  /**
   * npm/git spec this bundled copy vendors (`piwin.bundledFrom` in package.json).
   * Catalog merge hides the Pi-native package with the same identity so OAuth /
   * Settings do not list the product copy and `~/.pi` copy as two extensions.
   */
  bundledFrom?: string;
  /**
   * Raw Pi user-settings package source this entry was loaded from
   * (`npm:pi-lens@4.2.1`, `git:github.com/o/r`). Present only for user-global
   * Pi packages; it is the only identity `marketplace/package-remove` accepts.
   */
  piPackageSource?: string;
};

export type ExtensionsConfig = {
  /** Extra extension entry paths (file or directory). */
  extraPaths: string[];
  /** Disabled extension ids (basename without .ts). */
  disabledIds: string[];
  /**
   * Expose `extension_install` / `extension_list` to the Agent so a request in
   * the conversation ("install extension X") can stage + hot-activate it.
   * Every install still passes through a per-call permission prompt. Default
   * true; set false to require the Settings panel for all installs.
   */
  agentInstall?: boolean;
};
