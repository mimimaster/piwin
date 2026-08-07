/**
 * Settings editor for Orchestration Schemes (ORCH-V2).
 *
 * Edits main discipline + members roster. Built-in Ultra Code can be overlaid
 * (same id in settings) or reset; user schemes support full CRUD.
 */
import { useMemo, useState, type ReactElement } from 'react';
import {
  BUILTIN_ULTRA_CODE_SCHEME,
  DEFAULT_ORCHESTRATION_ROLE_TEMPLATES,
  ULTRA_CODE_SCHEME_ID,
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
import { Button, Notice, Select, TextInput } from '@piwin/ui-kit';

const THINKING_LEVELS: ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra',
];

const ISOLATION_MODES: SubagentIsolationMode[] = ['readonly', 'worktree'];

const FALLBACK_OPTIONS: OrchestrationMemberFallback[] = ['main', 'none'];

export type SchemeModelOption = {
  value: string;
  label: string;
  ref: ModelRef;
};

export type OrchestrationSchemeEditorCopy = {
  schemesTitle: string;
  schemesDescription: string;
  schemeClone: string;
  schemeCloneSaved: string;
  schemeClonedSuffix: string;
  schemeSourceBuiltin: string;
  schemeSourceSettings: string;
  schemeDefaultProfile: string;
  schemeGeneric: string;
  schemeExpose: string;
  schemeEdit: string;
  schemeNew: string;
  schemeDelete: string;
  schemeResetBuiltin: string;
  schemeSave: string;
  schemeSaved: string;
  schemeName: string;
  schemeId: string;
  schemeDesc: string;
  schemeDiscipline: string;
  schemeDisciplineHint: string;
  schemeMembers: string;
  schemeAddMember: string;
  schemeAddFromTemplate: string;
  schemeRole: string;
  schemeRoleDesc: string;
  schemeMemberProfile: string;
  schemeMemberModel: string;
  schemeModelInherit: string;
  schemeThinking: string;
  schemeThinkingInherit: string;
  schemeIsolation: string;
  schemeIsolationInherit: string;
  schemeFallback: string;
  schemeDefaultRole: string;
  schemeMaxConcurrency: string;
  schemeMaxTasks: string;
  schemeMaxThinking: string;
  schemeMaxThinkingInherit: string;
  schemeRemoveMember: string;
  schemeCancel: string;
  schemeInvalidId: string;
  schemeInvalidRole: string;
  schemeNeedMember: string;
  schemeCheapModelHint: string;
  remove: string;
};

function cloneMember(member: OrchestrationSchemeMember): OrchestrationSchemeMember {
  return {
    role: member.role,
    description: member.description,
    ...(member.profileId ? { profileId: member.profileId } : {}),
    ...(member.model ? { model: member.model } : {}),
    ...(member.thinkingLevel ? { thinkingLevel: member.thinkingLevel } : {}),
    ...(member.isolation ? { isolation: member.isolation } : {}),
    ...(member.fallback ? { fallback: member.fallback } : { fallback: 'main' }),
  };
}

/** Normalize a scheme (builtin or settings) into an editable settings draft. */
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
  if (scheme.allowedProfileIds) draft.allowedProfileIds = [...scheme.allowedProfileIds];
  if (scheme.maxConcurrency !== undefined) draft.maxConcurrency = scheme.maxConcurrency;
  if (scheme.maxTasksPerRun !== undefined) draft.maxTasksPerRun = scheme.maxTasksPerRun;
  if (scheme.maxSubagentThinkingLevel) {
    draft.maxSubagentThinkingLevel = scheme.maxSubagentThinkingLevel;
  }
  return draft;
}

export function createEmptyUserScheme(existingIds: ReadonlySet<string>): OrchestrationSchemeSettings {
  let suffix = 1;
  let id = `my-scheme-${suffix}`;
  while (existingIds.has(id) || !isValidOrchestrationSchemeId(id)) {
    suffix += 1;
    id = `my-scheme-${suffix}`;
  }
  const searcher = cloneMember(DEFAULT_ORCHESTRATION_ROLE_TEMPLATES[0]!);
  return {
    id,
    name: 'My scheme',
    description: 'Custom orchestration roster',
    systemPreamble:
      'This orchestration scheme is active. Delegate polluting exploration to roster roles via piwin_subagent_run with role set. Wait for results before continuing. Do not nest subagents.',
    exposeSpawnMetadata: false,
    waitPolicy: 'await-all',
    defaultRole: searcher.role,
    defaultProfileId: searcher.profileId ?? 'explorer',
    members: [searcher],
    maxConcurrency: 4,
    maxTasksPerRun: 8,
    maxSubagentThinkingLevel: 'low',
  };
}

export function validateSchemeDraft(draft: OrchestrationSchemeSettings): string | undefined {
  if (!isValidOrchestrationSchemeId(draft.id)) {
    return 'invalid-id';
  }
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
  if (draft.defaultRole && !seen.has(draft.defaultRole)) {
    return 'bad-default-role';
  }
  return undefined;
}

function modelSelectValue(model: ModelRef | undefined): string {
  if (!model) return '';
  return JSON.stringify(model);
}

export type OrchestrationSchemeEditorProps = {
  schemes: readonly OrchestrationScheme[];
  schemeDrafts: OrchestrationSchemeSettings[];
  modelOptions: readonly SchemeModelOption[];
  saving: boolean;
  copy: OrchestrationSchemeEditorCopy;
  notice: string | null;
  onNotice: (message: string | null) => void;
  onPersistSchemes: (schemes: OrchestrationSchemeSettings[]) => Promise<boolean>;
  onCloneScheme: (schemeId: string) => Promise<void>;
};

export function OrchestrationSchemeEditor(props: OrchestrationSchemeEditorProps): ReactElement {
  const {
    schemes,
    schemeDrafts,
    modelOptions,
    saving,
    copy,
    notice,
    onNotice,
    onPersistSchemes,
    onCloneScheme,
  } = props;

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<OrchestrationSchemeSettings | null>(null);
  const [editError, setEditError] = useState<string | null>(null);

  const overlayIds = useMemo(
    () => new Set(schemeDrafts.map((scheme) => scheme.id)),
    [schemeDrafts],
  );

  function startEdit(scheme: OrchestrationScheme): void {
    setExpandedId(scheme.id);
    setEditing(schemeToEditableDraft(scheme));
    setEditError(null);
    onNotice(null);
  }

  function startCreate(): void {
    const existing = new Set(schemes.map((scheme) => scheme.id));
    const draft = createEmptyUserScheme(existing);
    setExpandedId(draft.id);
    setEditing(draft);
    setEditError(null);
    onNotice(null);
  }

  function cancelEdit(): void {
    setEditing(null);
    setEditError(null);
  }

  function patchEditing(patch: Partial<OrchestrationSchemeSettings>): void {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  type MemberPatch = {
    role?: string;
    description?: string;
    profileId?: string | null;
    model?: ModelRef | null;
    thinkingLevel?: ThinkingLevel | null;
    isolation?: SubagentIsolationMode | null;
    fallback?: OrchestrationMemberFallback;
  };

  function patchMember(index: number, patch: MemberPatch): void {
    setEditing((prev) => {
      if (!prev?.members) return prev;
      const rebuilt = prev.members.map((member, memberIndex) => {
        if (memberIndex !== index) return member;
        const merged: OrchestrationSchemeMember = {
          role: (patch.role ?? member.role).trim(),
          description: (patch.description ?? member.description).trim(),
        };
        const nextProfileId =
          patch.profileId === null
            ? undefined
            : patch.profileId !== undefined
              ? patch.profileId
              : member.profileId;
        if (nextProfileId) merged.profileId = nextProfileId;
        const nextModel =
          patch.model === null
            ? undefined
            : patch.model !== undefined
              ? patch.model
              : member.model;
        if (nextModel) merged.model = nextModel;
        const nextThinking =
          patch.thinkingLevel === null
            ? undefined
            : patch.thinkingLevel !== undefined
              ? patch.thinkingLevel
              : member.thinkingLevel;
        if (nextThinking) merged.thinkingLevel = nextThinking;
        const nextIsolation =
          patch.isolation === null
            ? undefined
            : patch.isolation !== undefined
              ? patch.isolation
              : member.isolation;
        if (nextIsolation) merged.isolation = nextIsolation;
        const nextFallback = patch.fallback ?? member.fallback ?? 'main';
        merged.fallback = nextFallback;
        return merged;
      });
      return { ...prev, members: rebuilt };
    });
  }

  function addMember(template?: OrchestrationSchemeMember): void {
    setEditing((prev) => {
      if (!prev) return prev;
      const base =
        template ??
        ({
          role: `role-${(prev.members?.length ?? 0) + 1}`,
          description: 'Describe when the main agent should use this role.',
          fallback: 'main' as const,
        } satisfies OrchestrationSchemeMember);
      let role = base.role;
      const existing = new Set((prev.members ?? []).map((member) => member.role));
      if (existing.has(role)) {
        let suffix = 2;
        while (existing.has(`${base.role}-${suffix}`)) suffix += 1;
        role = `${base.role}-${suffix}`;
      }
      const member = cloneMember({ ...base, role });
      const members = [...(prev.members ?? []), member];
      return {
        ...prev,
        members,
        defaultRole: prev.defaultRole ?? member.role,
      };
    });
  }

  function removeMember(index: number): void {
    setEditing((prev) => {
      if (!prev?.members) return prev;
      const members = prev.members.filter((_, memberIndex) => memberIndex !== index);
      const defaultRole =
        prev.defaultRole && members.some((member) => member.role === prev.defaultRole)
          ? prev.defaultRole
          : members[0]?.role;
      const next: OrchestrationSchemeSettings = { ...prev, members };
      if (defaultRole) next.defaultRole = defaultRole;
      else delete next.defaultRole;
      return next;
    });
  }

  async function saveEditing(): Promise<void> {
    if (!editing) return;
    const code = validateSchemeDraft(editing);
    if (code === 'invalid-id') {
      setEditError(copy.schemeInvalidId);
      return;
    }
    if (code === 'invalid-role' || code === 'duplicate-role') {
      setEditError(copy.schemeInvalidRole);
      return;
    }
    if (code === 'need-member' || code === 'bad-default-role') {
      setEditError(copy.schemeNeedMember);
      return;
    }
    if (code) {
      setEditError(copy.schemeNeedMember);
      return;
    }

    const cleaned: OrchestrationSchemeSettings = {
      id: editing.id.trim(),
      name: editing.name.trim(),
      description: editing.description.trim(),
      systemPreamble: editing.systemPreamble.trim(),
      exposeSpawnMetadata: editing.exposeSpawnMetadata === true,
      waitPolicy: 'await-all',
      members: (editing.members ?? []).map(cloneMember),
    };
    if (editing.defaultRole?.trim()) cleaned.defaultRole = editing.defaultRole.trim();
    if (editing.defaultProfileId?.trim()) {
      cleaned.defaultProfileId = editing.defaultProfileId.trim();
    }
    if (editing.maxConcurrency !== undefined) cleaned.maxConcurrency = editing.maxConcurrency;
    if (editing.maxTasksPerRun !== undefined) cleaned.maxTasksPerRun = editing.maxTasksPerRun;
    if (editing.maxSubagentThinkingLevel) {
      cleaned.maxSubagentThinkingLevel = editing.maxSubagentThinkingLevel;
    }

    const withoutSame = schemeDrafts.filter((scheme) => scheme.id !== cleaned.id);
    const next = [...withoutSame, cleaned];
    const ok = await onPersistSchemes(next);
    if (!ok) return;
    setEditing(null);
    setEditError(null);
    onNotice(copy.schemeSaved);
  }

  async function resetBuiltin(schemeId: string): Promise<void> {
    if (schemeId !== ULTRA_CODE_SCHEME_ID) return;
    const next = schemeDrafts.filter((scheme) => scheme.id !== schemeId);
    const ok = await onPersistSchemes(next);
    if (!ok) return;
    if (editing?.id === schemeId) {
      setEditing(schemeToEditableDraft(BUILTIN_ULTRA_CODE_SCHEME));
    }
    onNotice(copy.schemeSaved);
  }

  async function deleteUserScheme(schemeId: string): Promise<void> {
    if (schemeId === ULTRA_CODE_SCHEME_ID) return;
    const next = schemeDrafts.filter((scheme) => scheme.id !== schemeId);
    const ok = await onPersistSchemes(next);
    if (!ok) return;
    if (editing?.id === schemeId) cancelEdit();
    onNotice(copy.schemeSaved);
  }

  return (
    <div className="settings-section" data-testid="orchestration-schemes-section">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          marginBottom: 8,
        }}
      >
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>{copy.schemesTitle}</h3>
          <p className="muted" style={{ marginTop: 8, marginBottom: 0, fontSize: 13, lineHeight: 1.45 }}>
            {copy.schemesDescription}
          </p>
        </div>
        <Button
          variant="secondary"
          disabled={saving}
          data-testid="orchestration-scheme-new"
          onClick={startCreate}
        >
          {copy.schemeNew}
        </Button>
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {editError ? <Notice tone="error">{editError}</Notice> : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {schemes.map((scheme) => {
          const isExpanded = expandedId === scheme.id;
          const isEditingThis = editing?.id === scheme.id;
          const hasOverlay = overlayIds.has(scheme.id);
          const isBuiltinBase = scheme.id === ULTRA_CODE_SCHEME_ID;
          return (
            <div
              key={scheme.id}
              className="settings-section-card"
              style={{ padding: 12 }}
              data-testid={`orchestration-scheme-row-${scheme.id}`}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <strong style={{ fontSize: 14 }}>{scheme.name}</strong>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    <code>{scheme.id}</code>
                    {' · '}
                    {scheme.source === 'builtin' && !hasOverlay
                      ? copy.schemeSourceBuiltin
                      : hasOverlay && isBuiltinBase
                        ? `${copy.schemeSourceBuiltin}+`
                        : copy.schemeSourceSettings}
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                  <Button
                    variant="secondary"
                    disabled={saving}
                    data-testid={`orchestration-scheme-edit-${scheme.id}`}
                    onClick={() => {
                      if (isEditingThis) {
                        cancelEdit();
                        setExpandedId(null);
                      } else {
                        startEdit(scheme);
                      }
                    }}
                  >
                    {isEditingThis ? copy.schemeCancel : copy.schemeEdit}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={saving}
                    data-testid={`orchestration-scheme-clone-${scheme.id}`}
                    onClick={() => void onCloneScheme(scheme.id)}
                  >
                    {copy.schemeClone}
                  </Button>
                  {isBuiltinBase && hasOverlay ? (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      data-testid={`orchestration-scheme-reset-${scheme.id}`}
                      onClick={() => void resetBuiltin(scheme.id)}
                    >
                      {copy.schemeResetBuiltin}
                    </Button>
                  ) : null}
                  {!isBuiltinBase ? (
                    <Button
                      variant="ghost"
                      disabled={saving}
                      data-testid={`orchestration-scheme-delete-${scheme.id}`}
                      onClick={() => void deleteUserScheme(scheme.id)}
                    >
                      {copy.schemeDelete}
                    </Button>
                  ) : null}
                </div>
              </div>

              <p style={{ fontSize: 13, marginTop: 8, marginBottom: 0, lineHeight: 1.4 }}>
                {scheme.description}
              </p>
              <div className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                {scheme.defaultRole ? (
                  <>
                    {copy.schemeDefaultRole}: <code>{scheme.defaultRole}</code>
                    {' · '}
                  </>
                ) : null}
                {scheme.exposeSpawnMetadata ? copy.schemeExpose : copy.schemeGeneric}
                {scheme.members && scheme.members.length > 0
                  ? ` · roles: ${scheme.members.map((member) => member.role).join(', ')}`
                  : ''}
              </div>

              {isEditingThis && editing ? (
                <div
                  style={{ marginTop: 14, borderTop: '1px solid rgba(127,127,127,0.25)', paddingTop: 12 }}
                  data-testid={`orchestration-scheme-editor-${scheme.id}`}
                >
                  {editing.id === ULTRA_CODE_SCHEME_ID ? (
                    <div style={{ marginBottom: 10 }}>
                      <Notice tone="info">{copy.schemeCheapModelHint}</Notice>
                    </div>
                  ) : null}

                  <div style={{ display: 'grid', gap: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600 }}>
                      {copy.schemeName}
                      <TextInput
                        value={editing.name}
                        disabled={saving}
                        onChange={(event) => patchEditing({ name: event.target.value })}
                      />
                    </label>
                    {editing.id !== ULTRA_CODE_SCHEME_ID ? (
                      <label style={{ fontSize: 12, fontWeight: 600 }}>
                        {copy.schemeId}
                        <TextInput
                          value={editing.id}
                          disabled={saving || overlayIds.has(editing.id)}
                          onChange={(event) =>
                            patchEditing({
                              id: event.target.value.trim().toLowerCase(),
                            })
                          }
                        />
                      </label>
                    ) : null}
                    <label style={{ fontSize: 12, fontWeight: 600 }}>
                      {copy.schemeDesc}
                      <TextInput
                        value={editing.description}
                        disabled={saving}
                        onChange={(event) => patchEditing({ description: event.target.value })}
                      />
                    </label>

                    <details open>
                      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
                        {copy.schemeDiscipline}
                      </summary>
                      <p className="muted" style={{ fontSize: 11, margin: '6px 0' }}>
                        {copy.schemeDisciplineHint}
                      </p>
                      <textarea
                        className="ui-text-input"
                        style={{ width: '100%', minHeight: 120, fontFamily: 'inherit', fontSize: 13 }}
                        value={editing.systemPreamble}
                        disabled={saving}
                        data-testid={`orchestration-scheme-preamble-${editing.id}`}
                        onChange={(event) => patchEditing({ systemPreamble: event.target.value })}
                      />
                    </details>

                    <div>
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 8,
                          marginBottom: 8,
                        }}
                      >
                        <strong style={{ fontSize: 12 }}>{copy.schemeMembers}</strong>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <Button
                            size="compact"
                            variant="ghost"
                            disabled={saving}
                            onClick={() => addMember()}
                          >
                            {copy.schemeAddMember}
                          </Button>
                          {DEFAULT_ORCHESTRATION_ROLE_TEMPLATES.map((template) => (
                            <Button
                              key={template.role}
                              size="compact"
                              variant="ghost"
                              disabled={saving}
                              onClick={() => addMember(template)}
                            >
                              +{template.role}
                            </Button>
                          ))}
                        </div>
                      </div>

                      {(editing.members ?? []).map((member, index) => (
                        <div
                          key={`${member.role}-${index}`}
                          className="settings-section-card"
                          style={{ padding: 10, marginBottom: 8 }}
                          data-testid={`orchestration-member-row-${index}`}
                        >
                          <div
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              gap: 8,
                              marginBottom: 8,
                            }}
                          >
                            <strong style={{ fontSize: 12 }}>
                              {copy.schemeRole} #{index + 1}
                            </strong>
                            <Button
                              size="compact"
                              variant="ghost"
                              disabled={saving || (editing.members?.length ?? 0) <= 1}
                              onClick={() => removeMember(index)}
                            >
                              {copy.schemeRemoveMember}
                            </Button>
                          </div>
                          <div style={{ display: 'grid', gap: 8 }}>
                            <label style={{ fontSize: 12 }}>
                              {copy.schemeRole}
                              <TextInput
                                value={member.role}
                                disabled={saving}
                                onChange={(event) =>
                                  patchMember(index, {
                                    role: event.target.value.trim().toLowerCase(),
                                  })
                                }
                              />
                            </label>
                            <label style={{ fontSize: 12 }}>
                              {copy.schemeRoleDesc}
                              <TextInput
                                value={member.description}
                                disabled={saving}
                                onChange={(event) =>
                                  patchMember(index, { description: event.target.value })
                                }
                              />
                            </label>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <label style={{ fontSize: 12, flex: 1, minWidth: 140 }}>
                                {copy.schemeMemberProfile}
                                <TextInput
                                  value={member.profileId ?? ''}
                                  disabled={saving}
                                  placeholder="explorer"
                                  onChange={(event) => {
                                    const value = event.target.value.trim();
                                    patchMember(index, {
                                      profileId: value ? value : null,
                                    });
                                  }}
                                />
                              </label>
                              <label style={{ fontSize: 12, flex: 1, minWidth: 160 }}>
                                {copy.schemeMemberModel}
                                <Select
                                  value={modelSelectValue(member.model)}
                                  disabled={saving}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    if (!value) {
                                      patchMember(index, { model: null });
                                      return;
                                    }
                                    try {
                                      const parsed = JSON.parse(value) as ModelRef;
                                      patchMember(index, { model: parsed });
                                    } catch {
                                      patchMember(index, { model: null });
                                    }
                                  }}
                                >
                                  <option value="">{copy.schemeModelInherit}</option>
                                  {modelOptions.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                            </div>
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                              <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                                {copy.schemeThinking}
                                <Select
                                  value={member.thinkingLevel ?? ''}
                                  disabled={saving}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    patchMember(index, {
                                      thinkingLevel: value
                                        ? (value as ThinkingLevel)
                                        : null,
                                    });
                                  }}
                                >
                                  <option value="">{copy.schemeThinkingInherit}</option>
                                  {THINKING_LEVELS.map((level) => (
                                    <option key={level} value={level}>
                                      {level}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                              <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                                {copy.schemeIsolation}
                                <Select
                                  value={member.isolation ?? ''}
                                  disabled={saving}
                                  onChange={(event) => {
                                    const value = event.target.value;
                                    patchMember(index, {
                                      isolation:
                                        value === 'readonly' || value === 'worktree'
                                          ? value
                                          : null,
                                    });
                                  }}
                                >
                                  <option value="">{copy.schemeIsolationInherit}</option>
                                  {ISOLATION_MODES.map((mode) => (
                                    <option key={mode} value={mode}>
                                      {mode}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                              <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                                {copy.schemeFallback}
                                <Select
                                  value={member.fallback ?? 'main'}
                                  disabled={saving}
                                  onChange={(event) =>
                                    patchMember(index, {
                                      fallback: event.target.value as OrchestrationMemberFallback,
                                    })
                                  }
                                >
                                  {FALLBACK_OPTIONS.map((option) => (
                                    <option key={option} value={option}>
                                      {option}
                                    </option>
                                  ))}
                                </Select>
                              </label>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 12, flex: 1, minWidth: 140 }}>
                        {copy.schemeDefaultRole}
                        <Select
                          value={editing.defaultRole ?? ''}
                          disabled={saving}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEditing((prev) => {
                              if (!prev) return prev;
                              const next: OrchestrationSchemeSettings = { ...prev };
                              if (value) next.defaultRole = value;
                              else delete next.defaultRole;
                              return next;
                            });
                          }}
                        >
                          {(editing.members ?? []).map((member) => (
                            <option key={member.role} value={member.role}>
                              {member.role}
                            </option>
                          ))}
                        </Select>
                      </label>
                      <label style={{ fontSize: 12, flex: 1, minWidth: 140 }}>
                        {copy.schemeExpose}
                        <Select
                          value={editing.exposeSpawnMetadata ? 'expose' : 'generic'}
                          disabled={saving}
                          onChange={(event) =>
                            patchEditing({
                              exposeSpawnMetadata: event.target.value === 'expose',
                            })
                          }
                        >
                          <option value="generic">{copy.schemeGeneric}</option>
                          <option value="expose">{copy.schemeExpose}</option>
                        </Select>
                      </label>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                        {copy.schemeMaxConcurrency}
                        <TextInput
                          type="number"
                          min={1}
                          value={String(editing.maxConcurrency ?? 4)}
                          disabled={saving}
                          onChange={(event) =>
                            patchEditing({
                              maxConcurrency: Math.max(1, Number(event.target.value) || 1),
                            })
                          }
                        />
                      </label>
                      <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                        {copy.schemeMaxTasks}
                        <TextInput
                          type="number"
                          min={1}
                          value={String(editing.maxTasksPerRun ?? 8)}
                          disabled={saving}
                          onChange={(event) =>
                            patchEditing({
                              maxTasksPerRun: Math.max(1, Number(event.target.value) || 1),
                            })
                          }
                        />
                      </label>
                      <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                        {copy.schemeMaxThinking}
                        <Select
                          value={editing.maxSubagentThinkingLevel ?? ''}
                          disabled={saving}
                          onChange={(event) => {
                            const value = event.target.value;
                            setEditing((prev) => {
                              if (!prev) return prev;
                              const next: OrchestrationSchemeSettings = { ...prev };
                              if (value) next.maxSubagentThinkingLevel = value as ThinkingLevel;
                              else delete next.maxSubagentThinkingLevel;
                              return next;
                            });
                          }}
                        >
                          <option value="">{copy.schemeMaxThinkingInherit}</option>
                          {THINKING_LEVELS.map((level) => (
                            <option key={level} value={level}>
                              {level}
                            </option>
                          ))}
                        </Select>
                      </label>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                      <Button variant="ghost" disabled={saving} onClick={cancelEdit}>
                        {copy.schemeCancel}
                      </Button>
                      <Button
                        variant="primary"
                        disabled={saving}
                        data-testid={`orchestration-scheme-save-${editing.id}`}
                        onClick={() => void saveEditing()}
                      >
                        {saving ? '…' : copy.schemeSave}
                      </Button>
                    </div>
                  </div>
                </div>
              ) : isExpanded ? (
                <pre
                  className="muted"
                  style={{
                    marginTop: 10,
                    fontSize: 11,
                    whiteSpace: 'pre-wrap',
                    maxHeight: 160,
                    overflow: 'auto',
                  }}
                >
                  {scheme.systemPreamble}
                </pre>
              ) : (
                <button
                  type="button"
                  className="muted"
                  style={{
                    marginTop: 8,
                    border: 0,
                    background: 'transparent',
                    padding: 0,
                    cursor: 'pointer',
                    fontSize: 12,
                    textDecoration: 'underline',
                  }}
                  onClick={() => setExpandedId(scheme.id)}
                >
                  {copy.schemeDiscipline}…
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
