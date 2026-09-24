# OAuth 登录与账号管理指南

在 **Piwin** 中，你可以通过 **OAuth 登录** 直接绑定你在各家 AI 服务商的官方订阅账号（如 ChatGPT Codex、Claude Pro/Max、Kimi Coding、Devin、xAI Grok、GitHub Copilot），无需繁琐地去后台生成与复制长字符串 API Key。

本文档将详细介绍 OAuth 登录机制、使用方式、注意事项与常见排查。

---

## 1. 什么是 OAuth 登录？

传统 Coding Agent 通常要求开发者手动填写 API Key。而在 Piwin 中：

1. **一键浏览器授权**：点击登录按钮后，自动打开官方认证网页完成安全授权；
2. **凭证统一管理**：授权生成的 Token/Cookie 凭据统一加密存放在本机 Host 的 `~/.piwin/pi-agent/auth.json` 中；
3. **能力与模型自动同步**：
   - 登录大模型服务商（如 Codex / Kimi），可用模型自动出现在选择列表中；
   - 登录 **Devin**，客户端将**全自动配置并激活** [Web 搜索](./web-search.md) 与 [Code Search 代码语义检索](./code-search.md)，再也不需要手动抓包挖 Token；
4. **互不冲突的通道设计**：OAuth 账号与常规的 API Key 通道（Channel）并存，你可以随时在不同会话中自由切换。

---

## 2. 桌面端操作流程

1. 打开 **Piwin 桌面客户端**；
2. 点击左下角 **「设置 (Settings)」** 进入 **「OAuth 登录 (OAuth Accounts)」** 页面；
3. 在支持的服务商列表中找到目标平台（例如 `Devin`、`OpenAI Codex`、`Kimi Coding`、`Anthropic Claude` 或 `xAI Grok`）；
4. 点击 **「登录」**，客户端会调起浏览器跳转至官方授权页面；
5. 在浏览器中完成登录与确认授权后，页面提示成功即可返回客户端；
6. 此时在右侧或模型列表中即可看到已授权的订阅模型，若授权 Devin 则搜索与检索能力即刻亮起。

```
┌─────────────────────────────────────────────────────────────┐
│                    OAuth 账号管理 (OAuth)                    │
├─────────────────────────────────────────────────────────────┤
│  [ Devin ]            状态: 已授权 (Web 搜索 & Code Search 已打通) │
│  [ OpenAI Codex ]     状态: 已授权 (gpt-4o, o3-mini...) [登出] │
│  [ Anthropic ]        状态: 已授权 (claude-3-7-sonnet) [登出] │
│  [ Kimi Coding ]      状态: 未登录                   [登录] │
│  [ xAI Grok ]         状态: 未登录                   [登录] │
│  [ GitHub Copilot ]   状态: 未登录                   [登录] │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. CLI 命令行管理方式

如果你使用终端模式（CLI）或在无图形界面的远程服务器上运行 Piwin Host，可以直接通过命令行进行管理：

```bash
# 1. 查看当前所有 OAuth 账号状态
piwin auth status

# 2. 登录指定服务商（终端会输出授权链接与验证码）
piwin auth login openai-codex
# 或者登录其他平台：
# piwin auth login kimi-coding
# piwin auth login anthropic
# piwin auth login xai
# piwin auth login github-copilot

# 3. 登出指定账号
piwin auth logout <account-id>
```

---

## 4. 关键注意事项与风险提示

### 4.1 Claude Pro / Max 订阅的 Extra Usage 规则
- **计费变更**：Anthropic 自 2026-04-04 起将所有第三方客户端的调用归入 **Extra Usage（额外付费用量）**，不再计入网页版专属的每周限额；
- **配置要求**：使用 Claude OAuth 时，请务必前往 [Claude 账户用量设置页面 (claude.ai/settings/usage)](https://claude.ai/settings/usage) 确认已开通 Extra Usage，否则调用模型时会提示配额不足或请求失败。

### 4.2 账号安全与第三方通道提示
- 尽量使用官方或正规授权渠道，避免在不受信任的第三方镜像平台输入主账号凭据；
- 如果通过第三方逆向扩展接入未经验证的渠道，请注意控制敏感操作与账号风险。

---

## 5. 关联文档

- [快速起步与核心概念](./getting-started.md)
- [模型与多模态委托配置](./model-config.md)
- [实时语音与 Live 协作模式](./realtime-voice.md)
