import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import type { HostResponse, RemoteSessionSummary, SessionPlan, SessionSummary } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Dot, Facts, FullButton, ListRow, Pill } from '../inkstone-ui.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
import { cleanSessionPreview, formatClock, mapPermissionGate } from '../host/host-bridge.js';
import { readSessionPlan } from '../../mobile-host-readers.js';
import { createMobileIdempotencyKey, executeMobileMutation } from '../../mobile-prompt-send.js';
import { readSessionMessages, type MobileTranscriptMessage } from '../../mobile-transcript.js';

function RealPermissionSheet(): ReactElement {
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <></>;
  }
  const { host } = hostCtx;
  const gate = mapPermissionGate(host.permissionRequest);
  if (gate === undefined) {
    return (
      <>
        <p>这项请求已经处理完毕。</p>
        <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>
          知道了
        </FullButton>
      </>
    );
  }
  return (
    <>
      <Pill variant="zhu">Host 正在等待你</Pill>
      <Facts
        items={[
          ['动作', gate.title],
          ['说明', gate.detail],
          ...(gate.cwd !== undefined
            ? ([['目录', <span className="mono">{gate.cwd}</span>]] as [string, ReactElement][])
            : []),
        ]}
      />
      {gate.command !== undefined ? <div className="command">{gate.command}</div> : null}
      <label className="field">
        批准的范围
        <select
          value={state.scope}
          onChange={(event) =>
            dispatch({
              type: 'set-scope',
              scope: event.target.value as 'once' | 'session' | 'project',
            })
          }
        >
          <option value="once">仅这一次</option>
          <option value="session">本次会话</option>
          <option value="project">此项目</option>
        </select>
      </label>
      <p>这是 Host 的真实请求；落印后会按所选范围继续。</p>
      <FullButton
        onClick={() => void host.handleResolvePermission('allow', gate.requestId, state.scope)}
        disabled={host.isResolvingPermission}
      >
        允 · 批准本次操作
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => void host.handleResolvePermission('deny', gate.requestId, state.scope)}
        disabled={host.isResolvingPermission}
      >
        否 · 拒绝这次操作
      </FullButton>
    </>
  );
}

export function PermissionSheet(): ReactElement {
  if (useInkstoneHost() === null) {
    return <NeedsHost />;
  }
  return <RealPermissionSheet />;
}

export function ExecutePlanSheet(): ReactElement {
  if (useInkstoneHost() === null) {
    return <NeedsHost />;
  }
  return <RealExecutePlanSheet />;
}

function RealExecutePlanSheet(): ReactElement {
  const { dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const host = hostCtx?.host;
  const client = host?.client;
  const sessionId = host?.activeSessionId;
  const [plan, setPlan] = useState<SessionPlan | null | undefined>(undefined);
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPlan(undefined);
    setError(undefined);
    if (client === undefined || sessionId === undefined) {
      return () => {
        cancelled = true;
      };
    }
    if (!client.supportsCommand('plan/get')) {
      setPlan(null);
      setError('当前 Host 未开放计划读取。');
      return () => {
        cancelled = true;
      };
    }
    void client.request({ type: 'plan/get', sessionId }).then((response) => {
      if (cancelled) return;
      if (!response.success) {
        setPlan(null);
        setError(response.error);
        return;
      }
      setPlan(readSessionPlan(response));
    });
    return () => {
      cancelled = true;
    };
  }, [client, sessionId]);

  const execute = async (mode: 'inline' | 'subagent-driven'): Promise<void> => {
    if (
      client === undefined ||
      sessionId === undefined ||
      plan === null ||
      plan === undefined ||
      !client.supportsCommand('plan/execute')
    ) {
      return;
    }
    setBusy(true);
    try {
      const response = await client.request({
        type: 'plan/execute',
        request: {
          sessionId,
          planId: plan.id,
          mode,
          expectedRevision: plan.revision,
          ...(plan.status === 'draft' ? { approveDraft: true } : {}),
        },
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'toast', message: mode === 'inline' ? '计划已开始执行。' : '子代理计划已开始。' });
    } finally {
      setBusy(false);
    }
  };

  if (client === undefined) {
    return <p className="muted">正在连接 Host，暂时不能执行计划。</p>;
  }
  if (sessionId === undefined) {
    return <p className="muted">请先选择一个 Host 会话。</p>;
  }
  if (plan === undefined) {
    return <p className="muted">正在读取当前会话的计划…</p>;
  }
  if (plan === null) {
    return (
      <>
        <p>Host 没有返回可执行的计划。</p>
        {error !== undefined ? <p className="error-text">{error}</p> : null}
      </>
    );
  }
  const canExecute = plan.status === 'draft' || plan.status === 'approved';
  return (
    <>
      <p>
        {plan.title} · {plan.steps.length} 个步骤 · 当前状态：{plan.status}
      </p>
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      <FullButton onClick={() => void execute('inline')} disabled={busy || !canExecute}>
        普通执行
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => void execute('subagent-driven')}
        disabled={busy || !canExecute}
      >
        子代理驱动
      </FullButton>
      {!canExecute ? <p className="muted">计划当前不可再次启动。</p> : null}
      <FullButton variant="subtle" onClick={() => dispatch({ type: 'close-sheet' })}>
        暂时不执行
      </FullButton>
    </>
  );
}

export function SubagentSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedSubagentSheet hostCtx={hostCtx} />;
}

type SubagentSession = {
  id: string;
  name?: string;
  task?: string;
  lastPreview?: string;
  updatedAt?: string;
  subagentStatus?: SessionSummary['subagentStatus'];
  subagentRole?: string;
  subagentModel?: SessionSummary['subagentModel'];
};

function connectedSubagentChildren(sessions: RemoteSessionSummary[]): SubagentSession[] {
  return sessions
    .filter((session) => session.kind === 'subagent' || session.parentSessionId !== undefined)
    .map((session) => ({
      id: session.sessionId,
      ...(session.name === undefined ? {} : { name: session.name }),
      ...(session.task === undefined ? {} : { task: session.task }),
      ...(session.lastPreview === undefined ? {} : { lastPreview: session.lastPreview }),
      ...(session.updatedAt === undefined ? {} : { updatedAt: session.updatedAt }),
      ...(session.subagentStatus === undefined ? {} : { subagentStatus: session.subagentStatus }),
      ...(session.subagentRole === undefined ? {} : { subagentRole: session.subagentRole }),
      ...(session.subagentModel === undefined ? {} : { subagentModel: session.subagentModel }),
    }));
}

function subagentStatusLabel(status: SubagentSession['subagentStatus']): string {
  switch (status) {
    case 'running':
      return '工作中';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    case 'done':
      return '已完成';
    default:
      return '状态未知';
  }
}

function subagentDotStatus(status: SubagentSession['subagentStatus']): 'running' | 'done' | 'waiting' {
  if (status === 'running') return 'running';
  if (status === undefined) return 'waiting';
  return 'done';
}

function ConnectedSubagentSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const children = connectedSubagentChildren(host.sessions);
  const activeChild = children.find((child) => child.subagentStatus === 'running') ?? children[0];
  return (
    <>
      {activeChild === undefined ? (
        <>
          <p className="muted">Host 尚未返回当前会话的子代理记录。</p>
          <p className="muted">子代理启动后，这里会显示真实任务、模型和工作状态。</p>
        </>
      ) : (
        <>
          <Pill variant="azure">
            <Dot status={subagentDotStatus(activeChild.subagentStatus)} />
            子代理 · {subagentStatusLabel(activeChild.subagentStatus)}
          </Pill>
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 22, margin: '18px 0' }}>
            {activeChild.name?.trim() || activeChild.task?.trim() || '未命名子代理'}
          </h3>
          <p>{activeChild.task?.trim() || cleanSessionPreview(activeChild.lastPreview) || 'Host 尚未返回任务描述。'}</p>
          <Facts
            items={[
              ['模型', activeChild.subagentModel?.modelId ?? 'Host 未返回模型'],
              ['角色', activeChild.subagentRole ?? 'Host 子代理'],
              ['会话', <span className="mono">{activeChild.id}</span>],
            ]}
          />
        </>
      )}
      <FullButton onClick={() => dispatch({ type: 'open-sheet', key: 'intervene' })}>
        追加一条要求
      </FullButton>
      <FullButton
        variant="secondary"
        onClick={() => dispatch({ type: 'open-sheet', key: 'subagent-output' })}
      >
        查看子代理输出
      </FullButton>
    </>
  );
}

export function SubagentOutputSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedSubagentOutputSheet hostCtx={hostCtx} />;
}

function readChildSessions(response: HostResponse): SubagentSession[] {
  if (!response.success || !isRecord(response.data) || !Array.isArray(response.data.sessions)) {
    return [];
  }
  return response.data.sessions.flatMap((value): SubagentSession[] => {
    if (
      !isRecord(value) ||
      typeof value.id !== 'string' ||
      typeof value.updatedAt !== 'string'
    ) {
      return [];
    }
    return [{
      id: value.id,
      ...(typeof value.name === 'string' ? { name: value.name } : {}),
      ...(typeof value.task === 'string' ? { task: value.task } : {}),
      ...(typeof value.lastPreview === 'string' ? { lastPreview: value.lastPreview } : {}),
      updatedAt: value.updatedAt,
      ...(value.subagentStatus === 'running' || value.subagentStatus === 'done' || value.subagentStatus === 'failed' || value.subagentStatus === 'cancelled' ? { subagentStatus: value.subagentStatus } : {}),
      ...(typeof value.subagentRole === 'string' ? { subagentRole: value.subagentRole } : {}),
      ...(isRecord(value.subagentModel) && typeof value.subagentModel.modelId === 'string' && typeof value.subagentModel.providerId === 'string' ? { subagentModel: { providerId: value.subagentModel.providerId, modelId: value.subagentModel.modelId } } : {}),
    }];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function ConnectedSubagentOutputSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const [children, setChildren] = useState<SubagentSession[]>([]);
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [messages, setMessages] = useState<MobileTranscriptMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);
    const load = async (): Promise<void> => {
      if (client === undefined || host.activeSessionId === undefined) {
        setChildren([]);
        setLoading(false);
        return;
      }
      try {
        const response = client.supportsCommand('session/list-children')
          ? await client.request({ type: 'session/list-children', parentSessionId: host.activeSessionId })
          : { success: true, data: { sessions: connectedSubagentChildren(host.sessions) } } as HostResponse;
        if (!active) return;
        if (!response.success) {
          setError(response.error);
          setChildren([]);
          return;
        }
        const next = readChildSessions(response);
        const fallback = next.length > 0 ? next : connectedSubagentChildren(host.sessions);
        setChildren(fallback);
        setSelectedId((current) => fallback.some((child) => child.id === current) ? current : fallback[0]?.id);
      } catch (reason: unknown) {
        if (active) setError(reason instanceof Error ? reason.message : '读取 Host 子代理失败。');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [client, host.activeSessionId, host.sessions]);

  const selected = children.find((child) => child.id === selectedId);
  useEffect(() => {
    let active = true;
    setMessages([]);
    if (client === undefined || selectedId === undefined || !client.supportsCommand('session/messages')) {
      return () => {
        active = false;
      };
    }
    void client.request({ type: 'session/messages', sessionId: selectedId }).then((response) => {
      if (!active) return;
      if (!response.success) {
        setError(response.error);
        return;
      }
      setMessages(readSessionMessages(response));
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '读取子代理消息失败。');
    });
    return () => {
      active = false;
    };
  }, [client, selectedId]);

  const openChild = async (): Promise<void> => {
    if (selectedId === undefined) return;
    await host.handleSelectSession(selectedId);
    dispatch({ type: 'close-sheet' });
    dispatch({ type: 'navigate', route: 'chat' });
  };

  return (
    <>
      {loading ? <p className="muted">正在读取 Host 子代理记录…</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {children.map((child) => (
        <ListRow
          key={child.id}
          name="fork"
          title={child.name?.trim() || child.task?.trim() || '未命名子代理'}
          subtitle={`${subagentStatusLabel(child.subagentStatus)} · ${formatClock(child.updatedAt) || '时间未知'}`}
          selected={child.id === selectedId}
          onClick={() => setSelectedId(child.id)}
        />
      ))}
      {!loading && children.length === 0 ? <p className="muted">Host 尚未返回子代理会话。</p> : null}
      {selected !== undefined ? (
        <>
          <div className="tool-thread">
            {messages.filter((message) => message.role === 'user' || message.role === 'assistant').slice(-12).map((message) => (
              <div className="tool-step" key={message.id}>
                <Dot status={message.status === 'streaming' ? 'running' : message.status === 'error' ? 'waiting' : 'done'} />
                <span className="grow">
                  <strong>{message.role === 'user' ? '任务' : '子代理'}</strong>
                  <small>{cleanSessionPreview(message.text) || (message.status === 'streaming' ? '正在输出…' : '（无文本内容）')}</small>
                </span>
                <span>{formatClock(message.createdAt) || '—'}</span>
              </div>
            ))}
          </div>
          {messages.length === 0 ? <p className="muted">Host 尚未返回该子代理的消息。</p> : null}
          <FullButton variant="secondary" onClick={() => void openChild()}>打开子代理会话</FullButton>
        </>
      ) : null}
      <FullButton variant="subtle" onClick={() => dispatch({ type: 'navigate', route: 'review' })}>查看 Host 变更审阅</FullButton>
    </>
  );
}

export function InterveneSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedInterveneSheet hostCtx={hostCtx} />;
}

function ConnectedInterveneSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { host } = hostCtx;
  const client = host.client;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | undefined>();
  const sessionId = host.activeSessionId;
  const runId = host.activeRunId;
  const submit = async (): Promise<void> => {
    const value = text.trim();
    if (client === undefined || sessionId === undefined || runId === undefined || value.length === 0 || busy) return;
    if (!client.supportsCommand('run/intervention-submit')) {
      setMessage('当前 Host 未开放运行中介入。');
      return;
    }
    setBusy(true);
    setMessage(undefined);
    try {
      const response = await executeMobileMutation(
        (command, options) => client.request(command, options),
        {
          type: 'run/intervention-submit',
          sessionId,
          runId,
          interventionId: createMobileIdempotencyKey(),
          userMessageId: createMobileIdempotencyKey(),
          input: { text: value },
        },
        createMobileIdempotencyKey(),
      );
      if (!response.success) {
        setMessage(response.error);
        return;
      }
      setText('');
      setMessage('已转发给 Host 当前运行。');
      host.refreshActivitySummary();
    } catch (reason: unknown) {
      setMessage(reason instanceof Error ? reason.message : '转发介入要求失败。');
    } finally {
      setBusy(false);
    }
  };
  const stop = (): void => {
    if (sessionId !== undefined && runId !== undefined) void host.handleAbort({ sessionId, runId });
  };
  return (
    <>
      <p>这条消息会直接进入 Host 当前运行，不会另开本地任务。</p>
      {client === undefined ? <p className="muted">正在连接 Host…</p> : null}
      {sessionId === undefined || runId === undefined ? <p className="muted">当前没有可介入的运行。</p> : null}
      {message !== undefined ? <p className={message.startsWith('已') ? 'quote-note' : 'error-text'}>{message}</p> : null}
      <label className="field">
        追加要求
        <textarea
          placeholder="例如，也覆盖手机在后台时的恢复场景。"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <FullButton onClick={() => void submit()} disabled={busy || text.trim().length === 0 || client === undefined || sessionId === undefined || runId === undefined}>
        {busy ? '转发中…' : '转发给当前运行'}
      </FullButton>
      {runId !== undefined ? <FullButton variant="secondary" onClick={stop} disabled={busy}>停止当前运行</FullButton> : null}
    </>
  );
}

export function CommentSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedCommentSheet hostCtx={hostCtx} />;
}

function ConnectedCommentSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const [text, setText] = useState('');
  return (
    <>
      <p>Host 当前协议没有独立的行批注写入命令；这里先把意见放回 Host 会话草稿。</p>
      <label className="field">
        审阅意见
        <textarea
          placeholder="例如，这里也考虑一下旧格式的会话数据。"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </label>
      <FullButton
        onClick={() => {
          const value = text.trim();
          if (!value) return;
          const existing = host.composerText.trim();
          host.setComposerText(existing.length > 0 ? `${existing}\n\n${value}` : value);
          dispatch({ type: 'close-sheet' });
          dispatch({ type: 'toast', message: '批注已放入 Host 会话输入框' });
        }}
        disabled={text.trim().length === 0}
      >
        放入对话输入框
      </FullButton>
      <p className="muted">需要提交时，请在主会话中确认后发送。</p>
    </>
  );
}

export function ReviewOptionsSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedReviewOptionsSheet hostCtx={hostCtx} />;
}

function ConnectedReviewOptionsSheet({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  return (
    <>
      <p>审阅数据来自 Host 的子代理结果；移动端不会重置或伪造差异。</p>
      <ListRow name="cards" title="打开当前计划" subtitle="读取 Host 计划版本" onClick={() => { dispatch({ type: 'close-sheet' }); dispatch({ type: 'navigate', route: 'plan' }); }} />
      <ListRow name="copy" title="把审阅结论带回对话" subtitle={host.activeSessionId ? '回到当前 Host 会话' : '尚未选择会话'} onClick={() => { dispatch({ type: 'close-sheet' }); dispatch({ type: 'navigate', route: 'chat' }); }} />
      <FullButton variant="secondary" onClick={() => dispatch({ type: 'close-sheet' })}>关闭</FullButton>
    </>
  );
}
