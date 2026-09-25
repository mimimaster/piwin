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
  ScreenHeading,
  TopBar,
} from '../inkstone-ui.js';
import { endpointLabel } from './sessions.js';
import { useInkstoneHost, type InkstoneHostContextValue } from '../host/inkstone-host-context.js';
import { collectPendingPermissionSessionIds } from '../host/host-bridge.js';

interface SettingsItem {
  title: string;
  icon: InkstoneIconName;
  subtitle: string;
}

const SETTINGS_GROUPS: [string, SettingsItem[]][] = [
  [
    '应用',
    [
      { title: '通用与外观', icon: 'gear', subtitle: '外观主题与桌面接入' },
      { title: '权限与安全', icon: 'shield', subtitle: 'Auto / Ask / YOLO 三态规则' },
    ],
  ],
  [
    'Agent',
    [
      { title: '模型配置', icon: 'bulb', subtitle: 'Claude · OpenAI · 自定义 API' },
      { title: 'OAuth 登录', icon: 'key', subtitle: 'Codex 与 Gemini 账号凭据' },
      { title: 'Hooks', icon: 'bolt', subtitle: '会话生命周期自动化检查' },
      { title: '智能体策略', icon: 'fork', subtitle: '子代理编排方案与沙箱' },
    ],
  ],
  [
    '集成',
    [
      { title: '技能与扩展', icon: 'puzzle', subtitle: 'Skills · MCP · 插件市场' },
      { title: '网络搜索与抓取', icon: 'globe', subtitle: 'DuckDuckGo · 网页抓取' },
      { title: '知识库与向量', icon: 'book', subtitle: '向量索引与词条库' },
    ],
  ],
  [
    '系统',
    [
      { title: '会话与运行时', icon: 'term', subtitle: '恢复策略与阅读断点保留' },
      { title: '冷存储', icon: 'archive', subtitle: '2 个离线备份包与快照' },
      { title: '用量统计', icon: 'chart', subtitle: 'Token 输入输出统计' },
      { title: '归档管理', icon: 'folder', subtitle: '已归档历史会话恢复' },
    ],
  ],
];

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
        <ScreenHeading
          title="一方小案头。"
          subtitle="收下成果，也留住灵感。"
        />
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
        {SETTINGS_GROUPS.map(([groupName, items]) => (
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
                subtitle={item.subtitle}
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
