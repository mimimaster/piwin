/** Pure resolver: ResourceCatalog + settings + trust → ResourcePolicy/activations (spec §8.5). */

import type {
  ResourceActivation,
  ResourceCatalog,
  ResourceId,
  ResourceKind,
  ResourcePolicy,
  ResourceSelectionPolicy,
  ResourceSource,
} from '@piwin/contracts';

export type ResourcePolicyInput = {
  catalog: ResourceCatalog;
  /** Logical IDs disabled by the user (Settings `disabledIds`, normalized). */
  disabledIds: ResourceId[];
  /** Global per-family disable switches. */
  familyDisabled: Partial<Record<ResourceKind, boolean>>;
  /** Optional allowlist; when present only these IDs may be active. */
  allowlist?: ResourceId[];
  /** Whether the open project is trusted (ADR 0019 §2). */
  projectTrusted: boolean;
};

export type ResolveResourceActivationsResult = {
  policy: ResourcePolicy;
  activations: ResourceActivation[];
  /** Active entries only — exactly what Pi should receive. */
  activeEntries: ResourceCatalog['entries'];
};

const FAMILY_KINDS: Readonly<Record<keyof ResourcePolicy, ResourceKind>> = {
  skills: 'skill',
  extensions: 'extension',
  prompts: 'prompt',
};

function defaultSources(projectTrusted: boolean): ResourceSource[] {
  const sources: ResourceSource[] = ['bundled', 'user', 'mapped'];
  if (projectTrusted) {
    sources.push('project');
  }
  return sources;
}

export function createResourcePolicy(input: ResourcePolicyInput): ResourcePolicy {
  const sources = defaultSources(input.projectTrusted);
  const selection: ResourceSelectionPolicy = {
    disabledIds: [...input.disabledIds],
    allowedSources: sources,
    allowlistedIds: input.allowlist !== undefined ? [...input.allowlist] : null,
  };
  return {
    skills: selection,
    extensions: selection,
    prompts: selection,
  };
}

/**
 * Compile the exact active resource set for a session. General-scope sessions
 * always exclude project resources; untrusted projects defensively exclude
 * them too, even if session creation should already have been rejected (SCR-08).
 */
export function resolveResourceActivations(
  input: ResourcePolicyInput,
): ResolveResourceActivationsResult {
  const policy = createResourcePolicy(input);
  const disabled = new Set(policy.skills.disabledIds);
  const allow =
    policy.skills.allowlistedIds !== null ? new Set(policy.skills.allowlistedIds) : null;

  const activations: ResourceActivation[] = [];
  const seenIds = new Set<ResourceId>();
  const activeEntries: ResourceCatalog['entries'] = [];

  for (const entry of input.catalog.entries) {
    const resourceId = entry.resourceId;
    const familyKey = (Object.keys(FAMILY_KINDS) as Array<keyof ResourcePolicy>).find(
      (key) => FAMILY_KINDS[key] === entry.kind,
    );
    const familyOff = familyKey !== undefined && input.familyDisabled[entry.kind] === true;
    const selectionForKind = familyKey !== undefined ? policy[familyKey] : policy.skills;
    const isProjectResource = entry.source === 'project';
    const sourceAllowed = selectionForKind.allowedSources.includes(entry.source);
    const projectBlocked = isProjectResource && !sourceAllowed;
    const idDisabled = disabled.has(resourceId);
    const notAllowed = allow !== null && !allow.has(resourceId);

    const configuredEnabled = !familyOff && !idDisabled;
    const effectiveEnabled = configuredEnabled && sourceAllowed && !notAllowed;
    const blockedReason = projectBlocked
      ? 'project-untrusted'
      : notAllowed
        ? 'not-allowed'
        : familyOff || idDisabled || !sourceAllowed
          ? 'disabled'
          : undefined;

    const activation: ResourceActivation = {
      resourceId,
      kind: entry.kind,
      name: entry.name,
      ...(entry.description !== undefined ? { description: entry.description } : {}),
      path: entry.path,
      source: entry.source,
      configuredEnabled,
      effectiveEnabled,
      ...(blockedReason !== undefined ? { blockedReason } : {}),
    };

    // First occurrence wins by precedence (catalog order encodes precedence);
    // later shadowing copies are reported via diagnostics by the catalog.
    if (!seenIds.has(resourceId)) {
      seenIds.add(resourceId);
      activations.push(activation);
      if (effectiveEnabled) {
        activeEntries.push(entry);
      }
    }
  }

  return { policy, activations, activeEntries };
}
