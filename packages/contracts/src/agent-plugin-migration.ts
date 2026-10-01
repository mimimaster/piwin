import type { SessionBackendBinding } from './agent-backend.js';
import type { AgentPluginInstallation } from './agent-plugin.js';

export type AgentPluginBindingReadiness =
  | { state: 'ready'; revision: string }
  | { state: 'unavailable'; reason: 'wrong-agent' | 'disabled' | 'legacy-declaration' }
  | { state: 'migration-required'; expectedRevision: string | null; targetRevision: string; compatible: boolean };

export type AgentPluginMigrationConfirmation = {
  sessionId: string;
  /** null explicitly confirms a previously unversioned binding, not any revision. */
  expectedRevision: string | null;
  targetRevision: string;
};

/**
 * The installed implementation a binding may resolve to.
 *
 * Neutral between registries: an extension-provided session backend and the
 * retired downloaded-adapter inventory both project onto this shape.
 */
export type AgentPluginBindingTarget = {
  agentId: string;
  revision: string;
  enabled: boolean;
  unversionedBindingCompatible: boolean;
  compatibleRevisions: readonly string[];
};

/** Project a retired downloaded-adapter installation onto the neutral target. */
export function agentPluginBindingTargetFromInstallation(
  installation: AgentPluginInstallation,
): AgentPluginBindingTarget {
  return {
    agentId: installation.agentId,
    revision: installation.revision,
    enabled: installation.enabled,
    unversionedBindingCompatible:
      installation.manifest.schemaVersion === 2
        ? installation.manifest.unversionedBindingCompatible
        : false,
    compatibleRevisions:
      installation.manifest.schemaVersion === 2 ? installation.manifest.compatibleRevisions : [],
  };
}

/** Assessment never mutates a binding. Only explicit Host confirmation may perform a migration. */
export function assessAgentPluginBinding(
  binding: SessionBackendBinding,
  target: AgentPluginBindingTarget,
): AgentPluginBindingReadiness {
  if (binding.agentId !== target.agentId) return { state: 'unavailable', reason: 'wrong-agent' };
  if (!target.enabled) return { state: 'unavailable', reason: 'disabled' };
  if (binding.pluginRevision === target.revision) return { state: 'ready', revision: target.revision };
  return {
    state: 'migration-required', expectedRevision: binding.pluginRevision ?? null, targetRevision: target.revision,
    compatible: binding.pluginRevision === undefined
      ? target.unversionedBindingCompatible
      : target.compatibleRevisions.includes(binding.pluginRevision),
  };
}
