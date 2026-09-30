import type { ReactElement } from 'react';
import {
  Field,
  Notice,
  Select,
  Switch,
  TextInput,
} from '@piwin/ui-kit';
import { FieldRow } from '../field-row';
import { SearchRouteStatus } from '../search-route-status';
import { WebSecretEditor } from '../web-secret-editor';
import { WebCliSourceFields } from '../web-cli-source-fields';
import { WebDevinSourceCard } from '../web-devin-source-card';
import { SOURCE_KIND_OPTIONS } from './web-page-options';
import { modelRefKey } from './web-page-model-ref.js';
import type { SearchRoutePolicy } from '@piwin/contracts';
import type { WebPageSearchTabProps } from './web-page-tab-props.js';

export function WebPageSearchTab(props: WebPageSearchTabProps): ReactElement {
  const {
    zh,
    webDraft,
    setWebDraft,
    saving,
    remoteSettingsReadOnly,
    hasTaggedNativeSearch,
    searchDelegateOptions,
    selectSearchDelegate,
    isKindEnabled,
    findSource,
    toggleKind,
    toggleExpanded,
    expandedSourceIds,
    updateKind,
    loadProviderSecret,
    storeProviderSecret,
    saveSearchSecret,
    testSearchConnection,
    pickCliScript,
    routePreview,
    routePreviewLoading,
    routePreviewError,
    translator,
    locale,
  } = props;
  return (
            <div className="web-tools-panel" data-testid="web-tools-search-panel">
              {hasTaggedNativeSearch ? (
              <div className="settings-section settings-section-card">
                <Field
                  label={zh ? '搜索代理模型' : 'web_search delegate model'}
                  description={
                    zh
                      ? '可选：只显示已启用且标记“模型内置搜索”的模型。「模型内置搜索」= web_search 被调用时，用代理模型（未指定则用当前对话模型）发起一次厂商原生搜索子请求。指定一个更便宜的标记模型可避免主模型双倍费用。Gemini 会在工具卡中展示 Google Search Suggestions；Codex / WebSocket 通道可能没有结构化来源。'
                      : 'Optional: only enabled models tagged Native search are listed. Native search = when web_search runs, the delegate (or, if none, the current chat model) makes one provider-native search sub-request. A cheaper tagged delegate avoids paying the main model twice. Gemini shows Google Search Suggestions in the tool card; Codex/WebSocket transports may return no structured sources.'
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
                          ? '不指定（跟随当前对话模型，否则用下方搜索源）'
                          : 'No delegate (follow the chat model, else sources below)',
                      },
                      ...(webDraft.searchDelegateModel &&
                      !searchDelegateOptions.some(
                        (option) => option.key === modelRefKey(webDraft.searchDelegateModel),
                      )
                        ? [
                            {
                              value: modelRefKey(webDraft.searchDelegateModel),
                              label: zh ? '当前代理模型不可用' : 'Current delegate is unavailable',
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
                      ? '已指定代理模型时，web_search 由该模型的原生搜索完成；仅在它失败且策略不是「仅内置搜索」时，同一次调用内回退到下方搜索源。'
                      : 'While a delegate is set, web_search runs that model’s native search. Sources below are used only as an in-call fallback when it fails (not under native-only).'}
                  </Notice>
                ) : null}
              </div>
              ) : (
                <Notice tone="info" testId="web-search-native-untagged">
                  {zh
                    ? '没有已启用且标记“模型内置搜索”的模型时，web_search 走搜索源，没有搜索源则用 DuckDuckGo 兜底。官方 OpenAI / Anthropic / Gemini / xAI 拉取模型会自动打标。'
                    : 'With no enabled model tagged Native search, web_search uses your sources, then DuckDuckGo. Official OpenAI / Anthropic / Gemini / xAI discovery auto-tags eligible models.'}
                </Notice>
              )}

              <div className="settings-section settings-section-card">
                <div className="settings-card-heading">
                  <h4>{zh ? '搜索源' : 'Search sources'}</h4>
                  <p className="muted">
                    {zh
                      ? '搜索在 Host 端执行，模型统一使用 web_search 工具获取结果。'
                      : 'Search sources execute on the Host. The model only sees one web_search tool.'}
                  </p>
                </div>
                <div className="web-source-list" data-testid="web-search-sources">
                  {SOURCE_KIND_OPTIONS.map((option) => {
                    const selected = isKindEnabled(option.id);
                    const source = findSource(option.id);
                    const isExpandable = option.id !== 'duckduckgo';
                    // A row can open before its source exists, so the chevron always answers.
                    const isExpanded = expandedSourceIds.has(source?.id ?? option.id);
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

                        {isExpandable && isExpanded && option.id === 'devin' ? (
                          <WebDevinSourceCard
                            zh={zh}
                            enabled={source !== undefined}
                            disabled={saving || remoteSettingsReadOnly === true}
                            onTest={() => {
                              const id = source?.id ?? option.id;
                              // Send the draft: an unsaved source is not in the Host config yet.
                              return testSearchConnection(id, 'devin', {
                                id,
                                kind: 'devin',
                                enabled: true,
                                // Remote settings project apiKeyRef as
                                // `[stored-secret]`; Devin always reuses the
                                // Host OAuth account.
                                apiKeyRef: 'oauth:devin',
                              });
                            }}
                          />
                        ) : null}
                        {isExpandable && isExpanded && !source && option.id !== 'devin' ? (
                          <div className="web-source-card-body">
                            <p className="muted">{zh ? '打开右侧开关后在这里配置。' : 'Turn the switch on to configure this source.'}</p>
                          </div>
                        ) : null}

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
                    value={
                      !hasTaggedNativeSearch && webDraft.searchRoutePolicy === 'native-only'
                        ? 'external-first'
                        : webDraft.searchRoutePolicy
                    }
                    onChange={(event) =>
                      setWebDraft({
                        ...webDraft,
                        searchRoutePolicy: event.currentTarget.value as SearchRoutePolicy,
                      })
                    }
                    testId="web-search-route-policy"
                    data={
                      hasTaggedNativeSearch
                        ? [
                            { value: 'native-first', label: translator.settings.web.nativeSearchFirst },
                            { value: 'external-first', label: translator.settings.web.externalSearchFirst },
                            { value: 'native-only', label: translator.settings.web.nativeSearchOnly },
                            { value: 'external-only', label: translator.settings.web.externalSearchOnly },
                          ]
                        : [
                            { value: 'external-first', label: translator.settings.web.externalSearchFirst },
                            { value: 'external-only', label: translator.settings.web.externalSearchOnly },
                          ]
                    }
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
              </div>
            </div>
  );
}
