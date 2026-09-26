import type { InkstoneIconName } from '../icons.js';

export interface SettingsCatalogItem {
  title: string;
  icon: InkstoneIconName;
  /** Static description for lists without live Host summaries (案头, search). */
  blurb: string;
}

/**
 * The one list of settings sections. 案头, the settings page and settings
 * search all read it, so a new section (or its icon) is added once.
 * `title` is also the `settings-section` route key HostSettingsDetail switches on.
 */
export const SETTINGS_CATALOG: [string, SettingsCatalogItem[]][] = [
  [
    '应用',
    [
      { title: '通用与外观', icon: 'gear', blurb: '外观主题与桌面接入' },
      { title: '权限与安全', icon: 'shield', blurb: 'Auto / Ask / YOLO 三态规则' },
    ],
  ],
  [
    'Agent',
    [
      { title: '模型配置', icon: 'bulb', blurb: 'Claude · OpenAI · 自定义 API' },
      { title: 'OAuth 登录', icon: 'key', blurb: 'Codex 与 Gemini 账号凭据' },
      { title: 'Hooks', icon: 'bolt', blurb: '会话生命周期自动化检查' },
      { title: '智能体策略', icon: 'fork', blurb: '子代理编排方案与沙箱' },
    ],
  ],
  [
    '集成',
    [
      { title: '技能与扩展', icon: 'puzzle', blurb: 'Skills · MCP · 插件市场' },
      { title: '网络搜索与抓取', icon: 'globe', blurb: '搜索来源与网页抓取' },
      { title: '知识库与向量', icon: 'book', blurb: '向量索引与词条库' },
    ],
  ],
  [
    '系统',
    [
      { title: '会话与运行时', icon: 'term', blurb: '恢复策略与阅读断点保留' },
      { title: '冷存储', icon: 'archive', blurb: '离线备份包与快照' },
      { title: '用量统计', icon: 'chart', blurb: 'Token 输入输出统计' },
      { title: '归档管理', icon: 'folder', blurb: '已归档历史会话恢复' },
    ],
  ],
  ['本机', [{ title: 'Apple Health', icon: 'drop', blurb: '在你同意时读取健康摘要' }]],
];

export const SETTINGS_ITEMS: SettingsCatalogItem[] = SETTINGS_CATALOG.flatMap(([, items]) => items);
