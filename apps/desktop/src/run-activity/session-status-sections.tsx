/**
 * Structured Inkstone detail sections rendered inside `SessionStatusPanel`:
 * runtime overview, system prompt / Purge path card, Antigravity status,
 * and extra plugin statuses.
 */
import { useEffect, useState, type ReactElement } from 'react';
import type {
  AntigravityPanelView,
  PromptStatusView,
  SessionOverviewView,
} from './session-status-model.js';

function useCopyText(): {
  copiedKey: string | null;
  copy: (key: string, value: string) => void;
} {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    if (copiedKey === null) return;
    const timer = window.setTimeout(() => setCopiedKey(null), 1500);
    return () => window.clearTimeout(timer);
  }, [copiedKey]);

  const copy = (key: string, value: string): void => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(value).catch(() => undefined);
      }
    } catch {
      // Clipboard API may be unavailable in tests or restricted origins.
    }
    setCopiedKey(key);
  };

  return { copiedKey, copy };
}

function shortenPathMiddle(path: string, max = 44): string {
  if (path.length <= max) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 2) return `…${path.slice(-(max - 1))}`;
  const tail = parts.slice(-2).join('/');
  if (tail.length + 4 >= max) return `…/${parts.at(-1) ?? tail}`;
  return `…/${tail}`;
}

export function SessionStatusOverviewSection(props: {
  overview: SessionOverviewView;
  zh: boolean;
}): ReactElement {
  const { overview, zh } = props;
  const { copiedKey, copy } = useCopyText();
  const contextBarPct =
    overview.contextPercent !== undefined
      ? Math.max(0, Math.min(100, Math.round(overview.contextPercent)))
      : undefined;

  return (
    <div className="session-status-group" data-testid="session-status-runtime">
      <div className="session-status-label">
        <span>{zh ? '会话概况' : 'Session'}</span>
        <span className="session-status-label-meta">
          {[overview.agentLabel, overview.modeLabel, overview.permissionMode]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>

      <div className="session-status-kv-list">
        {overview.modelLabel ? (
          <div className="session-status-kv-row">
            <span className="session-status-kv-key">{zh ? '模型' : 'Model'}</span>
            <span className="session-status-kv-val" title={overview.modelLabel}>
              {overview.modelLabel}
              {overview.effortLabel ? ` · ${overview.effortLabel}` : ''}
            </span>
          </div>
        ) : null}

        {overview.contextSummary ? (
          <div className="session-status-kv-row is-stack">
            <div className="session-status-kv-pair">
              <span className="session-status-kv-key">{zh ? '上下文' : 'Context'}</span>
              <span className="session-status-kv-val is-mono">{overview.contextSummary}</span>
            </div>
            {contextBarPct !== undefined ? (
              <div className="session-status-bar-track" aria-hidden="true">
                <div
                  className={`session-status-bar-fill${contextBarPct >= 85 ? ' is-high' : ''}`}
                  style={{ width: `${contextBarPct}%` }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {overview.usageSummary || overview.cacheSummary || overview.costSummary ? (
          <div className="session-status-kv-row">
            <span className="session-status-kv-key">{zh ? '用量' : 'Usage'}</span>
            <span className="session-status-kv-val is-mono">
              {[overview.usageSummary, overview.cacheSummary, overview.costSummary]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>
        ) : null}

        {overview.workspacePath ? (
          <div className="session-status-kv-row">
            <span className="session-status-kv-key">{zh ? '工作区' : 'Workspace'}</span>
            <button
              type="button"
              className="session-status-copy-btn"
              title={overview.workspacePath}
              onClick={() => copy('workspace', overview.workspacePath ?? '')}
            >
              <span>{copiedKey === 'workspace' ? (zh ? '已复制' : 'Copied') : shortenPathMiddle(overview.workspacePath)}</span>
            </button>
          </div>
        ) : null}

        {overview.sessionId || overview.nativeSessionId ? (
          <div className="session-status-kv-row">
            <span className="session-status-kv-key">{zh ? '会话 ID' : 'Session ID'}</span>
            <button
              type="button"
              className="session-status-copy-btn is-mono"
              title={[overview.sessionId, overview.nativeSessionId].filter(Boolean).join(' / ')}
              onClick={() =>
                copy('sessionId', overview.nativeSessionId ?? overview.sessionId ?? '')
              }
            >
              <span>
                {copiedKey === 'sessionId'
                  ? zh
                    ? '已复制'
                    : 'Copied'
                  : (overview.nativeSessionId ?? overview.sessionId ?? '').slice(0, 14)}
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function SessionStatusPromptSection(props: {
  prompt: PromptStatusView;
  zh: boolean;
}): ReactElement {
  const { prompt, zh } = props;
  const { copiedKey, copy } = useCopyText();

  return (
    <div className="session-status-group" data-testid="session-status-prompt">
      <div className="session-status-label">
        <span>{zh ? '系统提示词 · Purge' : 'System Prompt · Purge'}</span>
        <span className={`session-status-pill is-${prompt.tone}`} data-testid="session-status-prompt-badge">
          {prompt.badge}
        </span>
      </div>

      {prompt.activePath ? (
        <div className="session-status-path-box">
          <div className="session-status-path-head">
            <span className="session-status-path-caption">
              {zh ? '正在生效的提示词路径' : 'Active prompt path'}
            </span>
            <button
              type="button"
              className="session-status-copy-btn"
              data-testid="session-status-copy-prompt-path"
              onClick={() => copy('activePath', prompt.activePath ?? '')}
            >
              {copiedKey === 'activePath' ? (zh ? '已复制' : 'Copied') : zh ? '复制' : 'Copy'}
            </button>
          </div>
          <code className="session-status-path-value" data-testid="session-status-active-prompt-path">
            {prompt.activePath}
          </code>
        </div>
      ) : (
        <div className="session-status-subnote" data-testid="session-status-active-prompt-path">
          {prompt.hint ??
            (zh
              ? '未覆盖外部文件（当前使用引擎内置默认提示词）'
              : 'No external prompt file (engine built-in default active)')}
        </div>
      )}

      {prompt.candidatePath ? (
        <div className="session-status-kv-row is-compact">
          <span className="session-status-kv-key">{zh ? '候选路径' : 'Candidate'}</span>
          <button
            type="button"
            className="session-status-copy-btn is-mono"
            title={prompt.candidatePath}
            onClick={() => copy('candidatePath', prompt.candidatePath ?? '')}
          >
            {copiedKey === 'candidatePath'
              ? zh
                ? '已复制'
                : 'Copied'
              : shortenPathMiddle(prompt.candidatePath, 34)}
          </button>
        </div>
      ) : null}

      {prompt.appendPath ? (
        <div className="session-status-kv-row is-compact">
          <span className="session-status-kv-key">{zh ? '追加文件' : 'Append'}</span>
          <span className="session-status-kv-val is-mono" title={prompt.appendPath}>
            {shortenPathMiddle(prompt.appendPath, 34)}
          </span>
        </div>
      ) : null}

      {prompt.charsLabel || prompt.agentsCount !== undefined || prompt.surgeLabel ? (
        <div className="session-status-subnote">
          {[
            prompt.charsLabel,
            prompt.agentsCount !== undefined && prompt.agentsCount > 0
              ? `AGENTS ×${prompt.agentsCount}`
              : undefined,
            prompt.surgeLabel ? `Surge: ${prompt.surgeLabel}` : undefined,
          ]
            .filter(Boolean)
            .join(' · ')}
        </div>
      ) : null}

      {prompt.error ? (
        <div className="session-status-warning" role="alert">
          {prompt.error}
        </div>
      ) : null}
    </div>
  );
}

export function SessionStatusAntigravitySection(props: {
  antigravity: AntigravityPanelView;
  zh: boolean;
}): ReactElement {
  const { antigravity, zh } = props;
  return (
    <div className="session-status-group" data-testid="session-status-antigravity">
      <div className="session-status-label">
        <span>Antigravity ACP</span>
        {antigravity.autoRebuildLabel ? (
          <span className="session-status-label-meta">{antigravity.autoRebuildLabel}</span>
        ) : null}
      </div>

      <div className="session-status-kv-list">
        <div className="session-status-kv-row">
          <span className="session-status-kv-key">{zh ? '账号' : 'Account'}</span>
          <span className="session-status-kv-val is-mono">
            {antigravity.accountLabel}
            {antigravity.proxyLabel ? ` · ${antigravity.proxyLabel}` : ''}
            {antigravity.cooldownCount ? (zh ? ` · 冷却 ${antigravity.cooldownCount}` : ` · ${antigravity.cooldownCount} cool`) : ''}
          </span>
        </div>

        <div className="session-status-kv-row">
          <span className="session-status-kv-key">{zh ? '路由健康' : 'Route'}</span>
          <span className={`session-status-kv-val${antigravity.routeDegraded ? ' is-warn' : ''}`}>
            {antigravity.routeText ?? (zh ? '正常' : 'Normal')}
          </span>
        </div>

        {antigravity.quotaBuckets.length > 0 ? (
          <div className="session-status-quota-grid">
            {antigravity.quotaBuckets.map((bucket) => (
              <div key={bucket.id} className="session-status-quota-item">
                <div className="session-status-quota-head">
                  <span>{bucket.label}</span>
                  <span className="is-mono">
                    {bucket.remainingPct}%
                    {bucket.resetLabel ? ` (${bucket.resetLabel})` : ''}
                  </span>
                </div>
                <div className="session-status-bar-track" aria-hidden="true">
                  <div
                    className={`session-status-bar-fill${bucket.remainingPct <= 15 ? ' is-high' : ''}`}
                    style={{ width: `${bucket.remainingPct}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        ) : antigravity.quotaHeadline ? (
          <div className="session-status-kv-row">
            <span className="session-status-kv-key">{zh ? '配额' : 'Quota'}</span>
            <span className="session-status-kv-val is-mono">{antigravity.quotaHeadline}</span>
          </div>
        ) : null}

        {antigravity.quotaError ? (
          <div className="session-status-subnote">{antigravity.quotaError}</div>
        ) : null}
      </div>
    </div>
  );
}

export function SessionStatusExtraStatusesSection(props: {
  items: readonly { key: string; text: string }[];
  zh: boolean;
}): ReactElement {
  return (
    <div className="session-status-group" data-testid="session-status-extensions">
      <div className="session-status-label">
        <span>{props.zh ? '扩展状态' : 'Extensions'}</span>
      </div>
      <div className="session-status-kv-list">
        {props.items.map((item) => (
          <div key={item.key} className="session-status-kv-row">
            <span className="session-status-kv-key">{item.key}</span>
            <span className="session-status-kv-val is-mono">{item.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
