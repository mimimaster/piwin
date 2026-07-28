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
import { PageTitle } from '../page-title';

export function WebPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { webDraft, setWebDraft, saveWeb, saving } = useSettings();
  const [webToolsTab, setWebToolsTab] = useState<'search' | 'fetch'>('search');

  return (
    <div className="settings-card" data-testid="settings-web-tools">
      <div className="settings-section">
        <PageTitle
          title={locale === 'zh-CN' ? 'Web 工具' : 'Web Tools'}
          description={locale === 'zh-CN'
            ? '配置 web_search 与 web_fetch 插件以访问互联网。'
            : 'Configure web_search and web_fetch plugins to access the internet.'}
        />

        <div className="segmented-control" style={{ marginBottom: 24 }}>
          <button
            type="button"
            className="segmented-control-item"
            data-state={webToolsTab === 'search' ? 'active' : 'inactive'}
            onClick={() => setWebToolsTab('search')}
          >
            {locale === 'zh-CN' ? '搜索' : 'Search'}
          </button>
          <button
            type="button"
            className="segmented-control-item"
            data-state={webToolsTab === 'fetch' ? 'active' : 'inactive'}
            onClick={() => setWebToolsTab('fetch')}
          >
            Fetch
          </button>
        </div>

        {webToolsTab === 'search' ? (
          <div className="web-tools-panel" data-testid="web-tools-search-panel">
            <div className="ext-list" style={{ marginBottom: 24 }}>
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
                <div
                  key={option.id}
                  className={webDraft.searchProvider === option.id ? 'ext-list-item active' : 'ext-list-item'}
                  onClick={() =>
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
                  style={{ cursor: 'pointer' }}
                >
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{option.title}</strong>
                    </div>
                    <div className="muted ext-desc">{option.description}</div>
                  </div>
                  {webDraft.searchProvider === option.id && <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>✓</span>}
                </div>
              ))}
            </div>

            {webDraft.searchProvider === 'brave' || webDraft.searchProvider === 'tavily' ? (
              <FieldRow
                label={locale === 'zh-CN' ? 'API Key 环境变量' : 'API Key Env Var'}
                description={locale === 'zh-CN' ? '仅环境变量名；密钥不写进配置。' : 'Env var name only; key not written to config.'}
              >
                <input
                  value={webDraft.searchApiKeyEnv}
                  onChange={(event) =>
                    setWebDraft({ ...webDraft, searchApiKeyEnv: event.target.value })
                  }
                  placeholder={
                    webDraft.searchProvider === 'tavily' ? 'TAVILY_API_KEY' : 'BRAVE_API_KEY'
                  }
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)' }}
                />
              </FieldRow>
            ) : null}

            <FieldRow label={locale === 'zh-CN' ? '搜索结果上限' : 'Maximum results'}>
              <input
                value={webDraft.searchMaxResults}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, searchMaxResults: event.target.value })
                }
                style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)', width: '80px' }}
              />
            </FieldRow>
          </div>
        ) : (
          <div className="web-tools-panel" data-testid="web-tools-fetch-panel">
            <div className="ext-list" style={{ marginBottom: 24 }}>
              {(
                [
                  {
                    id: 'supermarkdown' as const,
                    title: 'Supermarkdown',
                    description: locale === 'zh-CN' ? '本地 HTML 转换 · 默认免费' : 'Local HTML→Markdown · Free default',
                  },
                  {
                    id: 'jina' as const,
                    title: 'Jina Reader',
                    description: locale === 'zh-CN' ? 'r.jina.ai — 适合 JS 渲染' : 'r.jina.ai — handles JS-rendered pages',
                  },
                  {
                    id: 'firecrawl' as const,
                    title: 'Firecrawl',
                    description: locale === 'zh-CN' ? 'Scrape API — 可自托管' : 'Scrape API — self-hostable',
                  },
                ] as const
              ).map((option) => (
                <div
                  key={option.id}
                  className={webDraft.fetchProvider === option.id ? 'ext-list-item active' : 'ext-list-item'}
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
                    })
                  }
                  style={{ cursor: 'pointer' }}
                >
                  <div className="ext-list-main">
                    <div className="ext-list-title">
                      <strong>{option.title}</strong>
                    </div>
                    <div className="muted ext-desc">{option.description}</div>
                  </div>
                  {webDraft.fetchProvider === option.id && <span style={{ color: 'var(--accent)', fontWeight: 'bold' }}>✓</span>}
                </div>
              ))}
            </div>

            {webDraft.fetchProvider === 'firecrawl' || webDraft.fetchProvider === 'jina' ? (
              <FieldRow
                label={locale === 'zh-CN' ? 'API Key 环境变量' : 'API Key Env Var'}
                description={locale === 'zh-CN' ? '仅环境变量名；密钥不写进配置。' : 'Env var name only; key not written to config.'}
              >
                <input
                  value={webDraft.fetchApiKeyEnv}
                  onChange={(event) =>
                    setWebDraft({ ...webDraft, fetchApiKeyEnv: event.target.value })
                  }
                  placeholder={
                    webDraft.fetchProvider === 'firecrawl' ? 'FIRECRAWL_API_KEY' : 'JINA_API_KEY'
                  }
                  style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)' }}
                />
              </FieldRow>
            ) : null}
          </div>
        )}

        <div className="web-tools-actions" style={{ marginTop: 32, paddingTop: 24, borderTop: '1px solid var(--line-soft)', display: 'flex', justifyContent: 'flex-end' }}>
          <Button
            variant="primary"
            disabled={saving}
            onClick={() => void saveWeb()}
          >
            {saving ? (locale === 'zh-CN' ? '保存中...' : 'Saving...') : (locale === 'zh-CN' ? '保存 Web 配置' : 'Save Web Config')}
          </Button>
        </div>
      </div>
    </div>
  );
}
