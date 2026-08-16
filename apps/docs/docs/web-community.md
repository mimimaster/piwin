# Web 搜索与社群资源获取指引

在 **Planora** 中，除了强大的模型推理之外，联网检索（Web Search）与社群生态资源也是让智能体获取最新信息、解决复杂工程问题的重要支撑。

本文档将指导你如何获取免费/低成本的网络搜索 API，以及如何获取高质量的社群资源与扩展插件。

---

## 1. Web 搜索 API 获取指路 {#web-search}

让智能体具备联网检索能力，可以实时搜索最新的技术文档、API 更新和开源库变更。

### 选项 A：Tavily Search API <span class="tag-badge tag-free">每月 1000 次免费</span> <span class="tag-badge tag-fast">专为 AI 设计</span>

Tavily 是专门为 AI Agent 设计的搜索引擎，返回的结果经过清洗与精简，非常适合智能体阅读。

- **免费额度**：注册即可获得每月 **1000 次** 免费搜索请求，完全满足个人日常开发。
- **获取步骤**：
  1. 访问 [Tavily 官网](https://tavily.com/) 注册账号。
  2. 登录后进入 Dashboard，复制你的 `API Key`（格式形如 `tvly-*********`）。
- **在 Planora 中配置**：
  - 进入「设置」➔「网络检索 (Web Search)」。
  - 搜索引擎选择 **Tavily**。
  - 填入你的 API Key 并点击保存。

---

### 选项 B：Brave Search API <span class="tag-badge tag-free">开发者免费额度</span>

Brave 提供了独立的搜索引擎索引库，保护隐私且搜索质量极高。

- **免费额度**：提供 Free Tier（每月一定额度的免费查询）。
- **获取步骤**：
  1. 访问 [Brave Search API Portal](https://brave.com/search/api/)。
  2. 注册开发者账号并订阅 Free 计划。
  3. 创建 API Token 并在 Planora 设置中填入。

---

### 选项 C：SearXNG 私有化自建 <span class="tag-badge tag-local">100% 自主可控</span> <span class="tag-badge tag-free">无限调用</span>

如果你有自己的服务器或 VPS，可以一键通过 Docker 部署 SearXNG 聚合搜索引擎。

- **快速部署命令**：
  ```bash
  docker run -d --name searxng -p 8080:8080 -e "BASE_URL=http://localhost:8080/" searxng/searxng
  ```
- **在 Planora 中配置**：
  - 搜索引擎选择 **SearXNG**。
  - 填入自建实例地址（如 `http://your-server-ip:8080`）。

---

## 2. 社群与生态资源获取 {#community-resources}

Planora 拥有活跃的开源与开发者社区，你可以在以下渠道获取技能扩展（Skills）、提示词库（Prompts）以及 MCP 工具包。

### 1. 模型与提示词资源
- **系统提示词与角色定制**：访问 [Awesome-Prompts](https://github.com) 获取针对编程、架构设计、Code Review 的专属提示词。
- **MCP (Model Context Protocol) 插件集**：
  - [Model Context Protocol 官方生态](https://github.com/modelcontextprotocol)
  - 涵盖 GitHub、Postgres、Slack、Figma 等数百种官方及社区开源连接器。

### 2. 开发者交流社群
- **GitHub Discussions**：提交 Feature Request、查看更新日志与技巧分享。
- **交流答疑**：加入 Planora 开发者技术群，与更多智能体折腾爱好者交流心得。

---

## 3. 常见问题 {#faq}

::: details 智能体为什么需要 Web 搜索工具？
大语言模型的知识库截止到训练时间。在遇到最新发布的开源库（如 React 19、Next 15 等最新 API 变更）或时效性 Bug 时，智能体通过 Web 搜索可以主动查阅最新官方文档与 Issue，从而写出绝对准确的代码。
:::
