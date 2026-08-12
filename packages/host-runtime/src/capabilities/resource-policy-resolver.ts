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
import { normalizeResourceId } from '@piwin/contracts';

export type ResourcePolicyInput = {
  catalog: ResourceCatalog;
  /** Logical IDs disabled by the user (Settings `disabledIds`, normalized). */
  disabledIds?: ResourceId[];
  /** Family-scoped disabled IDs; takes precedence over the legacy field. */
  disabledIdsByKind?: Partial<Record<ResourceKind, ResourceId[]>>;
  /** Global per-family disable switches. */
  familyDisabled: Partial<Record<ResourceKind, boolean>>;
  /** Optional allowlist; when present only these IDs may be active. */
  allowlist?: ResourceId[];
  /** Family-scoped allowlists; takes precedence over the legacy field. */
  allowlistByKind?: Partial<Record<ResourceKind, ResourceId[]>>;
  /** Whether the open project is trusted (ADR 0019 §2). */
  projectTrusted: boolean;
};

export type ResolveResourceActivationsResult = {
  catalog: ResourceCatalog;
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
  const sources: ResourceSource[] = ['bundled', 'user'];
  if (projectTrusted) {
    sources.push('project');
  }
  sources.push('mapped');
  return sources;
}

export function createResourcePolicy(input: ResourcePolicyInput): ResourcePolicy {
  const sources = defaultSources(input.projectTrusted);
  const normalizeIds = (ids: ResourceId[] | undefined): ResourceId[] =>
    (ids ?? []).map((resourceId) => normalizeResourceId(resourceId));
  const createSelection = (kind: ResourceKind): ResourceSelectionPolicy => ({
    disabledIds: normalizeIds(input.disabledIdsByKind?.[kind] ?? input.disabledIds),
    allowedSources: sources,
    allowlistedIds:
      input.allowlistByKind?.[kind] !== undefined
        ? normalizeIds(input.allowlistByKind[kind])
        : input.allowlist !== undefined
          ? normalizeIds(input.allowlist)
          : null,
  });
  return {
    skills: createSelection('skill'),
    extensions: createSelection('extension'),
    prompts: createSelection('prompt'),
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
  const activations: ResourceActivation[] = [];
  const seenIds = new Set<string>();
  const activeEntries: ResourceCatalog['entries'] = [];

  const sourceOrder = new Map<ResourceSource, number>([
    ['bundled', 0],
    ['user', 1],
    ['project', 2],
    ['mapped', 3],
    ['pi-native', 4],
  ]);
  const orderedEntries = input.catalog.entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (left, right) =>
        (sourceOrder.get(left.entry.source) ?? Number.MAX_SAFE_INTEGER) -
          (sourceOrder.get(right.entry.source) ?? Number.MAX_SAFE_INTEGER) ||
        left.index - right.index,
    )
    .map(({ entry }) => entry);

  for (const entry of orderedEntries) {
    const resourceId = normalizeResourceId(entry.resourceId);
    const familyKey = (Object.keys(FAMILY_KINDS) as Array<keyof ResourcePolicy>).find(
      (key) => FAMILY_KINDS[key] === entry.kind,
    );
    const familyOff = familyKey !== undefined && input.familyDisabled[entry.kind] === true;
    const selectionForKind = familyKey !== undefined ? policy[familyKey] : policy.skills;
    const disabled = new Set(selectionForKind.disabledIds);
    const allow =
      selectionForKind.allowlistedIds !== null ? new Set(selectionForKind.allowlistedIds) : null;
    const isProjectResource = entry.source === 'project';
    const sourceAllowed = selectionForKind.allowedSources.includes(entry.source);
    const projectBlocked = isProjectResource && !sourceAllowed;
    const idDisabled = disabled.has(resourceId);
    const notAllowed = allow !== null && !allow.has(resourceId);

    const configuredEnabled = !familyOff && !idDisabled && entry.configuredEnabled !== false;
    const effectiveEnabled = configuredEnabled && sourceAllowed && !notAllowed;
    const blockedReason = projectBlocked
      ? 'project-untrusted'
      : notAllowed
        ? 'not-allowed'
        : familyOff || idDisabled || entry.configuredEnabled === false || !sourceAllowed
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
    const identity = `${entry.kind}\u0000${resourceId}`;
    if (!seenIds.has(identity)) {
      seenIds.add(identity);
      activations.push(activation);
      if (effectiveEnabled) {
        activeEntries.push(entry);
      }
    }
  }

  return { catalog: input.catalog, policy, activations, activeEntries };
}
