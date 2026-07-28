import { useCallback, useEffect, useState } from 'react';
import type {
  HostResponse,
  MemoryQuotaSummary,
  MemoryRecord,
  MemorySearchHit,
  PiwinConfig,
} from '@piwin/contracts';
import { Button, Collapse, Field, Notice, Spinner, Switch, TextInput } from '@piwin/ui-kit';
import { useDesktopLocale } from './desktop-locale-context';
import { PageTitle } from './settings/page-title';
import { FieldRow } from './settings/field-row';

const scopeLabel = (scope: 'global' | 'project', isChinese: boolean): string =>
  scope === 'project' ? (isChinese ? '项目' : 'Project') : (isChinese ? '全局' : 'Global');

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

export function MemoryPanel(props: MemoryPanelProps) {
  const { locale } = useDesktopLocale();
  const isChinese = locale === 'zh-CN';
  const [config, setConfig] = useState<PiwinConfig | null>(null);
  const [records, setRecords] = useState<MemoryRecord[]>([]);
  const [hits, setHits] = useState<MemorySearchHit[] | null>(null);
  const [quota, setQuota] = useState<MemoryQuotaSummary[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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
    setError(null);
    const next: PiwinConfig = {
      ...config,
      memory: {
        ...config.memory,
        ...patch,
      },
    };
    const response = await props.request({ type: 'config/set', config: next });
    if (!response.success) {
      setError(response.error);
      return;
    }
    setConfig(next);
    setInfo(isChinese ? '记忆设置已更新。' : 'Memory settings updated.');
    if (patch.enabled === true) {
      void loadData();
    }
  }

  async function handleDelete(memoryId: string) {
    setBusyId(memoryId);
    setError(null);
    const response = await props.request({ type: 'memory/delete', memoryId });
    setBusyId(null);
    if (!response.success) {
      setError(response.error);
      return;
    }
    setInfo(isChinese ? '已删除记忆。' : 'Memory deleted.');
    void loadData();
  }

  async function handleSearch() {
    if (!searchQuery.trim()) {
      setHits(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await props.request({
      type: 'memory/search',
      query: { query: searchQuery.trim(), limit: 10 },
    });
    setLoading(false);
    if (!response.success) {
      setError(response.error);
      return;
    }
    const data = response.data as { hits: MemorySearchHit[] };
    setHits(data.hits ?? []);
  }

  const enabled = config?.memory?.enabled === true;

  return (
    <div className={props.variant === 'inline' ? 'settings-inline-manager' : 'modal-backdrop'}>
      <div className={props.variant === 'inline' ? 'settings-inline-content' : 'modal settings-modal'}>
        <PageTitle
          title={isChinese ? '长期记忆' : 'Long-term Memory'}
          description={isChinese ? '允许 Agent 记住跨会话的重要信息。' : 'Allow the agent to remember important information across sessions.'}
        />

        <div className="settings-section">
          <FieldRow
            label={isChinese ? '启用记忆' : 'Enable Memory'}
            description={isChinese ? '开启后 Agent 可以自动存储和检索历史知识。' : 'When enabled, the agent can store and retrieve historical knowledge.'}
          >
            <Switch
              checked={enabled}
              onChange={() => void saveMemoryConfig({ enabled: !enabled })}
            />
          </FieldRow>

          <Collapse expanded={enabled}>
            <FieldRow
              label={isChinese ? '注入概览' : 'Inject Overview'}
              description={isChinese ? '在每个会话开始时注入简短的记忆摘要。' : 'Inject a brief memory summary at the start of each session.'}
            >
              <Switch
                checked={config?.memory?.injectOverview !== false}
                onChange={() => void saveMemoryConfig({ injectOverview: config?.memory?.injectOverview === false })}
              />
            </FieldRow>
          </Collapse>
        </div>

        <Collapse expanded={enabled} className="settings-section">
            <PageTitle
              title={isChinese ? '管理记忆' : 'Manage Memory'}
            />
            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <Field label={isChinese ? '搜索' : 'Search'}>
                  <TextInput
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Enter' && void handleSearch()}
                    placeholder={isChinese ? '搜索记忆内容...' : 'Search memory...'}
                    style={{ width: '100%', padding: '8px 12px', borderRadius: '8px', border: '1px solid var(--line-soft)', background: 'var(--surface-raised)', color: 'var(--text)' }}
                  />
                </Field>
              </div>
              <Button size="compact" onClick={() => void handleSearch()}>{isChinese ? '搜索' : 'Search'}</Button>
              <Button size="compact" variant="ghost" onClick={() => void loadData()}>{isChinese ? '重置' : 'Reset'}</Button>
            </div>

            {loading && <div style={{ padding: '20px 0', textAlign: 'center' }}><Spinner /></div>}
            {error ? <Notice tone="error">{error}</Notice> : null}
            {info ? <Notice tone="info">{info}</Notice> : null}

            <ul className="ext-list">
              {(hits || records).length === 0 && !loading ? (
                <li className="muted" style={{ textAlign: 'center', padding: '40px' }}>{isChinese ? '暂无记忆记录' : 'No memory records'}</li>
              ) : (
                (hits || records).map((record: any) => {
                  const r = (record as MemorySearchHit).record || (record as MemoryRecord);
                  return (
                    <li key={r.id} className="ext-list-item">
                      <div className="ext-list-main">
                        <div className="ext-list-title">
                          <strong>{r.title || r.id}</strong>
                          <span className="pill">{scopeLabel(r.scope, isChinese)}</span>
                        </div>
                        <div className="muted ext-desc" style={{ whiteSpace: 'pre-wrap', maxHeight: '100px', overflow: 'auto' }}>{r.content}</div>
                      </div>
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={isChinese ? '删除' : 'Delete'}
                        disabled={busyId === r.id}
                        onClick={() => void handleDelete(r.id)}
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                          <path d="M3 4h10M6 4V2.75h4V4M5 6.25v5.5M8 6.25v5.5M11 6.25v5.5M4 4l.5 9h7l.5-9" />
                        </svg>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>

            {quota.length > 0 && (
              <div style={{ marginTop: 24, padding: '12px 16px', borderRadius: '10px', background: 'var(--surface-inset)', border: '1px solid var(--line-soft)' }}>
                <div style={{ fontSize: '12px', fontWeight: 600, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 8 }}>{isChinese ? '配额使用情况' : 'Quota Usage'}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px' }}>
                  {quota.map((q) => (
                    <div key={q.scope} style={{ fontSize: '13px' }}>
                      <span className="muted">{scopeLabel(q.scope, isChinese)}:</span> {q.ordinaryCount} / {q.ordinaryLimit}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Collapse>
      </div>
    </div>
  );
}
