# 开源自荐：我做了一款“吃百家饭”长大的面向个人 Coding Agent 工作台 —— Piwin (砚)

> **项目主页**：[https://docs.piwinwin.com](https://docs.piwinwin.com)  
> **开源仓库**：[https://github.com/mimimaster/piwin](https://github.com/mimimaster/piwin)  
> **一句话介绍**：基于 Pi 内核打造、专为个人开发者打磨、配置极度省心方便的随身智能编程工作台。

---

## 1. 为什么做 Piwin？

在过去的一年里，AI 编程工具爆发式增长。作为一名重度开发者，我自费体验了几乎市面上所有的产品：从 Cursor、Devin、Windsurf，到 Claude Code、Codex、Kiro、Qoder、Grok Code 等。

然而在长期实际工程使用中，我经常面临几个痛苦的困境：
- **配置与切换繁琐**：不同工具绑死在各自专有的生态中，换个客户端历史记录和配置全部丢失；
- **上下文污染严重**：一次长对话随着读取的文件变多，主模型上下文迅速恶化，注意力急剧稀释；
- **官方订阅调用受限**：手里握着官方订阅或各种 Key，却很难找到一个能够一键集成、方便调度、不搞强制消费的前端；
- **Token 浪费肉疼**：用昂贵的大模型看报错截图、对齐前端样式，不知不觉烧掉几刀。

于是，我决定打造一款**完全属于开发者自己、配置自由省心、真正面向个人使用习惯**的 Agent 工作台 —— **Piwin**。

---

## 2. 核心特性亮点

### 1. 单一 Host 权威控制 + 多端解耦
- **架构解耦**：所有会话状态、权限引擎、工具执行与子代理调度全部收口在 **Piwin Host** 运行时中；
- **多端共享**：macOS / Windows 桌面端、Tailscale 远程 Web 端、iOS 移动端外壳均直连同一 Host，随时随地接续长程开发任务。

### 2. Inline & Canvas Artifact 实时渲染
支持在对话流中直接渲染 HTML、SVG、React 原生可视化组件与数据看板。提供内嵌对话流的 **Inline 视图** 与支持宽屏操作的 **Canvas 独立工作区视图**，内置严格的沙箱安全策略防范恶意脚本。

### 3. 智能体语义代码搜索 (Code Search)
参考 Devin Fast-Context 机制，基于只读子代理深入代码库进行依赖与拓扑关系探索。真正做到 **0 上下文污染**，不再因为几千行无关代码冲垮主模型的长上下文。  
查看详细说明：[Code Search 智能代码搜索](./code-search.md)

### 4. 多子代理编排协作 (Ultra Code & Fusion)
- **Ultra Code 模式**：先派发 Scout 侦察兵摸清代码关系，再由主代理实施精准修改；
- **Fusion 模式**：采用“SOTA 主规划模型（如 Claude 3.5 / DeepSeek V3） + 高性价比执行节点（如 Flash）”的黄金组合，通过独立 Git Worktree 并行写代码，主分支一键原子级合并与审查。  
查看详细说明：[子代理编排与协同](./subagent-orchestration.md)

### 5. 实时全双工语音 (Live Realtime Voice)
内置说话面契约（Live Spoken Contract），还原像真人结对编程一样“边聊天、边下发需求、边修改代码”的沉浸式体验。支持 OpenAI Realtime 协议、Codex Live 与 Grok2API 实时语音通道。  
查看详细说明：[实时语音与 Live 协作模式](./realtime-voice.md)

### 6. 极速视觉委托 (Vision Delegation)
为纯文本或昂贵的深度推理模型配备轻量级视觉委托模型（如 Google Gemini Flash / 硅基流动 Qwen2.5-VL / 本地 Ollama），毫秒级完成 UI 截图与报错识别，大幅节约 Token 消耗。  
查看详细说明：[视觉模型与委托配置指引](./vision-models.md)

---

## 3. 为什么叫“吃百家饭”？

“吃百家饭”包含双重含义：

1. **设计上博采众长**：深度体验了市面上几乎所有优秀的 Coding Agent，将好用的交互（Devin 的 Fast-Context、Codex 的 Ultra Code、Astra 的实时语音、Cursor 的多窗格切分、Pi 的扩展能力）在私有化架构中完整实现；
2. **开发上千锤百炼**：项目在构建过程中充分借助了各家强模型的推理能力与代码审查，历经数百次严苛的单测与架构重构。

---

## 4. 快速把玩指引

1. 前往 GitHub Releases 下载 **macOS 一体包**（`piwinwin_<version>_aarch64.dmg`）或 Windows 安装包；
2. 拖入应用程序直接启动；
3. 进入客户端「设置」快捷配置你的模型（支持官方订阅 OAuth 一键登录或输入自定义 Key）；
4. 配好 Web 搜索或视觉委托，开始享受随身掌控的智能编程体验！

- **在线文档站**：[https://docs.piwinwin.com](https://docs.piwinwin.com)
- **开源仓库**：[https://github.com/mimimaster/piwin](https://github.com/mimimaster/piwin)
