import type { ReactElement } from 'react';
import {
  Field,
  Notice,
  Select,
  TextInput,
} from '@piwin/ui-kit';
import { FieldRow } from '../field-row';
import { WebSecretEditor } from '../web-secret-editor';
import { FETCH_PROVIDER_OPTIONS } from './web-page-options';
import { modelRefKey } from './web-page-model-ref.js';
import type { WebPageFetchTabProps } from './web-page-tab-props.js';

export function WebPageFetchTab(props: WebPageFetchTabProps): ReactElement {
  const {
    zh,
    webDraft,
    setWebDraft,
    saving,
    remoteSettingsReadOnly,
    fetchDelegateOptions,
    selectFetchDelegate,
    loadProviderSecret,
    storeProviderSecret,
    saveFetchSecret,
  } = props;
  return (
            <div className="web-tools-panel" data-testid="web-tools-fetch-panel">
              <div className="settings-section settings-section-card">
                <Field
                  label={zh ? '网页提取模型' : 'web_fetch extract model'}
                  description={
                    zh
                      ? '可选：使用轻量对话模型提取与查询相关的重点内容。未配置或提取失败时回退为直接读取页面正文前段。'
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
                        label: zh ? '不提取（直接读取正文前段）' : 'No extract (return the page head)',
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
                      ? '配置提取模型后，带查询词抓取时将智能提炼重点段落；未带查询词时仍按字符上限截取。'
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
                <FieldRow label={zh ? '缓存提取上限（字符）' : 'Cached extract (chars)'}>
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
              </div>

              <div className="settings-section settings-section-card">
                <Field
                  label={zh ? 'JS 渲染页面回退' : 'JS-page fallback'}
                  description={
                    zh
                      ? '当本地直接解析提取到的正文内容过少时（如单页 SPA 应用），自动调用 Jina 或本地 Chromium 重新渲染抓取。'
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
  );
}
