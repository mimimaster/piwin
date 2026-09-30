/**
 * Settings → Agent Backends (ADR 0082).
 *
 * Shows what the *Host* reports about optional external agents (Grok Build).
 * There is no second, Desktop-local install state: every row is a projection of
 * `agents/status`, and `Check again` re-probes on the Host.
 *
 * Honesty rules this page follows (spec §2.1/§2.2):
 *   - readiness is never claimed before a real handshake succeeded;
 *   - sign-in happens on the Host machine, not here;
 *   - an operator action this build cannot perform is stated, not faked.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { ExternalAgentStatus } from '@piwin/contracts';
import { Button, Notice } from '@piwin/ui-kit';
import { useDesktopLocale } from '../../desktop-locale-context';
import { PageTitle } from '../page-title';
import { useSettings } from '../settings-context';

type LoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; agents: ExternalAgentStatus[] }
  | { kind: 'error'; message: string };

function readAgents(data: unknown): ExternalAgentStatus[] {
  const agents = (data as { agents?: ExternalAgentStatus[] } | undefined)?.agents;
  return Array.isArray(agents) ? agents : [];
}

export function AgentBackendsPage(): ReactElement {
  const { locale } = useDesktopLocale();
  const isZh = locale === 'zh-CN';
  const settings = useSettings();
  const [state, setState] = useState<LoadState>({ kind: 'idle' });

  const load = useCallback(
    async (refresh: boolean): Promise<void> => {
      const client = settings.hostClient;
      if (!client?.request) {
        setState({
          kind: 'error',
          message: isZh ? '当前 Host 不支持 Agent 状态查询。' : 'This Host cannot report agent status.',
        });
        return;
      }
      setState({ kind: 'loading' });
      try {
        const response = await client.request({
          type: 'agents/status',
          ...(refresh ? { refresh: true } : {}),
        });
        if (!response.success) {
          setState({ kind: 'error', message: response.error });
          return;
        }
        setState({ kind: 'loaded', agents: readAgents(response.data) });
      } catch (error) {
        setState({
          kind: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
    [settings.hostClient, isZh],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  return (
    <div className="settings-card" data-testid="settings-agent-backends">
      <PageTitle
        title={isZh ? 'Agent 后端' : 'Agent Backends'}
        description={
          isZh
            ? 'Pi 内置；Grok Build 为可选 Agent。状态来自当前 Host，不在本机另存一份安装状态。'
            : 'Pi is built in; Grok Build is optional. Status comes from the attached Host — there is no separate local install state.'
        }
        trailing={
          <Button
            variant="secondary"
            size="compact"
            data-testid="agent-backends-recheck"
            disabled={state.kind === 'loading'}
            onClick={() => void load(true)}
          >
            {state.kind === 'loading'
              ? isZh
                ? '检测中…'
                : 'Checking…'
              : isZh
                ? '重新检测'
                : 'Check again'}
          </Button>
        }
      />

      <p className="muted" data-testid="agent-backends-host">
        {isZh ? '当前 Host：' : 'Host: '}
        {settings.root || (isZh ? '(本地)' : '(local)')}
        {settings.hostStatus?.mock === true ? (isZh ? ' · mock' : ' · mock') : ''}
      </p>

      {state.kind === 'error' ? (
        <div data-testid="agent-backends-error">
          <Notice tone="error">{state.message}</Notice>
        </div>
      ) : null}

      {state.kind === 'loaded' && state.agents.length === 0 ? (
        <p className="muted" data-testid="agent-backends-empty">
          {isZh
            ? '这个 Host 上没有配置可选 Agent。桌面端始终可以用内置的 Pi。'
            : 'No optional agents are configured on this Host. The built-in Pi agent is always available.'}
        </p>
      ) : null}

      {state.kind === 'loaded' && state.agents.length > 0 ? (
        <ul className="agent-backends-list" data-testid="agent-backends-list">
          {state.agents.map((agent) => (
            <AgentBackendRow key={agent.agentId} agent={agent} isZh={isZh} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AgentBackendRow(props: { agent: ExternalAgentStatus; isZh: boolean }): ReactElement {
  const { agent, isZh } = props;
  const name = agent.agentId === 'grok' ? 'Grok Build' : agent.agentId;

  return (
    <li className="agent-backends-row" data-testid={`agent-backend-${agent.agentId}`}>
      <div className="agent-backends-row-main">
        <span className="agent-backends-name">{name}</span>
        <span
          className={`agent-backends-state agent-backends-state--${agent.state}`}
          data-testid={`agent-backend-state-${agent.agentId}`}
        >
          {stateLabel(agent, isZh)}
        </span>
      </div>
      <p className="muted agent-backends-detail">{stateDetail(agent, isZh)}</p>
      {agent.state === 'ready' || agent.state === 'unauthenticated' ? (
        <GrokFollowsHostNotes agent={agent} isZh={isZh} />
      ) : null}
      {agent.state !== 'ready' ? (
        <p className="muted agent-backends-next" data-testid={`agent-backend-next-${agent.agentId}`}>
          {isZh
            ? '下一步：在 Host 机器上安装/登录该 Agent 自己的 CLI，然后点“重新检测”。'
            : 'Next: install or sign in to the agent\u2019s own CLI on the Host machine, then choose “Check again”.'}
        </p>
      ) : null}
    </li>
  );
}

function GrokFollowsHostNotes(props: {
  agent: Extract<ExternalAgentStatus, { state: 'ready' | 'unauthenticated' }>;
  isZh: boolean;
}): ReactElement | null {
  if (props.agent.agentId !== 'grok') {
    return null;
  }
  const mode = props.agent.permissionMode;
  return (
    <>
      <p className="muted" data-testid="agent-backend-permission-grok">
        {props.isZh ? '当前权限模式：' : 'Permission mode: '}
        {mode === undefined
          ? props.isZh
            ? 'Grok 未报告'
            : 'not reported by Grok'
          : permissionModeLabel(mode, props.isZh)}
        {props.isZh
          ? '。piwin 中的 Grok 会话与 Grok TUI 一致，这里不能改。'
          : '. Grok sessions in piwin follow the Grok TUI. This page cannot change it.'}
      </p>
      <p className="muted" data-testid="agent-backend-mcp-grok">
        {props.isZh
          ? 'MCP：本切片不列出 Grok 的服务器。状态通知可能带有密钥，piwin 不保存、也不在这里展示。'
          : 'MCP: this build does not list Grok servers. Status notifications can carry secrets, so piwin neither stores nor shows them here.'}
      </p>
    </>
  );
}

function permissionModeLabel(mode: string, isZh: boolean): string {
  if (mode === 'always-approve') {
    return isZh ? '自动批准（always-approve）' : 'Always approve (always-approve)';
  }
  return mode;
}

function stateLabel(agent: ExternalAgentStatus, isZh: boolean): string {
  switch (agent.state) {
    case 'not-installed':
      return isZh ? '未安装' : 'Not installed';
    case 'unavailable':
      return isZh ? '不可用' : 'Unavailable';
    case 'unauthenticated':
      return isZh ? '待登录' : 'Sign-in required';
    case 'ready':
      return isZh ? '可用' : 'Ready';
  }
}

function stateDetail(agent: ExternalAgentStatus, isZh: boolean): string {
  switch (agent.state) {
    case 'not-installed':
      return isZh
        ? `未找到 CLI。已查找：${agent.searched.join('、') || '默认 PATH'}`
        : `CLI not found. Searched: ${agent.searched.join(', ') || 'default PATH'}`;
    case 'unavailable':
      return isZh
        ? `已找到 ${agent.binaryPath}，但握手失败：${agent.reason}`
        : `Found ${agent.binaryPath} but the handshake failed: ${agent.reason}`;
    case 'unauthenticated':
      return isZh
        ? `已安装 v${agent.version}（${agent.binaryPath}），需要登录`
        : `Installed v${agent.version} (${agent.binaryPath}); sign-in required`;
    case 'ready':
      return isZh
        ? `v${agent.version}（${agent.binaryPath}）· ${agent.supportStatus === 'verified' ? '已验证' : '未验证'}`
        : `v${agent.version} (${agent.binaryPath}) · ${agent.supportStatus}`;
  }
}
