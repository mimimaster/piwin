/**
 * Settings → Artifact page.
 *
 * Controls:
 * - Enable Artifact (master switch, stored in ~/.piwin/config.json)
 * - Trigger mode (automatic / explicit-only)
 * - Decision prompt (default / custom)
 * - Code-first display (Inline-only localStorage preference; Canvas still auto-opens)
 * - Max bytes (advanced)
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  createDefaultArtifactConfig,
  createDefaultArtifactScopes,
  DEFAULT_ARTIFACT_DECISION_PROMPT,
  resolveArtifactDecisionPrompt,
  type ArtifactConfig,
  type ArtifactPromptMode,
  type ArtifactScopeKey,
  type ArtifactScopesConfig,
  type ArtifactSurfaceSwitches,
  type ArtifactTriggerMode,
  type PiwinConfig,
} from '@piwin/contracts';
import { Button, SegmentedControl, Switch, TextArea } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { settingsSavedWithEffect } from '../../settings-effect-copy.js';
import { FieldRow } from '../field-row';
import { useSettings } from '../settings-context';
import { ArtifactAdvancedSettings } from './artifact-advanced-settings';
import { ArtifactScopeTree } from './artifact-scope-tree';

export function ArtifactPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const { config, saveConfig, preferences, onPreferencesChange, setInfo } = useSettings();

  // Stable default — useMemo prevents a new object on every render when
  // config is null, which would cause useEffect to fire infinitely.
  const defaultArtifactConfig = useMemo(() => createDefaultArtifactConfig(), []);
  const artifactConfig = config?.artifact ?? defaultArtifactConfig;

  const [enabled, setEnabled] = useState<boolean>(artifactConfig.enabled);
  // Missing scopes (older config, Host not loaded) read as the shipped default,
  // so the tree always shows the effective state.
  const [scopes, setScopes] = useState<ArtifactScopesConfig>(() =>
    artifactConfig.scopes ?? createDefaultArtifactScopes(),
  );
  const [triggerMode, setTriggerMode] = useState<ArtifactTriggerMode>(artifactConfig.triggerMode);
  const [promptMode, setPromptMode] = useState<ArtifactPromptMode>(
    artifactConfig.decisionPrompt.mode,
  );
  const [customPrompt, setCustomPrompt] = useState<string>(
    artifactConfig.decisionPrompt.customPrompt,
  );
  const [maxBytes, setMaxBytes] = useState<number>(artifactConfig.maxBytes);
  const [blockExternalScripts, setBlockExternalScripts] = useState<boolean>(
    artifactConfig.blockExternalScripts !== false,
  );
  const [blockExternalResources, setBlockExternalResources] = useState<boolean>(
    artifactConfig.blockExternalResources !== false,
  );
  const [editing, setEditing] = useState<boolean>(false);

  useEffect(() => {
    setEnabled(artifactConfig.enabled);
    setScopes(artifactConfig.scopes ?? createDefaultArtifactScopes());
    setTriggerMode(artifactConfig.triggerMode);
    setPromptMode(artifactConfig.decisionPrompt.mode);
    setCustomPrompt(artifactConfig.decisionPrompt.customPrompt);
    setMaxBytes(artifactConfig.maxBytes);
    setBlockExternalScripts(artifactConfig.blockExternalScripts !== false);
    setBlockExternalResources(artifactConfig.blockExternalResources !== false);
    setEditing(false);
  }, [artifactConfig]);

  const draft: ArtifactConfig = useMemo(
    () => ({
      enabled,
      scopes,
      triggerMode,
      decisionPrompt: {
        mode: promptMode,
        customPrompt,
      },
      maxBytes,
      blockExternalScripts,
      blockExternalResources,
    }),
    [
      enabled,
      scopes,
      triggerMode,
      promptMode,
      customPrompt,
      maxBytes,
      blockExternalScripts,
      blockExternalResources,
    ],
  );

  async function handleSave(): Promise<void> {
    if (!config) return;
    const next: PiwinConfig = {
      ...config,
      artifact: draft,
    };
    if (await saveConfig(next)) {
      setInfo(
        settingsSavedWithEffect(locale, 'next-session', isZh ? 'Artifact 设置' : 'Artifact settings'),
        'success',
      );
      setEditing(false);
    } else {
      setInfo(isZh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  const effectivePrompt = resolveArtifactDecisionPrompt(draft);

  return (
    <div className="settings-card" data-testid="settings-artifact">
      <div className="settings-section settings-section-card">
        {config ? (
          <>
            <FieldRow
              label={isZh ? '启用 Artifact' : 'Enable Artifact'}
              description={
                isZh
                  ? '总开关。关闭后所有会话都不再生成和渲染 Artifact，Agent 使用 Markdown 和普通代码块回答；分类与 Inline/Canvas 的选择会保留。'
                  : 'Master switch. When off, no session generates or renders Artifacts and the agent uses Markdown and ordinary code blocks. Your per-class and per-surface choices are kept.'
              }
              testId="artifact-enabled-row"
            >
              <Switch
                checked={enabled}
                onCheckedChange={(checked) => {
                  setEnabled(checked);
                  setEditing(true);
                }}
                aria-label={isZh ? '启用 Artifact' : 'Enable Artifact'}
                testId="artifact-enabled-switch"
              />
            </FieldRow>

            {enabled ? (
              <>
                <ArtifactScopeTree
                  scopes={scopes}
                  isZh={isZh}
                  onChange={(
                    scopeKey: ArtifactScopeKey,
                    surface: keyof ArtifactSurfaceSwitches,
                    value: boolean,
                  ) => {
                    setScopes((current) => ({
                      ...current,
                      [scopeKey]: { ...current[scopeKey], [surface]: value },
                    }));
                    setEditing(true);
                  }}
                />

                <FieldRow
                  label={isZh ? '触发模式' : 'Trigger mode'}
                  description={
                    isZh
                      ? '自动判断：Agent 根据内容价值自动选择 Markdown 或 Artifact。仅明确要求：只有用户明确要求时才使用 Artifact。'
                      : 'Automatic: the agent decides based on content value. Explicit-only: artifacts only when the user explicitly requests one.'
                  }
                  testId="artifact-trigger-mode-row"
                >
                  <SegmentedControl
                    value={triggerMode}
                    onChange={(value) => {
                      setTriggerMode(value as ArtifactTriggerMode);
                      setEditing(true);
                    }}
                    data={[
                      { value: 'automatic', label: isZh ? '自动判断' : 'Automatic' },
                      { value: 'explicit-only', label: isZh ? '仅明确要求' : 'Explicit only' },
                    ]}
                  />
                </FieldRow>

                <FieldRow
                  label={isZh ? '决策策略' : 'Decision policy'}
                  description={
                    isZh
                      ? '默认策略由 piwin 维护，随版本升级自动更新。自定义策略使用你编写的提示词替代默认决策规则。'
                      : 'The default policy is maintained by piwin and upgrades automatically. Custom policy replaces the default decision rules with your text.'
                  }
                  testId="artifact-prompt-mode-row"
                >
                  <SegmentedControl
                    value={promptMode}
                    onChange={(value) => {
                      const next = value as ArtifactPromptMode;
                      setPromptMode(next);
                      if (next === 'custom') {
                        setCustomPrompt((current) =>
                          current.trim() === '' ? DEFAULT_ARTIFACT_DECISION_PROMPT : current,
                        );
                      }
                      setEditing(true);
                    }}
                    data={[
                      { value: 'default', label: isZh ? '默认策略' : 'Default' },
                      { value: 'custom', label: isZh ? '自定义' : 'Custom' },
                    ]}
                    testId="artifact-prompt-mode-control"
                  />
                </FieldRow>

                {promptMode === 'custom' ? (
                  <div className="ui-field" data-testid="artifact-custom-prompt-field">
                    <TextArea
                      label={isZh ? '自定义决策提示词' : 'Custom decision prompt'}
                      description={
                        isZh
                          ? '替换默认的 Artifact 触发与 surface 路由规则。留空时回退到默认策略。运行时契约（主题变量、布局约束）始终注入，不受此设置影响。'
                          : 'Replaces the default artifact trigger and surface routing rules. Empty falls back to default. The runtime contract (theme variables, layout constraints) is always injected regardless.'
                      }
                      rows={14}
                      value={customPrompt}
                      onChange={(nextValue) => {
                        setCustomPrompt(nextValue);
                        setEditing(true);
                      }}
                      testId="artifact-custom-prompt-textarea"
                    />
                  </div>
                ) : null}

                <details
                  style={{ marginTop: 8, marginBottom: 8 }}
                  data-testid="artifact-effective-prompt-preview"
                >
                  <summary
                    style={{ cursor: 'pointer', fontSize: '0.85em', opacity: 0.7 }}
                  >
                    {isZh ? '查看当前有效决策提示词' : 'View effective decision prompt'}
                  </summary>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontSize: '0.8em',
                      opacity: 0.6,
                      maxHeight: '300px',
                      overflow: 'auto',
                      padding: '8px',
                      background: 'var(--piwin-surface-2, rgba(0,0,0,0.03))',
                      borderRadius: '6px',
                      marginTop: '8px',
                    }}
                  >
                    {effectivePrompt}
                  </pre>
                </details>

                {promptMode === 'custom' ? (
                  <div
                    className="ui-field-row-control"
                    style={{ justifyContent: 'flex-end', gap: 8 }}
                  >
                    <Button
                      variant="ghost"
                      data-testid="artifact-prompt-copy-default"
                      onClick={() => {
                        setCustomPrompt(DEFAULT_ARTIFACT_DECISION_PROMPT);
                        setEditing(true);
                      }}
                    >
                      {isZh ? '复制默认策略' : 'Copy default'}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}

            <FieldRow
              label={isZh ? '代码优先' : 'Code-first mode'}
              description={
                isZh
                  ? '仅影响 Inline Artifact：默认展示源代码，并提供 Preview 切换。显式 Canvas 仍会在回复完成后自动打开。'
                  : 'Inline only: show artifact source first with a Preview toggle. Explicit Canvas still auto-opens when the reply completes.'
              }
              testId="artifact-code-first-row"
            >
              <Switch
                checked={preferences.artifactCodeFirst}
                onCheckedChange={(checked) => {
                  onPreferencesChange({
                    ...preferences,
                    artifactCodeFirst: checked,
                  });
                }}
                aria-label={isZh ? '代码优先' : 'Code-first mode'}
                testId="artifact-code-first-switch"
              />
            </FieldRow>

            <ArtifactAdvancedSettings
              isZh={isZh}
              blockExternalScripts={blockExternalScripts}
              blockExternalResources={blockExternalResources}
              maxBytes={maxBytes}
              onBlockExternalScriptsChange={(checked) => {
                setBlockExternalScripts(checked);
                setEditing(true);
              }}
              onBlockExternalResourcesChange={(checked) => {
                setBlockExternalResources(checked);
                setEditing(true);
              }}
              onMaxBytesChange={(value) => {
                setMaxBytes(value);
                setEditing(true);
              }}
            />

            {editing ? (
              <div
                className="ui-field-row-control"
                style={{ justifyContent: 'flex-end', gap: 8, marginTop: 8 }}
              >
                <Button
                  variant="ghost"
                  data-testid="artifact-reset-button"
                  onClick={() => {
                    setEnabled(artifactConfig.enabled);
                    setScopes(artifactConfig.scopes ?? createDefaultArtifactScopes());
                    setTriggerMode(artifactConfig.triggerMode);
                    setPromptMode(artifactConfig.decisionPrompt.mode);
                    setCustomPrompt(artifactConfig.decisionPrompt.customPrompt);
                    setMaxBytes(artifactConfig.maxBytes);
                    setBlockExternalScripts(artifactConfig.blockExternalScripts !== false);
                    setBlockExternalResources(artifactConfig.blockExternalResources !== false);
                    setEditing(false);
                  }}
                >
                  {isZh ? '取消' : 'Cancel'}
                </Button>
                <Button
                  data-testid="artifact-save-button"
                  onClick={() => void handleSave()}
                >
                  {isZh ? '保存' : 'Save'}
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">
            {isZh ? '正在加载配置…' : 'Loading configuration…'}
          </p>
        )}
      </div>
    </div>
  );
}
