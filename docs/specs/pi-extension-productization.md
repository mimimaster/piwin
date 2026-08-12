# Pi Extension 产品化方案：即时扩展（Live Extensions）

| 字段 | 值 |
|------|----|
| 状态 | Proposed |
| 日期 | 2026-08-12 |
| 决策 | [ADR 0047](../adr/0047-managed-pi-extension-activation.md) |
| 相关 | [ADR 0010](../adr/0010-pi-extensions-channel.md)、[Settings / Capability Runtime Refactor](./settings-capability-runtime-refactor.md)、[Runtime Refactor](./runtime-refactor.md)、[ADR 0036](../adr/0036-host-server-multi-client-deployment.md)、[ADR 0040](../adr/0040-host-session-runtime-residency.md) |

## 1. 结论

piwin 可以继承 Pi 的扩展能力，但产品承诺应定义为：

> 用户安装一段受信任的 Pi Extension 后，无需重启 piwin、无需新建对话；piwin 会在当前任务边界为同一产品会话构建一代新 Agent Runtime，并在成功后切换到新能力，失败则继续使用旧能力。

对外名称建议使用 **即时扩展**，操作文案使用 **应用到当前 Agent**，不把技术性的 `reload` 暴露为主操作。

这里的“热更新”不是任意 JavaScript 模块的无损原地替换：

- 产品会话、可见消息和会话 ID 保持不变；
- 当前正在执行的 Run 不会中途更换工具或 Hook；
- 新 Runtime 从产品历史重建上下文，不保证保留 Pi 内部所有瞬时状态；
- 扩展代码拥有 Host 用户的完整 OS 权限，piwin 的权限规则不是它的沙箱；
- RPC worker 可以结束承载旧 Runtime 的 worker 进程并尽力清理进程树，SDK 模式不能保证清除扩展遗留的模块全局副作用；
- Pi Extension 扩展的是 **Agent Runtime**，不是任意 Desktop React 界面、Tauri 原生能力或 Host 应用包。

因此，产品核心不是“增加一个安装按钮”，而是建立完整闭环：

```text
获取源码 → 静态检查 → 安装但不执行 → 用户信任并申请激活
       → 等待当前 Run 边界 → 构建候选 Runtime → 原子发布
       → 观测 / 更新 / 回滚 / 隔离 / 审计
```

## 2. 当前基础与缺口

piwin 已经完成了大部分底座：

| 已有能力 | 当前实现 |
|----------|----------|
| 用户扩展目录 | `~/.piwin/extensions/` |
| 来源 | 本地文件、本地目录、Git |
| 发现与开关 | `extensions/list`、`extensions/set_enabled` |
| Desktop 页面 | 搜索、安装、启停 |
| 精确装载 | Host 编译 extension paths；仅 `@piwin/agent-host` 交给 Pi `DefaultResourceLoader` |
| 双后端 | SDK 与 piwin-owned worker 使用同一 Blueprint |
| 当前会话运行时替换 | `SessionRuntimeReplacementEngine` 与 `session/reload-runtime` |
| 运行状态 | live / stale / rebuilding / failed，加独立 residency 状态 |

还不能直接称为产品化热更新，原因如下：

1. 安装会覆盖可变路径，没有不可变版本、来源完整性、最后可用版本和回滚点。
2. `ExtensionSummary` 只有 ID、名称、路径、来源和 enabled，没有版本、内容摘要、风险、兼容性和当前 Runtime 绑定。
3. 当前 `extensions/set_enabled` 直接写配置，没有走 revisioned `SettingsService`，也没有稳定地把所有驻留会话标成 stale。
4. `resourceCatalogRevision` 只覆盖目录元数据和路径；同一路径内容被编辑时，能力快照可能不变。
5. 安装、启用和“当前 Runtime 已加载”是三个不同事实，但当前 UI 只显示一个开关。
6. 没有候选启动、自动保留旧版本、更新、回滚、卸载、隔离和部署审计。
7. Pi TUI 扩展并不天然兼容 Desktop。当前桥接只真正支持 confirm / select / input / notify；自定义 TUI、widget、editor、theme 等能力不可用或退化。
8. 扩展可直接使用 Node、进程、网络和文件系统，不能宣称受现有 Host 工具权限层保护。
9. Pi 原生 `ctx.reload()` 的同步语义不适合直接映射到 Host 的 Run 边界替换；当前 piwin 也没有把完整 command actions 绑定给扩展。
10. 多客户端环境下，安装、激活和状态必须由 Host 仲裁，不能由某个 Desktop 本地开关决定。

## 3. 产品边界与命名

### 3.1 三种能力不要混为一谈

| 类型 | 本质 | 权限与风险 | 典型用途 |
|------|------|------------|----------|
| Skill | Markdown 指令和工作流 | 不直接执行代码 | 教 Agent 如何完成任务 |
| Plugin | 声明式组合 Skills、MCP、配置与密钥引用 | 取决于所启用的 MCP / 能力 | 安装一套集成方案 |
| Pi Extension / 即时扩展 | 在 Agent Runtime 内执行的 TypeScript / JavaScript | 与 Host 用户同权限 | 注册工具、事件 Hook、命令和运行时行为 |

UI 中应把即时扩展放在“Agent 资源”下的高级区域，并明确显示“可执行代码”。用户只想补充知识或流程时，应优先推荐 Skill；需要外部系统连接时，优先推荐 Plugin / MCP。

### 3.2 第一版支持边界

第一版聚焦这些 Agent 能力：

- 启动期注册的工具；
- Pi 生命周期与 Agent 事件 Hook；
- confirm / select / input / notify 基础交互；
- 可被当前 piwin 会话路径验证的扩展命令；
- 扩展包内、可固定内容版本的附属资源。

以下能力必须标为“退化”或“不兼容”，不能静默当作正常支持：

- `ctx.ui.custom()`、自定义组件、widget、header/footer、editor、快捷键、theme；
- 依赖真实 TTY 输入或 Pi TUI 布局的扩展；
- 依赖 Pi 原生同步 `ctx.reload()` 完成自身控制流的扩展；
- 在受管包外动态发现未固定版本资源的扩展；
- 无法在 SDK 与 worker 两种后端得到一致行为的扩展。

## 4. 产品原则

1. **安装不等于执行。** 第三方扩展安装后默认处于未激活状态；读取 manifest 和源码元数据不得导入模块。
2. **用户授权执行。** 首次候选启动前必须告知扩展拥有完整 Host 用户权限；Agent 不能替用户确认。
3. **内容不可变。** 每次安装或更新生成新的 `contentRevision` 和精确 entry path；已被 Runtime 引用的目录绝不原地覆盖。
4. **Run 内不换能力。** 工具、Hook、提示资源和扩展版本只在 Run 边界切换。
5. **Host 是唯一权威。** Desktop、CLI、移动端和 Web 只发命令、消费状态；不扫描 Host 路径、不创建本地 Runtime。
6. **配置态、有效态、装载态分离。** UI 必须同时回答“用户想要什么”“Host 允许什么”“当前 Agent 正在用什么”。
7. **失败不破坏当前 Agent。** 候选 Runtime 发布前失败时，旧 generation 和最后可用扩展集继续工作。
8. **双后端一致。** SDK 和 worker 必须消费同一 `SessionBlueprint`、同一扩展 revision 集和同一激活时序。
9. **安全表述诚实。** worker 是崩溃与清理边界，不是 OS 沙箱；静态检查和候选启动也不是安全审计。
10. **自动化不能自我授权。** Agent 可以生成、修改和提交扩展草稿，但不能安装到有效目录、启用、更新或批准自身代码。

## 5. 状态模型

一个布尔 `enabled` 无法表达真实状态。扩展状态至少分为四条正交轴：

### 5.1 安装状态

```text
staged → installed → update-available
   └──→ invalid
installed / invalid → quarantined
```

- `staged`：源码已获取并完成静态检查，正在等待用户确认信任；
- `installed`：用户已确认并将不可变 revision 保存在受管仓库，但仍不代表已经启用或执行；
- `invalid`：入口、依赖、manifest 或兼容性校验失败；
- `quarantined`：Host 禁止任何新 Runtime 加载该 revision；
- `update-available`：仅表示发现新来源版本，不自动下载或执行。

### 5.2 用户意图

- `configuredEnabled: true | false`
- `selectedRevisionId?: string`

这是用户希望未来使用的版本，不代表当前会话已经加载。

### 5.3 Host 有效态

- `eligible`
- `blocked-project-untrusted`
- `blocked-incompatible`
- `blocked-collision`
- `blocked-quarantined`
- `blocked-policy`

项目扩展只有在项目已信任时才可能成为 `eligible`。

### 5.4 当前会话装载态

- `not-loaded`
- `loaded`
- `pending-current-run`
- `rebuilding`
- `failed-using-previous`
- `restart-required`

扩展卡片和会话 Runtime 页面都应显示：

```text
已配置：v1.4.0（启用）
当前 Agent：v1.3.2
状态：等待当前任务结束后应用
```

禁止用一个开关同时暗示“已保存配置”和“当前模型现在就能调用”。

## 6. 核心用户流程

### 6.1 安装

1. 用户选择本地文件 / 目录或 Git URL；远程客户端的本地路径始终指 Host 文件系统。
2. Host 获取源码到临时目录，不导入入口模块。
3. 静态检查：
   - 解析 Pi 原生 package metadata 和可选 piwin metadata；
   - 找到精确入口；
   - 计算完整包树内容摘要；
   - 固定 Git commit / 包版本 / integrity；
   - 检查裸依赖、安装脚本、重复 ID、已知工具名冲突和 Pi / piwin engine 范围；
   - 扫描明显的 TUI-only、`ctx.reload()`、包外动态资源等兼容性信号。
4. UI 展示来源、版本、变更摘要、兼容性和风险告知：
   - “此扩展可读取和修改 Host 用户能访问的文件，可启动进程并访问网络”；
   - 声明访问范围只能作为作者说明，不能作为强制边界；
   - 若需要依赖安装脚本，默认拒绝，只有高级流程可单独授权。
5. 用户确认后，Host 将源码复制为不可变 revision，状态为 `installed` 且默认禁用，仍不执行。
6. 主操作为“应用到当前 Agent”，而不是安装后自动启用。

本地开发可提供高级 `linked` 模式。文件监听只生成新的 staged revision 和提示，不得因保存文件自动执行新代码。

### 6.2 应用到当前 Agent

用户可选择：

- **当前任务结束后应用**：默认；当前 Run 完成后替换；
- **停止并立即应用**：显式终止当前 Run 后替换；
- **仅供新会话使用**：不主动重建其他驻留会话；
- 当前会话空闲时直接显示 **应用到当前 Agent**。

Host 流程：

```text
创建 ExtensionDeployment（带 settings / registry CAS）
  → 静态验证 target extension set
  → 若 Run 活跃，进入 waiting-current-run
  → 编译带精确 extension revision 的候选 Blueprint
  → 创建候选 SDK session 或 worker
  → 执行启动期兼容性检查并收集实际能力表面
  → 发布新 runtimeGenerationId
  → 旧 generation shutdown / dispose
  → 标记 selected session 已加载；其他驻留会话 stale
```

用户看到的会话、消息和会话 ID 不变。Runtime 替换会从产品历史重建上下文，因此产品文案应为“对话保留、Agent 能力重建”，不能称为“内部状态无损续接”。

候选在发布前失败时：

- 旧 generation 继续接收后续 Run；
- 新 revision 标记为 failed，不成为 last-known-good；
- UI 显示具体阶段和可操作错误；
- 提供“重试”和“一键回退到上一可用版本”。

这里的回滚只覆盖扩展 registry 指针和 Agent Runtime 发布。候选代码已造成的文件、网络、进程或外部系统副作用无法自动撤销。

### 6.3 更新与回滚

- 更新总是安装为新 immutable revision，不覆盖当前版本；
- 不受信任来源不得自动更新或自动激活；
- 更新检查可后台进行，但代码下载、依赖解析和候选执行分别显示状态；
- 默认先在用户当前选择的空闲会话做一次 canary activation；成功后才成为新的 last-known-good；
- 其他冷会话在下次激活时使用最新已提交版本；
- 其他驻留会话标记 stale，按各自 Run 边界应用，不做 Host 范围的同步重启；
- 回滚选择已有 revision，走同一部署事务，不能通过覆盖目录实现。

### 6.4 禁用、卸载与隔离

普通禁用：

- 当前 Run 默认允许完成；
- 变更提交后，受影响 generation 不再接受新的 Run，直到替换完成；
- 冷会话下次激活时不加载该扩展。

隔离（quarantine）是安全处置，不是普通开关：

- 立即阻止所有新 Run 使用该 revision；
- 默认提示用户停止正在执行的 Run；紧急处置可取消 Run；
- worker 后端结束对应子进程；
- SDK 后端执行 shutdown / drop，但若扩展启动过全局 timer、进程或修改过模块单例，状态显示 `restart-required`，建议重启 Host；
- 隔离记录必须包含原因、操作者和 extension revision。

卸载先禁用，再等待所有引用该 revision 的 generation 退出。实际源码先进入可恢复保留期，只有 GC 确认没有活跃引用且不再属于回滚窗口后才删除。

### 6.5 Agent 给自己编写扩展

这是即时扩展最有辨识度的闭环，但应放在安全激活 MVP 之后：

1. Bundled Skill 教 Agent 如何写 piwin-compatible Pi Extension；
2. Agent 通过 Host-owned draft API 写入 `drafts/<draftId>`，不能直接写有效 registry 或 `~/.piwin/config.json`；
3. Host 生成代码 diff、入口、依赖、兼容性和风险卡；
4. Agent 只能“提交审核”，不能确认信任或激活；
5. 用户确认后，草稿转成 immutable staged revision；
6. 当前 Run 结束后，Host 替换 Runtime；
7. 下一条 follow-up / 新 Run 才能调用新工具。

扩展创建 Skill 是指导，不是安全边界；禁止依赖提示词要求模型“不要自我启用”。Host 合同必须物理上不给模型审批能力。

## 7. 受管存储与版本模型

保留 ADR 0010 的 `~/.piwin/extensions` 根目录，并在其中增加受管区：

```text
~/.piwin/extensions/
  registry.json
  revisions/
    <extension-id>/
      <content-revision>/
        source/
        normalized-manifest.json
  drafts/
    <draft-id>/
  legacy entries...          # 兼容现有平铺 .ts / index.ts 目录
```

要求：

- `registry.json` 使用 schema version、原子写和单 Host 串行 mutation；
- `contentRevision` 至少覆盖入口、包内全部运行时代码、manifest、lockfile 和已物化依赖版本；
- `SessionBlueprint` 固定 `{ extensionId, contentRevision, entryPath }`，不通过“当前版本”软链接装载；
- 运行中的 revision 不允许修改；更新必须创建新目录；
- 保留 last-known-good 和有限历史版本；GC 不能删除任一 live generation 引用的 revision；
- 旧平铺扩展作为 `legacy-unmanaged` 继续可用，但 UI 明示“内容可变、无法保证可复现回滚”；
- linked development source 每次变更都复制成新 revision；Watcher 只 stage，不自动 activate。

### 7.1 Manifest 归一化

安装器优先读取 Pi 原生 package metadata，并可读取附加 `piwin` metadata；不要求第三方为了基础兼容改写扩展格式。Host 归一化出：

- stable id、name、version、entrypoints；
- source locator、resolved commit/version、integrity；
- Pi 与 piwin engine compatibility；
- 作者声明的 capability / OS access；
- UI surface（dialog、TUI custom、editor、theme）；
- dependency 与 install-script 状态；
- normalized content revision。

作者声明只用于展示和策略筛选，不是权限证明。没有 metadata 的单文件扩展仍可安装，但显示“未知来源 / 未声明访问范围”。

### 7.2 依赖策略

安全激活 MVP 只保证：

- 自包含单文件扩展；
- 已携带可解析依赖的目录扩展；
- Git 固定 commit 后得到的同类内容。

裸依赖不可解析时，安装停在 `invalid`，不得边启动 Agent 边临时安装。后续依赖物化使用锁文件和 `--ignore-scripts` 等等价策略；生命周期脚本需要单独高级授权，不能跟“信任扩展代码”合并成模糊的一次点击。

## 8. 兼容性模型

### 8.1 兼容级别

| 级别 | 含义 |
|------|------|
| `supported` | SDK / worker 都通过；只使用已支持的 Agent 与基础 dialog 能力 |
| `degraded` | 核心工具可用，但部分命令或 UI 能力不可用；UI 明确列出 |
| `tui-only` | 依赖真实 Pi TUI，不应在 Desktop Agent Runtime 激活 |
| `incompatible` | engine、入口、依赖、冲突或运行时检查失败 |
| `unknown` | 未完成候选执行；只能说明静态检查结果 |

静态检查只能发现信号。只有经用户授权的候选启动才能生成“observed”结果，且它仍不是恶意代码检测。

### 8.2 工具与运行时表面

候选启动报告至少记录：

- 启动前后工具名和 schema 摘要；
- extension commands；
- provider / resource 动态注册信号；
- extension error；
- TUI-only API 使用信号；
- shutdown handler 是否在限定时间内返回。

受保护的 Host 工具名、Pi built-in 名和其他扩展工具发生冲突时默认拒绝发布。显式覆盖 Pi built-in 只能作为高级、高风险能力。动态 `registerTool()` 是 Pi 的合法能力；piwin 将它视为该固定 extension revision 的运行时行为，并维护 `observedSurfaceRevision`，不能把它误认为新的安装版本。

由于扩展本身已经是完全受信任代码，冲突检测是可靠性与可解释性保护，不是安全沙箱。

### 8.3 原生 `ctx.reload()`

Pi 0.80.10 支持 `ctx.reload()`，但 piwin 第一版不应直接把它作为产品激活路径：

- 它会在同一 Pi session 内重新发现资源，绕过 Host 的 generation、Blueprint、Settings / extension-set CAS 和多客户端状态；
- 同步等待 `ctx.reload()` 与 Host “等待当前 Run 结束后替换”存在死锁语义；
- 当前 piwin 只绑定扩展 UI，没有提供完整 command context actions，原生 reload 不是一个可靠现状能力；
- worker 和 SDK 的资源重建、退出与模块缓存保证不同。

受管模式下，`ctx.reload()` 应返回明确的 `managed-runtime-reload-required` 兼容性错误，不能静默 no-op。扩展更新由用户或 Host 管理命令发起。未来如提供 linked-development 快速 reload，也只能是高级优化：它必须保留 `runtimeGenerationId` 纪律、SDK / worker 一致性和 Host 可观测状态，否则继续使用完整 Runtime Replacement。

## 9. 架构与包归属

建议现在引入聚焦的 `@piwin/extensions` application package。ADR 0010 当时拒绝单独包是合理的；进入版本、回滚、隔离和 revision store 后，职责已经足够独立。

| 责任 | Owner |
|------|-------|
| 安装/运行/部署合同 | `@piwin/contracts` |
| manifest 归一化、revision store、内容摘要、registry、GC、静态检查 | `@piwin/extensions` |
| 本地 / Git / 后续 npm 来源获取 | `@piwin/marketplace` |
| 部署事务、Settings 与 registry CAS、会话 stale/admission、Runtime Replacement、审计 | `@piwin/host-runtime` |
| 精确路径交给 Pi、扩展错误与 observed surface 适配、SDK / worker conformance | `@piwin/agent-host` |
| Desktop 体验 | `apps/desktop` + `@piwin/ui-kit` |
| CLI 体验 | `apps/cli` |
| 远程权限与 fan-out/replay | `@piwin/host-server` / transport contracts |

禁止：

- `@piwin/extensions` 导入 Pi；
- `@piwin/marketplace` 自己创建 Runtime；
- `@piwin/agent-host` 读写 registry 或依赖 marketplace；
- Desktop 扫描本地目录来推断 Host 扩展状态；
- 为扩展热更新 fork Pi core。

推荐组合：

```text
Client
  → HostCommand
  → ExtensionDeploymentCoordinator (@piwin/host-runtime)
      ├─ ExtensionRegistry / RevisionStore (@piwin/extensions)
      ├─ SettingsService
      ├─ BlueprintCompiler
      └─ SessionRuntimeReplacementEngine
           → @piwin/agent-host
               → Pi SDK session / piwin-owned worker

HostPush
  ← extension/catalog-updated
  ← extension/deployment-updated
  ← session/runtime-updated
```

## 10. Contracts 与协议建议

### 10.1 核心合同

在 `@piwin/contracts` 增加或扩展：

- `ExtensionRevisionRef`
- `InstalledExtensionRecord`
- `ExtensionCompatibilityReport`
- `ExtensionRuntimeBinding`
- `ExtensionDeploymentRecord`
- `ExtensionDeploymentPhase`
- `ExtensionSetRevision`

`ResourceCatalogEntry` / `ResourceInstance` 增加可选 `contentRevision`。`CapabilityInputRevisions` 增加 `extensionSetRevision`，由排序后的精确 `{ id, contentRevision, entryPath }` 计算。当前只基于 path 的 `resourceCatalogRevision` 也必须纳入内容 revision，确保同一路径内容变化会产生新 `snapshotId`。

`SessionRuntimeStatus` 应能投影：

- 当前 `loadedExtensionSetRevision`；
- 目标 `targetExtensionSetRevision`；
- pending / failed deployment id；
- `restartRequired` 与原因。

### 10.2 Host commands

建议逐步提供：

- `extensions/inspect-source`
- `extensions/install`：只写入 inactive revision，第三方默认不激活；
- `extensions/set-enabled`：通过 revisioned Settings / coordinator；旧命令保留兼容 facade；
- `extensions/apply`
- `extensions/update`
- `extensions/rollback`
- `extensions/uninstall`
- `extensions/quarantine`
- `extensions/status`
- `extensions/doctor`

`extensions/apply` 至少携带：

- `sessionId`；
- `targetExtensionSetRevision`；
- `expectedSettingsRevision`；
- `expectedRegistryRevision`；
- `when: 'now' | 'after-current-run' | 'new-sessions-only'`；
- 幂等 `deploymentId`。

通用 `session/reload-runtime` 继续作为高级 Runtime 操作，但 UI 的正常扩展流程使用 `extensions/apply`，以便状态、回滚和审计都绑定到具体扩展集。

### 10.3 HostPush

扩展部署不是 Pi `AgentEvent`，应作为 sibling `HostPush`：

- `extension/catalog-updated`：带 revision 的可替换投影；
- `extension/deployment-updated`：`queued`、`validating`、`waiting-current-run`、`compiling`、`creating-runtime`、`publishing`、`active`、`failed`、`rolled-back`、`restart-required`。

它们由 transport delivery classifier 明确归类：失败、发布和需要用户决策的状态为 control；高频进度为 keyed projection。多客户端使用同一个 Host deployment record，不各自创建任务。

## 11. Desktop 与 CLI 体验

### 11.1 Desktop

入口：**Settings → Agent Resources → Extensions**。

扩展卡显示：

- 名称、版本、作者、来源和 scope；
- 已固定 commit / integrity；
- 风险等级和“完整 Host 权限”标签；
- 配置版本、最后可用版本、当前 Agent 已加载版本；
- tools / hooks / commands / UI 兼容性；
- update、rollback、disable、quarantine 操作。

会话内增加轻量状态条：

- “新能力已安装，尚未应用到此 Agent”；
- “将在当前任务结束后应用”；
- “扩展启动失败，当前仍使用 v1.3.2”；
- “此扩展在 SDK 模式可能残留后台状态，建议重启 Host”。

发送新消息时，如果用户已经申请了 extension-set 变更但当前 Runtime 尚未更新，composer 提供“应用并发送”。禁用或隔离属于收紧能力，禁止继续用旧 generation 启动新 Run。

### 11.2 CLI

建议命令：

```text
piwin extension inspect <source>
piwin extension install <source>
piwin extension list
piwin extension apply --session <id>
piwin extension update <id>
piwin extension rollback <id> <revision>
piwin extension disable <id>
piwin extension quarantine <id>
piwin extension doctor <id>
```

非交互环境不能隐式接受第三方完整 Host 权限。首次执行必须携带明确 flag，并要求来源已固定到 commit / version / integrity。CLI 和 Desktop 调用同一 Host commands，不另写安装或 reload 逻辑。

## 12. 多客户端与远程 Host

- Extension registry、deployment record 和 Runtime binding 全部属于 Host 数据；
- 多个客户端并发变更使用 expected revision / deployment id 做 CAS 和幂等；
- 一个客户端开始部署后，其他客户端看到同一进度并可查看，但不能创建第二个冲突部署；
- `allowExtensionInstall` 继续默认 false；另增 `allowExtensionActivate`，远程执行代码同样默认 false；
- 远程“本地路径”是 Host 路径。客户端文件安装需要未来单独的限额 upload / asset 协议，不能把客户端绝对路径发给 Host；
- Gateway 只转发合同，不存扩展源码、不运行静态检查、不参与审批。

## 13. 安全模型

用户确认页必须直说：

> Pi Extension 是在你的 Host 上运行的受信任代码。它可以绕过 piwin 工具审批层，直接访问当前 OS 用户可访问的文件、进程、网络和密钥。

必须落实：

- 项目扩展只在 trusted project 生效；General session 不加载项目扩展；
- 禁止 Agent 通过普通 write/edit 修改 `~/.piwin` 有效配置；草稿写入走 Host-owned API；
- 来源 URL、commit、版本和 integrity 可审计；日志不记录源码正文、环境变量或密钥；
- 未知来源不自动更新；第三方更新不自动激活；
- 安装脚本独立授权；
- candidate worker 不是安全沙箱，不能以“在子进程里试跑”降低风险提示；
- extension-defined tools 不自动进入 Host permission rule engine；如果未来提供受管 extension tool SDK，必须另写 ADR，不能假装已拦截任意扩展代码；
- worker 崩溃应隔离到对应 generation，重复启动失败进入 cooldown / quarantine，避免重启风暴；
- shutdown 设超时并记录残留；RPC 可杀进程树，SDK 只能建议 Host restart；
- quarantined revision 在任何 source precedence 下都不能被 project / mapped copy 重新激活。

## 14. 交付阶段

### Phase A — 安全激活 MVP

目标：让“安装后应用到当前 Agent”真实、可解释、可回退。

1. contracts：revision、compatibility、deployment、runtime binding；
2. `@piwin/extensions`：immutable store、registry、内容摘要、原子写；
3. 现有本地 / Git 安装改为 immutable + inactive，不再覆盖当前 revision；
4. `extensions/set_enabled` 迁入 SettingsService / deployment coordinator；
5. Blueprint 固定 `extensionSetRevision` 和 exact paths；
6. 连接 `extensions/apply` 与 Runtime Replacement，支持空闲立即 / Run 后应用；
7. candidate 失败保留旧 Runtime 和 last-known-good；
8. Desktop / CLI 显示 configured / effective / loaded；
9. SDK / worker conformance、项目 trust、multi-client CAS 测试；
10. 受管模式下原生 `ctx.reload()` 明确报不兼容，不再 silent no-op。

### Phase B — 生命周期与诊断

- update / rollback / uninstall / quarantine / GC；
- dependency materialization 与 install-script policy；
- compatibility doctor、启动能力 diff、冲突检查；
- SDK 残留检测与 restart-required；
- 远程 Host 激活策略与部署审计。

### Phase C — Agent 自生成扩展

- bundled extension-authoring Skill；
- Host-owned draft API；
- 代码 diff / 风险 / 兼容性审核卡；
- 用户确认后自动排队 Runtime Replacement；
- follow-up Run 使用新能力。

### Phase D — 生态

- npm / Pi package 来源；
- curated marketplace；
- 签名、provenance / attestations；
- 更新频道与兼容性矩阵；
- 可选的组织策略只在产品定位需要时另行设计。

不要从 Marketplace 开始。没有 immutable revision、运行边界和回滚，扩大来源只会扩大不可控代码分发面。

## 15. 验收标准

Phase A 完成至少满足：

1. 安装一个在顶层写 side-effect marker 的扩展时，marker 在“安装”阶段不存在，只有用户批准候选执行后才出现。
2. 当前空闲会话应用扩展后，不重启 app、不创建新产品会话；下一 Run 能看到新工具。
3. Run 活跃时更新扩展，当前 Run 的工具集不改变；更新在 Run terminal 后发生。
4. 候选入口抛错时，旧 generation 仍可接收新 Run，旧工具仍可用。
5. 修改同一路径源码会生成不同 `contentRevision`、`extensionSetRevision` 和 capability `snapshotId`。
6. 更新不会覆盖旧目录；回滚精确加载旧 revision。
7. 项目未信任时，项目扩展不会进入 Blueprint。
8. 同一 Blueprint 在 SDK 与 worker 得到相同 extension revision 集；worker 退出后无对应子进程。
9. SDK 扩展 shutdown 失败时状态显示 `restart-required`，而不是假称已完全卸载。
10. 两个客户端并发 apply 只产生一个成功 deployment；另一个收到稳定 revision conflict。
11. Agent 创建的草稿无法通过任何模型可调用工具自行批准或激活。
12. TUI-only 扩展显示不兼容/退化，不静默吞掉核心 UI 操作。
13. 受管扩展调用 `ctx.reload()` 得到稳定、可解释错误，不在 Host 不知情时改变 generation 内容。
14. disable / quarantine 后，旧 generation 不能接收新的 Run；quarantine 在 worker 模式可结束对应进程。

## 16. 产品指标

优先观测：

- 安装 → 首次成功使用新工具的完成率与耗时；
- candidate activation 成功率和分阶段失败分布；
- rollback / quarantine / restart-required 比例；
- SDK 与 worker 行为差异；
- 扩展导致的 Host / worker crash 数；
- 用户在风险确认页取消的比例；
- configured 与 loaded 长时间不一致的会话数。

第一版先建立基线，不对外承诺固定秒数。“无需重启 app”和“当前 Run 结束后可应用”是行为承诺，启动耗时是可度量但受扩展依赖与模型后端影响的性能目标。
