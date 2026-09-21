# 快速起步与核心概念 (Getting Started)

欢迎查阅 **Piwin** 快速起步指南！

Piwin 是一个面向严肃工程开发的私有化智能编程工作台。无论你是初次接触 Coding Agent 的新手，还是拥有多个模型订阅的高级玩家，本文档都能帮助你快速理清核心概念，并完成基础配置。

---

## 1. 核心概念速览

### 1.1 BYOK (Bring Your Own Key)
现在的 AI 模型生态百花齐放，开发者往往在不同的平台购买了 Token 额度或订阅套餐。谁也不希望在电脑上为了不同的项目开启五六个不同的 Agent 窗口。

**BYOK** 允许你完全自带 API Key，将所有的模型资源统一收口在 Piwin 中：
- 自定义各服务商的 `Base URL` 与 `API Key`；
- 支持 OpenAI 兼容格式、Anthropic 原生接口、Google Gemini、Ollama 本地接口等；
- 所有密钥仅加密存储在本地机器（`~/.piwin`），绝不经过任何第三方云端。

---

### 1.2 通道 (Channel / Provider) 与 套餐账号 (OAuth Account) 的双层设计

在 Piwin 中，模型来源被清晰地解耦为两层：

```text
┌─────────────────────────────────────────────────────────────┐
│                    Piwin 模型体系 (Models)                   │
├──────────────────────────────┬──────────────────────────────┤
│  通道层 (Channel / Provider) │  套餐账号层 (OAuth Account)   │
├──────────────────────────────┼──────────────────────────────┤
│ • BYOK / 自定义 API Key      │ • 官方 OAuth 一键授权        │
│ • Anthropic API / OpenRouter │ • Kimi Code / Codex / Grok   │
│ • 本地 Ollama / 兼容端点     │ • Claude Pro / Max 订阅      │
│ • 存储在通道配置中            │ • 凭证写入 ~/.piwin/auth.json │
└──────────────────────────────┴──────────────────────────────┘
```

1. **通道 (Channel / Provider)**：面向标准 API 接口。例如输入 OpenAI / Anthropic 原生 API Key、OpenRouter Key 或本地 Ollama 地址。
2. **套餐账号 (Account / OAuth)**：面向官方订阅。通过 **「设置 ➔ OAuth 登录」** 授权，支持 Kimi Code、ChatGPT Codex、Claude Pro/Max、xAI Grok、GitHub Copilot。
   - 凭证保存在本地 Host 的 `~/.piwin/pi-agent/auth.json` 中，安全可靠；
   - 也可以通过 CLI 命令行进行管理：
     ```bash
     piwin auth status
     piwin auth login <kimi-coding|openai-codex|anthropic|xai|github-copilot>
     piwin auth logout <id>
     ```

::: warning 关于 Claude Pro / Max 的特别说明
从 2026-04-04 起，Anthropic 官方规定：所有第三方客户端（包括各类 Agent 工具及 Pi / Piwin）的 API 调用均记入 **Extra Usage（额外付费用量）**，不再扣减网页端或官方 App 的套餐额度。  
如果你要使用 Claude 官方 OAuth，请确保在 [Claude 账户设置 (claude.ai/settings/usage)](https://claude.ai/settings/usage) 中已开启 Extra Usage 额度，否则请求可能报错。
:::

---

## 2. 核心功能配置导航

按照你的使用需求，直接点击下方卡片阅读对应配置模块：

| 模块 | 核心内容 | 直达链接 |
| :--- | :--- | :--- |
| **OAuth 登录与账号** | 了解如何一键登录 Kimi、Codex、Claude、Grok 等官方套餐 | [OAuth 登录指南](./oauth-login.md) |
| **模型与多模态委托** | 推理模型、视觉委托、输出重写、生图与视频模型统一配置 | [模型配置说明](./model-config.md) |
| **视觉模型配置** | 免费获取 Gemini Flash、硅基流动 Qwen2.5-VL、Groq、Ollama 视觉模型 | [视觉模型指南](./vision-models.md) |
| **Code Search 语义检索** | 零上下文污染的智能体代码拓扑搜索与 Devin Key 配置 | [Code Search 指南](./code-search.md) |
| **子代理协同编排** | 掌握 Ultra Code（侦察兵模式）与 Fusion（双模规划执行） | [子代理编排说明](./subagent-orchestration.md) |
| **Web 搜索配置** | 接入 Tavily 免费 1000 次 Key、Brave 搜索与 windsurf-search-mcp | [Web 搜索说明](./web-search.md) |
| **实时语音协作** | 开启 Composer 小麦克风，体验全双工实时结对编程 | [实时语音说明](./realtime-voice.md) |
| **多端部署与私有化** | macOS 一体包、Windows 包、Web 远程直连与 iOS 移动端使用 | [多端部署说明](./deployment.md) |
| **Pi 扩展生态** | 在会话中一键热安装社区 Agent 工具与 Hook | [扩展说明](./extensions.md) |

---

## 3. 客户端一键直达

在 Piwin 桌面客户端各配置面板旁边，均提供了 **「配置指南」** 按钮，点击即可在默认浏览器中精准跳转至当前配置项的对应文档锚点。
