/**
 * Settings → Web tools page.
 * Multi-select search sources + web_fetch. Draft state lives in settings context.
 */
import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  DEFAULT_SEARCH_ROUTE_POLICY,
  isModelEnabled,
  isProviderEnabled,
  modelSupportsCapability,
  type HostListDirData,
  type ModelRef,
  type SearchRoutePolicy,
  type SearchRoutePreviewData,
  type SearchRoutePreviewInput,
  createDefaultWebConfig,
  type WebSearchSource,
  type WebSearchSourceKind,
  type WebSearchTestableSourceKind,
} from '@piwin/contracts';
import {
  Button,
  Dialog,
  Field,
  Notice,
  SegmentedControl,
  Select,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { SearchRouteStatus } from '../search-route-status';
import { WebSearchLogPanel } from '../web-search-log-panel';
import { useSettings } from '../settings-context';
import { WebSecretEditor } from '../web-secret-editor';
import { WebCliSourceFields } from '../web-cli-source-fields';
import { createDraftSearchSource, draftToWeb, findCustomSearchSource, type DraftSearchSource } from '../web-draft';
import { HostWorkspacePicker } from '../../host-workspace-picker';
import { pickLocalFile } from '../../pick-project-directory';
import { FETCH_PROVIDER_OPTIONS, SOURCE_KIND_OPTIONS } from './web-page-options';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

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
  const [webToolsTab, setWebToolsTab] = useState<'search' | 'fetch' | 'log'>('search');
  useResetSettingsMainScroll(webToolsTab);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [expandedSourceIds, setExpandedSourceIds] = useState<Set<string>>(() => new Set());
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [filePickerPath, setFilePickerPath] = useState('');
  const filePickResolverRef = useRef<((path: string | null) => void) | null>(null);
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

  const isKindEnabled = (kind: WebSearchSourceKind): boolean => {
    if (kind === 'cli') {
      return findCustomSearchSource(webDraft.searchSources)?.enabled === true;
    }
    return webDraft.searchSources.some((source) => source.kind === kind && source.enabled);
  };

  const findSource = (kind: WebSearchSourceKind): DraftSearchSource | undefined => {
    if (kind === 'cli') {
      return findCustomSearchSource(webDraft.searchSources);
    }
    return webDraft.searchSources.find((source) => source.kind === kind);
  };

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
          source.id === existing.id ? { ...source, enabled } : source,
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
        kind === 'cli' && patch.kind === 'http' ? 'http' : kind,
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
        source.id === existing.id ? { ...source, ...patch } : source,
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
    kind: WebSearchTestableSourceKind,
    draft?: WebSearchSource,
  ): Promise<{ durationMs: number; resultCount: number }> => {
    const input = {
      sourceId,
      kind,
      ...(draft ? { source: draft } : {}),
    };
    if (testWebSearchSource) {
      return testWebSearchSource(input);
    }
    const response = await request({
      type: 'web/test-search-source',
      webTest: input,
    });
    if (!response.success) {
      throw new Error(response.error);
    }
    const result = response.data as { durationMs: number; resultCount: number };
    return result;
  };

  const pickCliScript = async (): Promise<string | null> => {
    const remote = hostClient?.getTransport?.() === 'remote';
    if (!remote) {
      const native = await pickLocalFile({
        title: locale === 'zh-CN' ? '选择搜索脚本' : 'Choose search script',
      });
      if (native) {
        return native;
      }
    }
    if (!hostClient?.supportsCommand?.('host/list-dir') || !hostClient.request) {
      return null;
    }
    return await new Promise((resolve) => {
      filePickResolverRef.current = resolve;
      setFilePickerPath('');
      setFilePickerOpen(true);
    });
  };

  const closeFilePicker = (path: string | null): void => {
    setFilePickerOpen(false);
    const resolvePick = filePickResolverRef.current;
    filePickResolverRef.current = null;
    resolvePick?.(path);
  };

  return (
    <>
    <div
      className="settings-card settings-hub-page web-hub-page"
      data-testid="settings-web-tools"
      data-dirty={isDirty ? 'true' : 'false'}
    >
      <div className="settings-hub-tabs">
        <SegmentedControl
          value={webToolsTab}
          onChange={(value) => setWebToolsTab(value as 'search' | 'fetch' | 'log')}
          data={[
            { value: 'search', label: zh ? '搜索' : 'Search' },
            { value: 'fetch', label: 'Fetch' },
            { value: 'log', label: zh ? '调用日志' : 'Call log' },
          ]}
          testId="web-tools-tab"
        />
      </div>

      <div className="settings-hub-panels">
      {webToolsTab === 'log' ? (
        <WebSearchLogPanel
          locale={zh ? 'zh-CN' : 'en'}
          request={request}
          readOnly={remoteSettingsReadOnly === true}
        />
      ) : (
        <div className="web-tools-tab-body">
          {webToolsTab === 'search' ? (
            <div className="web-tools-panel" data-testid="web-tools-search-panel">
              <div className="settings-section settings-section-card">
                <Field
                  label={zh ? 'web_search 委托模型' : 'web_search delegate model'}
                  description={
                    zh
                      ? '可选：只显示已启用且标记“模型内置搜索”的模型。选择后，web_search 会调用该模型的内置搜索。'
                      : 'Optional: only enabled models tagged Native search are listed. When selected, web_search uses that model’s provider-native search.'
                  }
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
                ) : null}
              </div>

              <div className="settings-section settings-section-card">
                <div className="settings-card-heading">
                  <h4>{zh ? '搜索源渠道' : 'Search sources'}</h4>
                  <p className="muted">
                    {zh
                      ? '搜索源在 Host 上执行。模型只看到统一的 web_search 工具。'
                      : 'Search sources execute on the Host. The model only sees one web_search tool.'}
                  </p>
                </div>
                <div className="web-source-list" data-testid="web-search-sources">
                  {SOURCE_KIND_OPTIONS.map((option) => {
                    const selected = isKindEnabled(option.id);
                    const source = findSource(option.id);
                    const isExpandable = option.id !== 'duckduckgo';
                    const isExpanded = Boolean(source && expandedSourceIds.has(source.id));
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
                            onClick={() => {
                              if (isExpandable) {
                                toggleExpanded(source?.id ?? option.id);
                              }
                            }}
                            aria-expanded={isExpandable ? isExpanded : undefined}
                            data-testid={`web-search-source-${option.id}`}
                            style={{ cursor: isExpandable ? 'pointer' : 'default' }}
                          >
                            <div className="web-source-card-main">
                              <div className="web-source-card-title">{option.title}</div>
                              <div className="web-source-card-desc muted">
                                {zh ? option.descriptionZh : option.description}
                              </div>
                            </div>
                            {isExpandable ? (
                              <span
                                className={
                                  isExpanded
                                    ? 'web-source-card-chevron is-expanded'
                                    : 'web-source-card-chevron'
                                }
                                aria-hidden
                              >
                                ›
                              </span>
                            ) : null}
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

                        {isExpandable &&
                        source &&
                        isExpanded &&
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

                        {isExpandable &&
                        source &&
                        isExpanded &&
                        option.id === 'cli' ? (
                          <div
                            className="web-source-card-body"
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                          >
                            <WebCliSourceFields
                              source={source}
                              zh={zh}
                              disabled={saving || remoteSettingsReadOnly === true}
                              onChange={(patch) => updateKind('cli', patch)}
                              onPickScript={pickCliScript}
                              onTest={(tested) =>
                                testSearchConnection(
                                  tested.id,
                                  tested.kind === 'http' ? 'http' : 'cli',
                                  tested,
                                )
                              }
                            />
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="settings-section settings-section-card">
                <Field
                  label={translator.settings.web.searchRoute}
                  description={translator.settings.web.searchRouteDescription}
                  className="web-search-route-field"
                >
                  <Select
                    value={webDraft.searchRoutePolicy}
                    onChange={(event) =>
                      setWebDraft({
                        ...webDraft,
                        searchRoutePolicy: event.currentTarget.value as SearchRoutePolicy,
                      })
                    }
                    testId="web-search-route-policy"
                    data={[
                      { value: 'native-first', label: translator.settings.web.nativeSearchFirst },
                      { value: 'external-first', label: translator.settings.web.externalSearchFirst },
                      { value: 'native-only', label: translator.settings.web.nativeSearchOnly },
                      { value: 'external-only', label: translator.settings.web.externalSearchOnly },
                    ]}
                  />
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
              </div>

              <div className="settings-section settings-section-card">
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

                    <FieldRow label={zh ? '总超时时间 (ms)' : 'Overall timeout (ms)'}>
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
            </div>
          ) : (
            <div className="web-tools-panel" data-testid="web-tools-fetch-panel">
              <div className="settings-section settings-section-card">
                <Field
                  label={zh ? 'web_fetch 聚焦提取模型' : 'web_fetch extract model'}
                  description={
                    zh
                      ? '可选：使用轻量对话模型提取与问题相关的重点段落（约 4,000 字符）。未配置或提取失败时回退为读取页面头部内容。'
                      : 'Optional: a small chat model extracts about 4,000 characters relevant to the query. Missing or failed extraction falls back to the page head.'
                  }
                >
                  <Select
                    value={modelRefKey(webDraft.fetchDelegateModel)}
                    onChange={(event) => selectFetchDelegate(event.currentTarget.value)}
                    testId="web-fetch-delegate-model"
                    data={[
                      {
                        value: '',
                        label: zh ? '不提取（返回页面头部内容）' : 'No extract (return the page head)',
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
                      ? '配置后，web_fetch 附带查询词时将提取重点内容；获取目录或分页时仍按固定字符截取。'
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
                    ? '返回上限控制单次载入对话的最大字符数；完整缓存内容可通过 offset 偏移量续读，或在文件中检索全文。'
                    : 'Return window is what one call injects. The cache can be longer — continue with offset or search spillPath.'}
                </p>
              </div>

              <div className="settings-section settings-section-card">
                <Field
                  label={zh ? 'JS 站兜底' : 'JS-page fallback'}
                  description={
                    zh
                      ? '当本地解析提取到的正文内容过少时，自动使用 Jina 或本地 Chromium 重新抓取渲染结果。结果会标注实际使用的抓取服务。'
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
                      { value: 'none', label: zh ? '不使用备用抓取' : 'No fallback' },
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
      )}
      </div>
    </div>
    <Dialog
      label={zh ? '选择脚本' : 'Choose script'}
      open={filePickerOpen}
      onOpenChange={(open) => {
        if (!open) {
          closeFilePicker(null);
        }
      }}
      testId="web-search-cli-file-picker"
      contentClassName="workspace-open-dialog"
    >
      <HostWorkspacePicker
        locale={locale === 'zh-CN' ? 'zh-CN' : 'en'}
        currentPath={filePickerPath}
        onCurrentPathChange={setFilePickerPath}
        mode="file"
        listDirectory={async (path) => {
          const response = await hostClient?.request?.({
            type: 'host/list-dir',
            ...(path ? { path } : {}),
            includeHidden: true,
          });
          if (!response?.success) {
            throw new Error(response?.error ?? 'host/list-dir failed');
          }
          return response.data as HostListDirData;
        }}
        onConfirm={(path) => closeFilePicker(path)}
        onCancel={() => closeFilePicker(null)}
      />
    </Dialog>
    </>
  );
}
