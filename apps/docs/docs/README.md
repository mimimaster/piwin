<div align="center">

# Piwin 砚

<p align="center">
  <img src="/app-icon-512.png" alt="Piwin Logo" width="120" height="120" />
</p>

### 以砚为主题，明、墨分离，优雅的动态交互

**PiWin 面向个人、基于Pi的Coding Agent Desktop**

面向个人 · 拥抱Pi生态 · 极简配置 · 代码语义检索 · 先进的子代理编排 · 全双工实时语音 · 视觉委托省钱省心

<p align="center">
  <a href="https://github.com/mimimaster/piwin/releases"><img src="https://img.shields.io/github/v/release/mimimaster/piwin?color=6366f1&label=Release&logo=github" alt="Release" /></a>
  <a href="./docs/architecture.md"><img src="https://img.shields.io/badge/Architecture-Host--First-10b981?logo=diagramsdotnet" alt="Architecture" /></a>
  <a href="https://docs.piwinwin.com"><img src="https://img.shields.io/badge/Docs-docs.piwinwin.com-6366f1?logo=gitbook" alt="Docs" /></a>
  <img src="https://img.shields.io/badge/Platforms-macOS%20%7C%20Windows%20%7C%20Web%20%7C%20CLI-0ea5e9" alt="Platforms" />
  <img src="https://img.shields.io/badge/Stack-Tauri%202%20%7C%20React%2019%20%7C%20Node%2022%20%7C%20Rust-f59e0b" alt="Stack" />
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License" /></a>
</p>

<p align="center">
  <a href="https://docs.piwinwin.com"><b>📖 在线文档站</b></a> ·
  <a href="#-快速上手与使用方式"><b>⚡ 快速安装</b></a> ·
  <a href="#-核心特性亮点"><b>✨ 功能矩阵</b></a> ·
  <a href="#-整体系统架构"><b>🏛️ 系统架构</b></a> ·
  <a href="#-架构红线与开发规范"><b>📐 开发红线</b></a> ·
  <a href="./docs/adr/"><b>变更决策 (ADR)</b></a>
</p>

<p align="center">
  <b>简体中文</b> | <a href="./docs/en/README.md">English (Coming Soon)</a>
</p>

<br />

<p align="center">
  <img src="https://img.yorickjue.com/file/1789922562056_image.png" alt="Piwin 桌面工作台全景预览" width="96%" style="border-radius: 12px; box-shadow: 0 16px 36px rgba(0,0,0,0.2);" />
</p>

</div>

---

## 💡 诞生的初心与设计哲学

> *“砚者，研墨沉淀、静水流深。集百家之所长，归于一案之间。”*

 现在各类工具壳层出不穷又大差不差，有一个适合自己，有生态支撑又足够开放的agent还是蛮重要的，Pi应该是首选，但对于不习惯终端操作，嫌弃配置麻烦，喜欢desktop的用户，我这个工具也算是不错的选择
 - 基于Pi SDK，参考了诸多Pi设计原则，像Yolo First，没有Plan模式（落档成计划文件）
 - 架构上支持Agent Runtime级别的拓展，热插拔，但是毕竟没有TUI，所以只能部分支持，内置拓展市场，可以分级安装拓展；
 - code-search 原生工具，跟grep、read同级，参考devin实现的代码语义检索工具（得配模型），防止上下文腐烂，提高agent决策质量；
 - 子代理编排 可以自定义符合自己的子代理派发方式，自带ultra code和fusion两种编排方式，前者参考codex ultra，后者参考devin fusion
 - 内置artifact渲染，分为inline和canvas，对于信息密集度较高的场景，极大提升效率，你可以自己控制开关
 - 极其自由和友好的BYOK配置方式，包含各类模型的配置和委托方式，从文本模型到各类音视频模型；从embedding到reranker；支持oauth登录（Pi原生）等；
 - 内置视觉委托和web_search自由配置，方便你使用文本模型，简单下拉选择视觉模型，使用极其方便，你可以选择使用模型内置搜索，也可以使用外部各类搜索，具体可见使用文档，这部分可玩性大；
 - 内置部分实用拓展，比如缓存拓展，提高提示词命中缓存率，降低你的token消费；
 - 全双工的语音托管功能，是的，你可以边聊天，边coding；
 - 权限管理，虽然基于PI，但是还是加了个权限管理，方便你的场景。注意！默认是YOLO！，但依旧拦截rm等危险操作；
 - chat与agent分开管理，chat模式更少上下文注入，只读，响应快，交互方便；agent更专业；
 - 内置各类工具配合使用，terminal、浏览器、画布、note、
 - llm wiki + 闪卡，核心是闪卡，产出方式：知识库产出闪卡，也可以在任意对话区域划词或者调用Skill生成闪卡，支持闪卡管理，目前仍缺乏一定产品创意，欢迎各位的改造
 - 自由的部署方式，采用客户端与Host Runtime分离的分层架构，你可以使用一体包（我提供的，web可访问），也可以分开部署，核心是Host Runtime，你可以部署Host在服务器或者你的电脑，单独起一个shell客户端连接Host服务，可以简单理解为前后端分离，目前正在开发ios shell壳子，可以接入apple health kit, 申请可能需要点时间，期间欢迎大家使用web方式访问，或者自行开发对应系统的壳子；
 - 其他功能：包括codex宠物功能、冷存储（方便管理会话资源）、会话树、用量统计、资源管理等，大家在使用的过程中会发现更多的细节的



---

## ✨ 核心特性亮点

### 1. 0-Token 污染的智能语义搜索
- **Code Search**：对 Devin (原 Windsurf) Fast-Context 机制的实现，与grep、read等原生工具同级，对比fast-context mcp 召回率更高、门槛更低、模型兼容替换，推荐使用devin的key token响应极快；
- **零上下文注意力稀释**：自带编排模板会派发轻量独立的**只读 Scout 子代理**深入代码库梳理文件路径、接口定义与调用关系，**仅向主模型回传高信噪比提炼报告**，彻底告别几千行无关代码冲垮主会话长上下文的弊病，结合code_search使用效果更佳；
---

### 2. 工业级多子代理编排体系 (Subagent Orchestration)
在输入框（Composer）一键切换多agent编排模式

- **Ultra Code 模式（侦察兵 + 精准打击）**：先派发只读 Scout 子代理完成全代码库的依赖梳理与潜在影响面分析，输出结构化蓝图；主模型审阅报告后在纯净的上下文中精准落实代码修改；
- **Fusion 模式（SOTA 规划 + 高性价比执行）**： 参考devin公开资料实现
  - **规划与执行解耦**：主控会话（Lead）使用顶尖 SOTA 模型把握顶层架构与需求澄清；执行节点（Sidekick）配置高速轻量模型处理机械编码；
  - **Git Worktree 物理隔离**：所有代码写入均在临时的 Git Worktree 分支中并发实测与编译自愈，杜绝半成品污染主工作区；
  - **原子级合并与审查**：测试通过后生成 Candidate 候选集，经主控审查后原子级合入主分支，**Token 综合成本降低 60%+**。

---

### 3. 双层模型配置枢纽与极速视觉委托 (BYOK & Multi-Account)
- **通道层 (Channel) 与 套餐账号层 (OAuth) 彻底解耦**：
  - **通道层 (BYOK)**：原生支持 OpenAI、Anthropic、Google Gemini、OpenRouter 自定义 Base URL 与 API Key，以及本地 Ollama 私有化端点；
  - **套餐账号层 (OAuth)**：一键浏览器授权登录官方订阅（**Kimi Coding**、**OpenAI Codex**、**Claude Pro/Max**、**xAI Grok**、**GitHub Copilot**），凭证由本机 Host 安全托管；
- **毫秒级视觉委托 (Vision Delegation)**：
  - 为纯文本或昂贵的深度思考模型配备免费轻量多模态节点（Google Gemini 2.5 Flash / 硅基流动 Qwen2.5-VL / 本地 Ollama）；
  - 粘贴截屏或架构图时，自动完成图像特征提炼与 OCR，节约 **70%~90%** 的上下文 Token；
- **原生多媒体生成契约**：内置 `image_gen`（Flux / DALL-E）与 `video_gen` 工具契约，出图与视频资产原生沉淀至本地媒体库（`~/.piwin/media/`）。

---

### 4. 全双工实时语音 Live 结对编程 (Realtime Voice)
- **说话面与工作面契约分离 (Live Spoken Contract)**：
  - **说话面 (Speaking Face)**：负责自然的实时语音交互、寒暄、方案探讨与口误纠偏，提炼结构化 Brief 简报；
  - **工作面 (Chat Agent)**：在后台沉稳读写文件、执行构建与验证单测；完成后由说话面以极简的一句话回传关键 Takeaway；
- **全双工随时插话打断**：像真人坐在身旁一样边看屏幕边探讨方案；兼容 OpenAI Realtime 协议、Codex 官方 Live 与 Grok2API 语音通道。

---

### 5. 主动式 HTML / SVG 制品沙箱 (Artifact Runtime)
- **双模态无缝呈现**：
  - **Inline 内嵌视图**：对话流中紧凑渲染流程图、排版报表、交互卡片；
  - **Canvas 独立工作区视图**：复杂应用原型、数据可视化大屏、交付调研报告自动向右展开至全宽 Canvas 独立面板，对话区智能微调避让；
- **严格防御与流式预览**：移植成熟的安全沙箱（iframe + 严苛 CSP），阻断脚本提权与外部未受信网络请求，支持模型流式生成时毫秒级实时渲染。

---

### 6. 主机级无障碍语义浏览器工作台 (Browser Workbench)
- **Playwright 原生驱动**：Host 集中管理专属 Chromium 实例，具备点击、表单填充、滚动、网络监听与控制台捕获等全套工具；
- **Aria Snapshot 语义映射**：基于无障碍语义树定位网页元素，彻底规避脆弱的坐标猜测与易变的 DOM 选择器；
- **低延迟推流与双工锁**：桌面端右侧面板可实时推流显示浏览器画面，支持 Agent 自动操作与人工操作无缝交接（Lock 机制）。

---

### 7. 砚·多窗格桌面工作台与会话树 (Inkstone Multi-Pane & Tree)
- **多任务灵活切分**：单窗口支持 1 / 2 / 4 / 8 独立会话窗格自由切分（Split Right/Down），各任务具备独立的上下文流与执行管线；
- **SQLite 完整会话历史树**：支持会话无损分叉（Fork Branch）、完整克隆（Duplicate）、阶段截断回滚与断电安全持久化；
- **Goal 目标模式**：通过 `/goal` 唤起结构化任务面板，清晰掌握拆解步骤、阻塞等待与最终交付验证。

---

### 8. 企业级三层统一权限引擎 (Permission Engine)
- **Deny → Ask → Allow 严格门禁**：杜绝违规操作隐式放行；严格物理阻断对敏感目录（如 `.ssh/`、`.env`、密钥证书）的越权篡改；
- **免打扰工程记忆**：支持项目维度的常用命令记忆与安全白名单放行，保障敏捷开发的同时防范毁灭性指令（如误删库或强制推送）。

---

### 9. 原生扩展热装载生态 (Extensions & Skills)
- **无感平滑热加载**：在任务执行过程中一键安装社区扩展或编写本地 Skill，系统优雅等待当前轮次收尾后在下一轮自动激活，**无需重启客户端，完整保留对话上下文**；
- **全栈生态支持**：支持 Agent 自定义扩展工具、生命周期 Hook 以及 MCP (Model Context Protocol) 进程监督。

---

## 🏛️ 整体系统架构

`piwin` 采用 **“客户端表现层接入、单一 Host 权威控制、数据与代码完全本地化”** 的前后端分离架构：

```text
┌────────────────────────────────────────────────────────┐
│        多端接入 (Desktop · Web · Mobile)               │
└────────────────────────────────────────────────────────┘
                           │
                           ▼
┌────────────────────────────────────────────────────────┐
│     Piwin 核心工作台 (状态与工具执行)                   │
│ • 会话控制 & SQLite 历史树      • 安全防护门禁         │
│ • 子代理编排 & Worktree 隔离    • 浏览器 & 制品沙箱    │
└────────────────────────────────────────────────────────┘
```

### 核心分层与职责契约

| 层次 | 模块位置 | 核心职责 |
| :--- | :--- | :--- |
| **① 多端表现层** | `apps/desktop` · `apps/cli` · `apps/mobile` | 各终端一致的交互体验；客户端保持轻量，**绝不直接导入底层 Pi 包**，只负责 UI 呈现与用户交互。 |
| **② 协议与传输** | `packages/contracts` · `packages/host-client` · `packages/host-transport` · `packages/host-server` | 纯净的双向通讯协议通道，支持 stdio、WebSocket 远程连接、状态流式推送与断线重放。 |
| **③ Host 组合根** | `apps/host` · `packages/host-runtime` | **全产品唯一组合根与状态权威**，统筹会话生命周期、三层权限引擎、工具执行与子代理调度。 |
| **④ Agent 执行边界** | `packages/agent-host` · Pi Kernel | 通过进程内 SDK 或独立 RPC Worker 驱动模型与 Agent Loop，作为接触底层内核的唯一边界。 |
| **⑤ 扩展能力生态** | `packages/browser` · `packages/mcp` · `packages/git` · `packages/artifact` · `packages/doc-rag` | 将工程执行、浏览器、知识检索、媒体与制品渲染能力按需插拔装配进 Host。 |
| **⑥ 数据与本地隐私** | 本地代码库 · `~/.piwin` · 密钥管理器 | 源码、会话历史树、配置与日志 100% 留存于用户本地，杜绝未经授权的数据上传。 |

---

## 🚀 快速上手与使用方式

命令都在仓库根目录执行。开发和打包是两条命令，不要混用。

| 入口 | 用途 | 开发 | 打包与使用 |
| :--- | :--- | :--- | :--- |
| Desktop | 一体包。窗口里自带 Host，本机直接用 | `pnpm dev:tauri` | `pnpm package:desktop`，安装生成的 dmg / exe |
| Web | 浏览器访问。页面和 Host 打进同一个目录，同一个端口 | `pnpm dev:host` 与 `pnpm dev:web`，打开 `http://127.0.0.1:1420` | `pnpm package:web`，再运行 `./dist/piwin-host/start-host.sh`，打开 `http://127.0.0.1:8787` |
| 桌面端壳子 | 只有桌面窗口，不带 Host。连已经跑起来的 Host | `pnpm dev:tauri:shell` | `pnpm package:desktop-shell`，启动后填 Host 的 `ws://` 地址 |
| Host | 单独的后端。给桌面端壳子、Web 或别的机器连 | `pnpm dev:host`，监听 `ws://127.0.0.1:8787` | `pnpm package:host`，再运行 `./dist/piwin-host/start-host.sh` |

一体包和单独的 Host 不要在同一台机器同时开，两者会抢 `~/.piwin`。

你也可以按场景往下看：**桌面一体安装包**、**Web 正式部署** 或 **源码开发**。

### 方式一：下载桌面一体安装包（推荐 · 零环境门槛）

官方发布提供 **macOS（Apple Silicon）全功能一体化正式版** 与 **Windows 一体化安装包**：

- **零依赖开箱即用**：普通用户无需在本机配置 Node.js、pnpm、Python 或 Rust。安装包内置独立沙盒化的 **Node 22 LTS 运行时、Host Sidecar 守护进程、LanceDB 原生向量引擎与 Tauri 2 桌面客户端**；
- **下载与安装**：
  1. 前往 **[GitHub Releases](https://github.com/mimimaster/piwin/releases)** 下载最新版安装包：
     - **macOS**：下载 `piwinwin_<version>_aarch64.dmg`，双击后将 `piwin` 拖入 Applications（应用程序）文件夹即可；
       > *macOS 首次打开安全提示*：因未购买商业公证证书，若首次启动系统提示“无法验证开发者”，请前往 macOS「系统设置 → 隐私与安全性」点击「仍要打开」即可正常运行。
     - **Windows**：下载 `piwinwin_<version>_x64-setup.exe` 安装包，按指引完成安装后启动；
- **运行模式**：桌面端支持 **内置 Sidecar 模式**（随应用启动自动拉起本地 Host）与 **远程 Attach 模式**（连接远程主机或 NAS 上的 Host）。

---

### 方式二：Web 正式部署（一个目录，给别人访问）

不需要源码，也不需要开发服务器。打包一次，把目录拷到要跑的机器上，启动后浏览器打开同一个端口。

在构建机器上：

```bash
pnpm install
pnpm package:web
```

产物是 `dist/piwin-host/`。里面的 `web/` 是页面，`start-host.sh` 同时提供页面和 WebSocket。拷走整个目录后：

```bash
./start-host.sh
```

本机浏览器打开 `http://127.0.0.1:8787`，地址填 `ws://127.0.0.1:8787`，点 Connect。不用 token。不要和这台机器上的一体包同时开，两者会抢同一份 `~/.piwin`。

给别人访问时，Host 继续只听本机，TLS 放在前面：

```bash
export PIWIN_HOST_BIND=127.0.0.1
export PIWIN_HOST_PORT=8787
export PIWIN_HOST_TOKEN='换成长随机口令'
export PIWIN_HOST_ALLOWED_ORIGINS='https://ui.example.com'
./start-host.sh
```

用 Caddy、nginx 或 Tailscale Serve 把 `https://ui.example.com` 反代到 `127.0.0.1:8787`，并升级 WebSocket。`PIWIN_HOST_ALLOWED_ORIGINS` 填浏览器地址栏里的来源，多个用来源逗号分隔。页面里的地址填反代后的 `wss://` 地址，再填口令。

浏览器壳是远程客户端：会话、发消息、设置可用。本机终端、系统文件框、安装扩展不在这条连接上。

---

### 方式三：终端 Agent CLI 模式

如果你偏好纯终端与 Vim 结对编程：

```bash
pnpm dev:cli
```
支持在终端中进行代码检索、文件编辑、子代理调度、工具执行与沉浸式交互。

---

### 方式四：开发者全栈编译与二次开发

如果你需要对 Piwin 进行功能定制或二次开发：

#### 1. 环境准备
- **操作系统**：macOS (Apple Silicon 推荐)、Linux、Windows
- **开发工具**：Node.js `>= 22.0.0`、pnpm `>= 9.0.0`、Rust `>= 1.75.0`（用于桌面端编译）

#### 2. 本地初始化与核心脚本
```bash
# 1. 克隆代码仓库
git clone https://github.com/mimimaster/piwin.git
cd piwin

# 2. 安装全部 workspace 依赖
pnpm install

# 3. 运行静态类型检查、架构红线与单元测试
pnpm check

# 4. 启动对应入口进行开发
pnpm dev:desktop    # 启动桌面端 / Web 前端 (Vite 极速热重载)
pnpm dev:tauri      # 启动完整 Tauri 2 桌面端调试
pnpm dev:host       # 启动 Host 独立后端服务
pnpm dev:cli        # 启动终端命令行 CLI

# 5. 编译打包桌面端安装包
pnpm package:desktop # 打包生成 macOS (.dmg) / Windows 一体化安装包
```

---

## ⚙️ 核心功能配置速查

| 配置模块 | 推荐接入方案 | 说明与指引文档 |
| :--- | :--- | :--- |
| **OAuth 官方订阅** | 一键授权 Kimi Code / Codex / Claude / Grok | 在「设置 ➔ OAuth 登录」中直连各平台套餐 · [查看指南](https://docs.piwinwin.com/oauth-login.html) |
| **模型与多模态** | DeepSeek V3 / Claude 3.7 + Gemini Flash 视觉 | 自带 API Key 或结合免费视觉委托，大幅降低成本 · [查看指南](https://docs.piwinwin.com/model-config.html) |
| **代码搜索 (Code Search)** | 提取 Devin 专属 Token（免费极速） | 零上下文污染的语义代码搜索，支持复用于 Web 检索 · [获取指引](https://docs.piwinwin.com/token-acquisition.html) |
| **网络搜索 (Web Search)** | Tavily API（每月 1000 次免费） / Devin Key | 专为 Agent 设计的干净网页清洗萃取 · [查看指南](https://docs.piwinwin.com/web-search.html) |
| **实时语音 (Live Voice)** | OpenAI Codex 官方 Live / Realtime 协议 | 开启 Composer 小麦克风体验全双工实时结对 · [查看指南](https://docs.piwinwin.com/realtime-voice.html) |
| **多端组网直连** | Tailscale 加密虚拟局域网 | 将 Host 托管于 NAS，手机与浏览器跨端随行 · [部署指南](https://docs.piwinwin.com/deployment.html) |

---

## 📐 架构红线与开发规范

为确保系统的长期演进质量与架构纯洁度，所有代码修改与 Pull Request 必须严格恪守 [`AGENTS.md`](./AGENTS.md) 规则：

1. **绝对禁止跨层污染**：表现层（`apps/*`）严禁直接导入底层 Pi 包，所有交互必须经由 `@piwin/contracts` 或 Host 协议；
2. **单一组合根**：`packages/host-runtime` 是全产品唯一允许装配领域服务与执行业务逻辑的中心，严禁在子包私设旁路；
3. **单向依赖图**：依赖关系严格向下单向流动：`apps → host-runtime → packages/* + agent-host → contracts`；
4. **单文件 1000 行硬上限**：生产代码单文件逼近 400 行时必须规划职责拆分，超过 1000 行直接判定违规；
5. **严禁静默异常**：严禁任何形式的空 `catch (e) {}`，所有异步任务与流通道必须具备超时与显式清理机制；
6. **契约先行**：新增跨领域能力必须先在 `@piwin/contracts` 定义规范，严禁侵入式魔改底层内核。

---

## 🗂️ 仓库目录导览

```text
piwin/
├── apps/                        # 客户端外壳与接入层
│   ├── desktop/                 # Tauri 2 桌面端主应用 & Web 前端 (React 19 + Vite + Mantine)
│   ├── cli/                     # Node.js 交互式终端命令行工具
│   ├── host/                    # 独立 Host 服务端可执行包 (WebSocket Server)
│   ├── mobile/                  # 移动端外壳 (iOS / Android 轻量直连外壳)
│   └── docs/                    # 技术文档站 (VitePress)
├── packages/                    # 领域能力包 (按职责高内聚低耦合拆分)
│   ├── contracts/               # 全局共享契约、类型定义与 IPC 协议 (纯叶子包)
│   ├── host-runtime/            # 全局唯一产品组合根、权限引擎与调度中心
│   ├── host-server/             # 远程 WebSocket 协议服务与连接管理
│   ├── host-client/             # 统一 Client 通信封装与状态恢复
│   ├── host-transport/          # 底层 WebSocket / stdio 传输通道
│   ├── agent-host/              # Pi 内核适配层 (SDK / RPC 双模式运行)
│   ├── browser/                 # Playwright 驱动的主机浏览器推流与无障碍映射
│   ├── doc-rag/                 # LanceDB 本地向量知识库与 FSRS 记忆检索
│   ├── artifact/                # HTML / SVG 制品解析与安全预览沙箱
│   ├── mcp/                     # Model Context Protocol 进程监督与工具分发
│   ├── session/                 # SQLite 会话树分支存储与冷存归档
│   ├── git/                     # Git 仓库操作与 Worktree 并发分支隔离
│   ├── process/                 # 跨平台子进程树管理与自动回收
│   ├── media/                   # 剪贴板与多模态资产存储管理
│   ├── tools-web/               # 网络检索与网页正文清洗萃取服务
│   └── ui-kit/                  # 桌面端共享 Mantine UI 组件库
├── scripts/                     # 自动化构建、公证、校验与打包脚本
├── docs/                        # 架构设计 (Architecture)、决策记录 (ADR) 与规格说明 (Specs)
└── AGENTS.md                    # 专为 AI Agent 与协作者制定的核心架构红线
```

---

## 🤝 社区、交流与开源

- **官方文档站**：[https://docs.piwinwin.com](https://docs.piwinwin.com)
- **代码仓库**：[https://github.com/mimimaster/piwin](https://github.com/mimimaster/piwin)
- **问题反馈与建议**：欢迎提交 [GitHub Issues](https://github.com/mimimaster/piwin/issues) 或 Pull Requests

### 开源许可

本项目遵循 [MIT License](./LICENSE) 开源协议。所有源码、会话树记录与敏感凭证默认存储于用户本地计算机，尊重每一位开发者的代码主权与数据隐私。
