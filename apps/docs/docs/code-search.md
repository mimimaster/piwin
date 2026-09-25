# Code Search 智能代码语义搜索

> **智能体驱动的代码语义检索 (Agentic Semantic Search)**  
> 告别简单的文本匹配与臃肿的上下文污染，让智能体像资深架构师一样理解工程全貌。

---

## 1. 什么是 Code Search？

**Code Search** 是 Piwin 内置的高性能代码语义搜索体系，灵感源自对 **Devin (原 Windsurf) Fast-Context** 机制的深度实测与底层逆向分析。

与传统的关键词匹配（如纯 Grep）或容易断章取义的简单向量检索（Vector RAG）不同，Code Search 采用 **Agentic 智能体驱动搜索范式**：

```text
┌──────────────┐       派发检索任务       ┌────────────────────────┐
│  主编码模型  │ ───────────────────────> │  Code Search 只读侦察兵 │
│ (上下文纯净) │ <─────────────────────── │ (深入代码库扫视依赖与定义)│
└──────────────┘     结构化拓扑与精确路径  └────────────────────────┘
       │
       ▼ 精准修改代码
┌──────────────┐
│  目标代码落地 │
└──────────────┘
```

![Code Search 智能代码搜索特性图解](/images/promo/features/02-code-search.jpg)

---

## 2. 核心优势：为什么它至关重要？

### 2.1 零上下文污染 (0-Token Context Pollution)
在大型代码仓库中，如果直接把搜索到的几十个文件全部灌入主模型的上下文（Context Window），会导致：
- 主模型注意力被大量无关代码严重稀释（Attention Dilution）；
- 上下文极速膨胀，单次交互 Token 费用暴涨，甚至迅速触发模型上下文上限；
- 极易产生幻觉与代码遗忘。

Code Search 派发独立的**轻量级只读子智能体**去深入代码库探查，梳理出精确的文件路径、接口定义与调用链后，**仅将高信噪比的提炼结果回传给主代理**，确保主工作区上下文始终清爽。

### 2.2 工具级别地位
在 Piwin 架构中，`code_search` 与 `read_file`、`grep`、`write_file` 处于**完全同一级别的一等公民核心工具地位**。当主模型需要了解项目全局模块划分、寻找某个函数的真实实现时，会主动调用 `code_search` 完成勘探。

---

## 3. 与 Ultra Code Scout 的关系

- **原理共通**：两者均基于“派发 Scout 侦察兵出去探查代码关系，回传精简报告给主代理”的理念，彻底防范上下文污染；
- **能力侧重**：
  - `Code Search` 更侧重于**原子级工具调用（Tool Invocation）**，随用随查，支持在单轮对话内快速返回精准符号与文件关系；
  - `Ultra Code` 是**整会话级的子代理编排模式**，用于在编写复杂功能前先输出一份全仓库维度的调研蓝图。

---

## 4. 配置与使用方式

打开客户端 **「设置」➔「代码搜索 (Code Search)」**：

![code_search 设置界面](/images/readme/code-search.jpg)


### 选项 A：使用 Devin 官方 OAuth 【最推荐 · 一键自动打通 · 免费极速】
- **优势**：不仅检索质量极高，而且完全免费；直接在「设置 ➔ OAuth 登录」点击 Devin 授权后，系统自动配置并同时激活 [Web 搜索服务](./web-search.md)；
- **配置方法**：无需繁琐抓包，进入客户端「设置 ➔ OAuth 登录」点击 Devin 完成浏览器授权即可；习惯手动填入的用户也保留了手动粘贴 Token 入口，详见：[Devin 授权与 Token 指引](./token-acquisition.md)；
- **配套工具**：底层兼容开源 MCP 连接器 [windsurf-search-mcp](https://github.com/mimimaster/windsurf-search-mcp)。

### 选项 B：使用自定义推理模型
- **模型要求**：建议配置首字延迟（TTFT）极低、每秒输出 Token 数（TPS）极快的高速模型（如 DeepSeek Flash、Gemini Flash、Claude 3.5 Haiku 等）；
- **工作机制**：由你指定的模型充当只读子智能体在后台执行代码逻辑分析。

---

## 5. 关联文档

- [Devin Token 与专属 Key 获取指引](./token-acquisition.md)
- [子代理编排协同：Ultra Code 与 Fusion](./subagent-orchestration.md)
- [Web 搜索配置与工具](./web-search.md)
- [快速起步概览](./getting-started.md)
