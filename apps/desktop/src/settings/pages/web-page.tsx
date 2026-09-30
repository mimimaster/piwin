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
  SegmentedControl,
} from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { WebSearchLogPanel } from '../web-search-log-panel';
import { useSettings } from '../settings-context';
import {
  createDraftSearchSource,
  draftToWeb,
  findCustomSearchSource,
  webDraftDirty,
  webToDraft,
  type DraftSearchSource,
} from '../web-draft';
import { HostWorkspacePicker } from '../../host-workspace-picker';
import { pickLocalFile } from '../../pick-project-directory';
import { WebPageSearchTab } from './web-page-search-tab';
import { WebPageFetchTab } from './web-page-fetch-tab';
import { modelRefKey, type SearchDelegateOption } from './web-page-model-ref.js';
import { useDevinAccount } from '../use-devin-account.js';
import { useDevinLogoutSearch } from '../use-devin-logout-search.js';
import { useResetSettingsMainScroll } from '../use-reset-settings-scroll.js';

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
  const devinAccount = useDevinAccount();
  useDevinLogoutSearch({
    account: devinAccount,
    draft: webDraft,
    setDraft: setWebDraft,
    save: saveWeb,
  });
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
  const isDirty = useMemo(
    () => Boolean(config && webDraftDirty(webDraft, config.web)),
    [config, webDraft],
  );
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
  const hasTaggedNativeSearch = searchDelegateOptions.length > 0;
  const previewInput = useMemo<SearchRoutePreviewInput>(() => {
    const web = draftToWeb(webDraft);
    const policy = web.searchRoutePolicy ?? DEFAULT_SEARCH_ROUTE_POLICY;
    return {
      policy: !hasTaggedNativeSearch && policy === 'native-only' ? 'external-first' : policy,
      searchSources: web.searchSources,
      ...(web.searchDelegateModel ? { searchDelegateModel: web.searchDelegateModel } : {}),
    };
  }, [webDraft, hasTaggedNativeSearch]);
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
    if (saveStatus === 'saved') {
      const timer = window.setTimeout(() => {
        setSaveStatus('idle');
      }, 1800);
      return () => window.clearTimeout(timer);
    }
  }, [saveStatus]);

  useEffect(() => {
    if (isDirty && saveStatus === 'saved') {
      setSaveStatus('idle');
    }
  }, [isDirty, saveStatus]);

  const resetDraft = (): void => {
    if (!config) return;
    setWebDraft(webToDraft(config.web ?? createDefaultWebConfig()));
    setSaveStatus('idle');
  };

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
            { value: 'fetch', label: zh ? '网页抓取' : 'Fetch' },
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
            <WebPageSearchTab
              zh={zh}
              locale={locale}
              translator={translator}
              webDraft={webDraft}
              setWebDraft={setWebDraft}
              saving={saving}
              remoteSettingsReadOnly={remoteSettingsReadOnly}
              hasTaggedNativeSearch={hasTaggedNativeSearch}
              searchDelegateOptions={searchDelegateOptions}
              selectSearchDelegate={selectSearchDelegate}
              isKindEnabled={isKindEnabled}
              findSource={findSource}
              toggleKind={toggleKind}
              toggleExpanded={toggleExpanded}
              expandedSourceIds={expandedSourceIds}
              updateKind={updateKind}
              loadProviderSecret={loadProviderSecret}
              storeProviderSecret={storeProviderSecret}
              saveSearchSecret={saveSearchSecret}
              testSearchConnection={testSearchConnection}
              pickCliScript={pickCliScript}
              routePreview={routePreview}
              routePreviewLoading={routePreviewLoading}
              routePreviewError={routePreviewError}
            />
          ) : (
            <WebPageFetchTab
              zh={zh}
              webDraft={webDraft}
              setWebDraft={setWebDraft}
              saving={saving}
              remoteSettingsReadOnly={remoteSettingsReadOnly}
              fetchDelegateOptions={fetchDelegateOptions}
              selectFetchDelegate={selectFetchDelegate}
              loadProviderSecret={loadProviderSecret}
              storeProviderSecret={storeProviderSecret}
              saveFetchSecret={saveFetchSecret}
            />
          )}
          {isDirty || saveStatus !== 'idle' ? (
            <div
              className={`web-tools-actions is-floating is-${saveStatus}`}
              data-testid="web-tools-floating-bar"
            >
              <div className="web-tools-floating-pill">
                <div
                  className={`web-tools-save-status is-${saveStatus}`}
                  role="status"
                  aria-live="polite"
                >
                  {saveStatus === 'saving'
                    ? zh
                      ? '保存中…'
                      : 'Saving...'
                    : saveStatus === 'saved'
                      ? zh
                        ? '✓ 配置已保存'
                        : '✓ Settings saved'
                      : saveStatus === 'error'
                        ? zh
                          ? '保存失败，请重试'
                          : 'Save failed, please retry'
                        : zh
                          ? '● 有未保存更改'
                          : '● Unsaved changes'}
                </div>
                {isDirty && saveStatus !== 'saving' ? (
                  <Button
                    variant="ghost"
                    size="compact"
                    disabled={saving}
                    onClick={resetDraft}
                    data-testid="web-tools-reset-button"
                  >
                    {zh ? '还原' : 'Reset'}
                  </Button>
                ) : null}
                <Button
                  variant="primary"
                  size="compact"
                  disabled={saving || !isDirty}
                  onClick={() => void saveAllWebSettings()}
                  data-testid="web-tools-save-button"
                >
                  {saving
                    ? zh
                      ? '保存中…'
                      : 'Saving...'
                    : zh
                      ? '保存更改'
                      : 'Save changes'}
                </Button>
              </div>
            </div>
          ) : null}
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
