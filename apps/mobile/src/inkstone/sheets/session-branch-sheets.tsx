import { useEffect, useState, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import type {
  HostResponse,
  SessionBranchListData,
  SessionBranchSwitchData,
  WorkspaceWrites,
} from '@piwin/contracts';
import { isRecord } from '../../mobile-host-helpers.js';
import { useInkstone } from '../inkstone-context.js';
import { Dot, FullButton, ListRow } from '../inkstone-ui.js';
import { formatClock } from '../host/host-bridge.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';


function readBranchList(response: HostResponse): SessionBranchListData | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.sessionId !== 'string' || typeof response.data.revision !== 'string' || !Array.isArray(response.data.branchPoints)) {
    return undefined;
  }
  const branchPoints = response.data.branchPoints.filter((value): value is SessionBranchListData['branchPoints'][number] => {
    if (!isRecord(value) || (value.anchorMessageId !== null && typeof value.anchorMessageId !== 'string') || !Number.isSafeInteger(value.activeIndex) || !Array.isArray(value.siblings)) {
      return false;
    }
    return value.siblings.every((sibling) => {
      if (!isRecord(sibling) || typeof sibling.headMessageId !== 'string' || (sibling.role !== 'user' && sibling.role !== 'assistant') || typeof sibling.preview !== 'string' || typeof sibling.leafPreview !== 'string' || !Number.isSafeInteger(sibling.messageCount) || typeof sibling.writesWorkspace !== 'boolean' || typeof sibling.updatedAt !== 'string') {
        return false;
      }
      return (
        (sibling.responsePreview === undefined || typeof sibling.responsePreview === 'string') &&
        (sibling.responseStatus === undefined || (typeof sibling.responseStatus === 'string' && ['done', 'error', 'streaming', 'interrupted'].includes(sibling.responseStatus)))
      );
    });
  });
  if (branchPoints.length !== response.data.branchPoints.length) return undefined;
  return { sessionId: response.data.sessionId, revision: response.data.revision, branchPoints };
}

function readBranchSwitch(response: HostResponse): SessionBranchSwitchData | undefined {
  if (!response.success || !isRecord(response.data) || typeof response.data.status !== 'string') return undefined;
  if (response.data.status === 'run-active') return { status: 'run-active' };
  if (response.data.status === 'needs-confirmation' && isRecord(response.data.offPathWrites)) {
    const writes = response.data.offPathWrites;
    if (!Array.isArray(writes.files) || !writes.files.every((file) => typeof file === 'string') || typeof writes.hasUnknownWrites !== 'boolean') {
      return undefined;
    }
    const offPathWrites: WorkspaceWrites = {
      files: writes.files,
      hasUnknownWrites: writes.hasUnknownWrites,
    };
    return { status: 'needs-confirmation', offPathWrites };
  }
  if (response.data.status === 'switched' && typeof response.data.sessionId === 'string' && typeof response.data.activeLeafMessageId === 'string' && isRecord(response.data.session)) {
    return response.data as unknown as SessionBranchSwitchData;
  }
  return undefined;
}

export function BranchesSheet(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedBranchesSheet hostCtx={hostCtx} />;
}

function ConnectedBranchesSheet({
  hostCtx,
}: {
  hostCtx: InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const client = host.client;
  const sessionId = host.activeSessionId;
  const [branchList, setBranchList] = useState<SessionBranchListData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [confirmation, setConfirmation] = useState<WorkspaceWrites | undefined>();
  const [switchTarget, setSwitchTarget] = useState<string | undefined>();
  const [working, setWorking] = useState(false);
  const [loading, setLoading] = useState(false);
  const canSwitchBranches = client?.supportsCommand('session/branch-switch') === true;
  const canFork = client?.supportsCommand('session/fork') === true;

  useEffect(() => {
    if (client === undefined || sessionId === undefined) {
      setLoading(false);
      return;
    }
    if (!client.supportsCommand('session/branch-list')) {
      setLoading(false);
      setError('当前 Host 未开放会话分支浏览。');
      return;
    }
    let active = true;
    setLoading(true);
    setError(undefined);
    void client.request({ type: 'session/branch-list', sessionId }).then((response) => {
      if (!active) return;
      if (!response.success) {
        setError(response.error);
        return;
      }
      const value = readBranchList(response);
      if (value === undefined) setError('Host 返回了无法识别的分支数据。');
      else setBranchList(value);
      setLoading(false);
    }).catch((reason: unknown) => {
      if (active) {
        setError(reason instanceof Error ? reason.message : '读取会话分支失败。');
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [client, sessionId]);

  const switchBranch = async (targetMessageId: string, confirm = false): Promise<void> => {
    if (
      client === undefined ||
      sessionId === undefined ||
      !canSwitchBranches ||
      working
    ) {
      setError('当前 Host 未开放分支切换。');
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      const response = await client.request({
        type: 'session/branch-switch',
        sessionId,
        targetMessageId,
        messageProjection: 'tail',
        ...(confirm ? { confirm: true } : {}),
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      const result = readBranchSwitch(response);
      if (result?.status === 'needs-confirmation') {
        setConfirmation(result.offPathWrites);
        setSwitchTarget(targetMessageId);
        return;
      }
      if (result?.status === 'run-active') {
        setError('当前会话仍在运行，请等待完成后再切换分支。');
        return;
      }
      if (result?.status !== 'switched') {
        setError('Host 未返回可识别的分支切换结果。');
        return;
      }
      await host.handleSelectSession(sessionId);
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'toast', message: '已切换到 Host 分支' });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '切换分支失败。');
    } finally {
      setWorking(false);
    }
  };

  const forkSession = async (): Promise<void> => {
    if (client === undefined || sessionId === undefined || !canFork || working) {
      setError('当前 Host 未开放会话分叉。');
      return;
    }
    setWorking(true);
    setError(undefined);
    try {
      const response = await client.request({
        type: 'session/fork',
        sessionId,
        workspaceStrategy: 'shared',
        messageProjection: 'none',
      });
      if (!response.success) {
        setError(response.error);
        return;
      }
      if (!isRecord(response.data) || typeof response.data.sessionId !== 'string') {
        setError('Host 未返回新分支会话 ID。');
        return;
      }
      await host.handleSelectSession(response.data.sessionId);
      dispatch({ type: 'close-sheet' });
      dispatch({ type: 'navigate', route: 'chat' });
      dispatch({ type: 'toast', message: '已从当前 Host 会话创建分支' });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : '创建分支失败。');
    } finally {
      setWorking(false);
    }
  };

  if (sessionId === undefined) {
    return <p className="muted">Host 尚未选择会话。</p>;
  }
  return (
    <>
      <p>分支、切换和分叉均由 Host 保存；手机只展示并转发当前选择。</p>
      {client === undefined ? <p className="muted">正在连接 Host…</p> : null}
      {error !== undefined ? <p className="error-text">{error}</p> : null}
      {confirmation !== undefined ? (
        <div className="notice">
          <Dot status="waiting" />
          <span className="grow">
            目标分支之外有 {confirmation.files.length} 个文件写入
            {confirmation.hasUnknownWrites ? '（另有未归类写入）' : ''}
          </span>
          <FullButton
            onClick={() => {
              if (switchTarget !== undefined) void switchBranch(switchTarget, true);
              setConfirmation(undefined);
            }}
            disabled={working || switchTarget === undefined}
          >
            确认切换
          </FullButton>
        </div>
      ) : null}
      {branchList?.branchPoints.map((point, pointIndex) => (
        <div className="tool-thread" key={`${point.anchorMessageId ?? 'root'}:${pointIndex}`}>
          <div className="section-label">分叉点 {pointIndex + 1}</div>
          {point.siblings.map((sibling, siblingIndex) => (
            <ListRow
              key={sibling.headMessageId}
              name="branch"
              title={sibling.preview || '未命名分支'}
              subtitle={`${sibling.role === 'assistant' ? '回答版本' : '提示分支'} · ${sibling.messageCount} 条消息 · ${formatClock(sibling.updatedAt) || '时间未知'}`}
              trailing={siblingIndex === point.activeIndex ? '当前' : undefined}
              selected={siblingIndex === point.activeIndex}
              onClick={() => void switchBranch(sibling.headMessageId)}
            />
          ))}
        </div>
      ))}
      {branchList !== undefined && branchList.branchPoints.length === 0 ? (
        <p className="muted">Host 返回当前路径没有可切换的分叉。</p>
      ) : null}
      {loading ? <p className="muted">正在读取 Host 分支…</p> : null}
      <FullButton onClick={() => void forkSession()} disabled={working || client === undefined || !canFork}>
        {working ? '处理中…' : '从当前消息分叉'}
      </FullButton>
    </>
  );
}
