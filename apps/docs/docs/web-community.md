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

## 2. 社区交流与特别致谢

### 2.1 特别致谢：LINUX DO 社区 (linux.do)

> **“真诚、友善、团结、专业 —— 新的理想型社区。”**

衷心感谢 **[LINUX DO (linux.do)](https://linux.do)** 以及社区内广大的极客开发者伙伴！

在 Piwin 的构思、内测与开源历程中，LINUX DO 社区提供了海量的高质量技术讨论、架构灵感以及前沿 Agent 工具的实战反馈。无论是探讨大模型路由与 Token 优化，还是测试子代理协同与本地工作流，社区热烈纯粹的开源技术氛围都是推动 Piwin 持续打磨的核心动力。

- **社区主站**：[https://linux.do](https://linux.do)
- **交流主题**：欢迎在 LINUX DO 社区交流 Coding Agent 最佳实践、提示词工程与模型配置心得。

### 2.2 开发者开源渠道

- **开源仓库**：访问 [GitHub Repository (github.com/mimimaster/piwin)](https://github.com/mimimaster/piwin) 提交 Issue、提出 Feature Request 或参与代码贡献；
- **技术文档站**：[https://docs.piwinwin.com](https://docs.piwinwin.com)。

---

## 3. 关联文档

- [Web 搜索服务配置指南](./web-search.md)
- [Pi 扩展生态与热加载](./extensions.md)
- [Devin Token 获取指引](./token-acquisition.md)
- [快速起步概览](./getting-started.md)
