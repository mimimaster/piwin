/**
 * Settings → Sub-agents / orchestration.
 *
 * Product model (simple):
 * - A scheme is a roster of roles the main agent may call.
 * - User edits role + duty (+ optional model). Main agent schedules.
 * - No profile factory UI. Global limits live under Advanced only.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  BUILTIN_ULTRA_CODE_SCHEME,
  createDefaultSubagentConfig,
  listOrchestrationSchemes,
  migrateSchemeMembers,
  type OrchestrationSchemeSettings,
  toModelRef,
  type ModelRef,
  type SubagentConfig,
} from '@piwin/contracts';
import { Button, Notice, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import {
  buildEnabledModelOptions,
  modelOptionsFromConfiguredModels,
  readConfiguredChatModelsData,
} from '../../model-options';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { OrchestrationSchemeEditor } from '../orchestration-scheme-editor';

export function SubagentProfilesPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const { config, saving, saveConfig, setError, setInfo, request } = useSettings();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [configuredPickerOptions, setConfiguredPickerOptions] = useState<
    Array<{ value: string; label: string; ref: ModelRef }>
  >([]);

  const copy = isChinese
    ? {
        title: '编排方案',
        pageDescription:
          '预先配置可协同工作的子智能体角色。定义角色职责与可选模型后，主智能体将根据任务目标自主分派与调度。发送消息时可选择方案，选择「无」则仅由主智能体执行。',
        noModels: '尚未配置模型。请先在「模型配置」添加 Provider。',
        schemesTitle: '方案',
        schemesDescription:
          '每个方案包含调度指令与角色列表。内置 Ultra Code 为代码调研方案；支持覆盖、克隆或自建。',
        schemeClone: '克隆',
        schemeCloneSaved: '已克隆并保存',
        schemeClonedSuffix: '（副本）',
        schemeSourceBuiltin: '内置',
        schemeSourceOverridden: '已修改',
        schemeSourceSettings: '自定义',
        schemeGeneric: '自动派发（使用角色默认模型与配置）',
        schemeExpose: '允许主代理指定 model/thinking',
        schemeEdit: '编辑',
        schemeNew: '新建方案',
        schemeDelete: '删除',
        schemeResetBuiltin: '恢复默认',
        schemeSave: '保存方案',
        schemeSaved: '方案已保存',
        schemeName: '名称',
        schemeId: 'ID',
        schemeDesc: '简介',
        schemeDiscipline: '调度指令（指导主智能体分派规则）',
        schemeDisciplineHint: '定义派发时机、结果汇总要求及调用层级限制等规则。',
        schemeMembers: '子代理角色',
        schemeAddMember: '添加角色',
        schemeAddFromTemplate: '快捷添加',
        schemeRole: '角色 (role)',
        schemeRoleDesc: '职责描述（主智能体根据此描述决定何时调用该角色）',
        schemeMemberModel: '模型',
        schemeModelInherit: '继承主会话',
        schemeThinking: '思考',
        schemeThinkingInherit: '默认/上限内',
        schemeIsolation: '工作区',
        schemeIsolationReadonly: '只读',
        schemeIsolationWorktree: '独立 worktree（可写）',
        schemeFallback: '角色不可用时',
        schemeFallbackMain: '主智能体直接执行',
        schemeFallbackNone: '报错',
        schemeDefaultRole: '默认角色（未写 role 时）',
        schemeMaxConcurrency: '本方案并发上限',
        schemeMaxTasks: '本方案任务上限',
        schemeMaxThinking: '子代理思考上限',
        schemeMaxThinkingInherit: '不限制',
        schemeRemoveMember: '移除',
        schemeCancel: '取消',
        schemeInvalidId: 'ID 须为小写字母、数字与连字符',
        schemeInvalidRole: 'role 非法或重复',
        schemeNeedMember: '至少要有一个带职责描述的角色',
        schemeIncomplete: '名称、简介、调度指令和每个角色的职责都不能为空',
        schemeCheapModelHint: '调研辅助角色建议选用轻量、低延迟的已配置模型；留空则默认使用主模型。',
        schemeAdvanced: '本方案上限（可选）',
        advancedTitle: '高级 · 全局并行上限',
        maxConcurrency: '最大并发任务数',
        maxConcurrencyHint: '该值 + 1 为 Worker 进程池容量，上限 8，保存后立即生效',
        maxTasksPerRun: '单轮派发任务上限',
        saveAdvanced: '保存上限',
        saved: '已保存',
      }
    : {
        title: 'Orchestration schemes',
        pageDescription:
          'Give the main agent a roster of named subagent roles. You define roles and duties (optional model); the main agent decides who to call. Pick a scheme in Composer; Freehand means no scheme injection while delegation remains available.',
        noModels: 'No models configured. Add a provider under Models first.',
        schemesTitle: 'Schemes',
        schemesDescription:
          'Each scheme = main discipline + role roster. Ultra Code is the built-in scout pack; overlay, clone, or create your own.',
        schemeClone: 'Clone',
        schemeCloneSaved: 'Cloned and saved',
        schemeClonedSuffix: ' (copy)',
        schemeSourceBuiltin: 'Built-in',
        schemeSourceOverridden: 'Modified',
        schemeSourceSettings: 'Custom',
        schemeGeneric: 'Generic spawn (hide model/thinking from main)',
        schemeExpose: 'Allow main to set model/thinking',
        schemeEdit: 'Edit',
        schemeNew: 'New scheme',
        schemeDelete: 'Delete',
        schemeResetBuiltin: 'Reset default',
        schemeSave: 'Save scheme',
        schemeSaved: 'Scheme saved',
        schemeName: 'Name',
        schemeId: 'ID',
        schemeDesc: 'Summary',
        schemeDiscipline: 'Main discipline',
        schemeDisciplineHint: 'When to delegate, wait for results, no nesting. Editable.',
        schemeMembers: 'Subagent roles',
        schemeAddMember: 'Add role',
        schemeAddFromTemplate: 'Quick add',
        schemeRole: 'Role',
        schemeRoleDesc: 'Duty (main agent uses this to decide when to call)',
        schemeMemberModel: 'Model',
        schemeModelInherit: 'Inherit main session',
        schemeThinking: 'Thinking',
        schemeThinkingInherit: 'Default / under cap',
        schemeIsolation: 'Workspace',
        schemeIsolationReadonly: 'Read-only',
        schemeIsolationWorktree: 'Worktree (writable)',
        schemeFallback: 'If role unavailable',
        schemeFallbackMain: 'Main agent does it',
        schemeFallbackNone: 'Fail',
        schemeDefaultRole: 'Default role (when role omitted)',
        schemeMaxConcurrency: 'Scheme concurrency cap',
        schemeMaxTasks: 'Scheme task cap',
        schemeMaxThinking: 'Subagent thinking cap',
        schemeMaxThinkingInherit: 'No cap',
        schemeRemoveMember: 'Remove',
        schemeCancel: 'Cancel',
        schemeInvalidId: 'ID must be lowercase letters, digits, hyphens',
        schemeInvalidRole: 'Invalid or duplicate role',
        schemeNeedMember: 'Need at least one role with a duty description',
        schemeIncomplete: 'Name, summary, discipline, and every role duty are required',
        schemeCheapModelHint:
          'Pin a cheaper model on scout roles when possible; empty may match main model cost.',
        schemeAdvanced: 'Scheme caps (optional)',
        advancedTitle: 'Advanced · global concurrency',
        maxConcurrency: 'Max running at once',
        maxConcurrencyHint:
          'This value + 1 is the worker process pool (cap 8). Saves apply immediately.',
        maxTasksPerRun: 'Max per dispatch',
        saveAdvanced: 'Save limits',
        saved: 'Saved',
      };

  const subagents: SubagentConfig = config?.subagents ?? createDefaultSubagentConfig();

  const [schemeDrafts, setSchemeDrafts] = useState<OrchestrationSchemeSettings[]>(
    () => subagents.schemes ?? [],
  );
  const [schemeNotice, setSchemeNotice] = useState<string | null>(null);
  const [maxConcurrency, setMaxConcurrency] = useState<number>(subagents.maxConcurrency);
  const [maxTasksPerRun, setMaxTasksPerRun] = useState<number>(subagents.maxTasksPerRun);

  useEffect(() => {
    setSchemeDrafts(subagents.schemes ?? []);
    setMaxConcurrency(subagents.maxConcurrency);
    setMaxTasksPerRun(subagents.maxTasksPerRun);
    setSchemeNotice(null);
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
    if (!config) return [];
    return buildEnabledModelOptions(config.providers).map((option) => {
      const ref: ModelRef = toModelRef({
        providerId: option.providerId,
        modelId: option.modelId,
        ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
      });
      return { value: JSON.stringify(ref), label: option.label, ref };
    });
  }, [config]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await request({ type: 'models/configured' });
      if (cancelled || !response.success) return;
      const models = readConfiguredChatModelsData(response.data).models;
      if (cancelled) return;
      setConfiguredPickerOptions(
        modelOptionsFromConfiguredModels(models).map((option) => {
          const ref: ModelRef = toModelRef({
            providerId: option.providerId,
            modelId: option.modelId,
            ...(option.protocol !== undefined ? { protocol: option.protocol } : {}),
            ...(option.source !== undefined ? { source: option.source } : {}),
          });
          return { value: JSON.stringify(ref), label: option.label, ref };
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  const pickerModelOptions =
    configuredPickerOptions.length > 0 ? configuredPickerOptions : modelOptions;

  function buildUniqueSchemeCloneId(baseId: string, existingIds: ReadonlySet<string>): string {
    const sanitizedBase =
      baseId
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

  function baseSubagentPayload(schemes: OrchestrationSchemeSettings[] | undefined): SubagentConfig {
    const payload: SubagentConfig = {
      profiles: subagents.profiles ?? [],
      maxConcurrency,
      maxTasksPerRun,
      processIsolation: subagents.processIsolation,
      parallelWritePolicy: subagents.parallelWritePolicy,
      dirtyBasePolicy: subagents.dirtyBasePolicy,
    };
    if (subagents.defaultProfileId) {
      payload.defaultProfileId = subagents.defaultProfileId;
    }
    if (schemes && schemes.length > 0) {
      payload.schemes = schemes;
    }
    return payload;
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
      ...(source.maxConcurrency !== undefined ? { maxConcurrency: source.maxConcurrency } : {}),
      ...(source.maxTasksPerRun !== undefined ? { maxTasksPerRun: source.maxTasksPerRun } : {}),
      ...(source.maxSubagentThinkingLevel
        ? { maxSubagentThinkingLevel: source.maxSubagentThinkingLevel }
        : {}),
    };

    const nextSchemes = [...schemeDrafts, cloned];
    setSchemeDrafts(nextSchemes);
    const ok = await saveConfig({
      ...config,
      subagents: baseSubagentPayload(nextSchemes),
    });
    if (!ok) {
      setError(isChinese ? '克隆失败' : 'Clone failed');
      return;
    }
    setSchemeNotice(copy.schemeCloneSaved);
  }

  async function persistSchemes(nextSchemes: OrchestrationSchemeSettings[]): Promise<boolean> {
    if (!config) return false;
    setSchemeDrafts(nextSchemes);
    const ok = await saveConfig({
      ...config,
      subagents: baseSubagentPayload(nextSchemes.length > 0 ? nextSchemes : undefined),
    });
    if (!ok) {
      setError(isChinese ? '保存失败' : 'Save failed');
      return false;
    }
    return true;
  }

  async function saveAdvancedLimits(): Promise<void> {
    if (!config) return;
    const ok = await saveConfig({
      ...config,
      subagents: baseSubagentPayload(schemeDrafts.length > 0 ? schemeDrafts : undefined),
    });
    if (!ok) {
      setError(isChinese ? '保存失败' : 'Save failed');
      return;
    }
    setInfo(copy.saved);
  }

  if (!config) {
    return (
      <p className="muted" data-testid="settings-subagents-loading">
        {isChinese ? '正在加载配置…' : 'Loading configuration…'}
      </p>
    );
  }

  const schemeEditorCopy = {
    schemesTitle: copy.schemesTitle,
    schemesDescription: copy.schemesDescription,
    schemeClone: copy.schemeClone,
    schemeCloneSaved: copy.schemeCloneSaved,
    schemeClonedSuffix: copy.schemeClonedSuffix,
    schemeSourceBuiltin: copy.schemeSourceBuiltin,
    schemeSourceOverridden: copy.schemeSourceOverridden,
    schemeSourceSettings: copy.schemeSourceSettings,
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
    schemeMemberModel: copy.schemeMemberModel,
    schemeModelInherit: copy.schemeModelInherit,
    schemeThinking: copy.schemeThinking,
    schemeThinkingInherit: copy.schemeThinkingInherit,
    schemeIsolation: copy.schemeIsolation,
    schemeIsolationReadonly: copy.schemeIsolationReadonly,
    schemeIsolationWorktree: copy.schemeIsolationWorktree,
    schemeFallback: copy.schemeFallback,
    schemeFallbackMain: copy.schemeFallbackMain,
    schemeFallbackNone: copy.schemeFallbackNone,
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
    schemeIncomplete: copy.schemeIncomplete,
    schemeCheapModelHint: copy.schemeCheapModelHint,
    schemeAdvanced: copy.schemeAdvanced,
  };

  return (
    <div className="settings-card" data-testid="settings-subagents">
      <PageTitle title={copy.title} description={copy.pageDescription} />

      {pickerModelOptions.length === 0 ? (
        <div style={{ marginBottom: 16 }}>
          <Notice tone="warning">{copy.noModels}</Notice>
        </div>
      ) : null}

      <OrchestrationSchemeEditor
        schemes={orchestrationSchemes}
        schemeDrafts={schemeDrafts}
        modelOptions={pickerModelOptions}
        saving={saving}
        notice={schemeNotice}
        onNotice={setSchemeNotice}
        copy={schemeEditorCopy}
        onPersistSchemes={persistSchemes}
        onCloneScheme={handleCloneScheme}
      />

      <details
        className="settings-section settings-section-card"
        style={{ marginTop: 24, padding: 14 }}
        open={advancedOpen}
        onToggle={(event) => setAdvancedOpen((event.target as HTMLDetailsElement).open)}
        data-testid="subagents-advanced-limits"
      >
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
          {copy.advancedTitle}
        </summary>
        <FieldRow
          label={copy.maxConcurrency}
          description={copy.maxConcurrencyHint}
          testId="subagents-max-concurrency-row"
        >
          <TextInput
            type="number"
            min={1}
            value={String(maxConcurrency)}
            onChange={(event) => setMaxConcurrency(Math.max(1, Number(event.target.value) || 1))}
          />
        </FieldRow>
        <FieldRow label={copy.maxTasksPerRun} testId="subagents-max-tasks-row">
          <TextInput
            type="number"
            min={1}
            value={String(maxTasksPerRun)}
            onChange={(event) => setMaxTasksPerRun(Math.max(1, Number(event.target.value) || 1))}
          />
        </FieldRow>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
          <Button variant="primary" disabled={saving} onClick={() => void saveAdvancedLimits()}>
            {saving ? '…' : copy.saveAdvanced}
          </Button>
        </div>
      </details>
    </div>
  );
}
