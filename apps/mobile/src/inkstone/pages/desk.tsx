import type { ReactElement } from 'react';
import { useInkstone } from '../inkstone-context.js';
import { type InkstoneRoute } from '../demo-state.js';
import { Icon, type InkstoneIconName } from '../icons.js';
import {
  BottomNav,
  Dot,
  IconButton,
  ListRow,
  ScreenHeading,
  TopBar,
} from '../inkstone-ui.js';
import { endpointLabel, getAttentionItems } from './sessions.js';
import { useInkstoneHost } from '../host/inkstone-host-context.js';
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
  const { state, dispatch } = useInkstone();
  const hostCtx = useInkstoneHost();
  const attentionCount = hostCtx === null
    ? getAttentionItems(state).length
    : collectPendingPermissionSessionIds(hostCtx.host.activityItems).size;

  const isConnected = hostCtx !== null && hostCtx.host.connectionState.kind === 'ready';
  const isConnecting = hostCtx !== null && hostCtx.host.connectionState.kind === 'connecting';
  const isOffline = state.offline || (hostCtx !== null && !isConnected && !isConnecting);

  const hostTitle = hostCtx !== null && hostCtx.host.endpoint
    ? endpointLabel(hostCtx.host.endpoint)
    : '书房的 Mac Studio';

  const hostSubtitle = isConnected
    ? `已连接 · ${hostCtx.host.sessions.length > 0 ? `${hostCtx.host.sessions.length} 个会话` : '2 台设备在线'}`
    : isConnecting
      ? '正在连接…'
      : '连接已断开 · 点按管理';

  const onHostClick = () => {
    if (hostCtx !== null) {
      hostCtx.onOpenConnection();
    } else {
      dispatch({ type: 'open-sheet', key: 'host' });
    }
  };

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
      hostCtx === null ? '维基 · 信源 · 闪卡' : `${hostCtx.host.knowledgeBases.length} 个 Host 信源`,
      () => dispatch({ type: 'navigate', route: 'knowledge' }),
    ],
    [
      'refresh',
      '自动化',
      hostCtx === null ? '2 条定时任务' : '查看 Host 自动化状态',
      () => dispatch({ type: 'navigate', route: 'automations' }),
    ],
    [
      'chart',
      '用量统计',
      hostCtx === null ? '最近 30 天用量' : '读取 Host 用量',
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
          <span>连接中断 · 显示快照，草稿仍可写</span>
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
