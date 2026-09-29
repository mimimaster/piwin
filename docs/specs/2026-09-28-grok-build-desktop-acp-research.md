# Grok Build 作为 piwin 桌面端 Agent 的接入调研

| 项目 | 内容 |
| --- | --- |
| 日期 | 2026-09-28 |
| 状态 | 方案调研；未决定实施范围，未开始实现 |
| 目标 | 在 piwin Desktop 使用 Grok Build 的 Agent 能力，由 piwin UI 展示会话和交互；Grok TUI 为可选入口 |

## 1. 需求理解

用户选用的是 **Grok Build 整套 coding-agent harness**，包括它自己的会话、工具、计划、子代理和配置，而不只是把 Grok 模型接到 Pi。piwin 负责桌面交互、项目与会话入口、可见的输出和审批；Grok Build 负责实际的 Agent 执行。未来可以在同一个产品里选择 Pi 或 Grok Build，但每个会话绑定一个执行后端。Grok Build 希望以可启用的插件形态交付；这需要新的 Agent 后端插件能力，不能复用当前仅组合 Skill/MCP 的插件类型。

“一键切换”先定义为从新会话入口切换执行后端。已经存在的 Pi 与 Grok 会话各自保持原生上下文；跨后端迁移同一会话不作为首版承诺。可选的“在 terminal 打开 Grok TUI”是另一条入口，需要验证同一 Grok session 的并发占用与交接。

## 2. 已核实的接入面

1. Grok Build 官方提供长期运行的 ACP Agent：`grok agent stdio`，通过 JSON-RPC 进行 `initialize`、`session/new`、`session/load`、`session/prompt`，以 `session/update` 推送回答、思考、工具与计划，并能发起权限请求。它另有 `serve` WebSocket 模式。参见 [Grok Agent Mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md) 与 [官方 CLI 文档](https://docs.x.ai/build/cli/headless-scripting)。
2. `grok -p --output-format streaming-json` 可做单次集成，但官方将 ACP 用于需要工具、计划和权限 UI 的客户端。[官方 Grok README](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-shell/README.md) 也作此区分。
3. Grok 会话原生保存在 `~/.grok/sessions/`，ACP 可用 `session/load` 恢复。Grok 自己管理认证和配置，路径是 `~/.grok/`；piwin 只在 `~/.piwin` 保存产品侧绑定和展示索引，不复制凭据。[Grok Session Management](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/17-sessions.md)、[Grok Settings](https://docs.x.ai/build/settings)。
4. Grok 有标准 ACP 之外的 `x.ai/*` 扩展，涉及 Git、文件、worktree、terminal、搜索、会话管理等。首版只依赖已验证的标准流程；扩展逐项检测能力并实现。[Grok Agent Mode](https://github.com/xai-org/grok-build/blob/main/crates/codegen/xai-grok-pager/docs/user-guide/15-agent-mode.md)。
5. 本机已有 `grok 1.0.41 (4220f3b224a6)`；`grok agent --help` 显示 `stdio`、`serve`、`headless`、`leader`。目前只验证了命令存在，尚未做带认证的 ACP 实网往返。

## 3. 与 piwin 现状的边界

当前 Desktop 通过 `HostCommand` / `HostPush` 连接 Host，Host 拥有会话、Run、持久化和推送。`ProductAgentHost` 当前构造 Pi 专用 blueprint，`@piwin/agent-host` 是 Pi 专用边界；因此不能把 Grok ACP 直接塞进 `PiSdkAdapter` / `PiRpcAdapter`，也不能让 Desktop 直接启动 Grok。参见 [架构](../architecture.md)、[ADR 0003](../adr/0003-dual-mode-host.md)、[ADR 0036](../adr/0036-host-server-multi-client-deployment.md)。

建议的拓扑：

```text
Desktop / CLI / Mobile
        ↓ HostCommand / HostPush
HostRuntime（会话和 Run 的产品权威）
        ├─ Pi session runtime → @piwin/agent-host → Pi SDK / RPC
        └─ Grok session runtime → ACP client → grok agent stdio（Host 机器）
```

Grok 进程在 Host 所在机器运行。远端 Desktop 仍连接 piwin Host，不直接连接 Grok `serve`。新 `@piwin/acp-agent` 可拥有通用 ACP 进程和协议；Grok Build 插件声明启动方式与能力，并在必要时提供小范围的 `x.ai/*` 适配。`@piwin/host-runtime` 组合它。跨边界的会话来源、能力、事件与审批类型先落在 `@piwin/contracts`。新增顶层包时同步更新架构文档。Grok 不导入 Pi，`@piwin/agent-host` 仍只负责 Pi。

## 4. 推荐的交付切片

| 阶段 | 可见能力 | 必须验证 |
| --- | --- | --- |
| 0. 协议探针 | 无 UI 改动 | 本机版本的 initialize/auth、新建、流式回复、取消、权限请求、重启加载；记录真实消息样本 |
| 1. 可用会话 | 桌面选择“Grok Build”，新建/恢复会话，文本与工具卡、取消、权限审批 | Host 断线与进程崩溃后不出现假完成；Grok ID 与 piwin ID 稳定绑定 |
| 2. 丰富体验 | 计划、模型/推理强度、附件、文件变更、子代理/后台任务等按能力逐项接入 | 先对照 ACP/扩展的实际事件；未支持的 piwin 操作在该会话中隐藏或禁用 |
| 3. 可选入口 | piwin 内嵌 terminal / 打开 Grok TUI | 同一原生会话不会被 ACP 和 TUI 同时写入；交接、恢复和审批语义明确 |

首版应让用户先拥有完整的基本循环：安装/登录状态 → 选项目 → 新建 Grok 会话 → 发消息 → 看流式输出/工具 → 审批 → 取消 → 退出后恢复。仅有 `grok -p` 的文本回显不足以达到桌面端目标。

## 5. 关键设计约束

- **会话双 ID**：piwin session ID 是产品侧身份；Grok 原生 session ID 是执行侧身份。映射、cwd、后端类型持久化，恢复时由 Host 校验并调用 `session/load`。Grok 原生历史是其运行上下文权威；piwin transcript 是 UI/搜索/推送的投影，需按事件 ID 幂等写入，避免 `session/load` 重放产生重复消息。
- **不能伪装成 Pi 会话**：Pi 特有的会话树、上下文种子、暂停检查点、Steer/Follow-up 和 Host 工具注入，不能默认认为 ACP 支持。引入会话能力描述，桌面按后端能力显示操作；不支持时明确反馈。
- **权限**：Grok 自己的 permission mode 与 piwin 的规则引擎是两套机制。交互版默认接住 ACP 权限请求，并由 Host 转成 piwin 审批 UI；不能用 `--always-approve` 来绕开缺失的桥接。若 Grok 请求客户端的 terminal/FS 能力，由 Host 实现、限制并审计，不能让 Desktop 或未经授权的进程直接执行。需要验证 Grok 自身工具执行路径是否还有 piwin 审批无法覆盖的部分，并在产品中准确表述权限来源。
- **配置与认证**：调用已安装的 `grok`，依照 Grok 的 `authenticate` 能力选择已缓存登录或 API key；不读取或复制 `~/.grok/auth.json`。piwin 的 Grok 模型 OAuth 配置并不等于 Grok Build harness 已登录。缺少命令、版本不兼容和未登录都需要可操作的错误提示。
- **多客户端**：所有 Grok 进程、审批、会话映射与运行状态仍归 piwin Host；Desktop/CLI 只用产品协议。进程驻留、重启、取消、并发与资源限制沿用 Host 的运行生命周期语义。
- **扩展兼容**：`x.ai/*` 能力按握手及版本探测。官方文档列的是功能类别，具体 wire 方法和返回形状需要用当前安装版本的实测样本固定；不能仅凭名称推断。

## 6. 插件化形态

当前 `packages/contracts/src/plugin.ts` 的 `PluginManifest` 只有 `skills`、`mcpServers`、`secrets`；`packages/marketplace/src/plugin/manifest.ts` 会拒绝未知字段。因此 Grok Build 今天不能仅靠一个 `plugin.json` 接入。`Pi Extension` 则是 Pi 内部的工具/事件扩展，不是能替换 Pi 的 Agent 后端。

推荐新增 **Agent 插件类型**，而不是把 Grok 伪装成 MCP 服务或 Pi Extension：

| 部分 | 所属职责 |
| --- | --- |
| piwin 核心 | 稳定的 Agent 后端契约、ACP 客户端、Host 运行与权限、进程监管、会话映射、标准事件投影、UI 能力开关 |
| Grok Build 插件 | 可用性/版本探测、`grok agent stdio` 启动描述、认证入口、Grok 模型与配置项、可选 `x.ai/*` 能力适配 |
| 用户 | 在设置中安装/启用 Grok Build；新建会话时选择 Agent；未安装/未登录时看到清楚的修复入口 |

首版可交付**内置、可启停的 Grok Build Agent 插件**，以官方已安装的 `grok` 为依赖。这样先验证真实的安装、启用、运行、禁用链路，同时让契约保持对其他 ACP Agent 开放。之后再考虑第三方插件包的安装、版本固定、可信代码执行与更新。插件安装本身不应启动二进制；首次启用执行需要用户明确知道它会以 Host 用户权限运行。

插件更新/停用不得打断正在执行的 Run；在 Run 边界处理，并保留既有 Grok 会话的后端身份。停用后会话仍可见，但不能静默用 Pi 恢复。若未来允许插件自带执行代码，安装与运行信任边界应参照现有托管 Pi Extension 的修订、激活和回滚语义，但不能把那套 Pi 加载器直接用于 ACP Agent。

## 7. 方案比较与结论

| 方案 | 判断 |
| --- | --- |
| piwin Desktop 直接连 Grok ACP | 实现快，但形成第二套会话、权限、远端与推送权威，不符合 Host-first 设计。 |
| Host 每轮运行 `grok -p` | 适合探针/自动化；长期桌面体验缺少稳定的交互会话与完整 ACP 事件。 |
| **Host 托管 Grok ACP** | **推荐**。保留 Grok Build harness 与 piwin UI；与现有多端/远端拓扑一致，代价是明确处理双会话身份与能力差异。 |

下一步先做一个**独立协议探针**，在真实 `grok 1.0.41` 上记录握手、认证、消息、审批、取消与恢复，不改现有 Pi 路径。通过后写一份实施 spec/ADR，固定首版 UI 范围、能力契约和会话持久化方案，再开始纵向切片。

## 8. 市面桌面客户端调查（2026-09-28）

### 8.1 Grok Build 是否只能通过 ACP 接入？

不是。官方发布的 Grok Build CLI 支持 TUI、`grok -p --output-format streaming-json` 的单次 headless 运行，以及 `grok agent stdio` / `grok agent serve` 的 ACP Agent 模式。CLI 的 Rust 源码也已公开，但并未发现官方承诺的稳定、可嵌入桌面应用的 harness SDK。直接调用 xAI 模型 API 只得到模型；Agent loop、工具、会话、MCP 等由调用方自己实现，不能算运行 Grok Build harness。[官方概览](https://docs.x.ai/build/overview)、[Headless/ACP 文档](https://docs.x.ai/build/cli/headless-scripting)、[开源公告](https://x.ai/news/grok-build-open-source)。

对于需要长期会话、工具过程、计划和互动审批的 piwin，ACP 是目前最合适的**正式外部集成接口**。stdio / WebSocket 是 ACP 的两种传输形态。headless JSON 是可用替代，但它更适合一次性任务和脚本。

### 8.2 代表性实现

以下为项目公开源码/文档所能确认的实现路线，不等于对安装包做了独立实机验收。

| 产品 | 接入方式 | 公开资料显示的能力与缺口 |
| --- | --- | --- |
| [Groky](https://github.com/ti-ebi/groky) | Tauri Rust Host 启动 `grok agent stdio`；本地索引 + Grok 会话恢复 | 文本/思考/计划/工具、审批、模型/effort、附件、多会话、终端等有明确清单；作者标注为早期版本，恢复取决于 Grok `session/load` 支持；未声称 TUI 全功能等价。 |
| [KayG](https://github.com/technodweep/grok-build-gui) | Tauri + ACP，读部分 `~/.grok` 状态，并调用 Grok CLI 命令/斜杠命令补齐 | [全能力清单](https://github.com/technodweep/grok-build-gui/blob/main/docs/full-parity-plan.md) 覆盖计划、审批、worktree、插件、记忆、自动化、媒体等；清单也明确标出终端交互较弱、子代理 spawn UI 部分支持。该文件的功能表与后续阶段状态有不一致处，不能据此判定 100% parity。 |
| [Grok Build Desktop / VS Code](https://github.com/phuryn/grok-build-vscode) | Electron 桌面复用编辑器 ACP 客户端；标准 ACP + Grok `_x.ai/*` 扩展 + 本地状态处理 | 公开[架构](https://github.com/phuryn/grok-build-vscode/blob/main/docs/architecture.md)详细记录会话、工具、diff、权限、worktree 与扩展适配。开发者的[协议实测反馈](https://github.com/phuryn/grok-build-vscode/blob/main/docs/internal/ACP-feedback.md)说明许多 Grok 特性需版本探测和 workaround；历史实测版本是 1.0.5 等，不能直接推断本机 1.0.41 仍有相同问题。 |
| [Liaan Grok Desktop](https://github.com/liaan/grok-desktop) | Electron + ACP；`x.ai/*` worktree；`grok mcp`/`grok plugin` 命令管理 | README 自报对话、审批、diff、CLI 历史恢复、worktree、插件/MCP；模型/技能编辑 UI 仍计划中。 |
| [JaydenCJ Grok Build Desktop](https://github.com/JaydenCJ/grok-build-desktop) | Tauri，每轮 `grok --output-format streaming-json`，自身 SQLite 会话/队列 | 使用的是官方 Grok CLI/harness，但主要接入点是 headless JSON；README 展示流式回答、会话侧栏、MCP/Skills 设置和队列。不能从这些功能推断它实现了 ACP 的实时审批与全部会话控制。 |
| [Skunkworks Grok UI](https://github.com/kdewald/skunkworks-grok-ui) | Tauri + 通用 ACP，Grok/Codex/Claude 多后端 | 同一桌面 UI 选择不同后端，每个会话保留原生后端身份；这是 piwin Agent 插件方向的直接产品先例。公开 README 主要覆盖基本对话、附件、审批与远端 SSH，未证明 Grok 专属功能全覆盖。 |

另有直接接 Grok 模型 API、自建工具循环的“Grok 桌面端”。它可以做得很丰富，但模型相同不等于 Grok Build 会话、工具策略、插件和子代理行为相同。[官方 Grok Build 模型 API 说明](https://x.ai/news/grok-build-0-1)本身也把模型与 agentic harness 分开。

### 8.3 “能力全”应如何判断

**Agent 执行能力**：ACP 客户端启动的是官方 `grok` harness，Grok 自己仍运行工具、MCP、skills、plugins、hooks、子代理等；这部分不是桌面客户端重新实现的。官方把 ACP 定位为自建客户端/编排应用的支持路径。[Grok Build 发布说明](https://x.ai/news/grok-build-cli)。

**桌面操作与可见性**：目前没有看到可独立证明与 TUI 完全等价的客户端。标准 ACP 足以做基础对话、流式事件、工具、计划、审批、恢复；高级操作往往依赖 Grok 私有扩展、CLI 斜杠命令、`grok` 子命令或读取 Grok 本地状态。典型落差是每条命令的长期授权、准确用量/上下文指标、原生 fork/rewind、深度子代理控制、交互式终端、自动化与插件管理。KayG 的清单以及 phuryn 的版本化实测都显示这些功能是逐项补的，不会因接入 ACP 自动出现。[KayG parity 清单](https://github.com/technodweep/grok-build-gui/blob/main/docs/full-parity-plan.md)、[ACP 实测反馈](https://github.com/phuryn/grok-build-vscode/blob/main/docs/internal/ACP-feedback.md)。

其中 phuryn 在 Grok 1.0.5 上测到 ACP 权限选项、Plan 模式 terminal 委托、用量和 diff replay 的差异；这些是**旧版证据和测试设计输入**，不是对本机 1.0.41 的现状断言。piwin 实施前必须用本机版本复测权限、计划、FS/terminal、session/load、subagent 和扩展事件。

**对 piwin 的结论**：将“完整使用 Grok Build”分为两层承诺：第一层保证通过官方 harness 完成真实 coding-agent 工作；第二层逐项实现 piwin UI 对 Grok 特性的操作和展示。插件的能力清单应明确标注哪些已由 ACP 验证、哪些经 `x.ai/*` 或 CLI 命令实现、哪些当前只可在原生 TUI 操作。不能把 UI 上有按钮当作语义和 TUI 相同。
