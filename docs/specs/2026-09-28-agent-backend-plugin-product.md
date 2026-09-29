# 可选 Agent 插件：产品与功能实现方案

状态：产品方向已获用户认可；以下实现方案待审阅，尚未实施。本稿替代此前“内置 Grok 开关 + 用户自行安装 CLI”的草案。

## 1. 产品承诺与首发范围

piwin 是默认开箱即用、可以按需增加 Agent 的统一工作台。Pi 内置；Grok Build 是首个可选安装的 Agent。统一发现、配置、会话与审批体验，不统一或改写各 Agent 的内部执行循环。

首发闭环：市场找到 Grok → 安装适配插件 → 检查/补齐运行依赖 → 登录 → 新建 Grok 会话 → 流式消息/工具/审批 → 取消 → 重启恢复 → 停用/卸载但保留历史。

插件安装不等于可用。新用户不安装 Grok 时，Pi 的启动、设置、会话、包体与后台进程不引入 Grok runtime 负担；共享 ACP 支持代码可以随 Host 发布，Grok 二进制不随 DMG/NSIS 打包。

首发不做：会话中途 Pi↔Grok 转换、任意第三方 JS 适配器、跨 Agent 自动复用登录/技能/MCP、Grok TUI 全功能等价、混合 Agent 子代理编排、原生 TUI 交接。其他 ACP Agent 后续逐项验证再上架，不承诺仅写清单即可兼容所有 Agent。

## 2. 用户功能清单

| 入口 | 首发功能 | 完成标准 |
| --- | --- | --- |
| 市场 / 发现 | 新增 Agent 类型，Grok 卡片展示用途、支持的 Host 平台、账户/费用前提、验证范围 | 能区分“换执行引擎”和“给引擎加工具”，目录不把作者声明标成实测 |
| Agent 详情 | 安装内容、来源、适配插件版本、CLI 兼容范围、支持/缺失功能 | 下载前知道安装在哪里、是否需要账号、是否执行本地代码 |
| 安装向导 | 检测环境 → 选择已有 CLI 或补齐依赖 → 登录 → 验证连接 | 支持重试、取消与恢复；没有完成探测不能显示就绪 |
| 已安装 / 设置 | 同一 Host 库存，重新检测、登录、停用、更新、卸载 | 不生成第二套本地安装状态；明确当前 Host 名称 |
| 新建会话 | 有已安装的非 Pi Agent 时显示 Agent 选择，默认 Pi | 未就绪条目可见但不可发送，带“完成配置”；没有第二个 Agent 时保持原界面 |
| 会话 | Agent 身份标记、文本/思考流、工具卡、审批、取消、历史恢复 | Agent 绑定创建后不可变；不支持的操作在 UI 和 Host 同时禁止 |
| CLI | Agent 列表、安装、检测、登录、启停、卸载以及创建指定 Agent 会话 | 与 Desktop 调用同一 Host 命令，不能自行启动另一套会话权威 |
| 拓展站 | 同站新增 Agent 分类与详情，清楚展示兼容范围和安装指引 | 与应用内条目 ID/版本一致；网页不能直接在用户机器执行安装 |

界面复用现有市场卡片、设置结构、@piwin/ui-kit 对话框与审批卡，不重做导航和视觉系统。错误提供具体下一步，异步状态有可访问的反馈；取消安装与取消会话是不同操作。

### 2.1 安装向导

1. 确认目标 Host、插件来源和运行权限。安装轻量、固定版本的声明式适配清单，不加载仓库 JS，也不运行安装钩子。
2. 用户明确启动环境检查。探测 Host OS/架构、CLI 路径及版本；已有官方安装默认复用，也可显式选择路径。
3. 缺 CLI 时提供“安装运行依赖”。仅对已验证的官方分发方式启用应用内安装：用户确认来源、版本、预计下载量和目标后，按平台执行固定安装配方。无可靠校验或未验证平台只显示官方安装指引与重新检测，不能伪装一键安装。
4. 登录使用本机 Grok 支持的认证流程。若只有交互式 CLI 登录，则引导用户在 Host 机器完成并重新检测；远端 Host 不能误在 Desktop 本机登录。
5. 短生命周期的握手探测通过后显示“可用”；不发送收费 prompt 作为静默连接测试。若认证状态只能通过真实请求确认，显示“登录待验证”，试用请求由用户主动触发。
6. “开始使用”创建新会话；安装向导不会自动发送任务。新会话第一次运行才创建持久会话进程。

不再承诺“启用时绝不产生任何进程”：安装元数据与启用开关本身不运行第三方代码；用户明确触发检测/登录可以启动短任务，完成后回收；只有执行会话才驻留 Agent 进程。

### 2.2 状态不是一个大枚举

Host 分别持有：安装状态（未装/安装中/已装/失败）、启用状态、就绪状态（未检查/检查中/缺依赖/版本不支持/待登录/待验证/可用/错误）、当前活动 Run 数。市场和设置由这几项派生主按钮。

例如：已安装但缺 CLI → “继续配置”；已安装但禁用 → “启用”；可用 → “新建会话”；暂时网络失败 → “重试检测”，不能把已安装插件显示为丢失。浏览目录不探测所有第三方命令。

## 3. 架构与职责

```text
Desktop / CLI / 后续 Mobile
             │ HostCommand / HostPush
        host-runtime（唯一组合根）
             ├─ Pi 路由 → agent-host → Pi SDK / RPC（保留现有语义）
             ├─ 可选 Agent 库存/配置 → agent-plugins（拟新增）
             ├─ ACP 会话 → acp-agent（拟新增）→ Grok CLI
             ├─ process / permission / session 等现有服务
             └─ marketplace：目录与库存投影
```

- contracts：后端身份、插件清单、安装/就绪状态、会话操作能力、命令与推送类型。
- agent-plugins：清单验证、不可变插件修订、选择的运行依赖及安装归属、启停与检测状态。进程/下载等外部能力使用 Host 注入端口，不直接依赖其它应用包。
- acp-agent：stdio 协议、请求生命周期、标准 ACP 事件映射及必要的 Grok 差异模块。进程端口由 Host 注入；不导入 Pi。
- host-runtime：按后端路由、管理产品 Run、会话绑定、审批响应、持久化投影与多客户端广播；不重写 Grok 内部 Agent loop。
- agent-host：仍只负责 Pi；不新增“Grok 模式”的 PiSdkAdapter/PiRpcAdapter。
- marketplace：统一目录，Agent 安装分派给对应领域命令，不在市场包创建 runtime。

新增包时更新架构依赖图与边界检查器。共用接口从当前调用所需的最小公共操作开始，不建立无限扩展的插件虚拟机。

## 4. Agent 插件契约（拟新增，不是现有 API）

清单至少包括 schemaVersion、稳定 ID、显示名、插件版本、最低 Host 版本、协议类型、Host 平台约束、CLI 兼容范围、受支持的启动/检测/认证配方 ID、声明能力、帮助与费用说明。

首发仅接受受审查的配方 ID，映射到 Host 支持的固定命令与参数模板。远端目录不能直接下发任意 shell、安装脚本或 JS 模块。插件清单固定 commit/内容摘要并校验；目录固定版本并不等于作者代码可信，也不能替代用户确认。

插件版本、CLI 版本、握手实际能力是三个独立维度。实际能力取适配器已实现范围与 runtime 实测能力的交集，不信任清单自报全支持。

拟新增命令族（命名可在契约评审统一）：

- agents/list、agents/install、agents/set-enabled、agents/uninstall。
- agents/check、agents/setup、agents/authenticate；耗时操作返回 operationId，通过状态推送进度，支持取消。
- session/create 增加 agentId；省略时为 Pi。
- 会话快照/推送增加后端身份、可执行操作及不可用原因。

只复用中立的 Host 操作句柄，不把 Grok 伪装成带假 steer/getTree 成功返回的 Pi SessionHandle。Pi 专用接口继续留在 Pi 路径。

## 5. 会话与数据兼容

### 5.1 身份与旧数据

- 产品 sessionId 是主键；后端绑定持久保存 agentId、选定插件修订、backendSessionId（创建后）、运行版本信息。工作目录沿用现有产品字段。
- 旧 SessionIndexRecord 没有后端字段时解释为 Pi，保留 piSessionFile，不改写 Pi JSONL。
- 未知或已卸载 Agent ID 不回退 Pi；保留身份与历史，提示重装/启用。
- session/new 产生原生 ID 后，先持久化绑定再发送首条 prompt。保存失败不得继续执行；native new 后进程/Host 崩溃的孤儿情况必须有显式恢复策略，不能悄悄重发任务。
- 已存在 Grok CLI 历史批量导入不在首版；首版只恢复 piwin 创建并绑定的会话。

### 5.2 历史投影与恢复

Grok 原生历史是执行上下文权威；piwin transcript 是显示与搜索投影。不默认注入 Pi 历史、Pi 系统提示、Host 工具、Pi OAuth 或全部 MCP/Skill 配置。

不能假定 ACP 每个文本事件都有稳定事件 ID。协议探针必须确认 load 的重放与结束边界：有稳定 ID 可幂等入库；否则使用明确的 hydration 阶段，将重放和 live turn 隔离并按消息边界对账，不能只凭文本相同去重。若无法可靠区分重放，恢复能力不得标为已支持，交回评审而非掩盖缺口。

ACP 调用绑定 sessionId、runtime generation 与 Run。过期进程的迟到事件不进入新一代会话。Host/进程故障把正在运行的任务标为中断，不自动重发可能已产生副作用的 prompt。

### 5.3 能力门控

首版可用能力：发送文本、流式输出、工具进度、审批、取消、恢复（均需探针验证）。模型/推理强度、计划、附件、diff 按实际能力开启；Grok 的模型选择不使用 Pi 的全局 provider/model 引用。

Pi 专属 fork/rewind、steer、compaction、Host 子代理与冷存储/打包等操作必须逐项盘点。未支持的操作 UI 不展示或解释禁用，Host 直接调用也拒绝；产品级查看、重命名、搜索等可保留。能力不再只靠全局 HostStatus 控制。

## 6. 权限、生命周期与卸载

- ACP 权限请求映射现有 Host 审批交互，保留后端 option ID 和语义。没有永久批准选项就不显示“始终允许”。不使用 always-approve 补缺失实现。
- 审批请求绑定后端、会话、generation、请求 ID；多客户端只能决议一次。取消、过期或退出后不能响应到下一轮；断开一个 Desktop 不代表用户拒绝，待决请求仍由 Host 保持。
- Grok 已批准/内部执行的操作未必逐条经过 piwin 规则引擎，UI 必须准确标明权限来源，不能声称统一沙箱。
- 首版不默认开放 ACP 客户端 FS/terminal。若 Grok 基础循环必需，探针确定后通过 Host 授权服务实现；不能宣告支持但返回假结果。
- 进程按 session/generation 管理；超时、协议错误、取消、Host 退出时有有界清理与终态；资源上限复用现有 Host 配额原则。idle 会话允许按已验证的 load 能力回收。
- 停用先阻止新 Run，当前 Run 可继续到边界；更新不能热替换运行中的修订。已有会话保留修订，兼容升级要显式迁移，旧修订被引用时不可直接清理。
- 卸载保留会话索引、后端绑定与 transcript，仅取消插件可执行状态。永不删除用户自装 CLI、~/.grok 会话或认证文件。
- Host 托管的 CLI 依赖以独立归属记录管理；只有无会话/插件引用且用户选择清理时才删除。失败安装只清理本次 staging；不自动更新用户系统安装。

## 7. 拓展站整合：兼容优先

现有 index.json 的 schemaVersion=1 + extensions[] 是严格 Pi Extension 协议。首版保留它不变，同站增加 agents.json（独立版本化 schema），Host 将两份目录合并为统一市场。这样老客户端继续工作，不要求站点与所有客户端同日升级。

Agent 目录包含明确 kind=agent、条目 ID、固定版本、清单来源与完整摘要/commit、撤回状态、Host 版本/平台要求。目录不包含可直接执行的 shell 安装命令；安装前重新核验选择的版本，不追踪可变分支。

条目离线精选与远端缓存沿用现有市场原则。agents.json 不存在或超时不能拖垮已有扩展市场，也不能篡改已安装状态。

拓展站首版提供条目详情和“在 piwin 市场搜索此 Agent”的复制入口；若已有受校验的打开应用能力则复用，但不把新的 deep-link 安装协议作为前置条件。浏览网页绝不自动安装。

拓展站源码位于独立仓库 https://github.com/mimimaster/piwin-extensions，当前项目没有该站源码。主仓可先交付解析器、fixtures 和发布交接说明；站点修改/上线单独需要仓库访问与发布流程，不能把本地 mock 当成已上线。

## 8. 实施门槛与切片

### 第 1 步是协议/分发可行性关卡

在隔离测试项目、用户确认的本机 Grok 认证状态下采样：initialize、认证探测、new/prompt、工具/审批、cancel、load 重放、异常退出、是否需要客户端 FS/terminal，以及 Host 平台对应的官方 CLI 安装来源、校验与登录方式。

保存脱敏样本、支持矩阵和判定，不保存凭据/授权码。涉及模型费用的 live prompt 要明确提示。任何核心循环缺失都阻塞相关后续切片，不能降级为 headless 文本回显并称完整实现。

随后：契约/ADR → 插件安装与就绪生命周期、ACP runtime → Host 会话纵切 → 市场入口 → Desktop/CLI → 站点对接 → 发布验收。插件生命周期和 ACP 协议层在契约明确后可隔离开发，不并发改同一 Host 文件。

## 9. 验收与验证

| 验收点 | 必须有的证据 |
| --- | --- |
| 默认零打扰 | 未安装 Grok 的 Pi 创建/恢复、SDK/RPC 回归；目录浏览不产生 Grok 进程 |
| 安装到可用 | 缺 CLI、版本不符、未登录、取消安装、失败重试、已有 CLI 复用；只有真实检测通过才 ready |
| 会话运行 | 文本与工具卡，真实审批允许/拒绝，取消，崩溃终态；没有重复发送任务 |
| 数据恢复 | 旧 Pi 索引兼容，双 ID 持久化，load 无重复气泡，过期 generation 事件丢弃 |
| 能力与权限 | 不支持操作 Host 拒绝，多客户端审批一次，取消后的迟到批准无效 |
| 更新与卸载 | 运行中不换版本；停用阻止新 Run；卸载后历史可读且用户 CLI/~/.grok 未动 |
| 市场兼容 | 旧 index fixtures 全通过；Agent 源不可用不影响扩展；错误 pin/recipe/平台不安装 |
| 桌面/CLI/远端 | 同一 Host 状态一致，依赖安装与登录发生在 Host；真实页面 DOM + 截图、CLI smoke |
| 平台声明 | 只展示已验证的平台；未在 Windows/Linux 验收不得声称跨平台就绪 |

实施阶段命令：pnpm typecheck；pnpm test:architecture；pnpm --filter @piwin/{contracts,session,agent-host,host-runtime,marketplace,cli,desktop} test（分别运行各包）；新增 agent-plugins/acp-agent 包必须有非空测试。Desktop 关键路径另做 e2e；用 mock ACP 覆盖确定性错误、重放和并发，再补真实 Grok smoke，不以 mock 替代实机验收。

当前仅规划：未运行 ACP 探针、未安装依赖、未登录 Grok、未改生产代码，也未发布拓展站。

## 10. 代码依据

- packages/contracts/src/marketplace.ts：当前仅 extension/skill/mcp，安装按领域命令分发。
- packages/marketplace/src/extension-registry-index.ts：严格 v1 扩展目录、固定 commit 和缓存。
- packages/contracts/src/plugin.ts + packages/marketplace/src/plugin/manifest.ts：组合包而非 Agent 接口。
- packages/contracts/src/session-index.ts：仅有 piSessionFile，旧记录尚无后端绑定。
- packages/contracts/src/host.ts：SessionHandle 包含必选 steer/getTree，不能直接假装所有 ACP 都支持。
- packages/host-runtime/src/product-agent-host.ts：目前构造 PiSessionBackend，需在外层增加后端路由而非污染 Pi adapter。
- docs/adr/0003-dual-mode-host.md、0036-host-server-multi-client-deployment.md、0077-github-extension-registry.md：保留 Host-first、Pi 专用边界、安装与执行信任区分。
