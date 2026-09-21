# 如何管理与添加多层级 Markdown 文档

VitePress 原生支持**无限层级的父子文档嵌套**、**文件夹分类**以及**可折叠目录**。

本文将详细介绍如何在本项目（`apps/docs`）中组织和新增多层级文档。

---

## 1. 推荐的目录结构规范

在 `apps/docs/docs/` 下，你可以通过建立分类文件夹或平铺命名来组织文档。例如：

```text
apps/docs/docs/
├── getting-started.md             # 顶层入门文档
├── about.md                       # 架构起源与愿景
├── deployment.md                  # 多端部署说明
│
├── models/                        # 模型分类目录 (可选)
│   ├── model-config.md            # 模型与多模态配置
│   ├── vision-models.md           # 视觉模型指引
│   └── oauth-login.md             # OAuth 登录指南
│
└── agent/                         # 智能体能力目录 (可选)
    ├── code-search.md             # 代码语义检索
    ├── subagent-orchestration.md  # 子代理编排
    └── extensions.md              # 扩展生态说明
```

---

## 2. 在配置文件中配置层级侧边栏

打开 `apps/docs/.vitepress/config.mts`，在 `themeConfig.sidebar` 中通过 `items` 嵌套即可实现折叠树形结构：

```ts
sidebar: {
  '/docs/': [
    {
      text: '快速起步与入门',
      collapsed: false,
      items: [
        { text: '快速起步与核心概念', link: '/docs/getting-started' },
        { text: '架构起源与愿景', link: '/docs/about' },
        { text: '多端部署与私有化运行', link: '/docs/deployment' },
      ],
    },
    {
      text: '模型与推理配置',
      collapsed: false,
      items: [
        { text: '模型与多模态委托总览', link: '/docs/model-config' },
        { text: '视觉模型与免费渠道', link: '/docs/vision-models' },
        { text: 'OAuth 登录与账号管理', link: '/docs/oauth-login' },
        { text: '实时语音与 Live 协作', link: '/docs/realtime-voice' },
      ],
    },
    {
      text: '智能体执行与工程能力',
      collapsed: false,
      items: [
        { text: 'Code Search 代码语义搜索', link: '/docs/code-search' },
        { text: '子代理编排: Ultra Code & Fusion', link: '/docs/subagent-orchestration' },
        { text: 'Web 搜索与网络检索', link: '/docs/web-search' },
        { text: 'Pi 扩展生态与热加载', link: '/docs/extensions' },
      ],
    },
  ],
}
```

---

## 3. 本地调试与上线

1. **本地热更新预览**：在项目根目录运行 `pnpm dev:docs` 或进入 `apps/docs` 运行 `pnpm dev`，修改 Markdown 后浏览器会**秒级热重载**；
2. **构建验证**：运行 `pnpm build` 确认无断链（Broken Links）；
3. **自动发布**：代码推送到 GitHub `main` 分支后，Cloudflare Pages 会自动拉取最新提交并秒级部署至 [https://docs.planora.chat](https://docs.planora.chat)。
