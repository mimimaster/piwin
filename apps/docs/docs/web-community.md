# Web 社群与生态资源获取指引

在 **Piwin** 中，除了强大的核心推理之外，联网检索（Web Search）与丰富的社区生态资源也是让智能体保持最新感知、解决复杂工程问题的重要支撑。

本文档将指导你如何获取高质量的社群资源、扩展插件与提示词库。

---

## 1. 核心扩展与 MCP 资源生态

Piwin 全面兼容 **Model Context Protocol (MCP)** 标准与 Pi 扩展协议：

### 1.1 精选开源连接器推荐
- **[windsurf-search-mcp](https://github.com/mimimaster/windsurf-search-mcp)**：基于 Devin 专有 Token 的免费高效 Web 检索与代码搜索连接器；
- **[Model Context Protocol 官方生态](https://github.com/modelcontextprotocol)**：涵盖 GitHub、Postgres、GitLab、Slack、Figma 等数百种官方及社区开源连接器；
- **[Agent Memory MCP](https://github.com/)**：用于跨会话持久化记录项目架构、历史 Bug 修复经验与技术决策。

### 1.2 提示词与 Agent 技能库
- **提示词与角色定制**：查阅 [提示词工程与上下文设计体系](./prompt-system.md) 获取针对编程、架构设计与 Code Review 的标准生产提示词；
- **Skills 技能系统**：在 `~/.piwin/skills/` 目录下放置针对特定工作流的自动化操作剧本。

---

## 2. 开发者交流与社区渠道

- **开源仓库**：访问 [GitHub Repository (github.com/mimimaster/piwin)](https://github.com/mimimaster/piwin) 提交 Issue、提出 Feature Request 或参与代码贡献；
- **LINUX DO 社区**：访问 LINUX DO 开源专区，与更多热衷于折腾 AI Agent、模型路由与自动化编程的开发者交流心得；
- **技术文档站**：[https://docs.piwinwin.com](https://docs.piwinwin.com)。

---

## 3. 关联文档

- [Web 搜索服务配置指南](./web-search.md)
- [Pi 扩展生态与热加载](./extensions.md)
- [Devin Token 获取指引](./token-acquisition.md)
- [快速起步概览](./getting-started.md)
