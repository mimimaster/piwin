import { useCallback, useEffect, useState } from 'react';
import type {
  HostResponse,
  MemoryQuotaSummary,
  MemoryRecord,
  MemorySearchHit,
  PiwinConfig,
} from '@piwin/contracts';
import { createDefaultMemoryConfig } from '@piwin/contracts';
import { Button, Field, FieldCheckbox, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';

export type MemoryPanelProps = {
  projectPath: string | null;
  request: (command: {
    type:
      | 'memory/list'
      | 'memory/search'
      | 'memory/delete'
      | 'memory/accept'
      | 'memory/quota'
      | 'config/get'
      | 'config/set';
    filter?: { scope?: 'global' | 'project'; projectKey?: string; limit?: number };
    query?: { query: string; scope?: 'global' | 'project'; projectKey?: string; limit?: number };
    memoryId?: string;
    scope?: 'global' | 'project';
    projectKey?: string;
    config?: PiwinConfig;
  }) => Promise<HostResponse>;
  variant?: 'inline' | 'modal';
};

/**
 * Settings → Agent → Memory: list / search / delete / accept / quota + toggles.
 */
export function MemoryPanel(props: MemoryPanelProps) {
  const { locale, translator } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const common = translator.common;
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [hits, setHits] = useState<MemorySearchHit[] | null>(null);
  const [quota, setQuota] = useState<MemoryQuotaSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const loadConfig = useCallback(async () => {
    const response = await props.request({ type: 'config/get' });
    if (!response.success) {
      setError(response.error);
      return null;
    }
    const data = response.data as { config: PiwinConfig };
    setConfig(data.config);
    return data.config;
  }, [props]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const cfg = await loadConfig();
    if (!cfg || cfg.memory?.enabled !== true) {
      setRecords([]);
      setQuota([]);
      setLoading(false);
      return;
    }
    const listResponse = await props.request({
      type: 'memory/list',
      filter: { limit: 100 },
    });
    if (!listResponse.success) {
      setError(listResponse.error);
      setLoading(false);
      return;
    }
    const listData = listResponse.data as { records: MemoryRecord[] };
    setRecords(listData.records ?? []);

    const quotaResponse = await props.request({ type: 'memory/quota' });
    if (quotaResponse.success) {
      const quotaData = quotaResponse.data as { summaries: MemoryQuotaSummary[] };
      setQuota(quotaData.summaries ?? []);
    }
    setLoading(false);
  }, [loadConfig, props]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function saveMemoryConfig(patch: {
    enabled?: boolean;
    injectOverview?: boolean;
  }): Promise<void> {
    if (!config) return;
    setSaving(true);
    setError(null);
    setInfo(null);
    const previous = config.memory ?? createDefaultMemoryConfig();
    const nextMemory = {
      ...previous,
      ...patch,
    };
    const next: PiwinConfig = { ...config, memory: nextMemory };
    const response = await props.request({ type: 'config/set', config: next });
    setSaving(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setConfig(next);
    setInfo(isChinese ? '记忆设置已保存。' : 'Memory settings saved.');
    await loadData();
  }

  async function handleSearch(): Promise<void> {
    setError(null);
    const query = searchQuery.trim();
    if (!query) {
      setHits(null);
      return;
    }
    const response = await props.request({
      type: 'memory/search',
      query: { query, limit: 50 },
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { hits: MemorySearchHit[] };
    setHits(data.hits ?? []);
  }

  async function handleDelete(memoryId: string): Promise<void> {
    setBusyId(memoryId);
    setError(null);
    const response = await props.request({ type: 'memory/delete', memoryId });
    setBusyId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? `已删除 ${memoryId.slice(0, 8)}…` : `Deleted ${memoryId.slice(0, 8)}…`);
    await loadData();
  }

  async function handleAccept(memoryId: string): Promise<void> {
    setBusyId(memoryId);
    setError(null);
    const response = await props.request({ type: 'memory/accept', memoryId });
    setBusyId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? `已接受 ${memoryId.slice(0, 8)}…` : `Accepted ${memoryId.slice(0, 8)}…`);
    await loadData();
  }

  const enabled = config?.memory?.enabled === true;
  const injectOverview = config?.memory?.injectOverview !== false;
  const displayRecords =
    hits !== null ? hits.map((hit) => hit.record) : records;

  return (
    <div className="settings-section" data-testid="memory-panel">
      <div className="settings-card-heading">
        <div>
          <h4>{isChinese ? '记忆' : 'Memory'}</h4>
          <p>{isChinese ? '跨会话事实存储在 ~/.piwin/memory（由 Host 处理）。' : 'Cross-session facts under ~/.piwin/memory (host-mediated).'}</p>
        </div>
      </div>

      {error ? <Notice tone="error">{error}</Notice> : null}
      {info ? <Notice tone="info">{info}</Notice> : null}

      <FieldCheckbox
        label={isChinese ? '启用记忆工具与 IPC' : 'Enable memory tools & IPC'}
        description={isChinese ? '默认关闭。工具：memory_list|search|read|write|update|delete|accept' : 'Off by default. Tools: memory_list|search|read|write|update|delete|accept'}
        checked={enabled}
        disabled={!config || saving}
        testId="memory-enabled-toggle"
        onCheckedChange={(checked) => void saveMemoryConfig({ enabled: checked })}
      />
      <FieldCheckbox
        label={isChinese ? '在每次提示中注入概览' : 'Inject overview each prompt'}
        description={isChinese ? '仅限已信任项目。关闭后仍保留工具，但不在每次提示中注入索引。' : 'Trusted projects only. Disable to keep tools without per-prompt index injection.'}
        checked={injectOverview}
        disabled={!config || saving || !enabled}
        testId="memory-inject-toggle"
        onCheckedChange={(checked) => void saveMemoryConfig({ injectOverview: checked })}
      />
      {!enabled ? (
        <p className="muted">{isChinese ? '启用记忆后，可列出、搜索和管理条目。' : 'Enable memory to list, search, and manage entries.'}</p>
      ) : (
        <>
          {quota.length > 0 ? (
            <ul className="muted" data-testid="memory-quota">
              {quota.map((item) => (
                <li key={`${item.scope}-${item.projectKey ?? ''}`}>
                  {item.scope}
                  {item.projectKey ? `:${item.projectKey.slice(0, 12)}…` : ''}:{' '}
                  {item.ordinaryCount}/{item.ordinaryLimit} {isChinese ? '常规' : 'ordinary'}，{item.dailyCount} {isChinese ? '每日' : 'daily'}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="settings-search-row">
              <Field label={isChinese ? '搜索记忆' : 'Search memories'}>
                <input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder={isChinese ? '搜索记忆…' : 'Search memories…'}
                  data-testid="memory-search-input"
                />
              </Field>
            <Button onClick={() => void handleSearch()}>
              {isChinese ? '搜索' : 'Search'}
            </Button>
            <Button
              onClick={() => {
                setHits(null);
                setSearchQuery('');
                void loadData();
              }}
            >
              {common.refresh}
            </Button>
          </div>

          {loading ? (
            <p className="muted">{common.loading}</p>
          ) : displayRecords.length === 0 ? (
            <p className="muted">{isChinese ? '暂无记忆。Agent 可通过 memory_write 写入。' : 'No memories yet. Agent can write via memory_write.'}</p>
          ) : (
            <ul className="provider-list" data-testid="memory-list">
              {displayRecords.map((record) => (
                <li key={record.id}>
                  <strong>{record.title ?? record.id.slice(0, 8)}</strong>
                  <span className="muted">
                    {' '}
                    · {record.scope}/{record.type} · {record.confidence}
                    {record.reviewedAt ? (isChinese ? ' · 已审核' : ' · reviewed') : ''}
                  </span>
                  <br />
                  <span className="muted">{record.content.slice(0, 160)}</span>
                  <div className="settings-inline-actions">
                    <Button
                      disabled={busyId === record.id}
                      onClick={() => void handleAccept(record.id)}
                    >
                      {isChinese ? '接受' : 'Accept'}
                    </Button>
                    <Button
                      disabled={busyId === record.id}
                      onClick={() => void handleDelete(record.id)}
                    >
                      {common.delete}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
