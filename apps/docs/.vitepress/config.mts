import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Piwin · 砚',
  description: '面向个人的智能编程工作台 — 极其方便的配置方式，模型、视觉委托、Web 搜索随心掌控',
  cleanUrls: true,
  lastUpdated: true,
  ignoreDeadLinks: true,

  // 对外唯一域名是 docs.piwinwin.com：逐页输出 canonical / og:url，
  // 避免旧别名（docs.planora.chat）在迁移后被当作重复内容收录。
  transformHead({ pageData }) {
    const routePath = pageData.relativePath.replace(/index\.md$/, '').replace(/\.md$/, '');
    const canonicalUrl = `https://docs.piwinwin.com/${routePath}`;
    return [
      ['link', { rel: 'canonical', href: canonicalUrl }],
      ['meta', { property: 'og:url', content: canonicalUrl }],
    ];
  },

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@500;600;700&display=swap' }],
    ['meta', { name: 'theme-color', content: '#c6412a' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'Piwin · 砚 — 面向个人的智能编程工作台' }],
    ['meta', { name: 'og:description', content: '专为个人开发者打造：官方订阅一键授权，联网搜索即插即用，免费视觉委托跑腿，Devin 专属生态加持。' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Piwin · 砚',

    nav: [
      { text: '首页', link: '/' },
      { text: '下载', link: '/download' },
      { text: '快速起步', link: '/docs/getting-started' },
      { text: '智能能力', link: '/docs/code-search' },
      { text: '配置指南', link: '/docs/model-config' },
      { text: '系统生态', link: '/docs/extensions' },
      { text: '视觉画廊', link: '/docs/gallery' },
      {
        text: '更多',
        items: [
          { text: 'GitHub 仓库', link: 'https://github.com/mimimaster/piwin' },
          { text: '提示词体系', link: '/docs/prompt-system' },
          { text: '文档共建指引', link: '/docs/how-to-write-docs' },
        ],
      },
    ],

    sidebar: {
      '/docs/': [
        {
          text: '入门与使用',
          collapsed: false,
          items: [
            { text: '全平台客户端下载', link: '/download' },
            { text: '快速起步与配置概览', link: '/docs/getting-started' },
            { text: '多端运行与开箱安装', link: '/docs/deployment' },
          ],
        },

        {
          text: '智能体核心能力',
          collapsed: false,
          items: [
            { text: 'Code Search 代码拓扑检索', link: '/docs/code-search' },
            { text: '子代理协同 (Ultra & Fusion)', link: '/docs/subagent-orchestration' },
            { text: '全双工实时语音 Live', link: '/docs/realtime-voice' },
            { text: 'Artifact 实时渲染与画布', link: '/docs/artifact-rendering' },
          ],
        },
        {
          text: '配置指南（模型 · 搜索 · 委托）',
          collapsed: false,
          items: [
            { text: '模型与通道配置总览', link: '/docs/model-config' },
            { text: '视觉模型（免费渠道与委托）', link: '/docs/vision-models' },
            { text: 'Web 搜索与网络检索配置', link: '/docs/web-search' },
            { text: '官方订阅 OAuth 一键登录', link: '/docs/oauth-login' },
            { text: 'Devin OAuth 授权与获取', link: '/docs/token-acquisition' },
          ],
        },
        {
          text: '系统、生态与安全',
          collapsed: false,
          items: [
            { text: '扩展、Skill 与 MCP 生态', link: '/docs/extensions' },
            { text: '权限管控与安全拦截', link: '/docs/permissions' },
            { text: '知识库与多媒体资料库', link: '/docs/knowledge-and-media' },
            { text: '会话管理、归档与用量统计', link: '/docs/session-and-stats' },
          ],
        },
        {
          text: '视觉画廊与实景',
          collapsed: false,
          items: [
            { text: '实机体验与特性画廊', link: '/docs/gallery' },
          ],
        },
        {
          text: '进阶与共建',
          collapsed: false,
          items: [
            { text: '提示词与上下文设计体系', link: '/docs/prompt-system' },
            { text: '精选社群与优质资源', link: '/docs/web-community' },
            { text: '如何编写与扩充文档', link: '/docs/how-to-write-docs' },
          ],
        },
      ],
    },

    outline: {
      level: [2, 3],
      label: '本页目录',
    },

    search: {
      provider: 'local',
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
    },

    docFooter: {
      prev: '上一篇',
      next: '下一篇',
    },

    lastUpdated: {
      text: '最后更新于',
      formatOptions: {
        dateStyle: 'short',
        timeStyle: 'medium',
      },
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2026-present Piwin. All rights reserved.',
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/mimimaster/piwin' },
    ],

    darkModeSwitchLabel: '面（纸 / 墨）',
    lightModeSwitchTitle: '切换至纸面（浅色）',
    darkModeSwitchTitle: '切换至墨面（深色）',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
  },
});
