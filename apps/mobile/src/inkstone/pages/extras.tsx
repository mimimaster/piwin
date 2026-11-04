import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { readWalkthroughArtifacts } from '../../mobile-host-readers.js';
import { type WalkthroughArtifact } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import {
  Dot,
  FullButton,
  Pill,
  ScreenHeading,
  TopBar,
} from '../inkstone-ui.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { MobileMarkdown } from '../../components/chat/MobileMarkdown.js';

function ConnectedConnectPage({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host, onOpenConnection } = hostCtx;
  const ready = host.connectionState.kind === 'ready';
  return (
    <>
      <TopBar
        title="私有 Host"
        subtitle="设备与连接"
        onBack={() => dispatch({ type: 'navigate', route: 'desk' })}
      />
      <div className="screen-scroll">
        <div className="empty-state">
          <span className="brand-seal">砚</span>
          <h2>连回自己的书案。</h2>
          <p>
            项目、模型和会话都在你的 Host。
            <br />
            手机只是另一扇窗。
          </p>
        </div>
        <button className="host-card" onClick={onOpenConnection} type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>{(host.endpoint ?? '').replace(/^wss?:\/\//, '') || '私有 Host'}</strong>
            <small>{ready ? '已连接 · 正在与桌面同步' : '连接中…'}</small>
          </span>
          <Dot status={ready ? 'done' : 'waiting'} />
        </button>
        <FullButton onClick={onOpenConnection}>管理连接</FullButton>
        <FullButton variant="secondary" onClick={() => void host.handleDisconnect()}>
          断开连接
        </FullButton>
        <div className="quote-note">凭据保存在设备密钥库，连接由现有配对流程负责。</div>
      </div>
    </>
  );
}

export function ConnectPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedConnectPage hostCtx={hostCtx} />;
}

export function WalkthroughPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedWalkthroughPage hostCtx={hostCtx} />;
}


function ConnectedWalkthroughPage({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const sessionId = host.activeSessionId;
  const [artifacts, setArtifacts] = useState<WalkthroughArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  const load = async (): Promise<void> => {
    if (client === undefined || sessionId === undefined) {
      setLoading(false);
      return;
    }
    if (!client.supportsCommand('walkthrough/list')) {
      setError('当前 Host 未开放走查记录读取。');
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await client.request({ type: 'walkthrough/list', sessionId });
      if (!response.success) {
        setError(response.error);
      } else {
        setArtifacts(readWalkthroughArtifacts(response));
        setError(undefined);
      }
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '读取 Host 走查记录失败。');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [client, sessionId]);

  const generate = async (): Promise<void> => {
    if (client === undefined || sessionId === undefined || !client.supportsCommand('walkthrough/generate')) return;
    const message = [...host.messages].reverse().find((item) => item.role === 'assistant');
    if (message === undefined) {
      setError('当前会话还没有可生成走查的助手消息。');
      return;
    }
    const response = await client.request({
      type: 'walkthrough/generate',
      sessionId,
      messageId: message.id,
      ...(message.runId === undefined ? {} : { runId: message.runId }),
    });
    if (!response.success) {
      setError(response.error);
      return;
    }
    await load();
  };

  return (
    <>
      <TopBar title="报告" subtitle="Host · 当前会话" onBack={() => dispatch({ type: 'navigate', route: 'desk' })} />
      <div className="screen-scroll">
        <ScreenHeading title="把交付讲清楚。" subtitle="走查内容由 Host 生成并保存。" />
        {client === undefined ? <p className="muted">正在连接 Host，暂时没有走查记录。</p> : null}
        {sessionId === undefined ? <p className="muted">先选择一个 Host 会话。</p> : null}
        {loading ? <p className="muted">正在读取 Host 走查记录…</p> : null}
        {error !== undefined ? <p className="error-text">{error}</p> : null}
        {!loading && artifacts.length === 0 && error === undefined ? <p className="muted">当前会话还没有报告。</p> : null}
        {artifacts.map((artifact) => (
          <article className="note-paper" key={artifact.id}>
            <div className="spread">
              <Pill variant={artifact.status === 'ready' ? 'pine' : artifact.status === 'error' ? 'zhu' : 'azure'}>
                {artifact.status === 'ready' ? '已完成' : artifact.status === 'error' ? '生成失败' : '生成中'}
              </Pill>
              <span className="muted mono">{artifact.updatedAt}</span>
            </div>
            {artifact.status === 'ready' ? <article className="assistant-prose"><MobileMarkdown content={artifact.markdown} /></article> : null}
            {artifact.status === 'error' ? <p className="error-text">{artifact.error.message}</p> : null}
            {artifact.status === 'generating' ? <p className="muted">Host 正在生成走查内容…</p> : null}
          </article>
        ))}
        <FullButton onClick={() => void generate()} disabled={client === undefined || sessionId === undefined || !client?.supportsCommand('walkthrough/generate')}>
          请求 Host 生成走查
        </FullButton>
      </div>
    </>
  );
}
