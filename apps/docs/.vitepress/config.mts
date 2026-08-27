import { defineConfig } from 'vitepress';

export default defineConfig({
  lang: 'zh-CN',
  title: 'Planora',
  description: '下一代 AI 智能体工作台与生产力生态',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }],
    ['meta', { name: 'theme-color', content: '#2563eb' }],
    ['meta', { name: 'og:type', content: 'website' }],
    ['meta', { name: 'og:title', content: 'Planora Docs - AI 智能体配置与生产力生态' }],
    ['meta', { name: 'og:description', content: '纯静态、开箱即用的 AI 智能体配置与视觉委托指南' }],
  ],

  themeConfig: {
    logo: '/logo.svg',
    siteTitle: 'Planora',

    nav: [
      { text: '首页', link: '/' },
      { text: 'Docs', link: '/docs/vision-models' },
    ],

    // 左侧多层级侧边栏配置
    sidebar: {
      '/docs/': [
        {
          text: '🚀 起步入门',
          collapsed: false,
          items: [
            { text: '快速起步概览', link: '/docs/getting-started' },
          ],
        },
        {
          text: '🧠 模型与推理配置',
          collapsed: false,
          items: [
            // 一级父文档 / 目录
            {
              text: '视觉模型 (Vision Models)',
              collapsed: false,
              items: [
                { text: '视觉模型与委托完整指引', link: '/docs/vision-models' },
                { text: '视觉委托原理与配置', link: '/docs/vision-models#vision-delegation' },
                { text: '免费模型渠道指路 (Google/硅基等)', link: '/docs/vision-models#free-models' },
                { text: '客户端配置与测试', link: '/docs/vision-models#step-by-step' },
              ],
            },
            {
              text: '主力推理模型',
              collapsed: true,
              items: [
                { text: 'Claude / DeepSeek / GPT 配置', link: '/docs/getting-started' },
              ],
            },
          ],
        },
        {
          text: '🌐 网络与生态',
          collapsed: false,
          items: [
            {
              text: 'Web 搜索指路',
              collapsed: false,
              items: [
                { text: 'Web 搜索与社群资源汇总', link: '/docs/web-community' },
                { text: 'Tavily 免费 1000 次 API Key', link: '/docs/web-community#web-search' },
                { text: 'SearXNG 私有化自建', link: '/docs/web-community#web-search' },
              ],
            },
            {
              text: '社群与插件生态',
              collapsed: true,
              items: [
                { text: 'MCP 插件与提示词资源', link: '/docs/web-community#community-resources' },
              ],
            },
          ],
        },
        {
          text: '🧩 智能体架构与提示词系统',
          collapsed: false,
          items: [
            { text: '提示词工程与上下文设计体系', link: '/docs/prompt-system' },
          ],
        },
        {
          text: '📝 文档创作与层级管理',
          collapsed: false,
          items: [
            { text: '如何添加父子多层级 Markdown', link: '/docs/how-to-write-docs' },
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
      copyright: 'Copyright © 2024-present Planora. All rights reserved.',
    },

    darkModeSwitchLabel: '深浅模式',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    sidebarMenuLabel: '菜单',
    returnToTopLabel: '回到顶部',
  },
});
