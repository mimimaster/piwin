/**
 * Settings → Code search (`code_search`).
 *
 * Mirrors how Web search selects a backend: pick where the search subagent's
 * reasoning runs, then prove it is usable. `model` needs a configured chat
 * model; `windsurf` needs a Windsurf/Devin token stored in the keychain (never
 * written to config). Loop knobs stay collapsed — the main agent must not be
 * able to retune the subagent per call.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  createDefaultCodeSearchConfig,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type CodeSearchConfig,
  type ModelRef,
  type PiwinConfig,
} from '@piwin/contracts';
import {
  Button,
  SegmentedControl,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { PageTitle } from '../page-title';
import {
  CodeSearchWindsurfCredentials,
  DEFAULT_WINDSURF_KEY_ENV,
  DEVIN_ACCOUNT_REF,
  windsurfCredentialSource,
  type WindsurfCredentialSource,
} from '../code-search-windsurf-credentials';
import { useDevinAccount } from '../use-devin-account';
import { useSettings } from '../settings-context';


type ModelOption = {
  ref: ModelRef;
  label: string;
};

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

function collectChatModels(config: PiwinConfig | null): ModelOption[] {
  if (!config) return [];
  const options: ModelOption[] = [];
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

function describeDraftIssue(draft: CodeSearchConfig, zh: boolean): string | undefined {
  if (!draft.enabled) return undefined;
  if ((draft.backend ?? 'model') === 'windsurf') {
    if (!draft.apiKeyRef && !draft.apiKeyEnv) {
      return zh
        ? 'Windsurf 后端需要填入 token（或填写环境变量名）。'
        : 'The Windsurf backend needs a token (or an environment variable name).';
    }
    return undefined;
  }
  return undefined;
}

export function CodeSearchPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const zh = locale === 'zh-CN';
  const settings = useSettings();
  const { config, saveConfig, setInfo, loadProviderSecret, storeProviderSecret, testCodeSearchWindsurf } = settings;

  const saved = config?.codeSearch ?? createDefaultCodeSearchConfig();
  const [draft, setDraft] = useState<CodeSearchConfig>(saved);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [turnDraft, setTurnDraft] = useState(saved.maxTurns ? String(saved.maxTurns) : '');
  const [commandDraft, setCommandDraft] = useState(saved.maxCommands ? String(saved.maxCommands) : '');
  const [resultDraft, setResultDraft] = useState(saved.maxResults ? String(saved.maxResults) : '');
  const [depthDraft, setDepthDraft] = useState(
    saved.treeDepth !== undefined ? String(saved.treeDepth) : '',
  );

  // Re-sync after a save or an external config change.
  useEffect(() => {
    const next = config?.codeSearch ?? createDefaultCodeSearchConfig();
    setDraft(next);
    setTurnDraft(next.maxTurns ? String(next.maxTurns) : '');
    setCommandDraft(next.maxCommands ? String(next.maxCommands) : '');
    setResultDraft(next.maxResults ? String(next.maxResults) : '');
    setDepthDraft(next.treeDepth !== undefined ? String(next.treeDepth) : '');
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
      setDraft((current) =>
        current.backend === 'windsurf' && windsurfCredentialSource(current) === 'devin'
          ? { ...current, enabled: true }
          : current,
      );
    }
  }, [devinAccount.state, devinAccount.connected]);
  const backend = draft.backend ?? 'model';
  const issue = describeDraftIssue(draft, zh);
  // Not a save blocker: the account can be connected before or after saving.
  const accountIssue =
    backend === 'windsurf' &&
    windsurfCredentialSource(draft) === 'devin' &&
    devinAccount.state !== 'unknown' &&
    !devinAccount.connected;
  const invalidNumber =
    (turnDraft.trim() && parseOptionalPositiveInt(turnDraft) === undefined) ||
    (commandDraft.trim() && parseOptionalPositiveInt(commandDraft) === undefined) ||
    (resultDraft.trim() && parseOptionalPositiveInt(resultDraft) === undefined) ||
    (depthDraft.trim() && parseOptionalNonNegativeInt(depthDraft) === undefined);
  /**
   * The numeric fields live in their own text state so a half-typed value cannot
   * reach the config, which means the dirty check has to compare the *composed*
   * result rather than the object draft.
   */
  function composeCodeSearchConfig(): CodeSearchConfig {
    const next: CodeSearchConfig = { ...draft };
    delete next.maxTurns;
    delete next.maxCommands;
    delete next.maxResults;
    delete next.treeDepth;
    const maxTurns = turnDraft.trim() ? parseOptionalPositiveInt(turnDraft) : undefined;
    const maxCommands = commandDraft.trim() ? parseOptionalPositiveInt(commandDraft) : undefined;
    const maxResults = resultDraft.trim() ? parseOptionalPositiveInt(resultDraft) : undefined;
    const treeDepth = depthDraft.trim() ? parseOptionalNonNegativeInt(depthDraft) : undefined;
    if (maxTurns !== undefined) next.maxTurns = maxTurns;
    if (maxCommands !== undefined) next.maxCommands = maxCommands;
    if (maxResults !== undefined) next.maxResults = maxResults;
    if (treeDepth !== undefined) next.treeDepth = treeDepth;
    return next;
  }

  const dirty = JSON.stringify(composeCodeSearchConfig()) !== JSON.stringify(saved);
  const persistedEnabled = config?.codeSearch?.enabled === true;
  const draftReady = draft.enabled === true && !issue && !invalidNumber;

  function patch(changes: Partial<CodeSearchConfig>): void {
    setDraft((current) => ({ ...current, ...changes }));
  }

  /** Switching source only edits the draft; the bottom Save persists it. */
  function selectCredentialSource(source: WindsurfCredentialSource): void {
    setDraft((current) => {
      const next: CodeSearchConfig = { ...current };
      if (source === 'devin') {
        next.apiKeyRef = DEVIN_ACCOUNT_REF;
        delete next.apiKeyEnv;
        if (devinAccount.connected) next.enabled = true;
      } else if (next.apiKeyRef === DEVIN_ACCOUNT_REF) {
        delete next.apiKeyRef;
        next.apiKeyEnv = DEFAULT_WINDSURF_KEY_ENV;
      }
      return next;
    });
  }

  async function handleSave(): Promise<void> {
    if (!config) return;
    if (invalidNumber) {
      setInfo(zh ? '保存失败：数值项必须是正整数。' : 'Save failed: numeric fields must be positive integers.');
      return;
    }
    if (issue) {
      setInfo(zh ? `保存失败：${issue}` : `Save failed: ${issue}`);
      return;
    }
    const codeSearch = composeCodeSearchConfig();
    if (await saveConfig({ ...config, codeSearch })) {
      setInfo(
        zh
          ? codeSearch.enabled
            ? '已保存。请等本轮结束或开新会话后再试 code_search。'
            : '已保存（未启用：会话不会注册 code_search）。'
          : codeSearch.enabled
            ? 'Saved. Wait for this run to end or open a new session, then try code_search.'
            : 'Saved (disabled: sessions will not register code_search).',
      );
    } else {
      setInfo(zh ? '保存失败：无法写入配置文件。' : 'Save failed: could not write config.');
    }
  }

  return (
    <div className="settings-card" data-testid="settings-code-search">
      <section className="settings-section settings-section-card">
        <PageTitle
          title={zh ? '代码搜索' : 'Code search'}
          description={
            zh
              ? 'code_search 与 grep / read 同级：在后台运行只读搜索子代理，返回相关文件与行号范围。'
              : 'code_search sits alongside grep / read: a read-only search subagent returns relevant files and line ranges.'
          }
        />
        <FieldRow
          label={zh ? '启用 code_search' : 'Enable code_search'}
          description={
            zh
              ? '开启后工具与“优先搜索”指引会进入会话；关闭则两者都不出现。'
              : 'When on, the tool and its prefer-first guidance enter the session; when off, neither appears.'
          }
        >
          <Switch
            checked={draft.enabled}
            onCheckedChange={(checked) => patch({ enabled: checked })}
            aria-label={zh ? '启用 code_search' : 'Enable code_search'}
          />
        </FieldRow>
        <div
          className={`code-search-status${draft.enabled && draftReady && !accountIssue ? (persistedEnabled ? ' is-ready' : ' is-pending') : ' is-blocked'}`}
          data-testid="code-search-status"
          role="status"
        >
          {!draft.enabled ? (
            zh ? (
              <>
                当前关闭：只配置 Token / 模型还不够，会话中不会出现 <code>code_search</code>。
                {backend !== 'windsurf'
                  ? '选择搜索模型时会自动打开；或手动打开后再点底部「保存」。'
                  : windsurfCredentialSource(draft) === 'devin'
                    ? '连接 Devin 账号后会自动打开此开关；或手动打开后再点底部「保存」。'
                    : '保存 API Key 时会自动打开此开关；或手动打开后再点底部「保存」。'}
              </>
            ) : (
              <>
                Off: a token/model alone is not enough — sessions will not get <code>code_search</code>.
                {backend !== 'windsurf'
                  ? ' Picking a search model turns this on; or flip it and click Save below.'
                  : windsurfCredentialSource(draft) === 'devin'
                    ? ' Connecting the Devin account turns this on; or flip it and click Save below.'
                    : ' Saving the API key turns this on automatically; or flip it and click Save below.'}
              </>
            )
          ) : issue ? (
            zh ? <>已开启，但后端未就绪：{issue}</> : <>Enabled, but the backend is not ready: {issue}</>
          ) : accountIssue ? (
            zh ? (
              <>已开启，但 Devin 账号未连接：连接后会话里才会出现 <code>code_search</code>。</>
            ) : (
              <>Enabled, but the Devin account is not connected: <code>code_search</code> appears once it is.</>
            )
          ) : !persistedEnabled ? (
            zh ? (
              <>草稿已可保存，但 Host 配置中尚未启用。点击下方「保存」写入；若提示 Host 不支持，需更新并重启 Host。</>
            ) : (
              <>Draft is ready, but the Host config does not yet have it enabled. Click Save below. If save says the Host cannot persist Code search, update and restart the Host.</>
            )
          ) : (
            zh ? (
              <>已写入 Host。本轮任务结束后运行时将自动更新，或新建会话使用；之后工具列表中将出现 <code>code_search</code>。</>
            ) : (
              <>Persisted on the Host. After the current run ends (or in a new session), <code>code_search</code> should appear in the tool list.</>
            )
          )}
        </div>
      </section>

      <section className="settings-section settings-section-card">
        <PageTitle
          title={zh ? '推理后端' : 'Reasoning backend'}
          description={
            zh
              ? '两种后端的本地命令执行一致，仅下一轮搜索的规划方式不同。'
              : 'Local command execution is identical either way; only who plans the next search round changes.'
          }
        />
        <FieldRow
          label={zh ? '后端' : 'Backend'}
          description={
            zh
              ? '默认使用已配置的模型；也可以用 Devin 账号或 Windsurf Token 走云端服务。'
              : 'Default uses a configured model; or use the Devin account / a Windsurf token for the cloud service.'
          }
        >
          <SegmentedControl
            value={backend}
            onChange={(value) => {
              const nextBackend = value as NonNullable<CodeSearchConfig['backend']>;
              const ready =
                nextBackend === 'windsurf'
                  ? windsurfCredentialSource(draft) === 'token' || devinAccount.connected
                  : Boolean(draft.model);
              patch({
                backend: nextBackend,
                ...(ready ? { enabled: true } : {}),
              });
            }}
            data={[
              { value: 'model', label: zh ? '已配置模型' : 'Configured model' },
              { value: 'windsurf', label: zh ? 'Windsurf 云端' : 'Windsurf cloud' },
            ]}
            aria-label={zh ? '推理后端' : 'Reasoning backend'}
          />
        </FieldRow>

        {backend === 'model' ? (
          <FieldRow
            label={zh ? '搜索模型' : 'Search model'}
            description={
              zh
                ? '建议使用延迟低、TPS 快的模型。'
                : 'Prefer a low-latency, high-TPS model.'
            }
          >
            <select
              className="settings-select"
              value={draft.model ? `${draft.model.providerId}/${draft.model.modelId}` : ''}
              onChange={(event) => {
                const found = modelOptions.find(
                  (option) => `${option.ref.providerId}/${option.ref.modelId}` === event.target.value,
                );
                // Picking a search model is an explicit "I want this feature" gesture.
                patch(found ? { model: found.ref, enabled: true, backend: 'model' } : {});
              }}
              aria-label={zh ? '搜索模型' : 'Search model'}
              data-testid="code-search-model"
            >
              <option value="">{zh ? '请选择…' : 'Select…'}</option>
              {modelOptions.map((option) => (
                <option
                  key={`${option.ref.providerId}/${option.ref.modelId}`}
                  value={`${option.ref.providerId}/${option.ref.modelId}`}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </FieldRow>
        ) : (
          <CodeSearchWindsurfCredentials
            draft={draft}
            zh={zh}
            readOnly={settings.remoteSettingsReadOnly === true}
            account={devinAccount}
            onSelectSource={selectCredentialSource}
            loadSecret={loadProviderSecret}
            storeSecret={storeProviderSecret}
            {...(testCodeSearchWindsurf ? { testConnection: testCodeSearchWindsurf } : {})}
            onTokenSaved={async (apiKeyRef, apiKeyEnv) => {
              // Saving a Windsurf token is the configure gesture: wire the backend
              // AND flip the feature on so the tool actually registers. A bare
              // key with enabled=false is what made "I already configured it"
              // still produce sessions without code_search.
              const envName =
                apiKeyEnv && /^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv.trim())
                  ? apiKeyEnv.trim()
                  : DEFAULT_WINDSURF_KEY_ENV;
              const next: CodeSearchConfig = {
                ...composeCodeSearchConfig(),
                enabled: true,
                backend: 'windsurf',
                apiKeyRef,
                apiKeyEnv: envName,
              };
              // Drop any accidental plaintext that once lived in apiKeyEnv.
              patch({
                enabled: true,
                backend: 'windsurf',
                apiKeyRef,
                apiKeyEnv: envName,
              });
              if (!config) {
                return true;
              }
              const ok = await saveConfig({ ...config, codeSearch: next });
              if (ok) {
                setInfo(
                  zh
                    ? 'Token 已保存并已启用 code_search。请开新会话或等本轮结束后试用。'
                    : 'Token saved and code_search enabled. Open a new session (or wait for this run to end) to use it.',
                );
              }
              return ok;
            }}
          />
        )}
      </section>

      <section className="settings-section settings-section-card">
        <PageTitle
          title={zh ? '高级设置' : 'Advanced'}
          description={
            zh
              ? '搜索循环的执行限额。默认值已做优化，通常无需调整。'
              : 'Budgets for the search loop. Defaults follow the reference implementation and rarely need changing.'
          }
        />
        <FieldRow label={zh ? '高级搜索参数' : 'Adjust budgets'}>
          <Button variant="ghost" onClick={() => setAdvancedOpen((current) => !current)}>
            {advancedOpen ? (zh ? '收起' : 'Hide') : zh ? '展开' : 'Show'}
          </Button>
        </FieldRow>
        {advancedOpen ? (
          <>
            <FieldRow label={zh ? '搜索轮数' : 'Search rounds'} description={zh ? '默认 3' : 'Default 3'}>
              <TextInput
                testId="code-search-max-turns"
                type="number"
                min={1}
                value={turnDraft}
                onChange={(event) => setTurnDraft(event.currentTarget.value)}
              />
            </FieldRow>
            <FieldRow
              label={zh ? '每轮命令数' : 'Commands per round'}
              description={zh ? '默认 8' : 'Default 8'}
            >
              <TextInput
                testId="code-search-max-commands"
                type="number"
                min={1}
                value={commandDraft}
                onChange={(event) => setCommandDraft(event.currentTarget.value)}
              />
            </FieldRow>
            <FieldRow
              label={zh ? '最多返回文件' : 'Max files returned'}
              description={zh ? '默认 10' : 'Default 10'}
            >
              <TextInput
                testId="code-search-max-results"
                type="number"
                min={1}
                value={resultDraft}
                onChange={(event) => setResultDraft(event.currentTarget.value)}
              />
            </FieldRow>
            <FieldRow
              label={zh ? '目录树深度' : 'Repo map depth'}
              description={zh ? '默认 3；0 表示自动' : 'Default 3; 0 means auto'}
            >
              <TextInput
                testId="code-search-tree-depth"
                type="number"
                min={0}
                value={depthDraft}
                onChange={(event) => setDepthDraft(event.currentTarget.value)}
              />
            </FieldRow>
            <FieldRow
              label={zh ? '包含代码片段' : 'Include code snippets'}
              description={
                zh
                  ? '关闭后只返回文件路径与行号范围。'
                  : 'When off, only file paths and line ranges are returned.'
              }
            >
              <Switch
                checked={draft.includeSnippets ?? true}
                onCheckedChange={(checked) => patch({ includeSnippets: checked })}
                aria-label={zh ? '包含代码片段' : 'Include code snippets'}
              />
            </FieldRow>
          </>
        ) : null}
      </section>

      {dirty ? (
        <section className="settings-section settings-section-card">
          <Button variant="primary" onClick={() => void handleSave()}>
            {zh ? '保存' : 'Save'}
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setDraft(saved);
              setAdvancedOpen(false);
            }}
          >
            {zh ? '还原' : 'Reset'}
          </Button>
          {issue ? (
            <p className="settings-hint">{issue}</p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
