/**
 * Settings → Code search (`code_search`).
 *
 * One switch, one engine choice, folded budgets. The engine choice flattens
 * `backend` + Windsurf credential source into a single decision (see
 * `code-search-engine.ts`); Windsurf tokens live in the keychain, never in
 * config. Budgets stay here rather than on the tool so the main agent cannot
 * retune the subagent per call.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  createDefaultCodeSearchConfig,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type CodeSearchConfig,
  type PiwinConfig,
} from '@piwin/contracts';
import { Button, Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { CodeSearchAdvanced, type CodeSearchBudgetDrafts } from '../code-search-advanced';
import {
  DEFAULT_WINDSURF_KEY_ENV,
  applyCodeSearchEngine,
  codeSearchEngine,
  hasStoredWindsurfToken,
} from '../code-search-engine';
import { CodeSearchEnginePicker, type CodeSearchModelOption } from '../code-search-engine-picker';
import { describeCodeSearchStatus } from '../code-search-status';
import { useDevinAccount } from '../use-devin-account';
import { useSettings } from '../settings-context';

function parseOptionalPositiveInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value <= 0) return undefined;
  return value;
}

/** Depth 0 means "auto"; it is a valid value, unlike the other knobs. */
function parseOptionalNonNegativeInt(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const value = Number(trimmed);
  if (!Number.isInteger(value) || value < 0) return undefined;
  return value;
}

function budgetDraftsFrom(config: CodeSearchConfig): CodeSearchBudgetDrafts {
  return {
    turns: config.maxTurns ? String(config.maxTurns) : '',
    commands: config.maxCommands ? String(config.maxCommands) : '',
    results: config.maxResults ? String(config.maxResults) : '',
    depth: config.treeDepth !== undefined ? String(config.treeDepth) : '',
  };
}

/**
 * The numeric fields live in their own text state so a half-typed value cannot
 * reach the config; this folds the parseable ones back in.
 */
function withBudgets(base: CodeSearchConfig, budgets: CodeSearchBudgetDrafts): CodeSearchConfig {
  const next: CodeSearchConfig = { ...base };
  delete next.maxTurns;
  delete next.maxCommands;
  delete next.maxResults;
  delete next.treeDepth;
  const maxTurns = parseOptionalPositiveInt(budgets.turns);
  const maxCommands = parseOptionalPositiveInt(budgets.commands);
  const maxResults = parseOptionalPositiveInt(budgets.results);
  const treeDepth = parseOptionalNonNegativeInt(budgets.depth);
  if (maxTurns !== undefined) next.maxTurns = maxTurns;
  if (maxCommands !== undefined) next.maxCommands = maxCommands;
  if (maxResults !== undefined) next.maxResults = maxResults;
  if (treeDepth !== undefined) next.treeDepth = treeDepth;
  return next;
}

function collectChatModels(config: PiwinConfig | null): CodeSearchModelOption[] {
  if (!config) return [];
  const options: CodeSearchModelOption[] = [];
  for (const provider of config.providers ?? []) {
    if (!isProviderEnabled(provider)) continue;
    for (const model of provider.models) {
      if (!isModelEnabled(model) || !modelSupportsCapability(model, 'chat')) continue;
      options.push({
        ref: { providerId: provider.id, modelId: model.id },
        label: `${model.label ?? model.id} · ${provider.name}`,
      });
    }
  }
  return options;
}

export function CodeSearchPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const settings = useSettings();
  const { config, saving, saveConfig, setInfo, loadProviderSecret, storeProviderSecret, testCodeSearchWindsurf } =
    settings;
  const readOnly = settings.remoteSettingsReadOnly === true;

  const saved = config?.codeSearch ?? createDefaultCodeSearchConfig();
  const [draft, setDraft] = useState<CodeSearchConfig>(saved);
  const [budgets, setBudgets] = useState<CodeSearchBudgetDrafts>(() => budgetDraftsFrom(saved));

  // Re-sync after a save or an external config change.
  useEffect(() => {
    const next = config?.codeSearch ?? createDefaultCodeSearchConfig();
    setDraft(next);
    setBudgets(budgetDraftsFrom(next));
  }, [config]);

  const modelOptions = useMemo(() => collectChatModels(config), [config]);
  const devinAccount = useDevinAccount();
  // Connecting here is the configure gesture, like saving a token: turn the
  // feature on. Only a login completed on this page counts — reading an
  // already-connected account must not undo a deliberate "off".
  const previousDevinState = useRef(devinAccount.state);
  useEffect(() => {
    const before = previousDevinState.current;
    previousDevinState.current = devinAccount.state;
    if (before === 'logging-in' && devinAccount.connected) {
      setDraft((current) => (codeSearchEngine(current) === 'devin' ? { ...current, enabled: true } : current));
    }
  }, [devinAccount.state, devinAccount.connected]);

  const engine = codeSearchEngine(draft);
  const invalidNumber = Boolean(
    (budgets.turns.trim() && parseOptionalPositiveInt(budgets.turns) === undefined) ||
      (budgets.commands.trim() && parseOptionalPositiveInt(budgets.commands) === undefined) ||
      (budgets.results.trim() && parseOptionalPositiveInt(budgets.results) === undefined) ||
      (budgets.depth.trim() && parseOptionalNonNegativeInt(budgets.depth) === undefined),
  );

  function composeCodeSearchConfig(): CodeSearchConfig {
    return withBudgets(draft, budgets);
  }

  // Both sides go through withBudgets so key order cannot fake a change; a
  // half-typed invalid number composes away but is still an edit to resolve.
  const dirty =
    invalidNumber ||
    JSON.stringify(composeCodeSearchConfig()) !== JSON.stringify(withBudgets(saved, budgetDraftsFrom(saved)));
  const persistedEnabled = config?.codeSearch?.enabled === true;

  /** Not save blockers: each can be fixed before or after saving. */
  function describeMissingStep(): string | undefined {
    if (engine === 'devin' && devinAccount.state !== 'unknown' && !devinAccount.connected) {
      return zh ? 'Devin 账号未连接：在下方连接后生效。' : 'Devin account not connected: connect it below.';
    }
    if (engine === 'token' && !hasStoredWindsurfToken(draft)) {
      return zh
        ? `保存 Windsurf Token 后生效（或在 Host 上设置 ${draft.apiKeyEnv ?? DEFAULT_WINDSURF_KEY_ENV}）。`
        : `Save a Windsurf token (or set ${draft.apiKeyEnv ?? DEFAULT_WINDSURF_KEY_ENV} on the Host).`;
    }
    if (engine === 'model' && modelOptions.length === 0) {
      return zh ? '还没有可用的聊天模型：先到「模型」页添加一个。' : 'No chat model yet: add one on the Models page.';
    }
    return undefined;
  }

  const status = describeCodeSearchStatus(
    { enabled: draft.enabled, persistedEnabled, dirty, missingStep: describeMissingStep() },
    zh,
  );

  function patch(changes: Partial<CodeSearchConfig>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  function resetDraft(): void {
    setDraft(saved);
    setBudgets(budgetDraftsFrom(saved));
  }

  async function handleSave(): Promise<void> {
    if (!config || invalidNumber) return;
    const codeSearch = composeCodeSearchConfig();
    if (await saveConfig({ ...config, codeSearch })) {
      setInfo(
        codeSearch.enabled
          ? zh
            ? '已保存：新会话即可使用 code_search。'
            : 'Saved: new sessions get code_search.'
          : zh
            ? '已保存：code_search 已关闭。'
            : 'Saved: code_search is off.',
      );
    } else {
      setInfo(zh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  /** Saving a token is the configure gesture: wire the engine, enable, persist. */
  async function handleTokenSaved(apiKeyRef: string, apiKeyEnv: string): Promise<boolean> {
    const envName =
      apiKeyEnv && /^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv.trim()) ? apiKeyEnv.trim() : DEFAULT_WINDSURF_KEY_ENV;
    const credential: Partial<CodeSearchConfig> = {
      enabled: true,
      backend: 'windsurf',
      apiKeyRef,
      apiKeyEnv: envName,
    };
    patch(credential);
    if (!config) return true;
    const ok = await saveConfig({ ...config, codeSearch: { ...composeCodeSearchConfig(), ...credential } });
    if (ok) {
      setInfo(zh ? 'Token 已保存，code_search 已启用。' : 'Token saved and code_search enabled.');
    }
    return ok;
  }

  const saveBlocker = invalidNumber ? (zh ? '数值需为正整数' : 'Numbers must be positive integers') : null;

  return (
    <div className="settings-card code-search-page" data-testid="settings-code-search">
      <section className="settings-section settings-section-card code-search-hero">
        <PageTitle
          title={zh ? '启用代码搜索' : 'Enable code search'}
          description={
            zh
              ? '让代理派一个只读子代理快速定位相关文件与行号，代替多轮 grep / read。'
              : 'The agent dispatches a read-only subagent to pinpoint relevant files and lines instead of many grep / read rounds.'
          }
          trailing={
            <Switch
              checked={draft.enabled}
              disabled={readOnly}
              onCheckedChange={(checked) => patch({ enabled: checked })}
              aria-label={zh ? '启用 code_search' : 'Enable code_search'}
            />
          }
        />
        <div className="code-search-status" data-tone={status.tone} data-testid="code-search-status" role="status">
          <i className="code-search-status-dot" aria-hidden="true" />
          <span className="code-search-status-title">{status.title}</span>
          <span className="code-search-status-detail">{status.detail}</span>
        </div>
      </section>

      <section className="settings-section settings-section-card">
        <PageTitle
          title={zh ? '搜索引擎' : 'Search engine'}
          description={
            zh
              ? '引擎只负责规划每一轮搜索，命令始终在本机只读执行。'
              : 'The engine only plans each round; commands always run locally and read-only.'
          }
        />
        <CodeSearchEnginePicker
          draft={draft}
          zh={zh}
          readOnly={readOnly}
          account={devinAccount}
          modelOptions={modelOptions}
          onSelectEngine={(next) =>
            setDraft((current) => applyCodeSearchEngine(current, next, devinAccount.connected))
          }
          onSelectModel={(model) =>
            setDraft((current) => {
              const next: CodeSearchConfig = { ...current, backend: 'model' };
              if (model) {
                // Picking a search model is an explicit "I want this feature" gesture.
                next.model = model;
                next.enabled = true;
              } else {
                delete next.model;
              }
              return next;
            })
          }
          loadSecret={loadProviderSecret}
          storeSecret={storeProviderSecret}
          {...(testCodeSearchWindsurf ? { testConnection: testCodeSearchWindsurf } : {})}
          onTokenSaved={handleTokenSaved}
        />
      </section>

      <section className="settings-section settings-section-card">
        <CodeSearchAdvanced
          zh={zh}
          drafts={budgets}
          onDraftChange={(key, value) => setBudgets((current) => ({ ...current, [key]: value }))}
          includeSnippets={draft.includeSnippets ?? true}
          onIncludeSnippetsChange={(checked) => patch({ includeSnippets: checked })}
          invalid={invalidNumber}
        />
      </section>

      {dirty ? (
        <div className="web-tools-actions is-floating" data-testid="code-search-save-bar">
          <div className="web-tools-floating-pill">
            <div
              className={saveBlocker ? 'web-tools-save-status is-error' : 'web-tools-save-status'}
              role="status"
              aria-live="polite"
            >
              {saveBlocker ?? (zh ? '● 有未保存更改' : '● Unsaved changes')}
            </div>
            <Button variant="ghost" size="compact" disabled={saving} onClick={resetDraft}>
              {zh ? '还原' : 'Reset'}
            </Button>
            <Button
              variant="primary"
              size="compact"
              disabled={saving || readOnly || saveBlocker !== null}
              onClick={() => void handleSave()}
              data-testid="code-search-save"
            >
              {saving ? (zh ? '保存中…' : 'Saving…') : zh ? '保存更改' : 'Save changes'}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
