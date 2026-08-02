/**
 * Settings → Web tools page.
 * Configures multi-source web_search + web_fetch. Draft state lives in
 * settings context so it survives nav switches; tab state is page-local.
 */
import { useState, type ReactElement } from 'react';
import type { WebSearchSourceKind } from '@piwin/contracts';
import { Button, Notice, SegmentedControl, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { FieldRow } from '../field-row';
import { useSettings } from '../settings-context';
import { PageTitle } from '../page-title';
import {
  createDraftSearchSource,
  type DraftSearchSource,
} from '../web-draft';

const SOURCE_KIND_OPTIONS: Array<{
  id: WebSearchSourceKind;
  title: string;
  titleZh: string;
}> = [
  { id: 'duckduckgo', title: 'DuckDuckGo', titleZh: 'DuckDuckGo' },
  { id: 'brave', title: 'Brave', titleZh: 'Brave' },
  { id: 'tavily', title: 'Tavily', titleZh: 'Tavily' },
  { id: 'searxng', title: 'SearXNG', titleZh: 'SearXNG' },
  { id: 'cli', title: 'Custom CLI', titleZh: '自定义 CLI' },
];

export function WebPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const { webDraft, setWebDraft, saveWeb, saving } = useSettings();
  const [webToolsTab, setWebToolsTab] = useState<'search' | 'fetch'>('search');
  const zh = locale === 'zh-CN';

  const updateSource = (sourceId: string, patch: Partial<DraftSearchSource>) => {
    setWebDraft({
      ...webDraft,
      searchSources: webDraft.searchSources.map((source) =>
        source.id === sourceId ? { ...source, ...patch } : source,
      ),
    });
  };

  const removeSource = (sourceId: string) => {
    setWebDraft({
      ...webDraft,
      searchSources: webDraft.searchSources.filter((source) => source.id !== sourceId),
    });
  };

  const addSource = (kind: WebSearchSourceKind) => {
    const next = createDraftSearchSource(
      kind,
      webDraft.searchSources.map((source) => source.id),
    );
    setWebDraft({
      ...webDraft,
      searchSources: [...webDraft.searchSources, next],
    });
  };

  return (
    <div className="settings-card" data-testid="settings-web-tools">
      <div className="settings-section settings-section-card">
        <PageTitle
          title={zh ? 'Web 工具配置' : 'Web Tools'}
          description={
            zh
              ? '配置多源 web_search（host 并行合并）与 web_fetch。模型仍只看到一个搜索工具。'
              : 'Configure multi-source web_search (host merges hits) and web_fetch. The model still sees one search tool.'
          }
        />

        <div className="settings-segmented-wrap" style={{ marginBottom: 24 }}>
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
            <div style={{ marginBottom: 20 }} data-testid="web-search-aggregate-tips">
              <Notice
                tone="info"
                title={zh ? '多源聚合是做什么的？' : 'What does multi-source aggregation do?'}
              >
                {zh ? (
                  <>
                    <p style={{ margin: '0 0 8px' }}>
                      模型每次只调用一个 <code>web_search</code>。Host 会按你启用的源去查，
                      把结果按 URL 去重后合并成一份列表再返回——模型不感知有几家源。
                    </p>
                    <p style={{ margin: '0 0 8px' }}>
                      <strong>parallel（并行）</strong>
                      ：所有<strong>已启用</strong>的源会同时请求。覆盖面更大，但
                      <strong>会同时消耗每一家渠道的搜索额度 / 速率限制</strong>
                      （以及 CLI 源的一次调用）。免费额度紧时慎开多家。
                    </p>
                    <p style={{ margin: 0 }}>
                      <strong>ordered-fallback（顺序回退）</strong>
                      ：按列表从上到下依次尝试，凑够结果上限就停。更省额度，适合设一个主源、其余当备份。
                    </p>
                  </>
                ) : (
                  <>
                    <p style={{ margin: '0 0 8px' }}>
                      The model still calls a single <code>web_search</code>. The host queries
                      every enabled source and returns one URL-deduped hit list—the model does
                      not see which vendors ran.
                    </p>
                    <p style={{ margin: '0 0 8px' }}>
                      <strong>parallel</strong>: all <strong>enabled</strong> sources run at once
                      for broader coverage, but each call{' '}
                      <strong>consumes quota / rate limits on every channel</strong> (and one
                      invocation of any CLI source). Be careful with free tiers when many
                      sources are enabled.
                    </p>
                    <p style={{ margin: 0 }}>
                      <strong>ordered-fallback</strong>: tries sources top-to-bottom and stops
                      once enough hits are collected. Cheaper on quota—put a primary source
                      first and keep others as backups.
                    </p>
                  </>
                )}
              </Notice>
            </div>

            <FieldRow
              label={zh ? '合并策略' : 'Merge strategy'}
              description={
                zh
                  ? 'parallel：全部启用源并发后按 URL 去重合并（同时扣多家额度）。ordered-fallback：按列表顺序试到够结果为止（更省额度）。'
                  : 'parallel: query all enabled sources then dedupe by URL (uses quota on each). ordered-fallback: try sources in order until enough hits (cheaper).'
              }
            >
              <SegmentedControl
                value={webDraft.searchStrategyMode}
                onChange={(value) =>
                  setWebDraft({
                    ...webDraft,
                    searchStrategyMode: value as 'parallel' | 'ordered-fallback',
                  })
                }
                data={[
                  { value: 'parallel', label: 'parallel' },
                  { value: 'ordered-fallback', label: 'fallback' },
                ]}
                testId="web-search-strategy"
              />
            </FieldRow>

            <div className="ext-list" style={{ marginBottom: 16 }} data-testid="web-search-sources">
              {webDraft.searchSources.length === 0 ? (
                <div className="muted" style={{ padding: '12px 0' }}>
                  {zh
                    ? '未配置搜索源。添加至少一个源，或保持为空以禁用 web_search。'
                    : 'No search sources. Add at least one source, or leave empty to disable web_search.'}
                </div>
              ) : null}
              {webDraft.searchSources.map((source) => (
                <div
                  key={source.id}
                  className={source.enabled ? 'ext-list-item active' : 'ext-list-item'}
                  style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      alignItems: 'center',
                    }}
                  >
                    <div className="ext-list-main">
                      <div className="ext-list-title">
                        <strong>
                          {source.label.trim() || source.id}
                        </strong>
                        <span className="muted" style={{ marginLeft: 8 }}>
                          {source.kind}
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <label className="muted" style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <input
                          type="checkbox"
                          checked={source.enabled}
                          onChange={(event) =>
                            updateSource(source.id, { enabled: event.currentTarget.checked })
                          }
                        />
                        {zh ? '启用' : 'Enabled'}
                      </label>
                      <Button
                        variant="ghost"
                        onClick={() => removeSource(source.id)}
                      >
                        {zh ? '移除' : 'Remove'}
                      </Button>
                    </div>
                  </div>

                  {(source.kind === 'brave' || source.kind === 'tavily') && (
                    <FieldRow
                      label={zh ? 'API Key 环境变量' : 'API Key Env Var'}
                      description={
                        zh
                          ? '仅环境变量名；密钥不写进配置。'
                          : 'Env var name only; key not written to config.'
                      }
                    >
                      <TextInput
                        value={source.apiKeyEnv}
                        onChange={(event) =>
                          updateSource(source.id, {
                            apiKeyEnv: event.currentTarget.value,
                          })
                        }
                        placeholder={
                          source.kind === 'tavily' ? 'TAVILY_API_KEY' : 'BRAVE_API_KEY'
                        }
                        spellCheck={false}
                        style={{ minWidth: 180 }}
                      />
                    </FieldRow>
                  )}

                  {source.kind === 'searxng' && (
                    <FieldRow
                      label={zh ? 'SearXNG Base URL' : 'SearXNG Base URL'}
                      description={
                        zh
                          ? '实例根地址，tools-web 会请求 /search?format=json'
                          : 'Instance root; tools-web calls /search?format=json'
                      }
                    >
                      <TextInput
                        value={source.baseUrl}
                        onChange={(event) =>
                          updateSource(source.id, { baseUrl: event.currentTarget.value })
                        }
                        placeholder="https://searx.example.com"
                        spellCheck={false}
                        style={{ minWidth: 240 }}
                      />
                    </FieldRow>
                  )}

                  {source.kind === 'cli' && (
                    <>
                      <FieldRow
                        label={zh ? '命令' : 'Command'}
                        description={
                          zh
                            ? '可执行文件（无 shell）。stdout 须为 JSON hits。'
                            : 'Executable (no shell). stdout must be JSON hits.'
                        }
                      >
                        <TextInput
                          value={source.command}
                          onChange={(event) =>
                            updateSource(source.id, {
                              command: event.currentTarget.value,
                            })
                          }
                          placeholder="my-search"
                          spellCheck={false}
                          style={{ minWidth: 180 }}
                        />
                      </FieldRow>
                      <FieldRow
                        label={zh ? '参数模板' : 'Args template'}
                        description={
                          zh
                            ? '空格分隔；用 {{query}} 表示查询词。'
                            : 'Space-separated; use {{query}} for the query token.'
                        }
                      >
                        <TextInput
                          value={source.args}
                          onChange={(event) =>
                            updateSource(source.id, { args: event.currentTarget.value })
                          }
                          placeholder="search {{query}}"
                          spellCheck={false}
                          style={{ minWidth: 240 }}
                        />
                      </FieldRow>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 24 }}>
              {SOURCE_KIND_OPTIONS.map((option) => (
                <Button
                  key={option.id}
                  variant="secondary"
                  onClick={() => addSource(option.id)}
                >
                  {zh ? `+ ${option.titleZh}` : `+ ${option.title}`}
                </Button>
              ))}
            </div>

            <FieldRow label={zh ? '搜索结果上限' : 'Maximum results'}>
              <TextInput
                value={webDraft.searchMaxResults}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, searchMaxResults: event.currentTarget.value })
                }
                inputMode="numeric"
                style={{ width: 88 }}
              />
            </FieldRow>

            <FieldRow
              label={zh ? '整次搜索超时 (ms)' : 'Overall search timeout (ms)'}
              description={
                zh
                  ? '一次 web_search 的最大等待时间。'
                  : 'Hard timeout for a single web_search call.'
              }
            >
              <TextInput
                value={webDraft.searchTimeoutMs}
                onChange={(event) =>
                  setWebDraft({ ...webDraft, searchTimeoutMs: event.currentTarget.value })
                }
                inputMode="numeric"
                style={{ width: 110 }}
              />
            </FieldRow>

            <FieldRow
              label={zh ? '单源超时 (ms)' : 'Per-source timeout (ms)'}
              description={
                zh
                  ? '单个源超时后跳过，不拖死整次搜索。'
                  : 'Timeout for each source; failures are skipped in parallel mode.'
              }
            >
              <TextInput
                value={webDraft.perSourceTimeoutMs}
                onChange={(event) =>
                  setWebDraft({
                    ...webDraft,
                    perSourceTimeoutMs: event.currentTarget.value,
                  })
                }
                inputMode="numeric"
                style={{ width: 110 }}
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
                    description: zh
                      ? '本地 HTML 转换 · 默认免费'
                      : 'Local HTML→Markdown · Free default',
                  },
                  {
                    id: 'jina' as const,
                    title: 'Jina Reader',
                    description: zh
                      ? 'r.jina.ai — 适合 JS 渲染'
                      : 'r.jina.ai — handles JS-rendered pages',
                  },
                  {
                    id: 'firecrawl' as const,
                    title: 'Firecrawl',
                    description: zh
                      ? 'Scrape API — 可自托管'
                      : 'Scrape API — self-hostable',
                  },
                ] as const
              ).map((option) => (
                <div
                  key={option.id}
                  className={
                    webDraft.fetchProvider === option.id
                      ? 'ext-list-item active'
                      : 'ext-list-item'
                  }
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
                  {webDraft.fetchProvider === option.id ? (
                    <span className="ext-list-check" aria-hidden>
                      ✓
                    </span>
                  ) : (
                    <span className="ext-list-check ext-list-check--empty" aria-hidden />
                  )}
                </div>
              ))}
            </div>

            <div
              className={
                webDraft.fetchProvider === 'firecrawl' || webDraft.fetchProvider === 'jina'
                  ? 'web-tools-conditional is-visible'
                  : 'web-tools-conditional'
              }
            >
              <FieldRow
                label={zh ? 'API Key 环境变量' : 'API Key Env Var'}
                description={
                  zh
                    ? '仅环境变量名；密钥不写进配置。'
                    : 'Env var name only; key not written to config.'
                }
              >
                <TextInput
                  value={webDraft.fetchApiKeyEnv}
                  onChange={(event) =>
                    setWebDraft({ ...webDraft, fetchApiKeyEnv: event.currentTarget.value })
                  }
                  placeholder={
                    webDraft.fetchProvider === 'firecrawl'
                      ? 'FIRECRAWL_API_KEY'
                      : 'JINA_API_KEY'
                  }
                  spellCheck={false}
                  style={{ minWidth: 180 }}
                />
              </FieldRow>
            </div>
          </div>
        )}

        <div
          className="web-tools-actions"
          style={{
            marginTop: 32,
            paddingTop: 24,
            borderTop: '1px solid var(--line-soft)',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <Button variant="primary" disabled={saving} onClick={() => void saveWeb()}>
            {saving
              ? zh
                ? '保存中...'
                : 'Saving...'
              : zh
                ? '保存 Web 配置'
                : 'Save Web Config'}
          </Button>
        </div>
      </div>
    </div>
  );
}
