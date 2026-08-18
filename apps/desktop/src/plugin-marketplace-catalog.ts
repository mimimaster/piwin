/** Display catalog for Settings → Plugins marketplace. Ids match Host bundled plugins. */

export type PluginMarketplaceIconId =
  | 'cloudflare'
  | 'github'
  | 'remotion'
  | 'hyperframes'
  | 'figma';

export type PluginMarketplaceSecret = {
  name: string;
  displayNameEn: string;
  displayNameZh: string;
  descriptionEn: string;
  descriptionZh: string;
  required: boolean;
};

export type PluginMarketplaceCard = {
  id: string;
  icon: PluginMarketplaceIconId;
  name: string;
  descriptionEn: string;
  descriptionZh: string;
  category: 'featured';
  secrets: PluginMarketplaceSecret[];
};

export const PLUGIN_MARKETPLACE_CARDS: readonly PluginMarketplaceCard[] = [
  {
    id: 'cloudflare',
    icon: 'cloudflare',
    name: 'Cloudflare',
    descriptionEn: 'Connect to Cloudflare using remote MCP servers',
    descriptionZh: '通过远程 MCP 连接 Cloudflare 账号与文档',
    category: 'featured',
    secrets: [],
  },
  {
    id: 'github',
    icon: 'github',
    name: 'GitHub',
    descriptionEn: 'Connect to GitHub using remote MCP servers',
    descriptionZh: '通过远程 MCP 连接 GitHub 仓库与 Issue',
    category: 'featured',
    secrets: [
      {
        name: 'GITHUB_PERSONAL_ACCESS_TOKEN',
        displayNameEn: 'GitHub personal access token',
        displayNameZh: 'GitHub 个人访问令牌',
        descriptionEn: 'A classic or fine-grained PAT. The agent uses the scopes you grant.',
        descriptionZh: '经典或细粒度 PAT。Agent 只会使用你授予的权限。',
        required: true,
      },
    ],
  },
  {
    id: 'remotion',
    icon: 'remotion',
    name: 'Remotion',
    descriptionEn: 'Create motion graphics from React',
    descriptionZh: '用 React 做动态图形',
    category: 'featured',
    secrets: [],
  },
  {
    id: 'hyperframes',
    icon: 'hyperframes',
    name: 'HyperFrames',
    descriptionEn: 'Write HTML, render video',
    descriptionZh: '写 HTML，渲染成视频',
    category: 'featured',
    secrets: [],
  },
  {
    id: 'figma',
    icon: 'figma',
    name: 'Figma',
    descriptionEn: 'Design-to-code workflows from Figma files',
    descriptionZh: '从 Figma 文件做设计转代码',
    category: 'featured',
    secrets: [],
  },
];

export function marketplaceCardsForCategory(
  category: PluginMarketplaceCard['category'],
): PluginMarketplaceCard[] {
  return PLUGIN_MARKETPLACE_CARDS.filter((card) => card.category === category);
}

export function filterMarketplaceCards(
  cards: readonly PluginMarketplaceCard[],
  query: string,
): PluginMarketplaceCard[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [...cards];
  return cards.filter(
    (card) =>
      card.id.includes(needle) ||
      card.name.toLowerCase().includes(needle) ||
      card.descriptionEn.toLowerCase().includes(needle) ||
      card.descriptionZh.toLowerCase().includes(needle),
  );
}
