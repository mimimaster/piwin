import type { UserConfig } from 'vitepress';
import {
  COMMON_THEME_CONFIG,
  DOCS_ORIGIN,
  DOCS_SEARCH,
  createCommonHead,
  createSocialHead,
  createTransformHead,
} from '../shared';

const SITE_TITLE = 'Piwin 文档';
const SITE_DESCRIPTION = 'Piwin 使用文档：模型配置、Web 搜索、扩展生态、编排与权限';

/** docs/ 下的页面在最终路由里去掉前缀（docs/getting-started.md → /getting-started）。 */
const toRoutePath = (id: string) => id.replace(/^docs\//, '');

/**
 * 文档站：docs.piwinwin.com。
 *
 * 产品首页、下载、画廊、原型与拓展站都在 piwinwin.com（config.product.mts），
 * 本站只放正文；跨站链接一律用绝对 URL，避免误判为站内路由。
 *
 * 站内路径不再带 /docs 前缀：域名已表达"这是文档"，
 * 旧 URL 由 docs-public/_redirects 做 301。
 */
export const docsConfig: UserConfig = {
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
  srcExclude: ['product/**', '2026-*.md', 'Auto*.md'],
  rewrites: toRoutePath,
  outDir: '.vitepress/dist-docs',

  transformHead: createTransformHead(DOCS_ORIGIN, toRoutePath),

  head: [
    ...createCommonHead(),
    ...createSocialHead(`${SITE_TITLE} — 使用指南与配置手册`, SITE_DESCRIPTION),
  ],

  themeConfig: {
    ...COMMON_THEME_CONFIG,
    siteTitle: SITE_TITLE,
    search: DOCS_SEARCH,

    nav: [
      { text: '快速起步', link: '/getting-started' },
      {
        text: '使用指南',
        activeMatch:
          '^/(model-config|vision-models|web-search|oauth-login|token-acquisition|code-search|auto-orchestration|realtime-voice|artifact-rendering|extensions|permissions)',
        items: [
          {
            text: '核心能力',
            items: [
              { text: 'Code Search 代码检索', link: '/code-search' },
              { text: 'Auto 智能编排', link: '/auto-orchestration' },
              { text: '全双工实时语音', link: '/realtime-voice' },
              { text: 'Artifact 渲染与画布', link: '/artifact-rendering' },
            ],
          },
          {
            text: '配置',
            items: [
              { text: '模型与通道', link: '/model-config' },
              { text: '视觉模型与委托', link: '/vision-models' },
              { text: 'Web 搜索', link: '/web-search' },
            ],
          },
          {
            text: '系统与生态',
            items: [
              { text: '扩展、Skill 与 MCP', link: '/extensions' },
              { text: '权限与安全', link: '/permissions' },
            ],
          },
        ],
      },
      {
        text: '设计笔记',
        link: '/workspace-concurrency',
        activeMatch: '^/(prompt-system|workspace-concurrency)',
      },
      { text: '产品站 ↗', link: 'https://piwinwin.com' },
      { text: '拓展站 ↗', link: 'https://piwinwin.com/extensions/' },
      {
        text: '更多',
        items: [
          { text: 'GitHub 仓库', link: 'https://github.com/mimimaster/piwin' },
          { text: 'LINUX DO 社区', link: 'https://linux.do' },
          { text: '文档共建指引', link: '/how-to-write-docs' },
        ],
      },
    ],

    sidebar: {
      '/': [
        {
          text: '入门与使用',
          collapsed: false,
          items: [
            { text: '全平台客户端下载', link: 'https://piwinwin.com/download' },
            { text: '快速起步与配置概览', link: '/getting-started' },
            { text: '多端运行与开箱安装', link: '/deployment' },
          ],
        },
        {
          text: '智能体核心能力',
          collapsed: false,
          items: [
            { text: 'Code Search 代码拓扑检索', link: '/code-search' },
            { text: 'Auto 编排 (含 Ultra & Fusion)', link: '/auto-orchestration' },
            { text: '全双工实时语音 Live', link: '/realtime-voice' },
            { text: 'Artifact 实时渲染与画布', link: '/artifact-rendering' },
          ],
        },
        {
          text: '配置指南（模型 · 搜索 · 委托）',
          collapsed: false,
          items: [
            { text: '模型与通道配置总览', link: '/model-config' },
            { text: '视觉模型（免费渠道与委托）', link: '/vision-models' },
            { text: 'Web 搜索与网络检索配置', link: '/web-search' },
            { text: '官方订阅 OAuth 一键登录', link: '/oauth-login' },
            { text: 'Devin OAuth 授权与获取', link: '/token-acquisition' },
          ],
        },
        {
          text: '系统、生态与安全',
          collapsed: false,
          items: [
            { text: '扩展、Skill 与 MCP 生态', link: '/extensions' },
            { text: 'Pi 扩展开发与 piwin 适配', link: '/extension-development' },
            { text: 'Pi 扩展安装实战 (cc-safety-net)', link: '/install-pi-extension' },
            { text: '权限管控与安全拦截', link: '/permissions' },
            { text: '知识库与多媒体资料库', link: '/knowledge-and-media' },
            { text: '会话管理、归档与用量统计', link: '/session-and-stats' },
          ],
        },
        {
          text: '设计笔记',
          collapsed: false,
          items: [
            { text: '多会话并发写入与乐观写锁', link: '/workspace-concurrency' },
            { text: '提示词与上下文设计体系', link: '/prompt-system' },
          ],
        },
        {
          text: '进阶与共建',
          collapsed: false,
          items: [
            { text: '精选社群与优质资源', link: '/web-community' },
            { text: '如何编写与扩充文档', link: '/how-to-write-docs' },
          ],
        },
      ],
    },
  },
};
