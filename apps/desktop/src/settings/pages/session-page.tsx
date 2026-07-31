/**
 * Settings → Sessions page (Wave 1 migration from SettingsPanel).
 * Auto-compaction default for new sessions + Walkthrough generation config.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createDefaultWalkthroughConfig,
  MAX_WALKTHROUGH_PROMPT_BYTES,
  validateWalkthroughConfig,
  type ModelRef,
  type PiwinConfig,
  type WalkthroughConfig,
  type WalkthroughConfigIssue,
  type WalkthroughMode,
} from '@piwin/contracts';
import { Button, Collapse, Select, Switch, TextArea } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

/** Flatten all providers' models into Select options: `<name> / <label ?? id>`. */
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

function issueFor(
  issues: WalkthroughConfigIssue[],
  path: string,
): WalkthroughConfigIssue | undefined {
  return issues.find((issue) => issue.path === path);
}

export function SessionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { config, saveConfig, setInfo } = useSettings();

  const walkthrough = config?.walkthrough ?? createDefaultWalkthroughConfig();

  // Draft state mirrors the persisted walkthrough block; edits stay local
  // until the user presses Save so switching modes never loses a prompt draft.
  const [enabled, setEnabled] = useState<boolean>(walkthrough.enabled);
  const [mode, setMode] = useState<WalkthroughMode>(walkthrough.mode);
  const [modelValue, setModelValue] = useState<string>(
    walkthrough.custom.model ? JSON.stringify(walkthrough.custom.model) : '',
  );
  const [prompt, setPrompt] = useState<string>(walkthrough.custom.prompt);

  // Re-sync draft when the persisted config changes (e.g. external save).
  useEffect(() => {
    setEnabled(walkthrough.enabled);
    setMode(walkthrough.mode);
    setModelValue(walkthrough.custom.model ? JSON.stringify(walkthrough.custom.model) : '');
    setPrompt(walkthrough.custom.prompt);
  }, [walkthrough]);

  const modelOptions = useMemo(() => (config ? buildModelOptions(config.providers) : []), [config]);

  const draft: WalkthroughConfig = useMemo(() => {
    const selected = modelOptions.find((option) => option.value === modelValue);
    return {
      enabled,
      mode,
      custom: {
        model: selected ? selected.ref : null,
        prompt,
      },
    };
  }, [enabled, mode, modelValue, prompt, modelOptions]);

  const issues = useMemo(() => validateWalkthroughConfig(draft), [draft]);
  const promptIssue = issueFor(issues, 'walkthrough.custom.prompt');
  const modelIssue = issueFor(issues, 'walkthrough.custom.model');

  const hasNoModels = modelOptions.length === 0;

  async function handleToggleAutoCompact(autoEnabledDefault: boolean): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      compaction: {
        autoEnabledDefault,
        writeTranscriptNote: config.compaction?.writeTranscriptNote === true,
      },
    };
    if (await saveConfig(next)) {
      setInfo(
        locale === 'zh-CN'
          ? '已保存自动压缩默认值；新会话将继承此设置。'
          : 'Auto-compaction default saved. New sessions will inherit it.',
      );
    }
  }

  async function handleSaveWalkthrough(): Promise<void> {
    if (!config) return;
    if (issues.length > 0) return;
    const next: PiwinConfig = {
      ...config,
      walkthrough: draft,
    };
    if (await saveConfig(next)) {
      setInfo(locale === 'zh-CN' ? '已保存 Walkthrough 设置。' : 'Walkthrough settings saved.');
    }
  }

  const modeOptions: { value: string; label: string }[] = [
    { value: 'default', label: locale === 'zh-CN' ? '默认' : 'Default' },
    { value: 'custom', label: locale === 'zh-CN' ? '自定义' : 'Custom' },
  ];

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={locale === 'zh-CN' ? '会话与上下文管理' : 'Sessions & Context'}
          description={
            locale === 'zh-CN'
              ? '管理新会话创建时的默认上下文压缩策略与恢复行为。'
              : 'Configure context compaction strategies and defaults for new sessions.'
          }
        />
        {config ? (
          <FieldRow
            label={locale === 'zh-CN' ? '自动上下文压缩默认值' : 'Auto-compaction default'}
            description={
              locale === 'zh-CN'
                ? '新创建的会话默认开启上下文自动压缩，有助于长会话节省 Token 与加速响应。'
                : 'Enable context compaction by default for newly spawned sessions to optimize token usage.'
            }
          >
            <Switch
              checked={config.compaction?.autoEnabledDefault !== false}
              onCheckedChange={(checked) => void handleToggleAutoCompact(checked)}
              aria-label={locale === 'zh-CN' ? '自动上下文压缩' : 'Auto-compaction'}
            />
          </FieldRow>
        ) : null}
      </div>

      <div className="settings-section settings-section-card" data-testid="walkthrough-section">
        <PageTitle
          title={locale === 'zh-CN' ? 'Walkthrough' : 'Walkthrough'}
          description={
            locale === 'zh-CN'
              ? '配置 Walkthrough 生成能力。默认开启，生成由用户主动触发。'
              : 'Configure Walkthrough generation. Enabled by default; generation is user-triggered.'
          }
        />
        {config ? (
          <>
            <FieldRow
              label={locale === 'zh-CN' ? '启用 Walkthrough' : 'Enable Walkthrough'}
              description={
                locale === 'zh-CN'
                  ? '开启后在最终 Assistant 消息上提供生成 Walkthrough 的操作。'
                  : 'When enabled, a Generate Walkthrough action appears on the final assistant message.'
              }
              testId="walkthrough-enabled-row"
            >
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked)}
                aria-label={locale === 'zh-CN' ? '启用 Walkthrough' : 'Enable Walkthrough'}
                testId="walkthrough-enabled-switch"
              />
            </FieldRow>

            <FieldRow
              label={locale === 'zh-CN' ? '生成模式' : 'Generation mode'}
              description={
                locale === 'zh-CN'
                  ? '默认使用 Antigravity 公开结构；自定义可编辑提示词并选择生成模型。'
                  : 'Default uses the Antigravity public structure; Custom lets you edit the prompt and pick the generation model.'
              }
              testId="walkthrough-mode-row"
            >
              <Select
                value={mode}
                testId="walkthrough-mode-select"
                aria-label={locale === 'zh-CN' ? '生成模式' : 'Generation mode'}
                data={modeOptions}
                onChange={(event) => setMode(event.currentTarget.value as WalkthroughMode)}
                style={{ minWidth: 160 }}
              />
            </FieldRow>

            <Collapse expanded={mode === 'custom'} testId="walkthrough-custom-collapse">
              <div className="walkthrough-custom-body">
                {hasNoModels ? (
                  <p className="muted" data-testid="walkthrough-no-models-guide">
                    {locale === 'zh-CN'
                      ? '请先在 设置 → 模型 中添加一个模型。'
                      : 'Add a model in Settings → Models first.'}
                  </p>
                ) : (
                  <FieldRow
                    label={locale === 'zh-CN' ? '生成模型' : 'Generation model'}
                    description={
                      locale === 'zh-CN'
                        ? '从已配置的 Provider 模型中选择生成模型。'
                        : 'Pick a configured provider model to generate walkthroughs.'
                    }
                    testId="walkthrough-model-row"
                  >
                    <div
                      style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 240 }}
                    >
                      <Select
                        value={modelValue}
                        testId="walkthrough-model-select"
                        aria-label={locale === 'zh-CN' ? '生成模型' : 'Generation model'}
                        data={modelOptions.map((option) => ({
                          value: option.value,
                          label: option.label,
                        }))}
                        onChange={(event) => setModelValue(event.currentTarget.value)}
                      />
                      {modelIssue ? (
                        <p
                          className="ui-field-error"
                          role="alert"
                          data-testid="walkthrough-model-error"
                        >
                          {modelIssue.message}
                        </p>
                      ) : null}
                    </div>
                  </FieldRow>
                )}

                <div data-testid="walkthrough-prompt-field">
                  <TextArea
                    label={locale === 'zh-CN' ? '提示词' : 'Prompt'}
                    description={
                      locale === 'zh-CN'
                        ? `最大 ${MAX_WALKTHROUGH_PROMPT_BYTES} 字节（UTF-8）。切换回默认模式会保留草稿。`
                        : `Max ${MAX_WALKTHROUGH_PROMPT_BYTES} bytes (UTF-8). Switching back to Default keeps your draft.`
                    }
                    testId="walkthrough-prompt-textarea"
                    value={prompt}
                    onChange={(value) => setPrompt(value)}
                    rows={10}
                    error={promptIssue ? promptIssue.message : null}
                  />
                </div>

                <div className="ui-field-row-control" style={{ justifyContent: 'flex-end' }}>
                  <Button
                    variant="primary"
                    data-testid="walkthrough-save-button"
                    onClick={() => void handleSaveWalkthrough()}
                    disabled={issues.length > 0}
                  >
                    {locale === 'zh-CN' ? '保存' : 'Save'}
                  </Button>
                </div>
              </div>
            </Collapse>
          </>
        ) : null}
      </div>
    </div>
  );
}
