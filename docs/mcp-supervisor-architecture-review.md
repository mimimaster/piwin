# MCP 架构改造方案 — ADR 0033 评审与实现细化

| 字段 | 值 |
|------|-----|
| 状态 | 评审通过，文档方案已落档，实施待开始 |
| 日期 | 2026-08-06 |
| 关联 | [ADR 0033](./adr/0033-mcp-supervisor-architecture.md)、[ADR 0014](./adr/0014-mcp-lifecycle-hybrid-gateway.md)、[ADR 0019](./adr/0019-permission-rule-engine.md)、[ADR 0031](./adr/0031-mcp-process-leak-fix.md) |
| 评审基准 | piwin-dev 当前实现：`HostRuntime` 单 manager + `mcp_gateway` + cached direct tools |

## 1. 结论

总体方向正确，但原评审里有两处“当前状态”描述不准确，实施边界也需要补齐：

1. **配置替换竞态成立，必须修。** 当前已经只有一张
   `McpLifecycleManager.entries`，不是“双 lifecycle map”；但
   `refreshConfig()` 会删除正在进行的 `startPromise/startToken`，对旧 client
   只做未等待的关闭，且 slot 没有持有 connect abort controller。配置变化发生在
   `starting` 阶段时，旧 spawn/connect 操作可能脱离生命周期管理。
2. **失败风暴成立，必须修。** 当前 tool-call timeout 会让 client 失效，但没有
   per-server cooldown。坏 server 会被下一次模型调用立即重新拉起，重复执行
   `spawn → timeout → close`。
3. **pinned 直调是合理的产品取舍，不是上述两个 bug 的同等级正确性要求。** 当前
   `createMcpSessionBridge()` 确实还会注册缓存直调工具，而且默认 exposure policy
   会按字典序填充直调预算，不是“默认只有 gateway”。建议改为 gateway-only 默认，
   仅显式 `pinnedSelectors` 才注册直调；直调和 gateway 必须共用同一个 Supervisor。

因此本方案按 ADR 0033 执行，但不照抄不存在于 piwin-dev 的“删除 generation
snapshot / 双 lifecycle map”迁移项。

## 2. 当前基线核对

| 位置 | 当前事实 | 结论 |
|------|----------|------|
| `HostRuntime` | 创建一个 Host 级 `McpLifecycleManager`，`dispose()` 会调用其 `dispose()` | 全局 owner 已有雏形 |
| `getMcpManager()` | manager 被置空后仍可懒创建 | 必须增加 Host terminal/closing guard，不能在 dispose 后复活 |
| `mcp/save` | 校验并写 `mcp.json`，没有调用 manager 的 `refreshConfig/applyConfig` | 配置文件与运行态会分叉，必须接入 Supervisor |
| `mcp-session-bridge` | 未注入 manager 时会创建临时 manager | 生产 composition 必须强制注入；测试另设 factory |
| `mcp-lifecycle-manager` | 单 `entries` map；start/connect/close 状态仍分散在 entry 和局部 promise | 可在现有实现上收敛为 ProcessSlot，不需要重做 Host generation |
| transport | 对外先返回 `Promise<McpTransportClient>`，进程在 ready 前缺少统一 owned handle | 必须改成 spawn 即返回可关闭的 `OwnedMcpProcess` |
| cached direct tools | 当前默认会从有效缓存按字典序填充直调工具，并且仍经过 `mcp-call-permission` | 默认暴露和权限路径都要改 |
| permissions | `mcp-call-permission.ts` 与 gateway/direct tool 仍会评估 MCP 规则 | “MCP 完全退出权限层”尚未实现 |

## 3. 已确认的架构决策

| 决策 | 具体要求 |
|------|----------|
| 单 Owner | 一个 Host 一个 `McpSupervisor`；每个 server 一个 `ProcessSlot`；从 spawn 到 exit 只有 Supervisor 能管理进程 |
| 先拥有、后 ready | spawn 后立即注册 owned process；`ready` 只代表 MCP initialize 完成，不代表资源才开始被拥有 |
| MCP 无权限层 | 不使用 MCP `PermissionRuleSet`、`PermissionMode`、`PermissionSubject`；不产生 per-call prompt |
| 老规则静默失效 | `permissions.json` 中残留的 MCP deny/ask/allow 不读取、不迁移、不升级；最多打一条诊断，不拦截、不提示 |
| 配置单一入口 | `mcp/save`：validate → 原子写 → `supervisor.applyConfig()`；禁止其它隐式刷新路径 |
| gateway 稳定面 | 默认只注册 `mcp_gateway`；search / describe / call / status 走当前 Supervisor |
| pinned 直调 | `mcp.json` 顶层 `pinnedSelectors` 仅允许精确 selector；默认 gateway-only，不做缓存工具自动前 N 个直调 |
| 关闭顺序 | Host closing → 中止 run/MCP → await Supervisor.dispose → 关闭 Pi worker → flush |

MCP 不等于安全沙箱：启用后的 server 以 Host 用户 OS 权限运行，风险由用户
配置和运行环境承担。这是产品信任模型，不是“安全性已经解决”。

## 4. 三条评审意见的实现判定

### #1 `starting` 时配置替换竞态：必须实现

问题不是“有没有 map”，而是**旧异步操作是否仍被 slot 持有并可关闭**。

当前风险链路：

```text
ensureConnected
  → spawn/connect（startInternal 内部 promise）
  → refreshConfig 改 fingerprint
  → detach client / delete startPromise、startToken
  → 未等待旧 connect 与 close
```

必须改成：

```text
applyConfig
  → slot.draining，拒绝新 call（server-restarting）
  → abort connect
  → 等待活跃 call 到 drain deadline
  → await ownedProcess.close()
  → 旧 operation token 失效并完成清理
  → 安装新 fingerprint 的 stopped slot
```

关键不变量：

- 不得通过 `delete startPromise` 伪装成取消；必须 abort/close/await。
- 旧 connect 即使晚返回，也只能发现 stale token 后关闭 client，不能发布到 map。
- 新 revision 在旧 process 完成 close 前不得 spawn。
- draining 期间的新 call 立即失败，不与配置更新一起无限等待。
- `close()` 幂等，关闭失败要进入 health/diagnostic，不得静默吞掉。

### #2 timeout 后失败风暴：必须实现

tool-call timeout 仍然必须关闭受影响的 process；cooldown 只是防止下一次
调用立即再次 spawn，不能替代杀进程。

建议默认 `failureCooldownMs = 5_000`，并限制最大值。状态语义：

```text
timeout/connect failure
  → close owned process
  → unhealthyUntil = now + cooldown
  → cooldown 内 call/start 直接 server-unhealthy
  → explicit restart 绕过 cooldown
  → ready 成功后清除失败状态
```

以下情况不计为 server failure：用户主动 stop、Host dispose、调用方主动
Abort。配置 fingerprint 变化视为新 revision，绕过旧 revision 的 cooldown。

### #3 pinned 直调：纳入 v1，且 pin 不等于常驻进程

它解决的是高频工具的调用体验，不是生命周期正确性的前提。配置示意：

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"]
    }
  },
  "pinnedSelectors": ["github.list_repos"]
}
```

必须明确：

- 默认 policy 为 gateway-only；
- `pinnedSelectors` 位于 `mcp.json` 顶层，只接受精确 `serverId.toolName`，不接受 wildcard；
- pin 通过 `mcp/save` 持久化，pin-only 变更只更新 exposure revision，不重启/Drain server；
- `pinnedSelectors` 是唯一自动直调来源；
- pinned metadata 必须匹配当前 server fingerprint，过期就不注册并给出 warning；
- 未发现的 server/tool 可以保留为 dormant pin，但保存时不触发 transport I/O；
- 不再按字典序自动填充 `maxDirectTools`；
- pinned 工具消耗 direct count/schema budget，UI 超预算时拒绝 pin，不静默降级；
- direct execute 与 gateway `call` 都只调用 `Supervisor.callTool()`；
- pinned 直调不重新引入 MCP permission gate；
- pin 图标表达“固定工具面”，不表达进程常驻。建议 tooltip 使用“固定为直接调用工具”，
  而不是“常驻 MCP”；
- 当前 Pi session 的 custom tools 是静态的，v1 pin 在下个 session 或显式 tool-surface
  rebuild 生效，当前 session 继续使用 gateway；
- pin 操作绝不启动 MCP server。

## 5. ProcessSlot 设计

建议把当前 `RuntimeEntry` 收敛为一个明确的 slot。字段至少包括：

```text
serverId
config / configFingerprint / revisionToken
state: stopped | starting | ready | draining | stopping | unhealthy
ownedProcess: OwnedMcpProcess | null
client: McpTransportClient | null
connectAbort: AbortController | null
readyPromise: Promise<...> | null
closePromise: Promise<void> | null
activeCallCount / acceptingCalls
unhealthyUntil / failureCount / lastFailure
exitUnsubscribe / intentionalStop
```

并发规则：

1. 第一个 `ensureReady` 创建 slot operation token 和 readiness promise。
2. 后续 `ensureReady` 复用同一个 promise，禁止第二次 spawn。
3. `callTool` 进入时增加 `activeCallCount`；draining 后不再接收新 call。
4. 最后一个 active call 结束或 drain deadline 到达后关闭 owned process。
5. 所有 transition 串行化；不要让 `refreshConfig`、`stop`、`dispose` 各自
   直接操作 `entry.client`。

## 6. Supervisor API 与调用语义

公开 API 可以保留兼容别名，但实现只允许一个：

```ts
interface McpSupervisor {
  getConfig(): McpConfigDocument;
  applyConfig(config: McpConfigDocument): Promise<McpConfigApplyReport>;
  listHealth(): Promise<McpServerHealth[]>;
  listTools(serverId: string, signal?: AbortSignal): Promise<McpToolSummary[]>;
  callTool(serverId: string, toolName: string,
    args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
  restart(serverId: string): Promise<McpServerHealth>;
  dispose(): Promise<void>;
}
```

- `status` 和缓存 search 不连接 server。
- live `describe/listTools` 与 `call` lazy connect。
- disabled、removed、draining、disposed server 使用稳定错误：
  `server-disabled`、`server-restarting`、`host-closing`。
- `start/stop/restart` 仅是 Settings/诊断命令，委托给同一 Supervisor。

## 7. 文件级实现计划

| 文件/区域 | 修改内容 | 结论 |
|-----------|----------|------|
| `docs/adr/0033-mcp-supervisor-architecture.md` | 本文决策、状态机、竞态、cooldown、pinned、测试验收 | ✅ 已补齐 |
| `AGENTS.md` | MCP 移出权限层、老规则静默失效 | ✅ 当前工作区已有用户修改；本轮不覆盖 |
| `docs/architecture.md` | 删除 MCP permission mode/rule/trust 描述，增加 Supervisor 边界 | ✅ |
| `docs/guides/permissions.md` | 删除 MCP 示例、rule kind、remember/trust gating；增加“老规则无效”说明 | ✅ |
| `docs/adr/0014-mcp-lifecycle-hybrid-gateway.md` | 标记由 ADR 0033 部分 supersede；改为 gateway 默认 + pinned 直调 | ✅ |
| `docs/adr/0019-permission-rule-engine.md` | 删除 MCP 作为权限能力的实施描述，保留历史背景并链接 ADR 0033 | ✅ |
| `docs/adr/0031-mcp-process-leak-fix.md` | 把 transport 修复定位为 ADR 0033 的底座，补充 Supervisor 关系 | ✅ |
| `packages/contracts/src/permission.ts` | 删除 MCP rule target/subject 与 mode 表字段 | ⬜ |
| `packages/contracts/src/mcp.ts` | exposure 默认 gateway-only；`mode: gateway|pinned`、精确 pinned、预算与 config schema | ⬜ |
| `packages/mcp/src/mcp-transport.ts`、`mcp-client*.ts` | spawn 即返回 `OwnedMcpProcess`；统一 close、abort、PID/进程组清理 | ⬜ |
| `packages/mcp/src/mcp-lifecycle-manager.ts` | 收敛为 Supervisor/ProcessSlot；实现 applyConfig、drain、token、cooldown | ⬜ |
| `packages/host-runtime/src/host-runtime.ts` | 一个 Supervisor；增加 closing guard，禁止 dispose 后重建 | ⬜ |
| `packages/host-runtime/src/mcp-commands.ts` | `mcp/save` 原子写后 await `applyConfig` | ⬜ |
| `packages/host-runtime/src/mcp-session-bridge.ts` | 生产路径强制注入 Supervisor；临时 manager 仅留测试 factory | ⬜ |
| `packages/host-runtime/src/mcp-gateway-tool.ts` | 去掉 MCP permission gate，所有动作经 Supervisor | ⬜ |
| `packages/host-runtime/src/mcp-cached-tool-definitions.ts` | 默认不自动直调，仅 pinned；调用经 Supervisor | ⬜ |
| `packages/host-runtime/src/mcp-call-permission.ts` | 从执行路径移除；必要的风险/脱敏只保留 diagnostic | ⬜ |

不需要做的迁移：删除 piwin-dev 中不存在的 generation snapshot、第二张
lifecycle map，或另造 MCP OS daemon。

## 8. 分阶段实施顺序

### Phase 1 — 合同与文档

1. 先落 ADR 0033 和本评审文档。✅
2. 更新 architecture、permissions、ADR 0014/0019，避免代码改完仍有相反说明。✅
3. 删除 contracts 中 MCP permission 类型；加入明确的 `unrestricted` admission。
4. 把 exposure policy 改为 `gateway|pinned`，默认 gateway-only；把顶层
   `pinnedSelectors`、精确 selector 校验、预算和 pin UI 语义写入 contracts/spec。

### Phase 2 — owned transport 与 Supervisor

1. transport 在 spawn 后立即返回 owned handle。
2. official SDK 与兼容 transport 共用一个 close contract：SIGTERM → 等 exit →
   必要时 SIGKILL 进程组/树。
3. slot 持有 connect abort、ready/close promise、operation token。
4. 实现 serialized `applyConfig`、drain deadline、stale-token 防护。
5. 实现 failure cooldown，并把所有关闭路径改成 await。

### Phase 3 — Host wiring

1. Host 创建唯一 Supervisor，注入 session bridge、gateway、direct tools。
2. 删除生产路径的 bridge fallback。
3. `mcp/save` 接入 applyConfig；配置更新不创建 session generation，pin-only
   更新不重启或 drain server。
4. Host dispose 设置 terminal flag；后续命令返回 `host-closing`。
5. 删除 `mcp-call-permission` 的实际调用与 MCP permission loader 分支。

### Phase 4 — 测试与验收

必须补齐：

- 并发 ensureReady 至多一个 child；
- hanging initialize timeout 无孤儿子/孙进程；
- starting 阶段 applyConfig 会 abort、await close，再允许新 revision spawn；
- old operation 晚返回不能 publish client；
- active call drain、disabled/removed/config changed 行为；
- timeout/connect failure 进入 cooldown，重复调用不 spawn；
- explicit restart 绕过 cooldown，成功后清除 unhealthy；
- dispose during connect 完全 await 且幂等；
- `mcp/save` 后运行态立即使用新配置；
- dispose 后不会懒重建 Supervisor；
- MCP 调用永不产生 permission request，老 mcp 规则不影响调用；
- gateway-only 默认、精确 pinned direct、stale/dormant metadata warning、预算拒绝；
- pin 保存不触发 spawn，pin-only reload 不触发 restart/drain，当前 session 按约定继续走 gateway；
- pin UI 使用可访问的“固定为直接调用工具”标签，并支持多选；
- ADR 0031 回归测试多次运行无 orphan。

验收命令：`pnpm typecheck`，以及 `packages/mcp`、`packages/host-runtime` 的相关测试。

## 9. 验收标准

- 一个 Host 只有一个 Supervisor，session/UI 不直接持有 MCP client。
- 一个 server 的并发调用最多一个 child process。
- connect timeout、config replacement、tool timeout、Host shutdown 都不留
  MCP 子/孙进程。
- 旧 revision 不能发布 client；新 revision 不与旧 process 并存。
- cooldown 阻止自动失败风暴，显式 restart 可恢复。
- `mcp/save` 是运行态配置的唯一刷新入口。
- 默认是稳定 gateway，pinned 直调也走同一 Supervisor；pin-only 配置变化不重启 server。
- MCP 调用不进入权限规则、不产生提示；老规则静默失效。
- `dispose()` 幂等、完全 await；ADR 0031 回归持续通过。

本轮只修改架构文档，没有修改实现代码；代码变更应按上述 Phase 1–4 分拆提交。
