# Web 搜索与网络检索服务配置

在软件工程开发中，大语言模型的知识库截止到训练时间。在遇到最新发布的开源库（如 React 19、Next.js 15 等 API 变更）或时效性 Bug 时，智能体通过 **Web 搜索（联网检索）** 可以主动查阅最新官方文档与 GitHub Issue，从而写出绝对准确的代码。

Piwin 提供了极为开放和自由的网络检索配置，你可以根据自身对搜索质量、响应速度与稳定性的要求自由搭配。

---

## 1. 为什么需要灵活配置 Web 搜索？

1. **模型内置搜索 vs 独立检索工具**：部分云端模型自带联网能力，但返回内容不可控或被模型厂商截断；
2. **AI 定制化清洗**：专为 Agent 设计的搜索引擎（如 Tavily）返回的数据去除了广告、导航栏与无效 HTML 标签，信息密度更高，Token 占用更少；
3. **免费与高质量并存**：你可以选择每月提供免费额度的商业服务商，或者配置由逆向技术得到的专用高效 Key。

---

## 2. 搜索提供商推荐与配置方法

打开客户端 **「设置」➔「网络检索 (Web Search)」**：

![Web Search 设置界面实景](/images/readme/web-search.jpg)


---
### 选项 A：Devin 官方 OAuth (最推荐，一键自动打通) <span class="tag-badge tag-free">完全免费</span> <span class="tag-badge tag-fast">极速高质量</span>

不需要自己去抓包找 Token！在客户端「设置 ➔ OAuth 登录」点击 **Devin** 完成浏览器授权，系统即可自动获取并配置好搜索能力：

- **核心亮点**：一键授权后，不仅可以直接享受高质量 Web 搜索，还可以直接驱动 [Code Search 语义代码检索](./code-search.md)，双料功能即刻点亮；
- **极简配置**：进入客户端「设置 ➔ OAuth 登录」点击 Devin 登录即可；如果习惯手动填入 Token 也同样支持，详见：[Devin 授权与 Token 指引](./token-acquisition.md)；
- **开源 MCP 项目**：底层兼容开源生态 [mimimaster/windsurf-search-mcp](https://github.com/mimimaster/windsurf-search-mcp)。
---
### 选项 B：Tavily Search API <span class="tag-badge tag-free">每月 1000 次免费</span> <span class="tag-badge tag-fast">专为 AI 设计</span>

Tavily 是目前最受主流智能体欢迎的搜索引擎，返回的结果经过专业的数据清洗与精简。

- **免费额度**：注册即享每月 **1000 次** 免费请求，个人日常编码完全够用；
- **获取步骤**：
  1. 访问 [Tavily 官网 (tavily.com)](https://tavily.com/) 注册账号；
  2. 登录控制台后复制 `API Key`（格式形如 `tvly-*********`）；
  3. 在 Piwin 搜索设置中选择 **Tavily** 并填入 Key 保存。


---

### 选项 C：Brave Search API <span class="tag-badge tag-free">开发者免费额度</span>

Brave 提供了完全独立的全球网页索引库，注重隐私且搜索质量出众。

- **免费额度**：提供 Free Tier 每月免费查询额度；
- **获取步骤**：访问 [Brave Search API Portal (brave.com/search/api/)](https://brave.com/search/api/) 注册开发者账号并获取 API Token。

---

### 选项 D：SearXNG 私有化自建 <span class="tag-badge tag-local">完全私有化</span>

如果你希望彻底避免数据外流，可以在本地或 NAS 上自建开源元搜索引擎 **SearXNG**，并在 Piwin 中填入你自建服务的 Base URL。

---
### 选项 E：smart-search <span class="tag-badge tag-local">智能路由</span>
这属于究极方案了，详细看L站佬友的文章，支持使用Jev自动路由选择合适的web_search，这属于高端玩法了，对搜索质量要求很高的同志可以选择这个，多种渠道的web_search自动路由，这是佬友的文章：https://linux.do/t/topic/2920995
## 3. 关联文档

- [Devin Token 与专属 Key 获取指引](./token-acquisition.md)
- [Code Search 智能代码搜索](./code-search.md)
- [Web 社群与生态资源](./web-community.md)
- [提示词系统中的网页正文清洗契约](./prompt-system.md#21-网页正文萃取契约-fetch_extract_system_prompt)
