/**
 * Pure draft helpers for the orchestration scheme editor.
 *
 * Split out of the editor view (AGENTS.md §3.2: state/logic vs view) so the
 * validation and normalisation rules stay unit-testable without React.
 */
import {
  DEFAULT_ORCHESTRATION_ROLE_TEMPLATES,
  isValidOrchestrationRoleId,
  isValidOrchestrationSchemeId,
  migrateSchemeMembers,
  type ModelRef,
  type OrchestrationMemberFallback,
  type OrchestrationScheme,
  type OrchestrationSchemeMember,
  type OrchestrationSchemeSettings,
  type SubagentIsolationMode,
  type ThinkingLevel,
} from '@piwin/contracts';

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

export type SchemeModelOption = {
  value: string;
  label: string;
  ref: ModelRef;
};

export function cloneMember(member: OrchestrationSchemeMember): OrchestrationSchemeMember {
  return {
    role: member.role,
    description: member.description,
    ...(member.profileId ? { profileId: member.profileId } : {}),
    ...(member.model ? { model: member.model } : {}),
    ...(member.thinkingLevel ? { thinkingLevel: member.thinkingLevel } : {}),
    ...(member.isolation ? { isolation: member.isolation } : {}),
    ...(member.fallback ? { fallback: member.fallback } : { fallback: 'main' }),
    ...(member.reportContract?.trim() ? { reportContract: member.reportContract.trim() } : {}),
  };
}

export function schemeToEditableDraft(scheme: OrchestrationScheme): OrchestrationSchemeSettings {
  const members = migrateSchemeMembers(scheme).map(cloneMember);
  const draft: OrchestrationSchemeSettings = {
    id: scheme.id,
    name: scheme.name,
    description: scheme.description,
    systemPreamble: scheme.systemPreamble,
    exposeSpawnMetadata: scheme.exposeSpawnMetadata,
    waitPolicy: 'await-all',
    members,
  };
  if (scheme.defaultRole) draft.defaultRole = scheme.defaultRole;
  else if (members[0]) draft.defaultRole = members[0].role;
  if (scheme.defaultProfileId) draft.defaultProfileId = scheme.defaultProfileId;
  if (scheme.maxConcurrency !== undefined) draft.maxConcurrency = scheme.maxConcurrency;
  if (scheme.maxTasksPerRun !== undefined) draft.maxTasksPerRun = scheme.maxTasksPerRun;
  if (scheme.maxSubagentThinkingLevel) {
    draft.maxSubagentThinkingLevel = scheme.maxSubagentThinkingLevel;
  }
  return draft;
}

export function createEmptyUserScheme(
  existingIds: ReadonlySet<string>,
): OrchestrationSchemeSettings {
  let suffix = 1;
  let id = `my-scheme-${suffix}`;
  while (existingIds.has(id) || !isValidOrchestrationSchemeId(id)) {
    suffix += 1;
    id = `my-scheme-${suffix}`;
  }
  const scout = cloneMember(DEFAULT_ORCHESTRATION_ROLE_TEMPLATES[0]!);
  return {
    id,
    name: 'My scheme',
    description: 'Custom role roster for the main agent',
    systemPreamble:
      'This orchestration scheme is active. Delegate work that would pollute this context to roster roles via piwin_subagent_run with role set. Wait for tool results before continuing. Do not nest subagents. Trivial single-file work need not force a subagent.',
    exposeSpawnMetadata: false,
    waitPolicy: 'await-all',
    defaultRole: scout.role,
    defaultProfileId: scout.profileId ?? 'explorer',
    members: [scout],
    maxConcurrency: 4,
    maxTasksPerRun: 8,
    maxSubagentThinkingLevel: 'low',
  };
}

export function validateSchemeDraft(draft: OrchestrationSchemeSettings): string | undefined {
  if (!isValidOrchestrationSchemeId(draft.id)) return 'invalid-id';
  if (!draft.name.trim() || !draft.description.trim() || !draft.systemPreamble.trim()) {
    return 'incomplete';
  }
  const members = draft.members ?? [];
  if (members.length === 0) return 'need-member';
  const seen = new Set<string>();
  for (const member of members) {
    if (!isValidOrchestrationRoleId(member.role)) return 'invalid-role';
    if (!member.description.trim()) return 'incomplete';
    if (seen.has(member.role)) return 'duplicate-role';
    seen.add(member.role);
  }
  if (draft.defaultRole && !seen.has(draft.defaultRole)) return 'bad-default-role';
  return undefined;
}

/** Keep defaultRole on a live member after the roster is renamed. */
export function healSchemeDefaultRole(
  draft: OrchestrationSchemeSettings,
): OrchestrationSchemeSettings {
  const members = draft.members ?? [];
  if (draft.defaultRole && members.some((member) => member.role === draft.defaultRole)) {
    return draft;
  }
  const next: OrchestrationSchemeSettings = { ...draft };
  if (members[0]) next.defaultRole = members[0].role;
  else delete next.defaultRole;
  return next;
}

/** Trim / lowercase at save time so typing is not rewritten on every keystroke. */
export function cleanSchemeDraft(draft: OrchestrationSchemeSettings): OrchestrationSchemeSettings {
  const members = (draft.members ?? []).map((member) =>
    cloneMember({
      ...member,
      role: member.role.trim().toLowerCase(),
      description: member.description.trim(),
    }),
  );
  const next: OrchestrationSchemeSettings = {
    id: draft.id.trim().toLowerCase(),
    name: draft.name.trim(),
    description: draft.description.trim(),
    systemPreamble: draft.systemPreamble.trim(),
    exposeSpawnMetadata: draft.exposeSpawnMetadata === true,
    waitPolicy: 'await-all',
    members,
  };
  if (draft.defaultRole?.trim()) {
    next.defaultRole = draft.defaultRole.trim().toLowerCase();
  }
  if (draft.defaultProfileId?.trim()) {
    next.defaultProfileId = draft.defaultProfileId.trim();
  }
  if (draft.maxConcurrency !== undefined) next.maxConcurrency = draft.maxConcurrency;
  if (draft.maxTasksPerRun !== undefined) next.maxTasksPerRun = draft.maxTasksPerRun;
  if (draft.maxSubagentThinkingLevel) {
    next.maxSubagentThinkingLevel = draft.maxSubagentThinkingLevel;
  }
  return next;
}

export function modelSelectValue(model: ModelRef | undefined): string {
  if (!model) return '';
  return JSON.stringify(model);
}

/** Label for a member's pinned model, or undefined when it inherits. */
export function memberModelLabel(
  member: OrchestrationSchemeMember,
  options: readonly SchemeModelOption[],
): string | undefined {
  if (!member.model) return undefined;
  const value = modelSelectValue(member.model);
  const match = options.find((option) => option.value === value);
  return match?.label ?? member.model.modelId;
}

/** Append a member, keeping role ids unique and the default role populated. */
export function appendMember(
  draft: OrchestrationSchemeSettings,
  template?: OrchestrationSchemeMember,
): OrchestrationSchemeSettings {
  const base =
    template ??
    ({
      role: `role${(draft.members?.length ?? 0) + 1}`,
      description: '',
      isolation: 'readonly' as const,
      fallback: 'main' as const,
    } satisfies OrchestrationSchemeMember);
  let role = base.role;
  const existing = new Set((draft.members ?? []).map((member) => member.role));
  if (existing.has(role)) {
    let suffix = 2;
    while (existing.has(`${base.role}${suffix}`)) suffix += 1;
    role = `${base.role}${suffix}`;
  }
  const member = cloneMember({ ...base, role });
  return {
    ...draft,
    members: [...(draft.members ?? []), member],
    defaultRole: draft.defaultRole ?? member.role,
  };
}

export type OrchestrationMemberPatch = {
  role?: string;
  description?: string;
  model?: ModelRef | null;
  thinkingLevel?: ThinkingLevel | null;
  isolation?: SubagentIsolationMode | null;
  fallback?: OrchestrationMemberFallback;
};

/**
 * Apply one field edit to a roster member. `null` clears an optional field;
 * `undefined` leaves it alone — the two cannot collapse under
 * `exactOptionalPropertyTypes`.
 */
export function patchMemberAt(
  draft: OrchestrationSchemeSettings,
  index: number,
  patch: OrchestrationMemberPatch,
): OrchestrationSchemeSettings {
  const members = draft.members;
  if (!members) return draft;
  const previousRole = members[index]?.role;
  const rebuilt = members.map((member, memberIndex) => {
    if (memberIndex !== index) return member;
    const merged: OrchestrationSchemeMember = {
      role: patch.role ?? member.role,
      description: patch.description ?? member.description,
    };
    // Keep profileId if present (internal seed); the UI no longer edits it.
    if (member.profileId) merged.profileId = member.profileId;
    const nextModel =
      patch.model === null ? undefined : patch.model !== undefined ? patch.model : member.model;
    if (nextModel) merged.model = nextModel;
    const nextThinking =
      patch.thinkingLevel === null ? undefined : (patch.thinkingLevel ?? member.thinkingLevel);
    if (nextThinking) merged.thinkingLevel = nextThinking;
    const nextIsolation =
      patch.isolation === null ? undefined : (patch.isolation ?? member.isolation);
    if (nextIsolation) merged.isolation = nextIsolation;
    merged.fallback = patch.fallback ?? member.fallback ?? 'main';
    if (member.reportContract?.trim()) {
      merged.reportContract = member.reportContract.trim();
    }
    return merged;
  });
  const next: OrchestrationSchemeSettings = { ...draft, members: rebuilt };
  const nextRole = rebuilt[index]?.role;
  // A rename must drag the default pointer along, or saving trips validation.
  if (previousRole && nextRole && draft.defaultRole === previousRole) {
    next.defaultRole = nextRole;
  }
  return next;
}

export function removeMemberAt(
  draft: OrchestrationSchemeSettings,
  index: number,
): OrchestrationSchemeSettings {
  if (!draft.members) return draft;
  const members = draft.members.filter((_, memberIndex) => memberIndex !== index);
  const defaultRole =
    draft.defaultRole && members.some((member) => member.role === draft.defaultRole)
      ? draft.defaultRole
      : members[0]?.role;
  const next: OrchestrationSchemeSettings = { ...draft, members };
  if (defaultRole) next.defaultRole = defaultRole;
  else delete next.defaultRole;
  return next;
}

export function setSchemeDefaultRole(
  draft: OrchestrationSchemeSettings,
  role: string,
): OrchestrationSchemeSettings {
  const next: OrchestrationSchemeSettings = { ...draft };
  if (role) next.defaultRole = role;
  else delete next.defaultRole;
  return next;
}
