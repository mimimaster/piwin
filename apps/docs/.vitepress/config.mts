import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Piwin · 砚',
  description: '私有化 AI 智能体工作台与生产力生态',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/png', href: '/favicon.png' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    ['link', { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=JetBrains+Mono:ital,wght@0,400;0,500;0,600;1,400&family=Noto+Serif+SC:wght@500;600;700&display=swap' }],
    ['meta', { name: 'theme-color', content: '#c6412a' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'Piwin Docs · 砚 - 私有化 AI 智能体工作台' }],
    ['meta', { name: 'og:description', content: '构筑于 Pi 内核之上，具备清晰分层、独立 Host 权威、多端解耦契约以及模块化扩展生态' }],
  ],

  themeConfig: {
    logo: '/logo.png',
    siteTitle: 'Piwin · 砚',

    nav: [
      { text: '首页', link: '/' },
      { text: '快速起步', link: '/docs/getting-started' },
      { text: '架构与愿景', link: '/docs/about' },
      { text: '模型配置', link: '/docs/model-config' },
      { text: '智能体能力', link: '/docs/code-search' },
      { text: '多端部署', link: '/docs/deployment' },
      {
        text: '生态与源码',
        items: [
          { text: 'GitHub 仓库', link: 'https://github.com/mimimaster/piwin' },
          { text: '社区自荐帖子', link: '/docs/community-post' },
          { text: '提示词设计体系', link: '/docs/prompt-system' },
        ],
      },
    ],

    sidebar: {
      '/docs/': [
        {
          text: '快速起步与入门',
          collapsed: false,
          items: [
            { text: '快速起步概览与 BYOK', link: '/docs/getting-started' },
            { text: '架构起源与设计原则', link: '/docs/about' },
            { text: '开源自荐与生态故事', link: '/docs/community-post' },
            { text: '多端部署与私有化运行', link: '/docs/deployment' },
          ],
        },
        {
          text: '模型与多模态配置',
          collapsed: false,
          items: [
            { text: '模型与委托体系总览', link: '/docs/model-config' },
            { text: '视觉模型与免费渠道', link: '/docs/vision-models' },
            { text: 'OAuth 登录与账号管理', link: '/docs/oauth-login' },
            { text: '实时语音与 Live 协作', link: '/docs/realtime-voice' },
            { text: 'Devin Key 专属获取指引', link: '/docs/token-acquisition' },
          ],
        },
        {
          text: '智能体执行与工程能力',
          collapsed: false,
          items: [
            { text: 'Code Search 智能代码搜索', link: '/docs/code-search' },
            { text: '子代理编排 (Ultra Code & Fusion)', link: '/docs/subagent-orchestration' },
            { text: 'Web 搜索与网络检索', link: '/docs/web-search' },
            { text: 'Pi 扩展生态与热加载', link: '/docs/extensions' },
            { text: '提示词工程与上下文设计体系', link: '/docs/prompt-system' },
          ],
        },
        {
          text: '社群与文档指南',
          collapsed: false,
          items: [
            { text: 'Web 社群与精选资源', link: '/docs/web-community' },
            { text: '文档编写与层级管理', link: '/docs/how-to-write-docs' },
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
      copyright: 'Copyright © 2024-present Piwin (Planora). All rights reserved.',
    },

    darkModeSwitchLabel: '面（纸 / 墨）',
    lightModeSwitchTitle: '切换至纸面（浅色）',
    darkModeSwitchTitle: '切换至墨面（深色）',
    sidebarMenuLabel: '目录',
    returnToTopLabel: '回到顶部',
  },
});
