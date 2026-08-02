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
  SUBAGENT_CAPABILITIES,
  type ModelRef,
  type PiwinConfig,
  type SubagentCapability,
  type SubagentConfig,
  type SubagentIsolationMode,
  type SubagentProfile,
  type SubagentProfileSettings,
  type ThinkingLevel,
} from '@piwin/contracts';
import { Button, Notice, Select, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

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

function buildModelOptions(
  providers: PiwinConfig['providers'],
): { value: string; label: string; ref: ModelRef }[] {
  const options: { value: string; label: string; ref: ModelRef }[] = [];
  for (const provider of providers) {
    for (const model of provider.models) {
      const ref: ModelRef = {
        protocol: provider.protocol,
        providerId: provider.id,
        modelId: model.id,
      };
      options.push({
        value: JSON.stringify(ref),
        label: `${provider.name} / ${model.label ?? model.id}`,
        ref,
      });
    }
  }
  return options;
}

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
        maxParallelWriteTasks: '最大并行写入任务数',
        processIsolation: '进程隔离',
        parallelWritePolicy: '并行写入策略',
        requireCleanBase: '并行写入要求干净基线',
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
        maxParallelWriteTasks: 'Max parallel write tasks',
        processIsolation: 'Process isolation',
        parallelWritePolicy: 'Parallel write policy',
        requireCleanBase: 'Require clean base for parallel writes',
      };

  const subagents: SubagentConfig = config?.subagents ?? createDefaultSubagentConfig();

  // Drafts: built-ins (overridable) + custom (editable). Id is editable only
  // for custom profiles; built-in ids are fixed so overrides merge by id.
  const [drafts, setDrafts] = useState<ProfileDraft[]>([]);
  const [defaultProfileId, setDefaultProfileId] = useState<string>(
    subagents.defaultProfileId ?? '',
  );
  const [maxConcurrency, setMaxConcurrency] = useState<number>(subagents.maxConcurrency);
  const [maxTasksPerRun, setMaxTasksPerRun] = useState<number>(subagents.maxTasksPerRun);
  const [maxParallelWriteTasks, setMaxParallelWriteTasks] = useState<number>(
    subagents.maxParallelWriteTasks,
  );
  const [processIsolation, setProcessIsolation] = useState<SubagentConfig['processIsolation']>(
    subagents.processIsolation,
  );
  const [parallelWritePolicy, setParallelWritePolicy] = useState<
    SubagentConfig['parallelWritePolicy']
  >(subagents.parallelWritePolicy);
  const [requireCleanBase, setRequireCleanBase] = useState<boolean>(
    subagents.requireCleanBaseForParallelWrites,
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
    setMaxParallelWriteTasks(subagents.maxParallelWriteTasks);
    setProcessIsolation(subagents.processIsolation);
    setParallelWritePolicy(subagents.parallelWritePolicy);
    setRequireCleanBase(subagents.requireCleanBaseForParallelWrites);
    // We intentionally only re-sync on config identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const modelOptions = useMemo(() => (config ? buildModelOptions(config.providers) : []), [config]);

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
      maxParallelWriteTasks,
      processIsolation,
      parallelWritePolicy,
      requireCleanBaseForParallelWrites: requireCleanBase,
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
      <PageTitle title={copy.title} description={copy.description} />

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
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 13, fontWeight: 600 }}>{copy.maxParallelWriteTasks}</label>
              <TextInput
                type="number"
                min={1}
                value={String(maxParallelWriteTasks)}
                onChange={(e) => setMaxParallelWriteTasks(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
            <input
              type="checkbox"
              checked={requireCleanBase}
              onChange={(e) => setRequireCleanBase(e.target.checked)}
            />
            {copy.requireCleanBase}
          </label>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <Button variant="primary" disabled={saving} onClick={() => void handleSave()}>
          {saving ? '…' : copy.save}
        </Button>
      </div>
    </div>
  );
}
