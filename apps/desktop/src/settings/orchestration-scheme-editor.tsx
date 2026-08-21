/**
 * Orchestration scheme editor — roster of roles for the main agent.
 *
 * User configures: scheme name, main discipline, members (role + duty +
 * optional model/isolation). Runtime scheduling is the main agent's job.
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
];

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
  schemeSourceOverridden: string;
  schemeSourceSettings: string;
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
  schemeMemberModel: string;
  schemeModelInherit: string;
  schemeThinking: string;
  schemeThinkingInherit: string;
  schemeIsolation: string;
  schemeIsolationReadonly: string;
  schemeIsolationWorktree: string;
  schemeFallback: string;
  schemeFallbackMain: string;
  schemeFallbackNone: string;
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
  schemeAdvanced: string;
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

export function createEmptyUserScheme(existingIds: ReadonlySet<string>): OrchestrationSchemeSettings {
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

function modelSelectValue(model: ModelRef | undefined): string {
  if (!model) return '';
  return JSON.stringify(model);
}

function sourceLabel(
  scheme: OrchestrationScheme,
  hasOverlay: boolean,
  copy: OrchestrationSchemeEditorCopy,
): string {
  const isBuiltinBase = scheme.id === ULTRA_CODE_SCHEME_ID;
  if (isBuiltinBase && hasOverlay) return copy.schemeSourceOverridden;
  if (scheme.source === 'builtin' && !hasOverlay) return copy.schemeSourceBuiltin;
  return copy.schemeSourceSettings;
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

  const [editing, setEditing] = useState<OrchestrationSchemeSettings | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const overlayIds = useMemo(
    () => new Set(schemeDrafts.map((scheme) => scheme.id)),
    [schemeDrafts],
  );

  function startEdit(scheme: OrchestrationScheme): void {
    setEditing(schemeToEditableDraft(scheme));
    setEditError(null);
    setAdvancedOpen(false);
    onNotice(null);
  }

  function startCreate(): void {
    const existing = new Set(schemes.map((scheme) => scheme.id));
    setEditing(createEmptyUserScheme(existing));
    setEditError(null);
    setAdvancedOpen(false);
    onNotice(null);
  }

  function cancelEdit(): void {
    setEditing(null);
    setEditError(null);
    setAdvancedOpen(false);
  }

  function patchEditing(patch: Partial<OrchestrationSchemeSettings>): void {
    setEditing((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  type MemberPatch = {
    role?: string;
    description?: string;
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
        // Keep profileId if present (internal seed); UI no longer edits it.
        if (member.profileId) merged.profileId = member.profileId;
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
        merged.fallback = patch.fallback ?? member.fallback ?? 'main';
        if (member.reportContract?.trim()) {
          merged.reportContract = member.reportContract.trim();
        }
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
          role: `role${(prev.members?.length ?? 0) + 1}`,
          description: 'Describe when the main agent should use this role.',
          isolation: 'readonly' as const,
          fallback: 'main' as const,
        } satisfies OrchestrationSchemeMember);
      let role = base.role;
      const existing = new Set((prev.members ?? []).map((member) => member.role));
      if (existing.has(role)) {
        let suffix = 2;
        while (existing.has(`${base.role}${suffix}`)) suffix += 1;
        role = `${base.role}${suffix}`;
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
    const ok = await onPersistSchemes([...withoutSame, cleaned]);
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

  function renderEditorForm(draft: OrchestrationSchemeSettings): ReactElement {
    const isBuiltinId = draft.id === ULTRA_CODE_SCHEME_ID;
    return (
      <div
        style={{ marginTop: 14, borderTop: '1px solid rgba(127,127,127,0.25)', paddingTop: 12 }}
        data-testid={`orchestration-scheme-editor-${draft.id}`}
      >
        {isBuiltinId ? (
          <div style={{ marginBottom: 10 }}>
            <Notice tone="info">{copy.schemeCheapModelHint}</Notice>
          </div>
        ) : null}

        <div style={{ display: 'grid', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, fontWeight: 600, flex: 2, minWidth: 160 }}>
              {copy.schemeName}
              <TextInput
                value={draft.name}
                disabled={saving}
                onChange={(event) => patchEditing({ name: event.target.value })}
              />
            </label>
            {!isBuiltinId ? (
              <label style={{ fontSize: 12, fontWeight: 600, flex: 1, minWidth: 120 }}>
                {copy.schemeId}
                <TextInput
                  value={draft.id}
                  disabled={saving || overlayIds.has(draft.id)}
                  onChange={(event) =>
                    patchEditing({ id: event.target.value.trim().toLowerCase() })
                  }
                />
              </label>
            ) : null}
          </div>

          <label style={{ fontSize: 12, fontWeight: 600 }}>
            {copy.schemeDesc}
            <TextInput
              value={draft.description}
              disabled={saving}
              onChange={(event) => patchEditing({ description: event.target.value })}
            />
          </label>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              {copy.schemeDiscipline}
            </div>
            <p className="muted" style={{ fontSize: 11, margin: '0 0 6px' }}>
              {copy.schemeDisciplineHint}
            </p>
            <textarea
              className="ui-text-input"
              style={{ width: '100%', minHeight: 100, fontFamily: 'inherit', fontSize: 13 }}
              value={draft.systemPreamble}
              disabled={saving}
              data-testid={`orchestration-scheme-preamble-${draft.id}`}
              onChange={(event) => patchEditing({ systemPreamble: event.target.value })}
            />
          </div>

          <div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 8,
                marginBottom: 8,
                flexWrap: 'wrap',
              }}
            >
              <strong style={{ fontSize: 13 }}>{copy.schemeMembers}</strong>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <Button
                  size="compact"
                  variant="secondary"
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
                    data-testid={`orchestration-add-template-${template.role}`}
                  >
                    +{template.role}
                  </Button>
                ))}
              </div>
            </div>

            {(draft.members ?? []).map((member, index) => (
              <div
                key={`${member.role}-${index}`}
                className="settings-section-card"
                style={{ padding: 12, marginBottom: 8 }}
                data-testid={`orchestration-member-row-${index}`}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 8,
                    alignItems: 'center',
                  }}
                >
                  <strong style={{ fontSize: 13 }}>
                    {member.role || `${copy.schemeRole} #${index + 1}`}
                  </strong>
                  <Button
                    size="compact"
                    variant="ghost"
                    disabled={saving || (draft.members?.length ?? 0) <= 1}
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
                          const selected = modelOptions.find((option) => option.value === value);
                          if (selected) patchMember(index, { model: selected.ref });
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
                    <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                      {copy.schemeThinking}
                      <Select
                        value={member.thinkingLevel ?? ''}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.target.value;
                          patchMember(index, {
                            thinkingLevel: value ? (value as ThinkingLevel) : null,
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
                    <label style={{ fontSize: 12, flex: 1, minWidth: 140 }}>
                      {copy.schemeIsolation}
                      <Select
                        value={member.isolation ?? 'readonly'}
                        disabled={saving}
                        onChange={(event) => {
                          const value = event.target.value;
                          patchMember(index, {
                            isolation:
                              value === 'worktree' || value === 'readonly' ? value : null,
                          });
                        }}
                      >
                        <option value="readonly">{copy.schemeIsolationReadonly}</option>
                        <option value="worktree">{copy.schemeIsolationWorktree}</option>
                      </Select>
                    </label>
                  </div>
                  <label style={{ fontSize: 12, maxWidth: 280 }}>
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
                      <option value="main">{copy.schemeFallbackMain}</option>
                      <option value="none">{copy.schemeFallbackNone}</option>
                    </Select>
                  </label>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, flex: 1, minWidth: 140 }}>
              {copy.schemeDefaultRole}
              <Select
                value={draft.defaultRole ?? ''}
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
                {(draft.members ?? []).map((member) => (
                  <option key={member.role} value={member.role}>
                    {member.role}
                  </option>
                ))}
              </Select>
            </label>
            <label style={{ fontSize: 12, flex: 1, minWidth: 180 }}>
              {copy.schemeExpose}
              <Select
                value={draft.exposeSpawnMetadata ? 'expose' : 'generic'}
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

          <details
            open={advancedOpen}
            onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
          >
            <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
              {copy.schemeAdvanced}
            </summary>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
              <label style={{ fontSize: 12, flex: 1, minWidth: 120 }}>
                {copy.schemeMaxConcurrency}
                <TextInput
                  type="number"
                  min={1}
                  value={String(draft.maxConcurrency ?? 4)}
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
                  value={String(draft.maxTasksPerRun ?? 8)}
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
                  value={draft.maxSubagentThinkingLevel ?? ''}
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
          </details>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button variant="ghost" disabled={saving} onClick={cancelEdit}>
              {copy.schemeCancel}
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              data-testid={`orchestration-scheme-save-${draft.id}`}
              onClick={() => void saveEditing()}
            >
              {saving ? '…' : copy.schemeSave}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const creatingNew =
    editing !== null && !schemes.some((scheme) => scheme.id === editing.id);

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
          disabled={saving || editing !== null}
          data-testid="orchestration-scheme-new"
          onClick={startCreate}
        >
          {copy.schemeNew}
        </Button>
      </div>

      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {editError ? <Notice tone="error">{editError}</Notice> : null}

      {creatingNew && editing ? (
        <div
          className="settings-section-card"
          style={{ padding: 14, marginBottom: 12 }}
          data-testid={`orchestration-scheme-row-${editing.id}`}
        >
          <strong style={{ fontSize: 14 }}>{copy.schemeNew}</strong>
          {renderEditorForm(editing)}
        </div>
      ) : null}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
        {schemes.map((scheme) => {
          const isEditingThis = editing?.id === scheme.id;
          const hasOverlay = overlayIds.has(scheme.id);
          const isBuiltinBase = scheme.id === ULTRA_CODE_SCHEME_ID;
          const members = migrateSchemeMembers(scheme);

          return (
            <div
              key={scheme.id}
              className="settings-section-card"
              style={{ padding: 14 }}
              data-testid={`orchestration-scheme-row-${scheme.id}`}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontSize: 15 }}>{scheme.name}</strong>
                    <span className="pill">{sourceLabel(scheme, hasOverlay, copy)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                    <code>{scheme.id}</code>
                  </div>
                  <p style={{ fontSize: 13, marginTop: 8, marginBottom: 0, lineHeight: 1.45 }}>
                    {scheme.description}
                  </p>
                  <div
                    style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}
                    data-testid={`orchestration-scheme-roles-${scheme.id}`}
                  >
                    {members.map((member) => (
                      <span
                        key={member.role}
                        className="pill"
                        title={member.description}
                        style={{ fontSize: 11 }}
                      >
                        {member.role}
                      </span>
                    ))}
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' }}>
                  <Button
                    variant="secondary"
                    disabled={saving || (editing !== null && !isEditingThis)}
                    data-testid={`orchestration-scheme-edit-${scheme.id}`}
                    onClick={() => {
                      if (isEditingThis) cancelEdit();
                      else startEdit(scheme);
                    }}
                  >
                    {isEditingThis ? copy.schemeCancel : copy.schemeEdit}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={saving || editing !== null}
                    data-testid={`orchestration-scheme-clone-${scheme.id}`}
                    onClick={() => void onCloneScheme(scheme.id)}
                  >
                    {copy.schemeClone}
                  </Button>
                  {isBuiltinBase && hasOverlay ? (
                    <Button
                      variant="ghost"
                      disabled={saving || editing !== null}
                      data-testid={`orchestration-scheme-reset-${scheme.id}`}
                      onClick={() => void resetBuiltin(scheme.id)}
                    >
                      {copy.schemeResetBuiltin}
                    </Button>
                  ) : null}
                  {!isBuiltinBase ? (
                    <Button
                      variant="ghost"
                      disabled={saving || editing !== null}
                      data-testid={`orchestration-scheme-delete-${scheme.id}`}
                      onClick={() => void deleteUserScheme(scheme.id)}
                    >
                      {copy.schemeDelete}
                    </Button>
                  ) : null}
                </div>
              </div>

              {isEditingThis && editing ? renderEditorForm(editing) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
