import { useState, type ReactElement } from 'react';
import {
  computePromptCacheHitRate,
  type RemoteSessionSummary,
  type SessionColdStorageStatus,
  type UsageRollup,
} from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { Facts, ListRow, SectionLabel } from '../inkstone-ui.js';
import { isObject, readArrayField, useHostQuery } from '../host/use-host-query.js';

const COLD_COMMAND = { type: 'session/cold-storage-status' } as const;
const USAGE_COMMAND = { type: 'usage/get-rollup', topSessions: 5 } as const;
const ARCHIVED_COMMAND = {
  type: 'session/list',
  allScopes: true,
  includeArchived: true,
  order: 'updated',
  maxItems: 200,
} as const;

export function ColdStorageSection({ client }: { client: HostClient | undefined }): ReactElement {
  const { state } = useHostQuery(client, COLD_COMMAND, readColdStatus);
  if (state.kind !== 'ready') return <Pending state={state} />;
  const status = state.data;
  return (
    <>
      <Facts
        items={[
          ['冷存储', status.config.enabled ? '已开启' : '未开启'],
          ['归档多久后转存', `${status.config.minArchivedAgeDays} 天`],
          ['本机会话数据', formatBytes(status.localPayloadBytes)],
          ['可转存会话', `${status.eligibleCount} 个`],
          ['输出目录', status.packOutputDirValid ? '可用' : '未配置或不可用'],
        ]}
      />
      {status.residualTransactions.length > 0 ? (
        <p className="error-text">{status.residualTransactions.length} 个转存事务未完成，请在桌面端处理。</p>
      ) : null}
      {status.missingPackSessionIds.length > 0 ? (
        <p className="error-text">{status.missingPackSessionIds.length} 个会话的归档包缺失。</p>
      ) : null}
      <p className="quote-note">转存与恢复会移动 Host 上的文件，只在桌面端执行；这里显示当前状况。</p>
    </>
  );
}

export function UsageSection({ client }: { client: HostClient | undefined }): ReactElement {
  const { state } = useHostQuery(client, USAGE_COMMAND, readRollup);
  if (state.kind !== 'ready') return <Pending state={state} />;
  const rollup = state.data;
  const hitRate = computePromptCacheHitRate(rollup);
  const models = [...rollup.byModelKey].slice(0, 6);
  return (
    <>
      <div className="usage-hero">
        <strong>{formatTokens(rollup.totalTokens)}</strong>
        <span>tokens · {rollup.sessionCount} 个会话 · {rollup.entryCount} 次调用</span>
      </div>
      <Facts
        items={[
          ['输入', formatTokens(rollup.promptTokens)],
          ['输出', formatTokens(rollup.completionTokens)],
          ['缓存读取', formatTokens(rollup.cacheReadTokens)],
          ['缓存命中', hitRate === null ? '—' : `${Math.round(hitRate * 100)}%`],
          ['统计区间', rollup.firstAt !== null ? `${rollup.firstAt.slice(0, 10)} 起` : '—'],
        ]}
      />
      <SectionLabel>按模型</SectionLabel>
      {models.map((row) => (
        <div className="usage-bar" key={`${row.providerId ?? 'legacy'}:${row.modelId}`}>
          <span className="usage-bar-label">
            <strong>{row.modelId}</strong>
            <small>{row.providerId ?? '旧记录'}</small>
          </span>
          <span className="usage-bar-track">
            <i style={{ width: `${Math.max(2, (row.totalTokens / Math.max(1, rollup.totalTokens)) * 100)}%` }} />
          </span>
          <span className="usage-bar-value">{formatTokens(row.totalTokens)}</span>
        </div>
      ))}
    </>
  );
}

export function ArchiveSection({
  client,
  onToast,
}: {
  client: HostClient | undefined;
  onToast: (message: string) => void;
}): ReactElement {
  const { state, reload } = useHostQuery(client, ARCHIVED_COMMAND, readArrayField('sessions', isSession));
  const [busy, setBusy] = useState<string | undefined>();
  if (state.kind !== 'ready') return <Pending state={state} />;
  const archived = state.data.filter((session) => session.archived === true);

  const restore = (session: RemoteSessionSummary): void => {
    if (client === undefined) return;
    setBusy(session.sessionId);
    client
      .request({ type: 'session/unarchive', sessionId: session.sessionId })
      .then((response) => onToast(response.success ? '已恢复到会话列表' : response.error))
      .catch((reason: unknown) => onToast(reason instanceof Error ? reason.message : '恢复失败'))
      .finally(() => {
        setBusy(undefined);
        reload();
      });
  };

  return (
    <>
      <SectionLabel>已归档 · {archived.length}</SectionLabel>
      {archived.length === 0 ? <p className="muted">没有归档的会话。</p> : null}
      {archived.map((session) => (
        <ListRow
          key={session.sessionId}
          name="archive"
          title={session.name?.trim() || '未命名会话'}
          subtitle={`${session.messageCount ?? 0} 条消息${session.updatedAt !== undefined ? ` · ${session.updatedAt.slice(0, 10)}` : ''}`}
          trailing={<span className="row-action">{busy === session.sessionId ? '…' : '恢复'}</span>}
          onClick={() => {
            if (busy === undefined) restore(session);
          }}
        />
      ))}
    </>
  );
}

function Pending({ state }: { state: { kind: string; message?: string } }): ReactElement {
  return (
    <p className={state.kind === 'error' ? 'error-text' : 'muted'}>
      {state.kind === 'error' ? state.message : state.kind === 'unsupported' ? '当前 Host 未开放这项读取。' : '正在读取 Host…'}
    </p>
  );
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return `${value}`;
}

function formatBytes(value: number): string {
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function readColdStatus(data: unknown): SessionColdStorageStatus | undefined {
  return isObject(data) && isObject(data.config) && typeof data.localPayloadBytes === 'number'
    ? (data as SessionColdStorageStatus)
    : undefined;
}

function readRollup(data: unknown): UsageRollup | undefined {
  const rollup = isObject(data) ? data.rollup : undefined;
  return isObject(rollup) && typeof rollup.totalTokens === 'number' && Array.isArray(rollup.byModelKey)
    ? (rollup as UsageRollup)
    : undefined;
}

function isSession(value: unknown): value is RemoteSessionSummary {
  return isObject(value) && typeof value.sessionId === 'string';
}
