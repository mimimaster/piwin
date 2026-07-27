/**
 * Settings → Web tools page (Wave 1 migration from SettingsPanel).
 * Configures host web_search / web_fetch providers. Draft state lives in
 * settings context so it survives nav switches; tab state is page-local.
 */
import { useState, type ReactElement } from 'react';
import { Button } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { useSettings } from '../settings-context';

export function WebPage(): ReactElement {
  const { locale, translator } = useDesktopLocale();
  const { webDraft, setWebDraft, saveWeb, saving } = useSettings();
  const [webToolsTab, setWebToolsTab] = useState<'search' | 'fetch'>('search');

  return (
    <div className="settings-card" data-testid="settings-web-tools">
      <div className="settings-section">
        <p className="muted">
          {locale === 'zh-CN'
            ? <>配置 Host 的 <code>web_search</code> / <code>web_fetch</code>。默认免费可用：DuckDuckGo 搜索 + 本地 supermarkdown 抓取。API Key 只写环境变量名，不写进配置。</>
            : <>Configure Host <code>web_search</code> / <code>web_fetch</code>. Defaults are free: DuckDuckGo search + local supermarkdown fetch. API keys stay as env var names only.</>}
        </p>

        <div className="web-tools-tabs" role="tablist" aria-label={locale === 'zh-CN' ? 'Web 工具分类' : 'Web tools categories'}>
          <button
            type="button"
            role="tab"
            className={webToolsTab === 'search' ? 'web-tools-tab active' : 'web-tools-tab'}
            aria-selected={webToolsTab === 'search'}
            data-testid="web-tools-tab-search"
            onClick={() => setWebToolsTab('search')}
          >
            {locale === 'zh-CN' ? '搜索' : 'Search'}
          </button>
          <button
            type="button"
            role="tab"
            className={webToolsTab === 'fetch' ? 'web-tools-tab active' : 'web-tools-tab'}
            aria-selected={webToolsTab === 'fetch'}
            data-testid="web-tools-tab-fetch"
            onClick={() => setWebToolsTab('fetch')}
          >
            Fetch
          </button>
        </div>

        {webToolsTab === 'search' ? (
          <div className="web-tools-panel" data-testid="web-tools-search-panel">
            <div className="web-provider-list" role="radiogroup" aria-label={locale === 'zh-CN' ? '搜索提供商' : 'Search provider'}>
              {(
                [
                  {
                    id: 'duckduckgo' as const,
                    title: 'DuckDuckGo',
                    description: locale === 'zh-CN' ? '免费默认 · 无需 API Key' : 'Free default · no API key',
                  },
                  {
                    id: 'brave' as const,
                    title: 'Brave',
                    description: locale === 'zh-CN' ? '需 BRAVE_API_KEY' : 'Requires BRAVE_API_KEY',
                  },
                  {
                    id: 'tavily' as const,
                    title: 'Tavily',
                    description: locale === 'zh-CN' ? '需 TAVILY_API_KEY' : 'Requires TAVILY_API_KEY',
                  },
                  {
                    id: 'none' as const,
                    title: locale === 'zh-CN' ? '禁用' : 'None',
                    description: locale === 'zh-CN' ? '关闭 web_search' : 'Disable web_search',
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className={
                    webDraft.searchProvider === option.id
                      ? 'web-provider-option active'
                      : 'web-provider-option'
                  }
                >
                  <input
                    type="radio"
                    name="web-search-provider"
                    value={option.id}
                    checked={webDraft.searchProvider === option.id}
                    onChange={() =>
                      setWebDraft({
                        ...webDraft,
                        searchProvider: option.id,
                        searchApiKeyEnv:
                          option.id === 'brave'
                            ? webDraft.searchApiKeyEnv || 'BRAVE_API_KEY'
                            : option.id === 'tavily'
                              ? webDraft.searchApiKeyEnv || 'TAVILY_API_KEY'
                              : '',
                      })
                    }
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>

            {webDraft.searchProvider === 'brave' || webDraft.searchProvider === 'tavily' ? (
              <FieldRow
                label={locale === 'zh-CN' ? '搜索 API Key 环境变量' : 'Search API key environment variable'}
                description={locale === 'zh-CN' ? '仅环境变量名；密钥不写进配置。' : 'Environment variable name only; the key is not written to config.'}
              >
                <input
                  value={webDraft.searchApiKeyEnv}
                  onChange={(event) =>
                    setWebDraft({ ...webDraft, searchApiKeyEnv: event.target.value })
                  }
                  placeholder={
                    webDraft.searchProvider === 'tavily' ? 'TAVILY_API_KEY' : 'BRAVE_API_KEY'
                  }
                />
              </FieldRow>
            ) : null}

            <FieldRow label={locale === 'zh-CN' ? '搜索结果上限' : 'Maximum search results'}>
              <input
                value={webDraft.searchMaxResults}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, searchMaxResults: event.target.value })
                }
              />
            </FieldRow>
          </div>
        ) : (
          <div className="web-tools-panel" data-testid="web-tools-fetch-panel">
            <div className="web-provider-list" role="radiogroup" aria-label={locale === 'zh-CN' ? '抓取提供商' : 'Fetch provider'}>
              {(
                [
                  {
                    id: 'supermarkdown' as const,
                    title: locale === 'zh-CN' ? 'Built-in (supermarkdown)' : 'Built-in (supermarkdown)',
                    description: locale === 'zh-CN'
                      ? '本地 HTML→可读文本，零配置'
                      : 'Local HTML→Markdown, zero config',
                  },
                  {
                    id: 'jina' as const,
                    title: 'Jina Reader',
                    description: locale === 'zh-CN'
                      ? 'r.jina.ai — 适合 JS 渲染页面'
                      : 'r.jina.ai — handles JS-rendered pages',
                  },
                  {
                    id: 'firecrawl' as const,
                    title: 'Firecrawl',
                    description: locale === 'zh-CN'
                      ? 'Scrape API — 可自托管'
                      : 'Scrape API — self-hostable',
                  },
                ] as const
              ).map((option) => (
                <label
                  key={option.id}
                  className={
                    webDraft.fetchProvider === option.id
                      ? 'web-provider-option active'
                      : 'web-provider-option'
                  }
                >
                  <input
                    type="radio"
                    name="web-fetch-provider"
                    value={option.id}
                    checked={webDraft.fetchProvider === option.id}
                    onChange={() =>
                      setWebDraft({
                        ...webDraft,
                        fetchProvider: option.id,
                        fetchApiKeyEnv:
                          option.id === 'firecrawl'
                            ? webDraft.fetchApiKeyEnv || 'FIRECRAWL_API_KEY'
                            : option.id === 'jina'
                              ? webDraft.fetchApiKeyEnv || 'JINA_API_KEY'
                              : webDraft.fetchApiKeyEnv,
                      })
                    }
                  />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.description}</small>
                  </span>
                </label>
              ))}
            </div>

            {webDraft.fetchProvider === 'firecrawl' || webDraft.fetchProvider === 'jina' ? (
              <FieldRow
                label={locale === 'zh-CN' ? '抓取 API Key 环境变量' : 'Fetch API key environment variable'}
                description={
                  webDraft.fetchProvider === 'jina'
                    ? locale === 'zh-CN'
                      ? '可选。Jina 多数情况下无需 Key。'
                      : 'Optional. Jina often works without a key.'
                    : locale === 'zh-CN'
                      ? 'Firecrawl 需要 API Key 环境变量名。'
                      : 'Firecrawl requires an API key environment variable name.'
                }
              >
                <input
                  value={webDraft.fetchApiKeyEnv}
                  onChange={(event) =>
                    setWebDraft({ ...webDraft, fetchApiKeyEnv: event.target.value })
                  }
                  placeholder={
                    webDraft.fetchProvider === 'jina' ? 'JINA_API_KEY' : 'FIRECRAWL_API_KEY'
                  }
                />
              </FieldRow>
            ) : null}

            <FieldRow label={locale === 'zh-CN' ? '抓取最大字节' : 'Maximum fetch bytes'}>
              <input
                value={webDraft.fetchMaxBytes}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, fetchMaxBytes: event.target.value })
                }
              />
            </FieldRow>
            <FieldRow label={locale === 'zh-CN' ? '抓取超时（毫秒）' : 'Fetch timeout (milliseconds)'}>
              <input
                value={webDraft.fetchTimeoutMs}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, fetchTimeoutMs: event.target.value })
                }
              />
            </FieldRow>
            <FieldRow
              label={locale === 'zh-CN' ? '拦截的 URL 前缀' : 'Blocked URL prefixes'}
              description={locale === 'zh-CN' ? '用逗号分隔。' : 'Comma-separated.'}
            >
              <input
                value={webDraft.fetchBlockedUrlPrefixes}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, fetchBlockedUrlPrefixes: event.target.value })
                }
              />
            </FieldRow>
          </div>
        )}

        <div className="web-tools-actions">
          <Button
            variant="primary"
            disabled={saving}
            data-testid="web-tools-save-btn"
            onClick={() => void saveWeb()}
          >
            {saving ? translator.common.saving : locale === 'zh-CN' ? '保存' : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}
