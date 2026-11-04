import type { UserConfig } from 'vitepress';
import {
  COMMON_THEME_CONFIG,
  HERO_INTRO_SCRIPT,
  PRODUCT_ORIGIN,
  createCommonHead,
  createSocialHead,
  createTransformHead,
} from '../shared';

const SITE_TITLE = 'Piwin · 砚';
const SITE_DESCRIPTION =
  '面向个人的智能编程工作台 — 极其方便的配置方式，模型、视觉委托、Web 搜索随心掌控';

/** product/ 下的页面在最终路由里都是根路径（product/index.md → /）。 */
const toRoutePath = (id: string) => id.replace(/^product\//, '');

/**
 * 产品站：piwinwin.com。
 *
 * 只承载首页、下载、画廊、原型与拓展站入口；
 * 文档正文与侧边栏在 config.docs.mts，两站共享 public/ 与 .vitepress/theme。
 */
export const productConfig: UserConfig = {
  lang: 'zh-CN',
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  // srcDir 保持仓库根：VitePress 不支持自定义 publicDir，固定取 <srcDir>/public，
  // srcDir 一挪 public/ 就找不到。所以用 srcExclude 排除另一站，
  // 再用 rewrites 把子目录压回根路由。
  srcDir: '.',
  srcExclude: ['docs/**', '2026-*.md', 'Auto*.md'],
  rewrites: toRoutePath,
  outDir: '.vitepress/dist-product',

  transformHead: createTransformHead(PRODUCT_ORIGIN, toRoutePath),

  head: [
    ...createCommonHead(),
    ...createSocialHead(`${SITE_TITLE} — 面向个人的智能编程工作台`, SITE_DESCRIPTION),
    HERO_INTRO_SCRIPT,
  ],

  themeConfig: {
    ...COMMON_THEME_CONFIG,
    siteTitle: SITE_TITLE,

    nav: [
      { text: '下载', link: '/download' },
      { text: '视觉画廊', link: '/gallery' },
      { text: '设计原型', link: '/prototype' },
      { text: '拓展站', link: '/extensions/' },
      { text: '文档', link: 'https://docs.piwinwin.com' },
      { text: 'GitHub', link: 'https://github.com/mimimaster/piwin' },
    ],
  },
};
