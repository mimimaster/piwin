# Devin Token 与专属 Key 获取指引

> 本指引用于介绍如何从个人日常使用的 Devin / Windsurf 账号中获取专属 Token，供 Piwin 的 **Code Search（代码语义检索）** 与 **Web Search（网络搜索）** 工具免费、极速使用。

---

## 1. 为什么推荐获取 Devin Token？

在 Piwin 的两大核心能力中：
1. **[Code Search 智能代码搜索](./code-search.md)**：无需消耗昂贵的 LLM Token，直接借助 Devin 后台强大的语义检索算力完成工程拓扑梳理；
2. **[Web Search 网络搜索](./web-search.md)**：通过开源连接器 [mimimaster/windsurf-search-mcp](https://github.com/mimimaster/windsurf-search-mcp) 获取高质量清洗后的网页内容。

只需一个免费的 Devin Token，即可同时搞定代码语义检索与联网搜索，响应速度快且完全零额外开销。

---

## 2. 获取步骤详细指南

1. 打开并登录你的 **Devin (原 Windsurf)** 网页端或桌面客户端；
2. 打开浏览器的 **开发者工具（DevTools / F12）**，切换到 **网络（Network）** 选项卡；
3. 在页面中下发一条简单的提示或触发一次交互；
4. 检查网络请求列表，找到发往官方后端 API 的请求（如带有 `api.devin.ai` 或相关路由）；
5. 点击该请求，在 **请求头（Request Headers）** 中找到 `Authorization: Bearer <your-token>` 或带有 `session-token` / `api-key` 的字段；
6. 复制该字符串 Token（注意去除 `Bearer ` 前缀）。

---

## 3. 在 Piwin 中配置与使用

### 3.1 用于 Code Search 代码搜索
1. 打开 Piwin 客户端点击左下角 **「设置」**；
2. 进入 **「代码搜索 (Code Search)」**；
3. 搜索模式选择 **Devin 官方 Token**；
4. 粘贴你获取到的 Token 并点击 **「测试连通性」**，保存即可生效。

```
┌─────────────────────────────────────────────────────────────┐
│                    代码搜索配置 (Code Search)                │
├─────────────────────────────────────────────────────────────┤
│ 搜索模式:   (•) Devin 官方 Token (推荐)                     │
│ Key 填入:   tok_********************************            │
│ 状态:      [ 测试连通性 - 正常 ]                             │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 用于 Web Search 网络检索
1. 在 **「设置」➔「网络检索 (Web Search)」** 中选择 Devin 驱动的搜索服务端点；
2. 填入相同的 Token 并保存。

---

## 4. 安全与合规免责声明

- 本指引仅供个人开发者在私有化开发环境中进行技术研究与学习交流；
- 提取的凭据仅加密存储在本地机器（`~/.piwin`），不会向任何外部第三方服务器分发；
- 请妥善保管个人凭据，遵守对应平台的服务条款。

---

## 5. 关联文档

- [Code Search 智能代码语义检索](./code-search.md)
- [Web 搜索配置与服务](./web-search.md)
- [快速起步概览](./getting-started.md)
