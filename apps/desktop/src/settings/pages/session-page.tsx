/**
 * Settings → Session page.
 * - Walkthrough is always generated when a plan completes.
 * - Switch (default on): inject the custom prompt into generation.
 * - Switch off: no prompt injected — model generates freely (Pi norm).
 * - Prompt editor is shown only while the custom-prompt switch is on.
 * - Save / reset appear when the draft differs from the saved config.
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createDefaultWalkthroughConfig,
  DEFAULT_WALKTHROUGH_PROMPT,
  formatError,
  validateWalkthroughConfig,
  type PiwinConfig,
  type SessionCompactExportData,
  type SessionLifecycleApplyResult,
  type SessionLifecyclePlan,
  type WalkthroughConfig,
} from '@piwin/contracts';
import { Button, SegmentedControl, Switch, TextArea, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { chooseSessionExportPath } from '../../session-export-dialog';
import { SessionRuntimePage } from './session-runtime-page.js';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

type SessionSubTab = 'lifecycle' | 'runtime';

function parseOptionalPositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function parseOptionalNonNegativeInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return undefined;
  const value = Number(trimmed);
  if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function archiveReasonLabel(
  reason: SessionLifecyclePlan['candidates'][number]['reason'],
  isZh: boolean,
): string {
  if (reason === 'inactive-age') {
    return isZh ? '超过不活跃天数' : 'Inactive age';
  }
  return isZh ? '超过活跃数量上限' : 'Active limit';
}

function SessionLifecycleSection(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { config, saveConfig, setError, setInfo, request, hostStatus, activeSessionId } =
    useSettings();
  const walkthrough = config?.walkthrough ?? createDefaultWalkthroughConfig();
  const savedArchive = config?.session?.lifecycle?.archive;

  const [useCustomPrompt, setUseCustomPrompt] = useState<boolean>(walkthrough.enabled);
  const [prompt, setPrompt] = useState<string>(walkthrough.custom.prompt);
  const [compactExporting, setCompactExporting] = useState(false);
  const [maxInactiveDaysDraft, setMaxInactiveDaysDraft] = useState(
    savedArchive?.maxInactiveDays !== undefined ? String(savedArchive.maxInactiveDays) : '',
  );
  const [maxActiveMainSessionsDraft, setMaxActiveMainSessionsDraft] = useState(
    savedArchive?.maxActiveMainSessions !== undefined
      ? String(savedArchive.maxActiveMainSessions)
      : '',
  );
  const [lifecyclePlan, setLifecyclePlan] = useState<SessionLifecyclePlan | null>(null);
  const [lifecycleApplyResult, setLifecycleApplyResult] =
    useState<SessionLifecycleApplyResult | null>(null);
  const [lifecyclePlanning, setLifecyclePlanning] = useState(false);
  const [lifecycleApplying, setLifecycleApplying] = useState(false);
  const [lifecycleSaving, setLifecycleSaving] = useState(false);

  const compactExportAvailable =
    activeSessionId !== null &&
    hostStatus?.capabilities.compaction !== false &&
    hostStatus?.capabilities.sessionExport !== false;
  const lifecycleAvailable = hostStatus?.capabilities.sessionLifecycle !== false;

  useEffect(() => {
    setUseCustomPrompt(walkthrough.enabled);
    setPrompt(walkthrough.custom.prompt);
  }, [walkthrough]);

  useEffect(() => {
    setMaxInactiveDaysDraft(
      savedArchive?.maxInactiveDays !== undefined ? String(savedArchive.maxInactiveDays) : '',
    );
    setMaxActiveMainSessionsDraft(
      savedArchive?.maxActiveMainSessions !== undefined
        ? String(savedArchive.maxActiveMainSessions)
        : '',
    );
    // A config reload invalidates any preview tied to the previous policy.
    setLifecyclePlan(null);
    setLifecycleApplyResult(null);
  }, [savedArchive?.maxInactiveDays, savedArchive?.maxActiveMainSessions]);

  const draft: WalkthroughConfig = useMemo(
    () => ({
      ...createDefaultWalkthroughConfig(),
      enabled: useCustomPrompt,
      autoGenerate: false,
      mode: 'default',
      custom: {
        model: null,
        prompt,
      },
    }),
    [useCustomPrompt, prompt],
  );

  const issues = useMemo(() => validateWalkthroughConfig(draft), [draft]);
  const promptIssue = issues.find((issue) => issue.path === 'walkthrough.custom.prompt');
  const isDirty = useCustomPrompt !== walkthrough.enabled || prompt !== walkthrough.custom.prompt;

  const lifecycleDraft = useMemo(() => {
    const maxInactiveDays = parseOptionalPositiveInt(maxInactiveDaysDraft);
    const maxActiveMainSessions = parseOptionalNonNegativeInt(maxActiveMainSessionsDraft);
    const archive: {
      maxInactiveDays?: number;
      maxActiveMainSessions?: number;
    } = {};
    if (maxInactiveDays !== undefined) {
      archive.maxInactiveDays = maxInactiveDays;
    }
    if (maxActiveMainSessions !== undefined) {
      archive.maxActiveMainSessions = maxActiveMainSessions;
    }
    return Object.keys(archive).length > 0 ? { archive } : undefined;
  }, [maxInactiveDaysDraft, maxActiveMainSessionsDraft]);

  const lifecyclePolicyDirty =
    (savedArchive?.maxInactiveDays ?? undefined) !==
      (lifecycleDraft?.archive.maxInactiveDays ?? undefined) ||
    (savedArchive?.maxActiveMainSessions ?? undefined) !==
      (lifecycleDraft?.archive.maxActiveMainSessions ?? undefined);

  const lifecycleDraftInvalid =
    (maxInactiveDaysDraft.trim().length > 0 &&
      parseOptionalPositiveInt(maxInactiveDaysDraft) === undefined) ||
    (maxActiveMainSessionsDraft.trim().length > 0 &&
      parseOptionalNonNegativeInt(maxActiveMainSessionsDraft) === undefined);

  async function handleSave(): Promise<void> {
    if (!config) return;
    if (issues.length > 0) {
      setInfo(
        isZh
          ? '保存失败：请检查生成提示词是否填全且未超长。'
          : 'Save failed: Check that the generation prompt is non-empty and within size limits.',
      );
      return;
    }
    const next: PiwinConfig = {
      ...config,
      walkthrough: draft,
    };
    if (await saveConfig(next)) {
      setInfo(isZh ? '已保存 Walkthrough 设置。' : 'Walkthrough settings saved.');
    } else {
      setInfo(isZh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  async function handleCompactExport(): Promise<void> {
    if (!activeSessionId || compactExporting) {
      setInfo(
        isZh ? '请先选择一个会话。' : 'Select a session before compacting and exporting.',
        'warning',
      );
      return;
    }

    const defaultName = `piwin-compact-${activeSessionId.slice(0, 8)}.md`;
    const selectedPath = await chooseSessionExportPath({
      title: isZh ? '生成会话摘要' : 'Generate session summary',
      defaultName,
      format: 'md',
    });
    if (selectedPath === null) {
      return;
    }

    setCompactExporting(true);
    setError(null);
    setInfo(isZh ? '正在生成会话摘要…' : 'Generating session summary…');
    try {
      const response = await request({
        type: 'session/compact-export',
        sessionId: activeSessionId,
        ...(selectedPath ? { outputPath: selectedPath } : {}),
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const data = response.data as SessionCompactExportData | undefined;
      const pathLabel = data?.path ?? (isZh ? '会话默认导出目录' : 'the session export directory');
      const sizeLabel = typeof data?.byteLength === 'number' ? ` (${data.byteLength} bytes)` : '';
      setInfo(
        isZh
          ? `已将压缩摘要导出到 ${pathLabel}${sizeLabel}。`
          : `Compressed summary exported to ${pathLabel}${sizeLabel}.`,
        'success',
      );
    } catch (error) {
      setError(formatError(error));
    } finally {
      setCompactExporting(false);
    }
  }

  async function handleSaveLifecyclePolicy(): Promise<void> {
    if (!config || lifecycleDraftInvalid) {
      setInfo(
        isZh
          ? '保存失败：不活跃天数须为正整数；活跃上限须为非负整数；留空表示关闭该规则。'
          : 'Save failed: inactive days must be a positive integer; active limit must be a non-negative integer; leave blank to disable a rule.',
        'warning',
      );
      return;
    }
    setLifecycleSaving(true);
    setError(null);
    try {
      const nextSession = {
        ...(config.session ?? { autoName: true }),
      } as NonNullable<PiwinConfig['session']>;
      if (lifecycleDraft === undefined) {
        delete nextSession.lifecycle;
      } else {
        nextSession.lifecycle = lifecycleDraft;
      }
      const next: PiwinConfig = {
        ...config,
        session: nextSession,
      };
      if (await saveConfig(next)) {
        setLifecyclePlan(null);
        setLifecycleApplyResult(null);
        setInfo(
          isZh
            ? '已保存会话归档策略。预览与应用使用已保存策略，不会自动执行。'
            : 'Session archive policy saved. Plan and apply use the saved policy and never run automatically.',
          'success',
        );
      } else {
        setInfo(isZh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
      }
    } finally {
      setLifecycleSaving(false);
    }
  }

  async function handleLifecyclePlan(): Promise<void> {
    if (lifecyclePlanning || lifecycleApplying) return;
    if (lifecyclePolicyDirty) {
      setInfo(
        isZh
          ? '请先保存归档策略，再生成预览。'
          : 'Save the archive policy before generating a plan.',
        'warning',
      );
      return;
    }
    setLifecyclePlanning(true);
    setError(null);
    setLifecycleApplyResult(null);
    try {
      const response = await request({ type: 'session/lifecycle-plan' });
      if (!response.success) {
        setError(response.error);
        setLifecyclePlan(null);
        return;
      }
      const plan = response.data as SessionLifecyclePlan;
      setLifecyclePlan(plan);
      setInfo(
        isZh
          ? `已生成归档预览：${plan.candidates.length} 个候选。`
          : `Archive plan ready: ${plan.candidates.length} candidate(s).`,
        'success',
      );
    } catch (error) {
      setError(formatError(error));
      setLifecyclePlan(null);
    } finally {
      setLifecyclePlanning(false);
    }
  }

  async function handleLifecycleApply(): Promise<void> {
    if (!lifecyclePlan || lifecyclePlanning || lifecycleApplying) return;
    setLifecycleApplying(true);
    setError(null);
    try {
      const response = await request({
        type: 'session/lifecycle-apply',
        planId: lifecyclePlan.planId,
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const result = response.data as SessionLifecycleApplyResult;
      setLifecycleApplyResult(result);
      setInfo(
        isZh
          ? `归档完成：成功 ${result.archived.length}，跳过 ${result.skipped.length}，失败 ${result.failed.length}。`
          : `Archive apply finished: ${result.archived.length} archived, ${result.skipped.length} skipped, ${result.failed.length} failed.`,
        result.failed.length > 0 ? 'warning' : 'success',
      );
      // Plan ids are single-use; force a fresh preview after apply.
      setLifecyclePlan(null);
    } catch (error) {
      setError(formatError(error));
    } finally {
      setLifecycleApplying(false);
    }
  }

  return (
    <div className="settings-card">
      <div
        className="settings-section settings-section-card"
        data-testid="session-compact-export-section"
      >
        <PageTitle
          title={isZh ? '会话摘要导出' : 'Session summary export'}
          description={
            isZh
              ? '复制当前会话到临时上下文，自动压缩生成摘要并导出为 Markdown。原会话不会被压缩或改写。'
              : 'Copy the current session into a temporary context, reuse Pi compact to create a Markdown summary, and leave the original session unchanged.'
          }
        />
        <FieldRow
          label={isZh ? '生成摘要并导出 Markdown' : 'Generate and export Markdown summary'}
          description={
            activeSessionId
              ? isZh
                ? '选择保存位置后执行；临时副本压缩完成才会写入文件。'
                : 'Choose a save location, then compact a temporary copy. The file is written only after it succeeds.'
              : isZh
                ? '请先在工作区选择一个会话。'
                : 'Select a session in the workspace first.'
          }
          testId="session-compact-export-row"
        >
          <Button
            variant="primary"
            data-testid="session-compact-export-button"
            disabled={!compactExportAvailable || compactExporting}
            onClick={() => void handleCompactExport()}
          >
            {compactExporting
              ? isZh
                ? '生成中…'
                : 'Generating…'
              : isZh
                ? '生成摘要并导出'
                : 'Generate & export'}
          </Button>
        </FieldRow>
      </div>

      <div
        className="settings-section settings-section-card"
        data-testid="session-lifecycle-section"
      >
        <PageTitle
          title={isZh ? '会话归档策略' : 'Session archive policy'}
          description={
            isZh
              ? '先保存策略，再预览候选并显式应用。不会自动归档；忙碌中的会话会被跳过，空闲驻留会话会先挂起再归档。'
              : 'Save the policy, preview candidates, then apply explicitly. Nothing archives automatically. Busy sessions are skipped; idle resident sessions are suspended first.'
          }
        />

        <FieldRow
          label={isZh ? '不活跃天数上限' : 'Max inactive days'}
          description={
            isZh
              ? '正整数。超过该天数未更新的主会话进入候选；留空关闭。'
              : 'Positive integer. Main sessions older than this many days become candidates. Leave blank to disable.'
          }
          testId="session-lifecycle-max-inactive-row"
        >
          <TextInput
            testId="session-lifecycle-max-inactive-days"
            type="number"
            min={1}
            placeholder={isZh ? '关闭' : 'Off'}
            value={maxInactiveDaysDraft}
            onChange={(event) => setMaxInactiveDaysDraft(event.currentTarget.value)}
            disabled={!lifecycleAvailable}
          />
        </FieldRow>

        <FieldRow
          label={isZh ? '活跃主会话数量上限' : 'Max active main sessions'}
          description={
            isZh
              ? '非负整数。保留最新的 N 个未置顶主会话，其余进入候选；0 表示全部候选；留空关闭。'
              : 'Non-negative integer. Keep the newest N unpinned main sessions; the rest become candidates. Zero means all candidates. Leave blank to disable.'
          }
          testId="session-lifecycle-max-active-row"
        >
          <TextInput
            testId="session-lifecycle-max-active-main"
            type="number"
            min={0}
            placeholder={isZh ? '关闭' : 'Off'}
            value={maxActiveMainSessionsDraft}
            onChange={(event) => setMaxActiveMainSessionsDraft(event.currentTarget.value)}
            disabled={!lifecycleAvailable}
          />
        </FieldRow>

        <div className="ui-field-row-control" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <Button
            variant="ghost"
            data-testid="session-lifecycle-save-button"
            disabled={
              !lifecycleAvailable ||
              lifecycleSaving ||
              !lifecyclePolicyDirty ||
              lifecycleDraftInvalid
            }
            onClick={() => void handleSaveLifecyclePolicy()}
          >
            {lifecycleSaving ? (isZh ? '保存中…' : 'Saving…') : isZh ? '保存策略' : 'Save policy'}
          </Button>
          <Button
            data-testid="session-lifecycle-plan-button"
            disabled={
              !lifecycleAvailable ||
              lifecyclePlanning ||
              lifecycleApplying ||
              lifecyclePolicyDirty ||
              lifecycleDraftInvalid
            }
            onClick={() => void handleLifecyclePlan()}
          >
            {lifecyclePlanning
              ? isZh
                ? '预览中…'
                : 'Planning…'
              : isZh
                ? '生成预览'
                : 'Generate plan'}
          </Button>
          <Button
            variant="primary"
            data-testid="session-lifecycle-apply-button"
            disabled={
              !lifecycleAvailable ||
              lifecyclePlanning ||
              lifecycleApplying ||
              lifecyclePlan === null ||
              lifecyclePlan.candidates.length === 0
            }
            onClick={() => void handleLifecycleApply()}
          >
            {lifecycleApplying
              ? isZh
                ? '应用中…'
                : 'Applying…'
              : isZh
                ? '应用归档'
                : 'Apply archive'}
          </Button>
        </div>

        {lifecyclePlan ? (
          <div data-testid="session-lifecycle-plan-preview" className="muted">
            <p>
              {isZh
                ? `预览 ${lifecyclePlan.planId.slice(0, 12)}… · 候选 ${lifecyclePlan.candidates.length} · 跳过置顶 ${lifecyclePlan.skippedPinned} · 跳过非主会话 ${lifecyclePlan.skippedNonMain}`
                : `Plan ${lifecyclePlan.planId.slice(0, 12)}… · ${lifecyclePlan.candidates.length} candidate(s) · skipped pinned ${lifecyclePlan.skippedPinned} · skipped non-main ${lifecyclePlan.skippedNonMain}`}
            </p>
            {lifecyclePlan.candidates.length === 0 ? (
              <p data-testid="session-lifecycle-plan-empty">
                {isZh ? '当前没有可归档的主会话。' : 'No main sessions match the archive policy.'}
              </p>
            ) : (
              <ul data-testid="session-lifecycle-plan-candidates">
                {lifecyclePlan.candidates.map((candidate) => (
                  <li key={candidate.sessionId}>
                    {(candidate.name ?? candidate.sessionId) +
                      ` · ${archiveReasonLabel(candidate.reason, isZh)} · ${candidate.updatedAt}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {lifecycleApplyResult ? (
          <div data-testid="session-lifecycle-apply-result" className="muted">
            <p>
              {isZh
                ? `上次应用：归档 ${lifecycleApplyResult.archived.length} · 跳过 ${lifecycleApplyResult.skipped.length} · 失败 ${lifecycleApplyResult.failed.length}`
                : `Last apply: archived ${lifecycleApplyResult.archived.length} · skipped ${lifecycleApplyResult.skipped.length} · failed ${lifecycleApplyResult.failed.length}`}
            </p>
            {lifecycleApplyResult.skipped.length > 0 ? (
              <ul data-testid="session-lifecycle-apply-skipped">
                {lifecycleApplyResult.skipped.map((item) => (
                  <li key={`${item.sessionId}-${item.reason}`}>
                    {item.sessionId}: {item.reason}
                  </li>
                ))}
              </ul>
            ) : null}
            {lifecycleApplyResult.failed.length > 0 ? (
              <ul data-testid="session-lifecycle-apply-failed">
                {lifecycleApplyResult.failed.map((item) => (
                  <li key={`${item.sessionId}-${item.error}`}>
                    {item.sessionId}: {item.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="settings-section settings-section-card" data-testid="walkthrough-section">
        {config ? (
          <>
            <FieldRow
              label={isZh ? '自定义生成提示词' : 'Custom generation prompt'}
              description={
                isZh
                  ? '开启后使用下方自定义提示词生成 Walkthrough；关闭后使用内置默认提示词。计划完成时始终生成 Walkthrough 卡片，不受此开关影响。'
                  : 'When on, Walkthrough uses the custom prompt below; when off, the built-in default prompt is used. A Walkthrough card is always generated on plan completion.'
              }
              testId="walkthrough-enabled-row"
            >
              <Switch
                checked={useCustomPrompt}
                onCheckedChange={(checked) => setUseCustomPrompt(checked)}
                aria-label={isZh ? '自定义生成提示词' : 'Custom generation prompt'}
                testId="walkthrough-enabled-switch"
              />
            </FieldRow>

            {useCustomPrompt ? (
              <TextArea
                label={isZh ? '生成提示词' : 'Generation prompt'}
                description={
                  isZh
                    ? '生成 Walkthrough 时注入的自定义提示词。'
                    : 'Custom prompt injected when generating a Walkthrough.'
                }
                testId="walkthrough-prompt-textarea"
                rows={12}
                value={prompt}
                onChange={(nextValue) => setPrompt(nextValue)}
                error={promptIssue?.message ?? null}
                placeholder={
                  isZh
                    ? '描述你希望 Walkthrough 如何组织与表述…'
                    : 'Describe how the Walkthrough should be structured…'
                }
                nativeProps={{
                  style: { resize: 'vertical', minHeight: 220 },
                  spellCheck: true,
                }}
              />
            ) : null}

            {isDirty ? (
              <div className="ui-field-row-control" style={{ justifyContent: 'flex-end', gap: 8 }}>
                {useCustomPrompt ? (
                  <Button
                    variant="ghost"
                    data-testid="walkthrough-prompt-reset-button"
                    onClick={() => setPrompt(DEFAULT_WALKTHROUGH_PROMPT)}
                  >
                    {isZh ? '恢复默认提示词' : 'Reset prompt'}
                  </Button>
                ) : null}
                <Button data-testid="walkthrough-save-button" onClick={() => void handleSave()}>
                  {isZh ? '保存' : 'Save'}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">{isZh ? '正在加载配置…' : 'Loading config…'}</p>
        )}
      </div>
    </div>
  );
}

export function SessionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const [activeTab, setActiveTab] = useState<SessionSubTab>('lifecycle');
  useResetSettingsMainScroll(activeTab);

  return (
    <div className="settings-card settings-hub-page session-hub-page" data-testid="settings-session-hub">
      <div className="session-hub-tabs">
        <SegmentedControl
          value={activeTab}
          onChange={(val) => setActiveTab(val as SessionSubTab)}
          data={[
            { value: 'lifecycle', label: isZh ? '会话策略 (Policy & Walkthrough)' : 'Policy & Walkthrough' },
            { value: 'runtime', label: isZh ? '运行时驻留 (Runtime)' : 'Runtime' },
          ]}
          testId="session-subtabs-control"
        />
      </div>

      <div className="session-hub-panels">
        {activeTab === 'lifecycle' ? <SessionLifecycleSection /> : <SessionRuntimePage />}
      </div>
    </div>
  );
}
