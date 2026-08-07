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
  type WalkthroughConfig,
} from '@piwin/contracts';
import { Button, Switch, TextArea } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';
import { chooseSessionExportPath } from '../../session-export-dialog';

export function SessionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const {
    config,
    saveConfig,
    setError,
    setInfo,
    request,
    hostStatus,
    activeSessionId,
  } = useSettings();
  const walkthrough = config?.walkthrough ?? createDefaultWalkthroughConfig();

  const [useCustomPrompt, setUseCustomPrompt] = useState<boolean>(walkthrough.enabled);
  const [prompt, setPrompt] = useState<string>(walkthrough.custom.prompt);
  const [compactExporting, setCompactExporting] = useState(false);

  const compactExportAvailable =
    activeSessionId !== null &&
    hostStatus?.capabilities.compaction !== false &&
    hostStatus?.capabilities.sessionExport !== false;

  useEffect(() => {
    setUseCustomPrompt(walkthrough.enabled);
    setPrompt(walkthrough.custom.prompt);
  }, [walkthrough]);

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
  const isDirty =
    useCustomPrompt !== walkthrough.enabled || prompt !== walkthrough.custom.prompt;

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
      setInfo(isZh ? '已保存 WalkThrough 设置。' : 'WalkThrough settings saved.');
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
      const sizeLabel =
        typeof data?.byteLength === 'number' ? ` (${data.byteLength} bytes)` : '';
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
              ? '复制当前会话到临时上下文，复用 Pi compact 生成摘要并保存为 Markdown。原会话不会被压缩或改写。'
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
