import type { HeadConfig, TransformPageContext } from 'vitepress';

/**
 * 站点拆分的公共配置。
 *
 * 产品站与文档站共享字体、主题色、语言包与 SEO 兜底逻辑，
 * 差异（域名、导航、侧边栏、搜索）留在各自的 config 里。
 */

/** 产品站唯一对外域名。www 由 Cloudflare 层 301 到裸域。 */
export const PRODUCT_ORIGIN = 'https://piwinwin.com';

/** 文档站唯一对外域名。 */
export const DOCS_ORIGIN = 'https://docs.piwinwin.com';

/**
 * 逐页输出 canonical 与 og:url。
 *
 * 两站曾经共用一个站点，canonical 全部指向文档域名；
 * 拆分后必须按站输出，否则产品站页面会被搜索引擎当作文档站的副本。
 *
 * pageData.relativePath 是相对 srcDir 的源文件路径（product/index.md），
 * 不是最终路由，所以要先过一遍与 rewrites 相同的映射。
 */
export function createTransformHead(origin: string, toRoutePath: (id: string) => string) {
  return ({ pageData }: TransformPageContext): HeadConfig[] => {
    const routePath = toRoutePath(pageData.relativePath)
      .replace(/index\.md$/, '')
      .replace(/\.md$/, '');
    const canonicalUrl = `${origin}/${routePath}`;
    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
    ];
  };
}

/** 两站共用的 <head>：图标、字体、主题色、og 类型。 */
export function createCommonHead(): HeadConfig[] {
  return [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@500;600;700&display=swap',
      },
    ],
    ['meta', { name: 'theme-color', content: '#c6412a' }],
    ['meta', { property: 'og:type', content: 'website' }],
  ];
}

/** 各站自己的 og 标题与描述。 */
export function createSocialHead(title: string, description: string): HeadConfig[] {
  return [
    ['meta', { property: 'og:title', content: title }],
    ['meta', { property: 'og:description', content: description }],
  ];
}

/**
 * 首页开幕动画的待播状态必须在首帧之前就位，否则服务端渲染出的成品画面会先闪一下。
 * 只在直接打开首页时播放；6 秒兜底，脚本出错也不会把页面一直藏着。
 * 只有产品站有首页动画，文档站不加载。
 */
export const HERO_INTRO_SCRIPT: HeadConfig = [
  'script',
  {},
  `(function(){var r=document.documentElement;if(location.pathname!=='/'||matchMedia('(prefers-reduced-motion: reduce)').matches)return;r.classList.add('hero-intro');setTimeout(function(){if(!r.classList.contains('hero-intro-run'))r.classList.remove('hero-intro')},6000)})()`,
];

/** 两站共用的中文文案与正文样式配置。 */
export const COMMON_THEME_CONFIG = {
  logo: '/logo.png',
  outline: {
    level: [2, 3] as [number, number],
    label: '本页目录',
  },
  docFooter: {
    prev: '上一篇',
    next: '下一篇',
  },
  lastUpdated: {
    text: '最后更新于',
    formatOptions: {
      dateStyle: 'short' as const,
      timeStyle: 'medium' as const,
    },
  },
  footer: {
    message:
      'Released under the MIT License. · <a href="https://docs.piwinwin.com/privacy">隐私政策</a> · <a href="https://docs.piwinwin.com/en/privacy">Privacy Policy</a>',
    copyright: 'Copyright © 2026-present Piwin. All rights reserved.',
  },
  socialLinks: [{ icon: 'github' as const, link: 'https://github.com/mimimaster/piwin' }],
  darkModeSwitchLabel: '面（纸 / 墨）',
  lightModeSwitchTitle: '切换至纸面（浅色）',
  darkModeSwitchTitle: '切换至墨面（深色）',
  sidebarMenuLabel: '目录',
  returnToTopLabel: '回到顶部',
};

/** 文档站的本地搜索（产品站不需要）。 */
export const DOCS_SEARCH = {
  provider: 'local' as const,
  options: {
    translations: {
      button: {
        buttonText: '搜索文档',
        buttonAriaLabel: '搜索文档',
      },
      modal: {
        noResultsText: '无法找到相关结果',
        resetButtonTitle: '清除查询条件',
        footer: {
          selectText: '选择',
          navigateText: '切换',
          closeText: '关闭',
        },
      },
    },
  },
};
