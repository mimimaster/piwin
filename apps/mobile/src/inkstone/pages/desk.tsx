import { SETTINGS_CATALOG } from '../settings/settings-catalog.js';
import type { ReactElement } from 'react';
import { NeedsHost } from '../needs-host.js';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../inkstone-state.js';
import { Icon, type InkstoneIconName } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  ListRow,
  TopBar,
} from '../inkstone-ui.js';
import { endpointLabel } from './sessions.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { collectPendingPermissionSessionIds } from '../host/host-bridge.js';

export function DeskPage(): ReactElement {
  const hostCtx = useInkstoneHost();
  if (hostCtx === null) {
    return <NeedsHost what="案头" />;
  }
  return <ConnectedDesk hostCtx={hostCtx} />;
}

function ConnectedDesk({ hostCtx }: { hostCtx: InkstoneHostContextValue }): ReactElement {
  const { dispatch } = useInkstone();
  const { host } = hostCtx;
  const attentionCount = collectPendingPermissionSessionIds(host.activityItems).size;
  const isConnected = host.connectionState.kind === 'ready';
  const isConnecting = host.connectionState.kind === 'connecting';
  const isOffline = !isConnected && !isConnecting;
  const hostTitle = host.endpoint ? endpointLabel(host.endpoint) : 'Host';
  const hostSubtitle = isConnected
    ? `已连接 · ${host.sessions.length} 个会话`
    : isConnecting
      ? '正在连接…'
      : '连接已断开 · 点按管理';
  const onHostClick = hostCtx.onOpenConnection;

  const openSettings = (section: string) => {
    dispatch({ type: 'settings-section', section });
    dispatch({ type: 'navigate', route: 'settings-detail' });
  };

  const shelfTiles: [InkstoneIconName, string, string, () => void][] = [
    [
      'image',
      '资料库',
      '图片 · 视频 · 收藏',
      () => dispatch({ type: 'navigate', route: 'library' }),
    ],
    [
      'book',
      '知识中心',
      `${host.knowledgeBases.length} 个 Host 信源`,
      () => dispatch({ type: 'navigate', route: 'knowledge' }),
    ],
    [
      'refresh',
      '自动化',
      '查看与编辑 Host 定时任务',
      () => dispatch({ type: 'navigate', route: 'automations' }),
    ],
    [
      'chart',
      '用量统计',
      '读取 Host 用量',
      () => openSettings('用量统计'),
    ],
  ];

  return (
    <>
      <TopBar
        title="案头"
        subtitle="主机、资料与设置"
        right={
          <IconButton
            name="search"
            label="搜索设置"
            onClick={() => dispatch({ type: 'open-sheet', key: 'settings-search' })}
          />
        }
      />
      {isOffline ? (
        <div className="banner-offline">
          <span>连接中断 · 正在自动重连</span>
          <button onClick={onHostClick} type="button">
            管理连接
          </button>
        </div>
      ) : null}
      <div className="screen-scroll">
        <button
          className="host-card"
          onClick={onHostClick}
          type="button"
        >
          <span className="host-monogram">书</span>
          <span className="grow">
            <strong>{hostTitle}</strong>
            <small>{hostSubtitle}</small>
          </span>
          <Dot status={isConnected ? 'done' : 'waiting'} />
        </button>
        <div className="shelf-grid">
          {shelfTiles.map(([iconName, title, subtitle, onClick]) => (
            <button
              className="shelf-tile"
              key={title}
              onClick={onClick}
              type="button"
            >
              <Icon name={iconName} />
              <strong>{title}</strong>
              <small>{subtitle}</small>
            </button>
          ))}
        </div>
        <div className="section-label">设置分类</div>
        {SETTINGS_CATALOG.map(([groupName, items]) => (
          <div key={groupName}>
            <div className="group-label">
              <span>{groupName}</span>
              <span>{items.length}</span>
            </div>
            {items.map((item) => (
              <ListRow
                key={item.title}
                name={item.icon}
                title={item.title}
                subtitle={item.blurb}
                onClick={() => openSettings(item.title)}
              />
            ))}
          </div>
        ))}
        <div className="section-label">快捷随手记</div>
        <button
          className="full-button secondary"
          onClick={() => dispatch({ type: 'open-sheet', key: 'dictation' })}
          type="button"
        >
          <Icon name="mic" /> 说一句，存为便签
        </button>
      </div>
      <BottomNav
        selected="desk"
        inboxCount={attentionCount}
        onNavigate={(route) => dispatch({ type: 'navigate', route: route as InkstoneRoute })}
      />
    </>
  );
}
