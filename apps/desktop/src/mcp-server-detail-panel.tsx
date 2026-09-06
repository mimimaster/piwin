/**
 * Expanded MCP server detail — health, launch command, tool catalog.
 */
import type { ReactElement } from 'react';
import { Button, Spinner } from '@piwin/ui-kit';
import type { McpServerConfig, McpServerHealth } from '@piwin/contracts';
import { McpToolCatalogRow } from './mcp-tool-catalog-row.js';
import {
  mcpServerCommandLine,
  mcpServerEnvKeys,
  type McpToolCatalogEntry,
} from './mcp-visibility-model.js';

export type McpServerDetailPanelProps = {
  serverId: string;
  server: McpServerConfig;
  health: McpServerHealth | undefined;
  tools: readonly McpToolCatalogEntry[];
  toolsLoading: boolean;
  toolsError: string | null;
  toolsSource: 'live' | 'cached' | null;
  isChinese: boolean;
  onRefreshTools: () => void;
  onOpenEditor: () => void;
  onTogglePinned?: (selector: string, pinned: boolean) => void;
  pinningSelector?: string | null;
};

export function McpServerDetailPanel(props: McpServerDetailPanelProps): ReactElement {
  const { isChinese, server, health } = props;
  const command = mcpServerCommandLine(server);
  const envKeys = mcpServerEnvKeys(server);
  const startedAt = health?.startedAt
    ? new Date(health.startedAt).toLocaleString(isChinese ? 'zh-CN' : 'en')
    : null;

  return (
    <div className="mcp-server-detail" data-testid={`mcp-server-detail-${props.serverId}`}>
      <section className="mcp-server-detail-section">
        <h5>{isChinese ? '运行' : 'Runtime'}</h5>
        <dl className="mcp-server-detail-grid">
          <div>
            <dt>{isChinese ? '状态' : 'Status'}</dt>
            <dd>{health?.status ?? (isChinese ? '未知' : 'unknown')}</dd>
          </div>
          {health?.pid !== undefined ? (
            <div>
              <dt>PID</dt>
              <dd>
                <code>{health.pid}</code>
              </dd>
            </div>
          ) : null}
          {startedAt ? (
            <div>
              <dt>{isChinese ? '启动时间' : 'Started'}</dt>
              <dd>{startedAt}</dd>
            </div>
          ) : null}
          {health?.lastError ? (
            <div className="mcp-server-detail-error">
              <dt>{isChinese ? '最近错误' : 'Last error'}</dt>
              <dd>{health.lastError}</dd>
            </div>
          ) : null}
          {server.restartOnCrash === true ? (
            <div>
              <dt>{isChinese ? '崩溃重启' : 'Restart on crash'}</dt>
              <dd>{isChinese ? '开（一次）' : 'On (once)'}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section className="mcp-server-detail-section">
        <h5>{isChinese ? '启动' : 'Launch'}</h5>
        <code className="mcp-server-detail-command">{command || (isChinese ? '(无命令)' : '(no command)')}</code>
        {envKeys.length > 0 ? (
          <p className="muted mcp-server-detail-env">
            {isChinese ? '环境变量键：' : 'Env keys: '}
            {envKeys.map((key) => (
              <code key={key} className="mcp-env-key">
                {key}
              </code>
            ))}
          </p>
        ) : (
          <p className="muted">{isChinese ? '无环境变量。' : 'No environment variables.'}</p>
        )}
      </section>

      <section className="mcp-server-detail-section">
        <div className="mcp-server-detail-tools-header">
          <h5>
            {isChinese ? '工具' : 'Tools'}
            {props.tools.length > 0 ? ` · ${props.tools.length}` : null}
            {props.toolsSource === 'cached' ? (
              <span className="mcp-meta-badge">{isChinese ? '缓存' : 'cached'}</span>
            ) : null}
            {props.toolsSource === 'live' ? (
              <span className="mcp-meta-badge mcp-tools-badge">
                {isChinese ? '实时' : 'live'}
              </span>
            ) : null}
          </h5>
          <div className="mcp-server-detail-tools-actions">
            <Button
              size="compact"
              variant="ghost"
              disabled={props.toolsLoading}
              onClick={props.onRefreshTools}
              data-testid={`mcp-server-refresh-tools-${props.serverId}`}
            >
              {props.toolsLoading
                ? isChinese
                  ? '加载中…'
                  : 'Loading…'
                : isChinese
                  ? '刷新工具'
                  : 'Refresh tools'}
            </Button>
            <Button
              size="compact"
              variant="ghost"
              onClick={props.onOpenEditor}
              data-testid={`mcp-server-open-editor-${props.serverId}`}
            >
              {isChinese ? '配置…' : 'Configure…'}
            </Button>
          </div>
        </div>
        {props.toolsError ? (
          <p className="mcp-server-detail-tools-error" role="alert">
            {props.toolsError}
          </p>
        ) : null}
        {props.toolsLoading && props.tools.length === 0 ? (
          <div className="mcp-server-detail-tools-loading">
            <Spinner />
          </div>
        ) : props.tools.length === 0 ? (
          <p className="muted">
            {isChinese
              ? '尚未加载工具列表。点击「刷新工具」从服务器探测。'
              : 'No tools loaded yet. Click “Refresh tools” to probe the server.'}
          </p>
        ) : (
          <ul className="mcp-tool-catalog-list">
            {props.tools.map((entry) => (
              <McpToolCatalogRow
                key={entry.selector}
                entry={entry}
                isChinese={isChinese}
                {...(props.onTogglePinned
                  ? {
                      onTogglePinned: props.onTogglePinned,
                      pinning: props.pinningSelector === entry.selector,
                    }
                  : {})}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
