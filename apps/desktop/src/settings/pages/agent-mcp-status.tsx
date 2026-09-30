import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ExternalAgentMcpServerStatus, HostCommand, HostResponse } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';

export function AgentMcpStatus(props: { request?: (command: HostCommand) => Promise<HostResponse>; isZh: boolean }): ReactElement {
  const [servers, setServers] = useState<ExternalAgentMcpServerStatus[]>([]);
  const [observed, setObserved] = useState(false);
  const [error, setError] = useState('');
  const request = props.request;
  const load = useCallback(async () => {
    if (!request) return;
    try {
      const response = await request({ type: 'agents/mcp-status', agentId: 'grok' });
      if (!response.success) throw new Error(response.error);
      const data = response.data as { servers?: ExternalAgentMcpServerStatus[]; observed?: boolean } | undefined;
      setServers(Array.isArray(data?.servers) ? data.servers : []);
      setObserved(data?.observed === true);
      setError('');
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  }, [request]);
  useEffect(() => { void load(); }, [load]);
  return <section data-testid="agent-backend-mcp-grok">
    <p className="muted">{props.isZh ? 'Grok MCP（只读）。不展示环境变量、请求头或命令参数；错误详情请在 Host 查看。' : 'Grok MCP (read-only). Environment, headers and arguments are never displayed; inspect error details on the Host.'}</p>
    {error ? <Notice tone="error">{error}</Notice> : null}
    {!observed ? <p className="muted">{props.isZh ? '尚未收到 Grok MCP 状态。运行一个 Grok 会话后刷新；这不表示没有服务器。' : 'No MCP status observed yet. Run a Grok session then refresh; this does not mean no servers are configured.'}</p> : null}
    <ul>{servers.map((server) => <li key={server.name}>{server.name} · {server.transport ?? '—'} · {server.status}{server.reason ? ` · ${server.reason}` : ''}</li>)}</ul>
    <code>grok mcp</code>
    <Button variant="secondary" size="compact" onClick={() => void load()}>{props.isZh ? '刷新 MCP 状态' : 'Refresh MCP status'}</Button>
  </section>;
}
