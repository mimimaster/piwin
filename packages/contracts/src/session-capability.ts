/** Session capability snapshot + tool manifest contracts (spec §9–§10). */

import type { ModelRef, ThinkingLevel, SessionScope } from './host.js';
import type { SubagentIsolationMode } from './subagent.js';
import type { SubagentCapability } from './subagent-profile.js';
import type { ResourceId, ResourcePolicy } from './resource.js';
import type { ResourceManifest } from './resource-manifest.js';
import type { ContextPolicy, ContextManifest } from './context-manifest.js';
import type { HostToolDescriptor } from './host-tool.js';

/** High-level agent exposure of a tool family (spec §7.2). */
export type CapabilityExposure = 'off' | 'manual-only' | 'agent';

export type NotesAccess = 'off' | 'manual-only' | 'agent-read' | 'agent-read-write';

export type FlashcardsAccess = 'off' | 'manual-review' | 'agent-create';

/**
 * Host custom tool families. The resolver converts product capability
 * exposure into an exact set of enabled families.
 */
export type SessionToolFamily =
  | 'filesystem-read'
  | 'filesystem-write'
  | 'shell'
  | 'web-search'
  | 'web-fetch'
  | 'mcp'
  | 'process'
  | 'browser'
  | 'planning'
  | 'delegate'
  | 'notes-read'
  | 'notes-write'
  | 'flashcards-read'
  | 'flashcards-write'
  | 'image-generation'
  | 'video-generation';

/** Compiled tool policy for one session (spec §9.3). */
export type SessionToolPolicy = {
  hostTools: HostToolDescriptor[];
  piBuiltinToolNames: string[];
  enabledMcpServerIds: string[];
  enabledFamilies: SessionToolFamily[];
};

/**
 * Immutable subagent ceiling persisted at child creation (spec §9.6). Empty
 * capability or skill arrays mean none allowed.
 */
export type SubagentCapabilityCeiling = {
  profileId?: string;
  allowedCapabilities: SubagentCapability[];
  allowedSkillIds: ResourceId[];
  workingDirectory: string;
  isolation: SubagentIsolationMode;
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
};

export type CapabilityInputRevisions = {
  rulesRevision: string;
  settingsRevision: string;
  projectRevision: string;
  mcpRevision: string;
  resourceCatalogRevision: string;
};

/**
 * Compiled snapshot capturing every input that determines what Pi receives
 * (spec §10.1). Created by the Host resolver; adapters consume it.
 */
export type SessionCapabilitySnapshot = {
  version: 1;
  snapshotId: string;
  inputs: CapabilityInputRevisions;
  scope: SessionScope;
  workingDirectory: string;
  trust: { kind: 'general' } | { kind: 'project'; projectPath: string; trusted: boolean };
  resources: ResourcePolicy;
  resourceManifest: ResourceManifest;
  context: ContextPolicy;
  contextManifest: ContextManifest;
  tools: SessionToolPolicy;
  subagentCeiling?: SubagentCapabilityCeiling;
};
