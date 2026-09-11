import {
  LEGACY_SETTINGS_REDIRECTS,
  type SettingsSectionId,
  type SettingsSectionMeta,
} from './section-registry.js';

/** Search terms for controls that are rendered inside a section rather than in its nav label. */
const SETTINGS_SEARCH_TERMS: Readonly<Record<SettingsSectionId, readonly string[]>> = {
  general: [
    'appearance', 'theme', 'themes', 'font', 'typography', 'language', 'host', 'animation',
    'locator', 'shortcut', 'shortcuts', 'keyboard', 'companion', 'pet',
    '外观', '主题', '字体', '语言', '动效', '快捷键', '键盘', '灵动伴侣', '桌宠',
  ],
  permissions: ['permission', 'permissions', 'rules', 'allow', 'deny', '权限', '规则', '允许', '拒绝'],
  models: [
    'model', 'models', 'provider', 'providers', 'vision', 'image generation', 'image-generation',
    '模型', '提供商', '视觉', '图片生成', '图像生成',
  ],
  oauth: ['oauth', 'login', 'account', 'subscription', '登录', '账户', '订阅'],
  hooks: ['hook', 'hooks', 'event', 'lifecycle', '钩子', '事件', '生命周期'],
  agent: [
    'agent', 'subagent', 'subagents', 'automation', 'artifact', 'playground', '定时', '自动化',
    '子代理', '产物', '工件',
  ],
  extensions: [
    'extension', 'extensions', 'skill', 'skills', 'tool', 'tools', 'mcp', 'plugin', 'plugins',
    'prompt', 'prompts', 'tui', 'compat', 'compatibility',
    '扩展', '技能', '工具', '插件', '提示词', '兼容',
  ],
  web: ['web', 'search', 'fetch', 'source', 'delegate', '网络', '搜索', '提取', '来源', '委托'],
  knowledge: ['knowledge', 'embedding', 'reranker', 'parser', 'vector', '知识', '嵌入', '重排', '解析', '向量'],
  session: [
    'session', 'runtime', 'lifecycle', 'archive', 'cold storage', 'compact', '会话', '运行时',
    '生命周期', '归档', '冷存储', '压缩',
  ],
  'cold-storage': ['cold storage', 'cold-storage', 'session storage', '冷存储', '会话存储'],
  usage: ['usage', 'quota', 'cost', '使用量', '配额', '成本'],
  archive: ['archive', 'archived', '归档'],
};

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function getLegacySearchTerms(sectionId: SettingsSectionId): readonly string[] {
  return Object.entries(LEGACY_SETTINGS_REDIRECTS)
    .filter(([, target]) => target === sectionId)
    .map(([alias]) => alias);
}

/** Match a section using its visible labels plus its control and legacy-link terms. */
export function matchesSettingsSearch(
  query: string,
  section: Pick<SettingsSectionMeta, 'id'>,
  labels: readonly string[] = [],
): boolean {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return true;
  return [section.id, ...SETTINGS_SEARCH_TERMS[section.id], ...getLegacySearchTerms(section.id), ...labels]
    .some((term) => normalizeSearchText(term).includes(normalizedQuery));
}
