/**
 * Settings → WalkThrough page.
 * - Walkthrough is always generated when a plan completes.
 * - Switch (default on): inject the custom prompt into generation.
 * - Switch off: no prompt injected — model generates freely (Pi norm).
 * - Prompt textarea is always visible and editable.
 * - Save button appears only when the textarea is focused.
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

  const [useCustomPrompt, setUseCustomPrompt] = useState<boolean>(walkthrough.enabled);
  const [prompt, setPrompt] = useState<string>(walkthrough.custom.prompt);
  const [editing, setEditing] = useState<boolean>(false);

  useEffect(() => {
    setUseCustomPrompt(walkthrough.enabled);
    setPrompt(walkthrough.custom.prompt);
    setEditing(false);
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
      setEditing(false);
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
              ? '计划执行完成后自动生成交付文档。'
              : 'A Walkthrough document is generated automatically when a plan completes.'
          }
        />
        {config ? (
          <>
            <FieldRow
              label={isZh ? '自定义生成提示词' : 'Custom generation prompt'}
              description={
                isZh
                  ? '开启后，下方提示词会注入到 Walkthrough 生成中。关闭后不注入任何提示词，模型根据证据自由生成。计划完成时始终生成 Walkthrough，不受此开关影响。'
                  : 'When on, the prompt below is injected into Walkthrough generation. When off, no prompt is injected — the model generates freely from the evidence. Walkthrough is always generated on plan completion regardless of this setting.'
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

            <Field
              label={isZh ? '生成提示词' : 'Generation prompt'}
              description={
                isZh
                  ? '生成 Walkthrough 时使用的提示词。'
                  : 'Prompt used when generating a Walkthrough.'
              }
              testId="walkthrough-prompt-field"
            >
              <textarea
                className="mcp-raw-editor"
                rows={12}
                value={prompt}
                onChange={(event) => setPrompt(event.currentTarget.value)}
                onFocus={() => setEditing(true)}
                style={{ resize: 'vertical' }}
                data-testid="walkthrough-prompt-textarea"
              />
            </Field>
            {promptIssue ? (
              <p className="muted" data-testid="walkthrough-prompt-error">
                {promptIssue.message}
              </p>
            ) : null}
            {editing ? (
              <div className="ui-field-row-control" style={{ justifyContent: 'flex-end', gap: 8 }}>
                <Button
                  variant="ghost"
                  data-testid="walkthrough-prompt-reset-button"
                  onClick={() => setPrompt(DEFAULT_WALKTHROUGH_PROMPT)}
                >
                  {isZh ? '恢复默认提示词' : 'Reset prompt'}
                </Button>
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
