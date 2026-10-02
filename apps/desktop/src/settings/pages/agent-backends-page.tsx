/**
 * Settings → Agent Backends.
 *
 * Rows come from installed extension `sessionBackend` declarations. Enable and
 * disable use the extension registry. This page does not install a bundled
 * adapter and does not keep a second agent inventory.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import type { ExtensionSummary, ExternalAgentStatus } from '@piwin/contracts';
import { Button, Notice, Switch } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { useSettings } from '../settings-context';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; extensions: ExtensionSummary[]; agents: ExternalAgentStatus[] }
  | { kind: 'error'; message: string };

function readExtensions(data: unknown): ExtensionSummary[] {
  const extensions = (data as { extensions?: ExtensionSummary[] } | undefined)?.extensions;
  return Array.isArray(extensions) ? extensions : [];
}

function readAgents(data: unknown): ExternalAgentStatus[] {
  const agents = (data as { agents?: ExternalAgentStatus[] } | undefined)?.agents;
  return Array.isArray(agents) ? agents : [];
}

export function AgentBackendsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const settings = useSettings();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setHeaderSlot(document.getElementById('settings-main-header-actions'));
  }, []);

  const load = useCallback(async (refresh: boolean): Promise<void> => {
    const client = settings.hostClient;
    if (!client?.request) {
      setState({
        kind: 'error',
        message: isZh ? '当前 Host 不支持扩展或 Agent 状态查询。' : 'This Host cannot report extensions or agent status.',
      });
      return;
    }
    setState({ kind: 'loading' });
    try {
      const [extensionsRes, statusRes] = await Promise.all([
        client.request({ type: 'extensions/list' }),
        client.request({ type: 'agents/status', ...(refresh ? { refresh: true } : {}) }),
      ]);
      if (!extensionsRes.success) {
        setState({ kind: 'error', message: extensionsRes.error });
        return;
      }
      if (!statusRes.success) {
        setState({ kind: 'error', message: statusRes.error });
        return;
      }
      setState({
        kind: 'loaded',
        extensions: readExtensions(extensionsRes.data),
        agents: readAgents(statusRes.data),
      });
    } catch (failure) {
      setState({ kind: 'error', message: failure instanceof Error ? failure.message : String(failure) });
    }
  }, [settings.hostClient, isZh]);

  useEffect(() => {
    void load(false);
  }, [load]);

  const backends = state.kind === 'loaded'
    ? state.extensions.filter((extension) => extension.sessionBackend !== undefined)
    : [];

  async function toggle(extension: ExtensionSummary, enabled: boolean): Promise<void> {
    const client = settings.hostClient;
    if (!client?.request || busyId !== null) return;
    setBusyId(extension.id);
    setError('');
    try {
      const response = await client.request({
        type: 'extensions/set_enabled',
        extensionId: extension.id,
        enabled,
      });
      if (!response.success) throw new Error(response.error);
      await load(enabled);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusyId(null);
    }
  }

  const recheckButton = (
    <Button
      variant="secondary"
      size="compact"
      data-testid="agent-backends-recheck"
      disabled={state.kind === 'loading'}
      onClick={() => void load(true)}
    >
      {state.kind === 'loading' ? (isZh ? '检测中…' : 'Checking…') : (isZh ? '重新检测' : 'Check again')}
    </Button>
  );

  return (
    <div className="settings-card" data-testid="settings-agent-backends">
      {headerSlot ? (
        createPortal(recheckButton, headerSlot)
      ) : (
        <div className="agent-backends-toolbar">{recheckButton}</div>
      )}
      {state.kind === 'error' ? <Notice tone="error">{state.message}</Notice> : null}
      {error !== '' ? <Notice tone="error">{error}</Notice> : null}
      {state.kind === 'loaded' && backends.length === 0 ? (
        <p className="muted" data-testid="agent-backends-empty">
          {isZh
            ? '没有已安装的会话后端扩展。到扩展页安装一个带 sessionBackend 声明的扩展。'
            : 'No session-backend extension is installed. Install one from Extensions.'}
        </p>
      ) : null}
      <ul className="agent-backends-list" data-testid="agent-backends-list">
        {backends.map((extension) => {
          const backend = extension.sessionBackend;
          if (backend === undefined) return null;
          const status = state.kind === 'loaded'
            ? state.agents.find((agent) => agent.agentId === backend.id)
            : undefined;
          return (
            <li key={extension.id} className="agent-backends-row" data-testid={`agent-backend-${backend.id}`}>
              <div className="agent-backends-row-main">
                <span className="agent-backends-name">{backend.name}</span>
                <Switch
                  checked={extension.enabled}
                  disabled={busyId === extension.id}
                  testId={`agent-backend-toggle-${backend.id}`}
                  aria-label={isZh ? `启用 ${backend.name}` : `Enable ${backend.name}`}
                  onCheckedChange={(checked) => void toggle(extension, checked)}
                />
              </div>
              <p className="muted agent-backends-detail" data-testid={`agent-backend-state-${backend.id}`}>
                {extension.enabled ? stateDetail(status, isZh) : (isZh ? '已停用' : 'Disabled')}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function stateDetail(agent: ExternalAgentStatus | undefined, isZh: boolean): string {
  if (agent === undefined) return isZh ? '尚未检测 CLI' : 'CLI not checked yet';
  switch (agent.state) {
    case 'not-installed':
      return isZh ? '本机未找到该后端的 CLI。安装官方 CLI 后点重新检测。' : 'This backend’s CLI was not found. Install it, then check again.';
    case 'unavailable':
      return agent.reason;
    case 'unauthenticated':
      return isZh ? `已安装 v${agent.version}，需要在 Host 上登录。` : `Installed v${agent.version}; sign in on the Host.`;
    case 'ready':
      return isZh ? `可用 · v${agent.version}` : `Ready · v${agent.version}`;
  }
}
