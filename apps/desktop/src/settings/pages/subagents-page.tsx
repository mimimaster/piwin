/**
 * Settings → Sub-agent profiles page (CE-SUB-PROF).
 *
 * Lists built-in + Settings-defined profiles, lets the user override the
 * model (reusing configured providers), thinking level, capabilities,
 * isolation, and skill allowlist. Saving persists to `config.subagents`.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createDefaultSubagentConfig,
  listOrchestrationSchemes,
  BUILTIN_ULTRA_CODE_SCHEME,
  migrateSchemeMembers,
  type OrchestrationSchemeSettings,
  SUBAGENT_CAPABILITIES,
  type ModelRef,
  type SubagentCapability,
  type SubagentConfig,
  type SubagentIsolationMode,
  type SubagentProfile,
  type SubagentProfileSettings,
  type ThinkingLevel,
} from '@piwin/contracts';
import { Button, Notice, Select, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { buildEnabledModelOptions } from '../../model-options';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { OrchestrationSchemeEditor } from '../orchestration-scheme-editor';

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

type ProfileDraft = SubagentProfileSettings & {
  /** Tracks whether this draft originated from a built-in (read-only id). */
  builtin: boolean;
};

function profileToDraft(profile: SubagentProfile): ProfileDraft {
  return {
    id: profile.id,
    description: profile.description,
    isolation: profile.isolation,
    ...(profile.model ? { model: profile.model } : {}),
    ...(profile.thinkingLevel ? { thinkingLevel: profile.thinkingLevel } : {}),
    ...(profile.capabilities ? { capabilities: [...profile.capabilities] } : {}),
    ...(profile.skillIds ? { skillIds: [...profile.skillIds] } : {}),
    builtin: profile.source === 'builtin',
  };
}

export function SubagentProfilesPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { config, saving, saveConfig, setError } = useSettings();

  const copy = isChinese
    ? {
        title: '子代理配置',
        description: '为子代理定义可重用的配置档案：模型、思考级别、能力、隔离与技能。',
        builtin: '内置',
        custom: '自定义',
        addNew: '新增配置',
        save: '保存',
        saved: '已保存',
        id: 'ID',
        description2: '描述',
        model: '模型',
        modelInherit: '继承父会话',
        thinking: '思考级别',
        thinkingInherit: '继承',
        capabilities: '能力',
        isolation: '隔离',
        skills: '技能允许列表（逗号分隔）',
        remove: '删除',
        noModels: '尚未配置任何模型。请先在 Models 页面添加 Provider 与模型。',
        defaultProfile: '默认配置 ID',
        defaultProfileNone: '无（每次调用时选择）',
        limits: '并行与限制',
        maxConcurrency: '最大并发',
        maxTasksPerRun: '每次运行最大任务数',
        processIsolation: '进程隔离',
        parallelWritePolicy: '并行写入策略',
        dirtyBasePolicy: '脏基线并行写入策略',
        schemesTitle: '编排方案',
        schemesDescription:
          '编排方案是发送时的可选项（Composer 下拉）。Off 表示自由模式；选择后才注入主纪律与角色编队。可编辑 Ultra Code 覆盖层，或新建自己的方案。',
        schemeClone: '克隆',
        schemeCloneSaved: '已克隆并保存',
        schemeClonedSuffix: '（副本）',
        schemeSourceBuiltin: '内置',
        schemeSourceSettings: '自定义',
        schemeDefaultProfile: '默认档案',
        schemeGeneric: '泛型派发（隐藏 model/thinking）',
        schemeExpose: '暴露派发元数据',
        schemeEdit: '编辑',
        schemeNew: '新建方案',
        schemeDelete: '删除',
        schemeResetBuiltin: '恢复内置',
        schemeSave: '保存方案',
        schemeSaved: '方案已保存',
        schemeName: '名称',
        schemeId: 'ID',
        schemeDesc: '描述',
        schemeDiscipline: '主纪律',
        schemeDisciplineHint: '注入给主代理：何时派发、如何等待与验证。',
        schemeMembers: '角色成员',
        schemeAddMember: '添加角色',
        schemeAddFromTemplate: '从模板添加',
        schemeRole: '角色 ID',
        schemeRoleDesc: '工作描述（调度用）',
        schemeMemberProfile: '档案模板',
        schemeMemberModel: '模型',
        schemeModelInherit: '继承',
        schemeThinking: '思考',
        schemeThinkingInherit: '继承/方案上限',
        schemeIsolation: '隔离',
        schemeIsolationInherit: '继承档案',
        schemeFallback: '不可用回退',
        schemeDefaultRole: '默认角色',
        schemeMaxConcurrency: '最大并发',
        schemeMaxTasks: '每轮最大任务',
        schemeMaxThinking: '子代理思考上限',
        schemeMaxThinkingInherit: '不限制',
        schemeRemoveMember: '移除',
        schemeCancel: '取消',
        schemeInvalidId: '方案 ID 须为小写字母、数字与连字符',
        schemeInvalidRole: '角色 ID 非法或重复',
        schemeNeedMember: '至少需要一个带描述的角色',
        schemeCheapModelHint:
          '建议为 searcher 指定更便宜的已配置模型；留空则可能与主模型同价。',
      }
    : {
        title: 'Sub-agent profiles',
        description:
          'Define reusable profiles for sub-agents: model, thinking level, capabilities, isolation, and skills.',
        builtin: 'Built-in',
        custom: 'Custom',
        addNew: 'Add profile',
        save: 'Save',
        saved: 'Saved',
        id: 'ID',
        description2: 'Description',
        model: 'Model',
        modelInherit: 'Inherit parent',
        thinking: 'Thinking level',
        thinkingInherit: 'Inherit',
        capabilities: 'Capabilities',
        isolation: 'Isolation',
        skills: 'Skill allowlist (comma-separated)',
        remove: 'Remove',
        noModels: 'No models configured. Add a provider and model on the Models page first.',
        defaultProfile: 'Default profile id',
        defaultProfileNone: 'None (choose per call)',
        limits: 'Concurrency & limits',
        maxConcurrency: 'Max concurrency',
        maxTasksPerRun: 'Max tasks per run',
        processIsolation: 'Process isolation',
        parallelWritePolicy: 'Parallel write policy',
        dirtyBasePolicy: 'Dirty-base parallel write policy',
        schemesTitle: 'Orchestration schemes',
        schemesDescription:
          'Schemes are a per-send Composer choice. Off is freehand; selection injects main discipline and a role roster. Edit the Ultra Code overlay or create your own schemes.',
        schemeClone: 'Clone',
        schemeCloneSaved: 'Cloned and saved',
        schemeClonedSuffix: ' (copy)',
        schemeSourceBuiltin: 'Built-in',
        schemeSourceSettings: 'Custom',
        schemeDefaultProfile: 'Default profile',
        schemeGeneric: 'Generic spawn (hide model/thinking)',
        schemeExpose: 'Expose spawn metadata',
        schemeEdit: 'Edit',
        schemeNew: 'New scheme',
        schemeDelete: 'Delete',
        schemeResetBuiltin: 'Reset builtin',
        schemeSave: 'Save scheme',
        schemeSaved: 'Scheme saved',
        schemeName: 'Name',
        schemeId: 'ID',
        schemeDesc: 'Description',
        schemeDiscipline: 'Main discipline',
        schemeDisciplineHint: 'Injected for the main agent: when to delegate, wait, and verify.',
        schemeMembers: 'Role members',
        schemeAddMember: 'Add role',
        schemeAddFromTemplate: 'Add from template',
        schemeRole: 'Role id',
        schemeRoleDesc: 'Work description (for routing)',
        schemeMemberProfile: 'Profile template',
        schemeMemberModel: 'Model',
        schemeModelInherit: 'Inherit',
        schemeThinking: 'Thinking',
        schemeThinkingInherit: 'Inherit / scheme cap',
        schemeIsolation: 'Isolation',
        schemeIsolationInherit: 'Inherit profile',
        schemeFallback: 'Unavailable fallback',
        schemeDefaultRole: 'Default role',
        schemeMaxConcurrency: 'Max concurrency',
        schemeMaxTasks: 'Max tasks per run',
        schemeMaxThinking: 'Subagent thinking cap',
        schemeMaxThinkingInherit: 'No cap',
        schemeRemoveMember: 'Remove',
        schemeCancel: 'Cancel',
        schemeInvalidId: 'Scheme id must be lowercase letters, digits, and hyphens',
        schemeInvalidRole: 'Invalid or duplicate role id',
        schemeNeedMember: 'At least one role with a description is required',
        schemeCheapModelHint:
          'Pin a cheaper configured model on searcher when possible; inherit may match the main model cost.',
      };

  const subagents: SubagentConfig = config?.subagents ?? createDefaultSubagentConfig();

  const [schemeDrafts, setSchemeDrafts] = useState<OrchestrationSchemeSettings[]>(
    () => subagents.schemes ?? [],
  );
  const [schemeNotice, setSchemeNotice] = useState<string | null>(null);
  // Drafts: built-ins (overridable) + custom (editable). Id is editable only
  // for custom profiles; built-in ids are fixed so overrides merge by id.
  const [drafts, setDrafts] = useState<ProfileDraft[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string>(
    subagents.defaultProfileId ?? '',
  );
  const [maxConcurrency, setMaxConcurrency] = useState<number>(subagents.maxConcurrency);
  const [maxTasksPerRun, setMaxTasksPerRun] = useState<number>(subagents.maxTasksPerRun);
  const [processIsolation, setProcessIsolation] = useState<SubagentConfig['processIsolation']>(
    subagents.processIsolation,
  );
  const [parallelWritePolicy, setParallelWritePolicy] = useState<
    SubagentConfig['parallelWritePolicy']
  >(subagents.parallelWritePolicy);
  const [dirtyBasePolicy, setDirtyBasePolicy] = useState<SubagentConfig['dirtyBasePolicy']>(
    subagents.dirtyBasePolicy,
  );

  useEffect(() => {
    // Re-sync drafts when the persisted config changes.
    const builtins: ProfileDraft[] = (subagents.profiles ?? []).map((p) =>
      profileToDraft({ ...p, source: 'settings' }),
    );
    setDrafts(builtins);
    setDefaultProfileId(subagents.defaultProfileId ?? '');
    setMaxConcurrency(subagents.maxConcurrency);
    setMaxTasksPerRun(subagents.maxTasksPerRun);
    setProcessIsolation(subagents.processIsolation);
    setParallelWritePolicy(subagents.parallelWritePolicy);
    setDirtyBasePolicy(subagents.dirtyBasePolicy);
    setSchemeDrafts(subagents.schemes ?? []);
    setSchemeNotice(null);
    // We intentionally only re-sync on config identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const orchestrationSchemes = useMemo(
    () =>
      listOrchestrationSchemes({
        schemes: schemeDrafts,
        maxConcurrency: subagents.maxConcurrency,
        maxTasksPerRun: subagents.maxTasksPerRun,
      }),
    [schemeDrafts, subagents.maxConcurrency, subagents.maxTasksPerRun],
  );

  const modelOptions = useMemo(() => {
    if (!config) {
      return [];
    }
    return buildEnabledModelOptions(config.providers).map((option) => {
      const ref: ModelRef = {
        protocol: option.protocol,
        providerId: option.providerId,
        modelId: option.modelId,
      };
      return {
        value: JSON.stringify(ref),
        label: option.label,
        ref,
      };
    });
  }, [config]);

  function updateDraft(index: number, patch: Partial<ProfileDraft>): void {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)));
  }

  /** Strip undefined values so exactOptionalPropertyTypes stays satisfied. */
  function updateDraftOptional(
    index: number,
    patch: {
      model?: ModelRef | undefined;
      thinkingLevel?: ThinkingLevel | undefined;
      capabilities?: SubagentCapability[] | undefined;
      skillIds?: string[] | undefined;
    },
  ): void {
    const clean: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) clean[key] = value;
    }
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...clean } : draft)));
  }

  function addDraft(): void {
    setDrafts((prev) => [
      ...prev,
      {
        id: `custom-${Date.now().toString(36)}`,
        description: '',
        isolation: 'readonly',
        capabilities: ['read'],
        builtin: false,
      },
    ]);
  }

  function removeDraft(index: number): void {
    setDrafts((prev) => prev.filter((_, i) => i !== index));
  }

  function buildUniqueSchemeCloneId(baseId: string, existingIds: ReadonlySet<string>): string {
    const sanitizedBase = baseId
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'scheme';
    let candidate = `${sanitizedBase}-copy`;
    let suffix = 2;
    while (existingIds.has(candidate)) {
      candidate = `${sanitizedBase}-copy-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async function handleCloneScheme(schemeId: string): Promise<void> {
    if (!config) return;
    const source =
      orchestrationSchemes.find((scheme) => scheme.id === schemeId) ??
      (schemeId === BUILTIN_ULTRA_CODE_SCHEME.id ? BUILTIN_ULTRA_CODE_SCHEME : undefined);
    if (!source) return;

    const existingIds = new Set([
      ...schemeDrafts.map((scheme) => scheme.id),
      ...orchestrationSchemes.map((scheme) => scheme.id),
    ]);
    const clonedId = buildUniqueSchemeCloneId(source.id, existingIds);
    const cloned: OrchestrationSchemeSettings = {
      id: clonedId,
      name: `${source.name}${copy.schemeClonedSuffix}`,
      description: source.description,
      exposeSpawnMetadata: source.exposeSpawnMetadata,
      waitPolicy: 'await-all',
      systemPreamble: source.systemPreamble,
      ...(source.defaultProfileId ? { defaultProfileId: source.defaultProfileId } : {}),
      ...(source.defaultRole ? { defaultRole: source.defaultRole } : {}),
      members: migrateSchemeMembers(source).map((member) => ({
        role: member.role,
        description: member.description,
        ...(member.profileId ? { profileId: member.profileId } : {}),
        ...(member.model ? { model: member.model } : {}),
        ...(member.thinkingLevel ? { thinkingLevel: member.thinkingLevel } : {}),
        ...(member.isolation ? { isolation: member.isolation } : {}),
        ...(member.fallback ? { fallback: member.fallback } : { fallback: 'main' as const }),
      })),
      ...(source.allowedProfileIds ? { allowedProfileIds: [...source.allowedProfileIds] } : {}),
      ...(source.maxConcurrency !== undefined ? { maxConcurrency: source.maxConcurrency } : {}),
      ...(source.maxTasksPerRun !== undefined ? { maxTasksPerRun: source.maxTasksPerRun } : {}),
      ...(source.maxSubagentThinkingLevel
        ? { maxSubagentThinkingLevel: source.maxSubagentThinkingLevel }
        : {}),
    };

    const nextSchemes = [...schemeDrafts, cloned];
    setSchemeDrafts(nextSchemes);

    const nextSubagents: SubagentConfig = {
      ...subagents,
      schemes: nextSchemes,
    };
    const ok = await saveConfig({ ...config, subagents: nextSubagents });
    if (!ok) {
      setError(isChinese ? '克隆失败' : 'Clone failed');
      return;
    }
    setSchemeNotice(copy.schemeCloneSaved);
  }

  async function persistSchemes(nextSchemes: OrchestrationSchemeSettings[]): Promise<boolean> {
    if (!config) return false;
    setSchemeDrafts(nextSchemes);
    // exactOptional: omit schemes key when empty rather than assigning undefined.
    const payload: SubagentConfig = {
      profiles: subagents.profiles,
      maxConcurrency: subagents.maxConcurrency,
      maxTasksPerRun: subagents.maxTasksPerRun,
      processIsolation: subagents.processIsolation,
      parallelWritePolicy: subagents.parallelWritePolicy,
      dirtyBasePolicy: subagents.dirtyBasePolicy,
    };
    if (subagents.defaultProfileId) {
      payload.defaultProfileId = subagents.defaultProfileId;
    }
    if (nextSchemes.length > 0) {
      payload.schemes = nextSchemes;
    }
    const ok = await saveConfig({ ...config, subagents: payload });
    if (!ok) {
      setError(isChinese ? '保存失败' : 'Save failed');
      return false;
    }
    return true;
  }

  async function handleSave(): Promise<void> {
    if (!config) return;
    // Filter out invalid drafts (missing id or description).
    const profiles: SubagentProfileSettings[] = drafts
      .filter((draft) => draft.id.trim() && draft.description.trim())
      .map((draft) => {
        const profile: SubagentProfileSettings = {
          id: draft.id.trim(),
          description: draft.description.trim(),
          isolation: draft.isolation,
        };
        if (draft.model) profile.model = draft.model;
        if (draft.thinkingLevel) profile.thinkingLevel = draft.thinkingLevel;
        if (draft.capabilities && draft.capabilities.length > 0) {
          profile.capabilities = [...draft.capabilities];
        }
        if (draft.skillIds && draft.skillIds.length > 0) {
          profile.skillIds = [...draft.skillIds];
        }
        return profile;
      });
    const next: SubagentConfig = {
      profiles,
      ...(defaultProfileId.trim() ? { defaultProfileId: defaultProfileId.trim() } : {}),
      maxConcurrency,
      maxTasksPerRun,
      processIsolation,
      parallelWritePolicy,
      dirtyBasePolicy,
      // ORCH: never drop user schemes when saving profiles/limits.
      ...(schemeDrafts.length > 0 ? { schemes: schemeDrafts } : {}),
    };
    const ok = await saveConfig({ ...config, subagents: next });
    if (!ok) {
      setError(isChinese ? '保存失败' : 'Save failed');
    }
  }

  if (!config) {
    return (
      <p className="muted" data-testid="settings-subagents-loading">
        {isChinese ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  return (
    <div className="settings-card" data-testid="settings-subagents">
      {modelOptions.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning">{copy.noModels}</Notice>
        </div>
      )}

      <div className="settings-section">
        {drafts.map((draft, index) => (
          <div
            key={index}
            className="settings-section settings-section-card"
            style={{ marginBottom: 16 }}
            data-testid={`subagent-profile-row-${index}`}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              <span className="pill">{draft.builtin ? copy.builtin : copy.custom}</span>
              {!draft.builtin && (
                <Button size="compact" variant="ghost" onClick={() => removeDraft(index)}>
                  {copy.remove}
                </Button>
              )}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.id}</label>
                  <TextInput
                    value={draft.id}
                    disabled={draft.builtin}
                    onChange={(e) => updateDraft(index, { id: e.target.value })}
                  />
                </div>
                <div style={{ flex: 2 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.description2}</label>
                  <TextInput
                    value={draft.description}
                    onChange={(e) => updateDraft(index, { description: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.model}</label>
                  <Select
                    value={draft.model ? JSON.stringify(draft.model) : ''}
                    onChange={(e) => {
                      const selected = modelOptions.find((opt) => opt.value === e.target.value);
                      updateDraftOptional(index, { model: selected ? selected.ref : undefined });
                    }}
                  >
                    <option value="">{copy.modelInherit}</option>
                    {modelOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </Select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.thinking}</label>
                  <Select
                    value={draft.thinkingLevel ?? ''}
                    onChange={(e) =>
                      updateDraftOptional(index, {
                        thinkingLevel: (e.target.value || undefined) as ThinkingLevel | undefined,
                      })
                    }
                  >
                    <option value="">{copy.thinkingInherit}</option>
                    {THINKING_LEVELS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </Select>
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.isolation}</label>
                  <Select
                    value={draft.isolation}
                    onChange={(e) =>
                      updateDraft(index, {
                        isolation: e.target.value as SubagentIsolationMode,
                      })
                    }
                  >
                    {ISOLATION_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.capabilities}</label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                  {SUBAGENT_CAPABILITIES.map((cap) => {
                    const checked = draft.capabilities?.includes(cap) ?? false;
                    return (
                      <label
                        key={cap}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 13 }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const next = new Set<SubagentCapability>(draft.capabilities ?? []);
                            if (e.target.checked) next.add(cap);
                            else next.delete(cap);
                            updateDraftOptional(index, {
                              capabilities: next.size > 0 ? [...next] : undefined,
                            });
                          }}
                        />
                        {cap}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.skills}</label>
                <TextInput
                  value={(draft.skillIds ?? []).join(', ')}
                  onChange={(e) => {
                    const ids = e.target.value
                      .split(',')
                      .map((s) => s.trim())
                      .filter(Boolean);
                    updateDraftOptional(index, { skillIds: ids.length > 0 ? ids : undefined });
                  }}
                  placeholder="skill-a, skill-b"
                />
              </div>
            </div>
          </div>
        ))}

        <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
          <Button variant="ghost" onClick={addDraft}>
            {copy.addNew}
          </Button>
        </div>
      </div>

      <div className="settings-section">
        <PageTitle title={copy.limits} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.defaultProfile}</label>
              <Select
                value={defaultProfileId}
                onChange={(e) => setDefaultProfileId(e.target.value)}
              >
                <option value="">{copy.defaultProfileNone}</option>
                {drafts
                  .filter((d) => d.id.trim())
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.id}
                    </option>
                  ))}
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.processIsolation}</label>
              <Select
                value={processIsolation}
                onChange={(e) =>
                  setProcessIsolation(e.target.value as SubagentConfig['processIsolation'])
                }
              >
                <option value="required">required</option>
                <option value="best-effort">best-effort</option>
              </Select>
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.parallelWritePolicy}</label>
              <Select
                value={parallelWritePolicy}
                onChange={(e) =>
                  setParallelWritePolicy(e.target.value as SubagentConfig['parallelWritePolicy'])
                }
              >
                <option value="worktree-only">worktree-only</option>
                <option value="disabled">disabled</option>
              </Select>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.maxConcurrency}</label>
              <TextInput
                type="number"
                min={1}
                value={String(maxConcurrency)}
                onChange={(e) => setMaxConcurrency(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.maxTasksPerRun}</label>
              <TextInput
                type="number"
                min={1}
                value={String(maxTasksPerRun)}
                onChange={(e) => setMaxTasksPerRun(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.dirtyBasePolicy}</label>
            <Select
              value={dirtyBasePolicy}
              onChange={(e) =>
                setDirtyBasePolicy(e.target.value as SubagentConfig['dirtyBasePolicy'])
              }
            >
              <option value="ask">ask</option>
              <option value="bypass">bypass</option>
            </Select>
          </div>
        </div>
      </div>

      <OrchestrationSchemeEditor
        schemes={orchestrationSchemes}
        schemeDrafts={schemeDrafts}
        modelOptions={modelOptions}
        saving={saving}
        notice={schemeNotice}
        onNotice={setSchemeNotice}
        copy={{
          schemesTitle: copy.schemesTitle,
          schemesDescription: copy.schemesDescription,
          schemeClone: copy.schemeClone,
          schemeCloneSaved: copy.schemeCloneSaved,
          schemeClonedSuffix: copy.schemeClonedSuffix,
          schemeSourceBuiltin: copy.schemeSourceBuiltin,
          schemeSourceSettings: copy.schemeSourceSettings,
          schemeDefaultProfile: copy.schemeDefaultProfile,
          schemeGeneric: copy.schemeGeneric,
          schemeExpose: copy.schemeExpose,
          schemeEdit: copy.schemeEdit,
          schemeNew: copy.schemeNew,
          schemeDelete: copy.schemeDelete,
          schemeResetBuiltin: copy.schemeResetBuiltin,
          schemeSave: copy.schemeSave,
          schemeSaved: copy.schemeSaved,
          schemeName: copy.schemeName,
          schemeId: copy.schemeId,
          schemeDesc: copy.schemeDesc,
          schemeDiscipline: copy.schemeDiscipline,
          schemeDisciplineHint: copy.schemeDisciplineHint,
          schemeMembers: copy.schemeMembers,
          schemeAddMember: copy.schemeAddMember,
          schemeAddFromTemplate: copy.schemeAddFromTemplate,
          schemeRole: copy.schemeRole,
          schemeRoleDesc: copy.schemeRoleDesc,
          schemeMemberProfile: copy.schemeMemberProfile,
          schemeMemberModel: copy.schemeMemberModel,
          schemeModelInherit: copy.schemeModelInherit,
          schemeThinking: copy.schemeThinking,
          schemeThinkingInherit: copy.schemeThinkingInherit,
          schemeIsolation: copy.schemeIsolation,
          schemeIsolationInherit: copy.schemeIsolationInherit,
          schemeFallback: copy.schemeFallback,
          schemeDefaultRole: copy.schemeDefaultRole,
          schemeMaxConcurrency: copy.schemeMaxConcurrency,
          schemeMaxTasks: copy.schemeMaxTasks,
          schemeMaxThinking: copy.schemeMaxThinking,
          schemeMaxThinkingInherit: copy.schemeMaxThinkingInherit,
          schemeRemoveMember: copy.schemeRemoveMember,
          schemeCancel: copy.schemeCancel,
          schemeInvalidId: copy.schemeInvalidId,
          schemeInvalidRole: copy.schemeInvalidRole,
          schemeNeedMember: copy.schemeNeedMember,
          schemeCheapModelHint: copy.schemeCheapModelHint,
          remove: copy.remove,
        }}
        onPersistSchemes={persistSchemes}
        onCloneScheme={handleCloneScheme}
      />

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '…' : copy.save}
        </Button>
      </div>
    </div>
  );
}
