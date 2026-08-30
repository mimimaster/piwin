/**
 * Settings → Web tools page.
 * Multi-select search sources + web_fetch. Draft state lives in settings context.
 */
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  DEFAULT_SEARCH_ROUTE_POLICY,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type ModelRef,
  type SearchRoutePolicy,
  type SearchRoutePreviewData,
  type SearchRoutePreviewInput,
  createDefaultWebConfig,
  type WebSearchSourceKind,
} from '@piwin/contracts';
import {
  Button,
  Field,
  Notice,
  SegmentedControl,
  Select,
  Switch,
  TextArea,
  TextInput,
} from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { SearchRouteStatus } from '../search-route-status';
import { useSettings } from '../settings-context';
import { WebSecretEditor } from '../web-secret-editor';
import { CLI_SEARCH_EXAMPLES, formatCliSearchExample } from '../cli-search-examples';
import { createDraftSearchSource, draftToWeb, type DraftSearchSource } from '../web-draft';

const SOURCE_KIND_OPTIONS: Array<{
  id: Exclude<WebSearchSourceKind, 'searxng'>;
  title: string;
  description: string;
  descriptionZh: string;
}> = [
  {
    id: 'duckduckgo',
    title: 'DuckDuckGo',
    description: 'Free · no API key',
    descriptionZh: '免费 · 无需 API Key',
  },
  {
    id: 'brave',
    title: 'Brave',
    description: 'API key · stored on the Host',
    descriptionZh: '需要 API Key · 保存在 Host',
  },
  {
    id: 'tavily',
    title: 'Tavily',
    description: 'API key · stored on the Host',
    descriptionZh: '需要 API Key · 保存在 Host',
  },
  {
    id: 'cli',
    title: 'Custom CLI',
    description: 'Wrap SearXNG / self-hosted / any search API yourself',
    descriptionZh: '自行封装 SearXNG / 自托管 / 任意搜索接口',
  },
];

const FETCH_PROVIDER_OPTIONS = [
  {
    id: 'supermarkdown' as const,
    title: 'Supermarkdown',
    description: 'Local HTML→Markdown · Free default',
    descriptionZh: '本地 HTML 转换 · 默认免费',
  },
  {
    id: 'jina' as const,
    title: 'Jina Reader',
    description: 'r.jina.ai — handles JS-rendered pages',
    descriptionZh: 'r.jina.ai — 适合 JS 渲染',
  },
  {
    id: 'firecrawl' as const,
    title: 'Firecrawl',
    description: 'Scrape API — self-hostable',
    descriptionZh: 'Scrape API — 可自托管',
  },
];

type SearchDelegateOption = {
  key: string;
  label: string;
  ref: ModelRef;
};

function modelRefKey(model: ModelRef | undefined): string {
  return model
    ? [model.protocol ?? '', model.providerId, model.modelId].map(encodeURIComponent).join('/')
    : '';
}

export function WebPage(): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const {
    webDraft,
    setWebDraft,
    saveWeb,
    saving,
    config,
    request,
    storeProviderSecret,
    loadProviderSecret,
    testWebSearchSource,
    remoteSettingsReadOnly,
    hostClient,
  } = useSettings();
  const remoteShell = hostClient?.getTransport?.() === 'remote';
  const [webToolsTab, setWebToolsTab] = useState<'search' | 'fetch'>('search');
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<string>>(() => new Set());
  const [routePreview, setRoutePreview] = useState<SearchRoutePreviewData | null>(null);
  const [routePreviewLoading, setRoutePreviewLoading] = useState(false);
  const [routePreviewError, setRoutePreviewError] = useState(false);
  const zh = locale === 'zh-CN';
  const isDirty = config
    ? JSON.stringify(draftToWeb(webDraft)) !==
      JSON.stringify(config.web ?? createDefaultWebConfig())
    : false;
  const previewInput = useMemo<SearchRoutePreviewInput>(() => {
    const web = draftToWeb(webDraft);
    return {
      policy: web.searchRoutePolicy ?? DEFAULT_SEARCH_ROUTE_POLICY,
      searchSources: web.searchSources,
      ...(web.searchDelegateModel ? { searchDelegateModel: web.searchDelegateModel } : {}),
    };
  }, [webDraft]);
  const searchDelegateOptions = useMemo<SearchDelegateOption[]>(() => {
    return (config?.providers ?? []).filter(isProviderEnabled).flatMap((provider) =>
      provider.models
        .filter(
          (model) =>
            isModelEnabled(model) &&
            modelSupportsCapability(model, 'chat') &&
            modelSupportsCapability(model, 'native-web-search'),
        )
        .map((model) => {
          const ref: ModelRef = {
            protocol: provider.protocol,
            providerId: provider.id,
            modelId: model.id,
          };
          return {
            key: modelRefKey(ref),
            label: `${provider.name} · ${model.label?.trim() || model.id}`,
            ref,
          };
        }),
    );
  }, [config?.providers]);
  const fetchDelegateOptions = useMemo<SearchDelegateOption[]>(() => {
    return (config?.providers ?? []).filter(isProviderEnabled).flatMap((provider) =>
      provider.models
        .filter((model) => isModelEnabled(model) && modelSupportsCapability(model, 'chat'))
        .map((model) => {
          const ref: ModelRef = {
            protocol: provider.protocol,
            providerId: provider.id,
            modelId: model.id,
          };
          return {
            key: modelRefKey(ref),
            label: `${provider.name} · ${model.label?.trim() || model.id}`,
            ref,
          };
        }),
    );
  }, [config?.providers]);

  useEffect(() => {
    let disposed = false;
    setRoutePreviewLoading(true);
    setRoutePreviewError(false);
    const timerId = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await request({
            type: 'web/search-route-preview',
            input: previewInput,
          });
          if (disposed) {
            return;
          }
          if (!response.success) {
            setRoutePreviewError(true);
            setRoutePreviewLoading(false);
            return;
          }
          const data = response.data as SearchRoutePreviewData | undefined;
          if (!data) {
            setRoutePreviewError(true);
            setRoutePreviewLoading(false);
            return;
          }
          setRoutePreview(data);
          setRoutePreviewError(false);
          setRoutePreviewLoading(false);
        } catch {
          if (!disposed) {
            setRoutePreviewError(true);
            setRoutePreviewLoading(false);
          }
        }
      })();
    }, 150);

    return () => {
      disposed = true;
      window.clearTimeout(timerId);
    };
  }, [previewInput, request]);

  useEffect(() => {
    if (isDirty && saveStatus === 'saved') {
      setSaveStatus('idle');
    }
  }, [isDirty, saveStatus]);

  const isKindEnabled = (kind: WebSearchSourceKind): boolean =>
    webDraft.searchSources.some((source) => source.kind === kind && source.enabled);

  const findSource = (kind: WebSearchSourceKind): DraftSearchSource | undefined =>
    webDraft.searchSources.find((source) => source.kind === kind);

  const toggleExpanded = (sourceId: string): void => {
    setExpandedSourceIds((current) => {
      const next = new Set(current);
      if (next.has(sourceId)) {
        next.delete(sourceId);
      } else {
        next.add(sourceId);
      }
      return next;
    });
  };

  const toggleKind = (kind: WebSearchSourceKind, enabled: boolean) => {
    const existing = findSource(kind);
    if (existing) {
      setWebDraft({
        ...webDraft,
        searchSources: webDraft.searchSources.map((source) =>
          source.kind === kind ? { ...source, enabled } : source,
        ),
      });
      setExpandedSourceIds((current) => {
        const next = new Set(current);
        if (enabled) {
          next.add(existing.id);
        } else {
          next.delete(existing.id);
        }
        return next;
      });
      return;
    }
    const next = createDraftSearchSource(
      kind,
      webDraft.searchSources.map((source) => source.id),
    );
    setWebDraft({
      ...webDraft,
      searchSources: [...webDraft.searchSources, { ...next, enabled: true }],
    });
    setExpandedSourceIds((current) => new Set(current).add(next.id));
  };

  const updateKind = (kind: WebSearchSourceKind, patch: Partial<DraftSearchSource>) => {
    const existing = findSource(kind);
    if (!existing) {
      const created = createDraftSearchSource(
        kind,
        webDraft.searchSources.map((source) => source.id),
      );
      setWebDraft({
        ...webDraft,
        searchSources: [...webDraft.searchSources, { ...created, enabled: true, ...patch }],
      });
      return;
    }
    setWebDraft({
      ...webDraft,
      searchSources: webDraft.searchSources.map((source) =>
        source.kind === kind ? { ...source, ...patch } : source,
      ),
    });
  };

  const saveSearchSecret = async (
    kind: 'brave' | 'tavily',
    apiKeyRef: string,
    apiKeyEnv: string,
  ): Promise<boolean> => {
    const nextDraft = {
      ...webDraft,
      searchSources: webDraft.searchSources.map((source) =>
        source.kind === kind ? { ...source, apiKeyRef, apiKeyEnv } : source,
      ),
    };
    return saveWeb(nextDraft);
  };

  const saveFetchSecret = async (apiKeyRef: string, apiKeyEnv: string): Promise<boolean> => {
    const nextDraft = { ...webDraft, fetchApiKeyRef: apiKeyRef, fetchApiKeyEnv: apiKeyEnv };
    return saveWeb(nextDraft);
  };

  const saveAllWebSettings = async (): Promise<void> => {
    setSaveStatus('saving');
    const saved = await saveWeb();
    setSaveStatus(saved ? 'saved' : 'error');
  };

  const selectSearchDelegate = (key: string): void => {
    const selected = searchDelegateOptions.find((option) => option.key === key);
    if (selected) {
      setWebDraft({ ...webDraft, searchDelegateModel: selected.ref });
      return;
    }
    const { searchDelegateModel: _removed, ...withoutDelegate } = webDraft;
    setWebDraft(withoutDelegate);
  };

  const selectFetchDelegate = (key: string): void => {
    const selected = fetchDelegateOptions.find((option) => option.key === key);
    if (selected) {
      setWebDraft({ ...webDraft, fetchDelegateModel: selected.ref });
      return;
    }
    const { fetchDelegateModel: _removed, ...withoutDelegate } = webDraft;
    setWebDraft(withoutDelegate);
  };

  const testSearchConnection = async (
    sourceId: string,
    kind: 'brave' | 'tavily',
  ): Promise<{ durationMs: number; resultCount: number }> => {
    if (testWebSearchSource) {
      return testWebSearchSource({ sourceId, kind });
    }
    const response = await request({
      type: 'web/test-search-source',
      webTest: { sourceId, kind },
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    const result = response.data as { durationMs: number; resultCount: number };
    return result;
  };

  return (
    <div
      className="settings-card"
      data-testid="settings-web-tools"
      data-dirty={isDirty ? 'true' : 'false'}
    >
      <div className="settings-section settings-section-card">
        <div className="settings-segmented-wrap" style={{ marginBottom: 28 }}>
          <SegmentedControl
            value={webToolsTab}
            onChange={(value) => setWebToolsTab(value as 'search' | 'fetch')}
            data={[
              { value: 'search', label: zh ? '搜索' : 'Search' },
              { value: 'fetch', label: 'Fetch' },
            ]}
            testId="web-tools-tab"
          />
        </div>

        {webToolsTab === 'search' ? (
          <div className="web-tools-panel" data-testid="web-tools-search-panel">
            <Field
              label={zh ? 'web_search 委托模型' : 'web_search delegate model'}
              description={
                zh
                  ? '可选：只显示已启用且标记“模型内置搜索”的模型。选择后，web_search 会调用该模型的内置搜索。'
                  : 'Optional: only enabled models tagged Native search are listed. When selected, web_search uses that model’s provider-native search.'
              }
              className="web-search-route-field"
            >
              <Select
                value={modelRefKey(webDraft.searchDelegateModel)}
                onChange={(event) => selectSearchDelegate(event.currentTarget.value)}
                testId="web-search-delegate-model"
                data={[
                  {
                    value: '',
                    label: zh
                      ? '不委托（使用下方搜索源）'
                      : 'No delegation (use search sources below)',
                  },
                  ...(webDraft.searchDelegateModel &&
                  !searchDelegateOptions.some(
                    (option) => option.key === modelRefKey(webDraft.searchDelegateModel),
                  )
                    ? [
                        {
                          value: modelRefKey(webDraft.searchDelegateModel),
                          label: zh ? '当前委托模型不可用' : 'Current delegate is unavailable',
                          disabled: true,
                        },
                      ]
                    : []),
                  ...searchDelegateOptions.map((option) => ({
                    value: option.key,
                    label: option.label,
                  })),
                ]}
              />
            </Field>
            {webDraft.searchDelegateModel ? (
              <Notice tone="info" testId="web-search-delegate-active">
                {zh
                  ? '委托启用时，web_search 只调用所选模型；下方普通搜索源会保留配置，但不会同时请求。'
                  : 'While delegation is enabled, web_search calls only the selected model. Ordinary sources below remain configured but are not queried.'}
              </Notice>
            ) : searchDelegateOptions.length === 0 ? (
              <Notice tone="warning" testId="web-search-delegate-empty">
                {zh
                  ? '暂无可委托模型。请先在模型配置中给支持内置搜索的模型勾选“模型内置搜索”。'
                  : 'No delegate model is available. Tag a provider model with Native search first.'}
              </Notice>
            ) : null}
            <div className="web-source-list" data-testid="web-search-sources">
              {SOURCE_KIND_OPTIONS.map((option) => {
                const selected = isKindEnabled(option.id);
                const source = findSource(option.id);
                return (
                  <div
                    key={option.id}
                    className={selected ? 'web-source-card is-selected' : 'web-source-card'}
                    data-testid={`web-search-source-card-${option.id}`}
                  >
                    <div className="web-source-card-header-row">
                      <button
                        type="button"
                        className="web-source-card-header"
                        onClick={() => toggleExpanded(source?.id ?? option.id)}
                        aria-expanded={Boolean(source && expandedSourceIds.has(source.id))}
                        data-testid={`web-search-source-${option.id}`}
                      >
                        <div className="web-source-card-main">
                          <div className="web-source-card-title">{option.title}</div>
                          <div className="web-source-card-desc muted">
                            {zh ? option.descriptionZh : option.description}
                          </div>
                        </div>
                        <span
                          className={
                            source && expandedSourceIds.has(source.id)
                              ? 'web-source-card-chevron is-expanded'
                              : 'web-source-card-chevron'
                          }
                          aria-hidden
                        >
                          ›
                        </span>
                      </button>
                      <Switch
                        checked={selected}
                        onCheckedChange={(enabled) => toggleKind(option.id, enabled)}
                        aria-label={
                          zh
                            ? `${option.title}${selected ? '已启用' : '已停用'}`
                            : `${option.title} ${selected ? 'enabled' : 'disabled'}`
                        }
                        testId={`web-search-source-toggle-${option.id}`}
                      />
                    </div>

                    {selected &&
                    source &&
                    expandedSourceIds.has(source.id) &&
                    (option.id === 'brave' || option.id === 'tavily') ? (
                      <div
                        className="web-source-card-body"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <WebSecretEditor
                          secretId={`web-${source?.id ?? option.id}`}
                          apiKeyRef={source?.apiKeyRef ?? ''}
                          apiKeyEnv={source?.apiKeyEnv ?? ''}
                          defaultApiKeyEnv={
                            option.id === 'tavily' ? 'TAVILY_API_KEY' : 'BRAVE_API_KEY'
                          }
                          disabled={saving || remoteSettingsReadOnly === true}
                          zh={zh}
                          loadSecret={loadProviderSecret}
                          storeSecret={storeProviderSecret}
                          testConnection={() =>
                            testSearchConnection(source.id, option.id as 'brave' | 'tavily')
                          }
                          onSaved={(apiKeyRef, apiKeyEnv) =>
                            saveSearchSecret(option.id as 'brave' | 'tavily', apiKeyRef, apiKeyEnv)
                          }
                          testId={`web-search-${option.id}-api-key`}
                        />
                      </div>
                    ) : null}

                    {selected &&
                    source &&
                    expandedSourceIds.has(source.id) &&
                    option.id === 'cli' ? (
                      <div
                        className="web-source-card-body"
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        {remoteShell ? (
                          <Notice tone="info" testId="web-search-cli-host-held">
                            {zh
                              ? '启动器路径由 Host 保管。远程壳看不到、也不能改；保存其它 Web 选项不会把它抹掉。'
                              : 'The launcher path stays on the Host. This remote shell cannot see or edit it, and saving other Web options will not erase it.'}
                          </Notice>
                        ) : (
                          <>
                            <Field
                              label={zh ? '可执行文件' : 'Executable'}
                              description={
                                zh
                                  ? '无 shell：填写 PATH 上的命令名，或绝对路径。'
                                  : 'No shell: binary name on PATH, or an absolute path.'
                              }
                              className="web-source-field"
                            >
                              <TextInput
                                value={source?.command ?? ''}
                                onChange={(event) =>
                                  updateKind('cli', { command: event.currentTarget.value })
                                }
                                placeholder={
                                  zh
                                    ? '例如 anysearch、smart-search 或 /usr/local/bin/my-search'
                                    : 'e.g. anysearch, smart-search, or /usr/local/bin/my-search'
                                }
                                spellCheck={false}
                                testId="web-search-cli-command"
                              />
                            </Field>

                            <TextArea
                              label={zh ? '参数（每行一个）' : 'Arguments (one per line)'}
                              description={
                                zh
                                  ? '每行一个 argv；可用 {{query}} 插入查询词。stdout 需输出 JSON hits。密钥/URL 写在你的脚本或环境变量里。'
                                  : 'One argv token per line. Use {{query}} for the search text. stdout must print JSON hits. Keys/URLs live in your script or env.'
                              }
                              value={source?.args ?? ''}
                              onChange={(value) => updateKind('cli', { args: value })}
                              placeholder={'search\n{{query}}'}
                              rows={3}
                              className="web-source-field"
                              testId="web-search-cli-args"
                              nativeProps={{ spellCheck: false }}
                            />

                            <CliSearchExamples zh={zh} />

                            <CliCommandPreview
                              command={source?.command ?? ''}
                              argsText={source?.args ?? ''}
                              zh={zh}
                            />
                          </>
                        )}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <Field
              label={translator.settings.web.searchRoute}
              description={translator.settings.web.searchRouteDescription}
              className="web-search-route-field"
            >
              <select
                value={webDraft.searchRoutePolicy}
                onChange={(event) =>
                  setWebDraft({
                    ...webDraft,
                    searchRoutePolicy: event.currentTarget.value as SearchRoutePolicy,
                  })
                }
                data-testid="web-search-route-policy"
              >
                <option value="native-first">{translator.settings.web.nativeSearchFirst}</option>
                <option value="external-first">
                  {translator.settings.web.externalSearchFirst}
                </option>
                <option value="native-only">{translator.settings.web.nativeSearchOnly}</option>
                <option value="external-only">{translator.settings.web.externalSearchOnly}</option>
              </select>
            </Field>
            <SearchRouteStatus
              preview={routePreview}
              loading={routePreviewLoading}
              locale={locale}
            />
            {routePreviewError ? (
              <Notice tone="warning" testId="search-route-preview-error">
                {translator.settings.web.previewRequestFailed}
              </Notice>
            ) : null}

            <details className="web-search-advanced" data-testid="web-search-advanced">
              <summary>{zh ? '高级搜索设置' : 'Advanced search settings'}</summary>
              <div className="web-tools-options">
                <p className="web-search-aggregate-hint muted">
                  {zh
                    ? '同时启用多个搜索源时，它们会被并行调用，结果合并、去重后一起返回。'
                    : 'When multiple sources are enabled, they are queried in parallel and results are merged, deduplicated, and returned together.'}
                </p>

                <FieldRow label={zh ? '结果上限' : 'Max results'}>
                  <TextInput
                    value={webDraft.searchMaxResults}
                    onChange={(event) =>
                      setWebDraft({ ...webDraft, searchMaxResults: event.currentTarget.value })
                    }
                    inputMode="numeric"
                    style={{ width: 96 }}
                    testId="web-search-max-results"
                  />
                </FieldRow>

                <FieldRow label={zh ? '整次超时 (ms)' : 'Overall timeout (ms)'}>
                  <TextInput
                    value={webDraft.searchTimeoutMs}
                    onChange={(event) =>
                      setWebDraft({ ...webDraft, searchTimeoutMs: event.currentTarget.value })
                    }
                    inputMode="numeric"
                    style={{ width: 120 }}
                    testId="web-search-timeout-ms"
                  />
                </FieldRow>

                <FieldRow label={zh ? '单源超时 (ms)' : 'Per-source timeout (ms)'}>
                  <TextInput
                    value={webDraft.perSourceTimeoutMs}
                    onChange={(event) =>
                      setWebDraft({
                        ...webDraft,
                        perSourceTimeoutMs: event.currentTarget.value,
                      })
                    }
                    inputMode="numeric"
                    style={{ width: 120 }}
                    testId="web-search-per-source-timeout-ms"
                  />
                </FieldRow>
              </div>
            </details>

            <p className="muted web-tools-tip" data-testid="web-search-quota-tip">
              {zh
                ? '提示：并行聚合会同时请求所有已选源，各自消耗搜索额度。自托管或需额外 Key 的服务，请用 Custom CLI 封装。'
                : 'Tip: parallel aggregation queries every selected source at once and uses each source’s quota. For self-hosted or key-gated services, wrap them with Custom CLI.'}
            </p>
          </div>
        ) : (
          <div className="web-tools-panel" data-testid="web-tools-fetch-panel">
            <Field
              label={zh ? 'web_fetch 聚焦提取模型' : 'web_fetch extract model'}
              description={
                zh
                  ? '可选：用小型聊天模型按问题从页面里抽出约 4,000 字相关段。未配置或提取失败时回退到页首窗口。'
                  : 'Optional: a small chat model extracts about 4,000 characters relevant to the query. Missing or failed extraction falls back to the page head.'
              }
              className="web-search-route-field"
            >
              <Select
                value={modelRefKey(webDraft.fetchDelegateModel)}
                onChange={(event) => selectFetchDelegate(event.currentTarget.value)}
                testId="web-fetch-delegate-model"
                data={[
                  {
                    value: '',
                    label: zh ? '不提取（返回页首窗口）' : 'No extract (return the page head)',
                  },
                  ...(webDraft.fetchDelegateModel &&
                  !fetchDelegateOptions.some(
                    (option) => option.key === modelRefKey(webDraft.fetchDelegateModel),
                  )
                    ? [
                        {
                          value: modelRefKey(webDraft.fetchDelegateModel),
                          label: zh ? '当前提取模型不可用' : 'Current extract model is unavailable',
                          disabled: true,
                        },
                      ]
                    : []),
                  ...fetchDelegateOptions.map((option) => ({
                    value: option.key,
                    label: option.label,
                  })),
                ]}
              />
            </Field>
            {webDraft.fetchDelegateModel ? (
              <Notice tone="info" testId="web-fetch-delegate-active">
                {zh
                  ? '配置后，web_fetch 带 query 时会抽出相关段；outline / offset 仍走机械窗口。'
                  : 'When set, web_fetch with query returns a focused excerpt. outline and offset still use the mechanical window.'}
              </Notice>
            ) : fetchDelegateOptions.length === 0 ? (
              <Notice tone="warning" testId="web-fetch-delegate-empty">
                {zh
                  ? '暂无可用于提取的聊天模型。请先在模型配置中启用至少一个带 chat 能力的模型。'
                  : 'No chat model is available. Enable at least one chat-capable model first.'}
              </Notice>
            ) : null}
            <FieldRow label={zh ? '单次返回上限（字符）' : 'Return window (chars)'}>
              <TextInput
                value={webDraft.fetchReturnMaxChars ?? ''}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, fetchReturnMaxChars: event.currentTarget.value })
                }
                inputMode="numeric"
                style={{ width: 120 }}
                testId="web-fetch-return-max-chars"
              />
            </FieldRow>
            <FieldRow label={zh ? '缓存全文上限（字符）' : 'Cached extract (chars)'}>
              <TextInput
                value={webDraft.fetchStoreMaxChars ?? ''}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, fetchStoreMaxChars: event.currentTarget.value })
                }
                inputMode="numeric"
                style={{ width: 120 }}
                testId="web-fetch-store-max-chars"
              />
            </FieldRow>
            <FieldRow label={zh ? '缓存时间（毫秒）' : 'Cache TTL (ms)'}>
              <TextInput
                value={webDraft.fetchCacheTtlMs ?? ''}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, fetchCacheTtlMs: event.currentTarget.value })
                }
                inputMode="numeric"
                style={{ width: 120 }}
                testId="web-fetch-cache-ttl-ms"
              />
            </FieldRow>
            <p className="muted web-tools-tip">
              {zh
                ? '返回上限控制每次塞进对话的字数；缓存全文可更长，用 offset 续读或 spillPath 搜全文。'
                : 'Return window is what one call injects. The cache can be longer — continue with offset or search spillPath.'}
            </p>
            <Field
              label={zh ? 'JS 站兜底' : 'JS-page fallback'}
              description={
                zh
                  ? '本地提取正文过薄时，自动再用 Jina 或本机 Chromium 读一次。结果会标注实际 provider。'
                  : 'When the local extract looks empty (SPA / JS-rendered), retry once with Jina or local Chromium. The result names the provider that actually produced the text.'
              }
              className="web-search-route-field"
            >
              <Select
                value={webDraft.fetchFallback}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setWebDraft({
                    ...webDraft,
                    fetchFallback:
                      value === 'jina' || value === 'browser' ? value : 'none',
                  });
                }}
                testId="web-fetch-fallback"
                data={[
                  { value: 'none', label: zh ? '不兜底' : 'No fallback' },
                  { value: 'jina', label: 'Jina' },
                  {
                    value: 'browser',
                    label: zh ? '本地浏览器（Chromium）' : 'Local browser (Chromium)',
                  },
                ]}
              />
            </Field>
            <div className="web-source-list" style={{ marginBottom: 8 }}>
              {FETCH_PROVIDER_OPTIONS.map((option) => {
                const selected = webDraft.fetchProvider === option.id;
                return (
                  <div
                    key={option.id}
                    className={selected ? 'web-source-card is-selected' : 'web-source-card'}
                  >
                    <button
                      type="button"
                      className="web-source-card-header"
                      onClick={() =>
                        setWebDraft({
                          ...webDraft,
                          fetchProvider: option.id,
                          fetchApiKeyEnv:
                            option.id === 'firecrawl'
                              ? webDraft.fetchApiKeyEnv || 'FIRECRAWL_API_KEY'
                              : option.id === 'jina'
                                ? webDraft.fetchApiKeyEnv || 'JINA_API_KEY'
                                : webDraft.fetchApiKeyEnv,
                          fetchApiKeyRef:
                            option.id === webDraft.fetchProvider ? webDraft.fetchApiKeyRef : '',
                        })
                      }
                      aria-pressed={selected}
                      data-testid={`web-fetch-provider-${option.id}`}
                    >
                      <div className="web-source-card-main">
                        <div className="web-source-card-title">{option.title}</div>
                        <div className="web-source-card-desc muted">
                          {zh ? option.descriptionZh : option.description}
                        </div>
                      </div>
                      <span
                        className={
                          selected ? 'web-source-card-check is-on' : 'web-source-card-check'
                        }
                        aria-hidden
                      >
                        {selected ? '✓' : ''}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div
              className={
                webDraft.fetchProvider === 'firecrawl' || webDraft.fetchProvider === 'jina'
                  ? 'web-tools-conditional is-visible'
                  : 'web-tools-conditional'
              }
            >
              <div className="web-tools-options">
                <WebSecretEditor
                  secretId={`web-fetch-${webDraft.fetchProvider}`}
                  apiKeyRef={webDraft.fetchApiKeyRef}
                  apiKeyEnv={webDraft.fetchApiKeyEnv}
                  defaultApiKeyEnv={
                    webDraft.fetchProvider === 'firecrawl' ? 'FIRECRAWL_API_KEY' : 'JINA_API_KEY'
                  }
                  disabled={saving || remoteSettingsReadOnly === true}
                  zh={zh}
                  loadSecret={loadProviderSecret}
                  storeSecret={storeProviderSecret}
                  onSaved={saveFetchSecret}
                  testId="web-fetch-api-key"
                />
              </div>
            </div>
          </div>
        )}

        <div className="web-tools-actions">
          <div className="web-tools-save-meta">
            <div
              className={`web-tools-save-status is-${saveStatus}`}
              role="status"
              aria-live="polite"
            >
              {saveStatus === 'saving'
                ? zh
                  ? '正在保存...'
                  : 'Saving...'
                : saveStatus === 'saved'
                  ? zh
                    ? '✓ 配置已保存'
                    : '✓ Settings saved'
                  : saveStatus === 'error'
                    ? zh
                      ? '保存失败，请查看上方错误'
                      : 'Save failed; see the error above'
                    : isDirty
                      ? zh
                        ? '● 有未保存更改'
                        : '● Unsaved changes'
                      : ''}
            </div>
            <div className="web-tools-effective-scope">
              {zh
                ? '当前轮次完成后自动应用；无需重启应用'
                : 'Applied automatically after the current Run; no app restart required'}
            </div>
          </div>
          <Button variant="primary" disabled={saving} onClick={() => void saveAllWebSettings()}>
            {saving ? (zh ? '保存中...' : 'Saving...') : zh ? '保存 Web 配置' : 'Save Web Config'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CliCommandPreview(props: {
  command: string;
  argsText: string;
  zh: boolean;
}): ReactElement | null {
  const executable = props.command.trim();
  if (!executable) {
    return null;
  }
  const args = props.argsText
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
  const previewParts = [executable, ...args.map((arg) => shellQuotePreview(arg))];
  return (
    <div className="web-cli-preview" data-testid="web-search-cli-preview">
      <div className="web-cli-preview-label">{props.zh ? '将执行' : 'Will run'}</div>
      <code className="web-cli-preview-code">{previewParts.join(' ')}</code>
    </div>
  );
}

function CliSearchExamples(props: { zh: boolean }): ReactElement {
  return (
    <details className="web-cli-examples" data-testid="web-search-cli-examples">
      <summary>{props.zh ? '常用配置示例' : 'Common configuration examples'}</summary>
      <div className="web-cli-examples-list">
        <p className="web-cli-examples-intro">
          {props.zh
            ? '下面只是配置参考，不会自动安装服务。AnySearch 有官方 CLI 形态，其他示例需要你自己准备 wrapper。'
            : 'These are configuration references, not automatic integrations. AnySearch has a documented CLI shape; prepare the other wrappers yourself.'}
        </p>
        {CLI_SEARCH_EXAMPLES.map((example) => (
          <div className="web-cli-example" key={example.id}>
            <div className="web-cli-example-title">
              {props.zh ? example.labelZh : example.label}
            </div>
            <div className="web-cli-example-description">
              {props.zh ? example.descriptionZh : example.description}
            </div>
            <code className="web-cli-example-command">{formatCliSearchExample(example)}</code>
            <div className="web-cli-example-note">{props.zh ? example.noteZh : example.note}</div>
          </div>
        ))}
      </div>
    </details>
  );
}

/** Light quoting for preview only — runtime still uses argv array (no shell). */
function shellQuotePreview(value: string): string {
  if (value.length === 0) {
    return "''";
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value) || value.includes('{{query}}')) {
    return value;
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
