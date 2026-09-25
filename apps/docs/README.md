# Piwin Docs · 砚

VitePress documentation for Piwin, designed with the Inkstone (砚) aesthetic.

## 🌐 Live Documentation

- **Custom domain**: [https://docs.piwinwin.com](https://docs.piwinwin.com)
- **Production Pages**: [https://piwin-docs.pages.dev](https://piwin-docs.pages.dev)

## 📖 Content Structure

```text
apps/docs/
├── docs/
│   ├── getting-started.md         # 快速起步概览与 BYOK 体系
│   ├── about.md                   # 架构起源与愿景
│   ├── community-post.md          # 社区开源自荐说明
│   ├── deployment.md              # 多端部署与本地运行
│   ├── model-config.md            # 模型与多模态委托配置
│   ├── vision-models.md           # 视觉模型与免费渠道
│   ├── oauth-login.md             # OAuth 登录与账号管理
│   ├── realtime-voice.md          # 实时语音与 Live 协作模式
│   ├── token-acquisition.md       # Devin Key 专属获取指引
│   ├── code-search.md             # Code Search 智能代码搜索
│   ├── subagent-orchestration.md  # 子代理编排: Ultra Code 与 Fusion
│   ├── web-search.md              # Web 搜索与网络检索服务
│   ├── extensions.md              # Pi 扩展生态与热加载
│   ├── prompt-system.md           # 提示词工程与上下文设计体系
│   ├── web-community.md           # Web 社群与精选资源
│   └── how-to-write-docs.md       # 文档编写与层级管理
├── index.md                       # 文档站首页
└── .vitepress/
    ├── config.mts                 # VitePress 配置 (导航、侧边栏、SEO)
    └── theme/                     # 砚 (Inkstone) 纸/墨双面文人美学主题
```

## 💻 Local Development

```bash
# 进入文档目录并安装依赖
cd apps/docs
pnpm install

# 启动本地热重载开发服务器
pnpm dev

# 构建生产包并检查链接完整性
pnpm build

# 本地预览构建产物
pnpm preview
```
