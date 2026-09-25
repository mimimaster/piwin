import { useEffect, useState, type CSSProperties, type ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { HostSettingsDetail } from '../settings/HostSettingsDetail.js';
import type { HostResponse } from '@piwin/contracts';
import { useInkstone } from '../inkstone-context.js';
import { Dot, IconButton, ListRow, ScreenHeading, TopBar } from '../inkstone-ui.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';

export const SETTINGS_GROUPS: [string, string[]][] = [
  ['应用', ['通用与外观', '权限与安全']],
  ['Agent', ['模型配置', 'OAuth 登录', 'Hooks', '智能体策略']],
  ['集成', ['技能与扩展', '网络搜索与抓取', '知识库与向量']],
  ['系统', ['会话与运行时', '冷存储', '用量统计', '归档管理']],
];

export function FaceSwitch({ fullWidth = false }: { fullWidth?: boolean }): ReactElement {
  const { state, dispatch } = useInkstone();
  const style: CSSProperties | undefined = fullWidth
    ? { width: '100%', margin: '18px 0' }
    : undefined;
  return (
    <div className="face-switch" style={style}>
      <button
        style={fullWidth ? { flex: 1 } : undefined}
        aria-pressed={state.face === 'paper'}
        onClick={() => dispatch({ type: 'set-face', face: 'paper' })}
        type="button"
      >
        纸 · Paper
      </button>
      <button
        style={fullWidth ? { flex: 1 } : undefined}
        aria-pressed={state.face === 'ink'}
        onClick={() => dispatch({ type: 'set-face', face: 'ink' })}
        type="button"
      >
        墨 · Ink
      </button>
    </div>
  );
}

export function SettingsPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <ConnectedSettingsPage hostCtx={hostCtx} />;
}

export function SettingsDetailPage(): ReactElement {
  const { state } = useInkstone();
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost />;
  }
  return <HostSettingsDetail hostCtx={hostCtx} section={state.settingsSection} />;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readSettingsRevision(response: HostResponse): string | undefined {
  if (!response.success || !isRecord(response.data) || !isRecord(response.data.snapshot)) {
    return undefined;
  }
  return typeof response.data.snapshot.revision === 'string'
    ? response.data.snapshot.revision
    : undefined;
}

function connectedStateLabel(kind: string): string {
  switch (kind) {
    case 'ready':
      return '已连接 · Host 实时同步';
    case 'connecting':
      return '正在连接 Host…';
    case 'disconnected':
      return '连接已断开';
    case 'error':
      return 'Host 连接错误';
    default:
      return '等待 Host';
  }
}

function ConnectedSettingsPage({
  hostCtx,
}: {
  hostCtx: import('../host/inkstone-host-context.js').InkstoneHostContextValue;
}): ReactElement {
  const { dispatch } = useInkstone();
  const { host, onOpenConnection } = hostCtx;
  const [revision, setRevision] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    const client = host.client;
    if (client === undefined || !client.supportsCommand('settings/get')) {
      setRevision(undefined);
      return;
    }
    let active = true;
    void client
      .request({ type: 'settings/get' })
      .then((response) => {
        if (!active) return;
        setRevision(readSettingsRevision(response));
        setError(response.success ? undefined : response.error);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : '读取 Host 设置失败。');
      });
    return () => {
      active = false;
    };
  }, [host.client]);

  const openSection = (section: string) => {
    dispatch({ type: 'settings-section', section });
  };
  const modelSummary =
    host.configuredModels.length === 0
      ? 'Host 尚未返回可用模型'
      : `${host.configuredModels.length} 个可用模型`;
  const sessionSummary = `${host.sessions.length} 个会话 · ${host.activityItems.filter((item) => item.status === 'running').length} 个运行中`;
  const knowledgeSummary = `${host.knowledgeBases.length} 个知识库 · Host 索引`;
  const summaries: Record<string, string> = {
    '通用与外观': connectedStateLabel(host.connectionState.kind),
    '权限与安全': host.client?.supportsCommand('permissions/get-rules') ? '规则由 Host 管理' : 'Host 未开放权限规则读取',
    '模型配置': modelSummary,
    'OAuth 登录': '凭据只在 Host 侧管理',
    Hooks: host.client?.supportsCommand('hooks/list') ? 'Host Hook 状态' : 'Host 未开放 Hook 读取',
    智能体策略: `${sessionSummary} · 子代理结果由 Host 返回`,
    '技能与扩展': 'Host 技能、MCP 与插件目录',
    '网络搜索与抓取': '能力与来源由 Host 声明',
    '知识库与向量': knowledgeSummary,
    '会话与运行时': sessionSummary,
    冷存储: host.client?.supportsCommand('session/pack-list') ? 'Host 归档包状态' : 'Host 未开放归档包读取',
    用量统计: host.client?.supportsCommand('usage/get-rollup') ? 'Host 用量汇总' : 'Host 未开放用量汇总',
    归档管理: `${host.sessions.filter((session) => session.archived === true).length} 个已归档会话`,
  };

  return (
    <>
      <TopBar
        title="设置"
        onBack={() => dispatch({ type: 'navigate', route: 'desk' })}
        right={<IconButton name="search" label="搜索设置" onClick={() => dispatch({ type: 'open-sheet', key: 'settings-search' })} />}
      />
      <div className="screen-scroll">
        <ScreenHeading title="让工具，顺手。" subtitle="设备偏好与 Host 配置各归其位。" />
        <FaceSwitch fullWidth />
        <button className="host-card" onClick={onOpenConnection} type="button">
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>{host.endpoint}</strong>
            <small>{connectedStateLabel(host.connectionState.kind)}</small>
          </span>
          <Dot status={host.connectionState.kind === 'ready' ? 'done' : 'waiting'} />
        </button>
        {revision !== undefined ? <p className="muted">Host 设置版本 · {revision}</p> : null}
        {error !== undefined ? <p className="error-text">{error}</p> : null}
        {SETTINGS_GROUPS.map(([group, items]) => (
          <div key={group}>
            <div className="section-label">{group}</div>
            {items.map((title) => (
              <ListRow
                key={title}
                name={title.includes('模型') ? 'bulb' : 'sliders'}
                title={title}
                subtitle={summaries[title] ?? '由 Host 提供实时状态'}
                onClick={() => openSection(title)}
              />
            ))}
          </div>
        ))}
        <div className="section-label">设备与连接</div>
        <ListRow name="globe" title="私有 Host" subtitle={connectedStateLabel(host.connectionState.kind)} onClick={onOpenConnection} />
        <ListRow name="bulb" title="移动端通知" subtitle="通知偏好保留在本设备" onClick={() => dispatch({ type: 'open-sheet', key: 'notifications' })} />
      </div>
    </>
  );
}
