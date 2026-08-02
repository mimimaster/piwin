/**
 * Settings → WalkThrough page (ADR 0026).
 * - enabled: master generation switch
 * - custom.prompt: editable generation instructions
 * - no autoGenerate, no model picker, no custom mode
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createDefaultWalkthroughConfig,
  DEFAULT_WALKTHROUGH_PROMPT,
  validateWalkthroughConfig,
  type PiwinConfig,
  type WalkthroughConfig,
} from '@piwin/contracts';
import { Button, Field, Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

export function SessionPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { config, saveConfig, setInfo } = useSettings();
  const walkthrough = config?.walkthrough ?? createDefaultWalkthroughConfig();

  const [enabled, setEnabled] = useState<boolean>(walkthrough.enabled);
  const [prompt, setPrompt] = useState<string>(walkthrough.custom.prompt);

  useEffect(() => {
    setEnabled(walkthrough.enabled);
    setPrompt(walkthrough.custom.prompt);
  }, [walkthrough]);

  const draft: WalkthroughConfig = useMemo(
    () => ({
      ...createDefaultWalkthroughConfig(),
      enabled,
      autoGenerate: false,
      mode: 'default',
      custom: {
        model: null,
        prompt,
      },
    }),
    [enabled, prompt],
  );

  const issues = useMemo(() => validateWalkthroughConfig(draft), [draft]);
  const promptIssue = issues.find((issue) => issue.path === 'walkthrough.custom.prompt');

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

  return (
    <div className="settings-card">
      <div className="settings-section settings-section-card" data-testid="walkthrough-section">
        <PageTitle
          title="WalkThrough"
          description={
            isZh
              ? '可选：自定义 Walkthrough 生成提示词。默认关闭，不会在发消息/跑测试后自动生成。'
              : 'Optional: customize the walkthrough generation prompt. Off by default; never auto-runs after chat turns.'
          }
        />
        {config ? (
          <>
            <FieldRow
              label={isZh ? '启用 WalkThrough' : 'Enable WalkThrough'}
              description={
                isZh
                  ? '默认关闭。开启后仅允许手动/CLI 生成；聊天轮次与计划完成都不会自动生成。'
                  : 'Off by default. When on, only manual/CLI generation is allowed; chat turns and plan completion never auto-generate.'
              }
              testId="walkthrough-enabled-row"
            >
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => setEnabled(checked)}
                aria-label={isZh ? '启用 WalkThrough' : 'Enable WalkThrough'}
                testId="walkthrough-enabled-switch"
              />
            </FieldRow>

            <Field
              label={isZh ? '生成提示词' : 'Generation prompt'}
              description={
                isZh
                  ? '生成 WalkThrough 时发给模型的说明。使用当前会话/消息模型，不单独选模型。'
                  : 'Instructions sent when generating a walkthrough. Uses the session/message model (no separate model picker).'
              }
              testId="walkthrough-prompt-field"
            >
              <textarea
                className="mcp-raw-editor"
                rows={12}
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                style={{ resize: 'vertical' }}
                data-testid="walkthrough-prompt-textarea"
                disabled={!enabled}
              />
            </Field>
            {promptIssue ? (
              <p className="muted" data-testid="walkthrough-prompt-error">
                {promptIssue.message}
              </p>
            ) : null}
            <div className="ui-field-row-control" style={{ justifyContent: 'flex-end', gap: 8 }}>
              <Button
                variant="ghost"
                data-testid="walkthrough-prompt-reset-button"
                onClick={() => setPrompt(DEFAULT_WALKTHROUGH_PROMPT)}
                disabled={!enabled}
              >
                {isZh ? '恢复默认提示词' : 'Reset prompt'}
              </Button>
              <Button data-testid="walkthrough-save-button" onClick={() => void handleSave()}>
                {isZh ? '保存' : 'Save'}
              </Button>
            </div>
          </>
        ) : (
          <p className="muted">{isZh ? '正在加载配置…' : 'Loading config…'}</p>
        )}
      </div>
    </div>
  );
}
