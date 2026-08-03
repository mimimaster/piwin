# Phase 7 RPC Worker Parity — 差异文档 (Gap Analysis)

**日期:** 2026-08-04
**分支:** `feat/settings-capability-runtime-refactor`
**计划:** [`phase7-rpc-worker-parity-plan.md`](./phase7-rpc-worker-parity-plan.md)
**状态:** WP0–WP6 已实现并提交。885 测试全绿, typecheck 全绿。但 10 个差异点尚未闭合, 其中 2 个为 Critical。

---

## 1. 总览: "Done" 标准 vs 实现状态

计划 §0.1 定义了 Phase 7 完成的 6 个条件:

| # | "Done" 标准 | 状态 | 差异 |
|---|------------|------|------|
| 1 | `hostMode=rpc` 在 piwin-owned worker 进程中运行产品会话 | **部分完成** | worker 进程可以启动并运行, 但 `PiRpcAdapter.createSession` 使用 transitional shim (`deriveBlueprintFromInput`) 而非真正的 capability snapshot 编译。worker 收到的是空资源路径的 blueprint, 不是产品级会话。 |
| 2 | worker 从 serializable blueprint projection 创建 Pi 会话, 不重新读 Settings | **部分完成** | `WorkerSessionRuntime` + `worker-pi-session-factory` 确实从 `SerializableBlueprint` 创建会话。但 adapter 传递的 blueprint 是 shim, 不是从 `SessionCapabilityResolver` 编译的真实投影。 |
| 3 | 所有 Host custom tool execution 代理到 parent Host | **机制完成, 数据未通** | tool proxy 机制 (WP4) 完整: proxy tool factory, parent routing, error codes, abort/drop。但 `customToolNames` 在 shim blueprint 中为空, 所以 worker 实际不注册任何 proxy tool。 |
| 4 | Parent 保持权限/secret/MCP/process/browser 的唯一权威 | **完成** | `HostToolExecutionRouter` 在 parent 侧执行所有 tool calls, worker 不持有任何工具执行器。 |
| 5 | SDK 和 RPC 通过 conformance suite | **完成 (数据层)** | WP6 conformance suite 覆盖 10 个断言, 全部在数据/策略层验证。runtime event parity 通过 shared mapper 结构性验证。 |
| 6 | 删除 fallback/stock 路径 | **未执行 (正确)** | WP7 文档化为 next step, gated on CI green + R2。本 session 不删除。 |

**结论:** 条件 4、5 已满足。条件 1、2、3 的机制已实现但数据管道未接通 (GAP-1, GAP-2)。条件 6 正确推迟。

---

## 2. WP 级别 Exit Criteria vs 实现状态

### WP0 — Plan lock and ADR updates

| Exit 标准 | 状态 |
|----------|------|
| Docs agree on authority matrix and deletion gates | ✅ 已完成 |

**交付物:**
- ✅ Plan file (`phase7-rpc-worker-parity-plan.md`)
- ✅ ADR 0011 更新 (标记 transitional, 引用 Phase 7 plan)
- ✅ ADR 0012 更新 (标记 implementation in progress, D-HOST-01b 已实现)
- ✅ `docs/dev-plan.md` Phase 7 指针
- ✅ Parent spec Phase 7 section 指向 deep plan

### WP1 — Blueprint/protocol completion

| Exit 标准 | 状态 |
|----------|------|
| Protocol and blueprint ready for a real worker without product wiring yet | ✅ 已完成 |

**交付物:**
- ✅ `SerializableBlueprint` 包含 §5.1 所有字段 (scope, resourceManifest, tools, subagentCeiling, model, thinkingLevel, activePaths)
- ✅ `SerializableProviderRuntime` 包含 §6.2 所有字段 (providerId, protocol, baseUrl, models, auth)
- ✅ `WorkerToolCallFrame` + `WorkerToolResultFrame` + `WorkerHelloFrame` 协议帧
- ✅ `session/create` payload 支持 blueprint-first (productSessionId + blueprint + providers)
- ✅ Round-trip blueprint 测试
- ✅ Empty allowlist 保持 empty 测试
- ✅ Protocol parse unknown frames 测试

### WP2 — HostToolExecutionRouter extraction

| Exit 标准 | 状态 |
|----------|------|
| Parent can execute any product custom tool by name without going through Pi | ✅ 已完成 |

**交付物:**
- ✅ `HostToolExecutionRouter` 按 name 查找工具
- ✅ Disabled family/stale gate (`isToolDisabled` predicate)
- ✅ Permission-aware execution (`permissionGate`)
- ✅ Stable error codes: `tool-not-available`, `tool-disabled`, `permission-denied`, `aborted`
- ✅ 8 个测试覆盖

### WP3 — Worker real session create/prompt/event

| Exit 标准 | 状态 |
|----------|------|
| Worker can run a text-only session end-to-end in isolation without custom tools | ⚠️ 机制完成, Pi 未安装无法验证 |

**交付物:**
- ✅ `WorkerSessionRuntime` dispatches JSONL requests (create/prompt/abort/steer/follow-up/drop)
- ✅ `worker-pi-session-factory` 从 blueprint 构建 ResourceLoader + Pi session
- ✅ Event mapping via `createPiSessionEventMapper`
- ✅ `rpc-sdk-worker-entry` 重写为 wire runtime + factory
- ✅ Integration test: worker process hello + create + drop lifecycle (3 tests, 真实进程)
- ⚠️ 无法验证真实 Pi session (Pi 包未安装); mock Pi module 测试覆盖 factory 逻辑

**差异:**
- ⚠️ **GAP-1**: adapter 传递的 blueprint 是 shim, 不是真实 capability snapshot
- ⚠️ **GAP-2**: adapter 传递 `providers: []`, worker 无法注册任何 model provider

### WP4 — Tool proxy end-to-end

| Exit 标准 | 状态 |
|----------|------|
| Custom tools work under worker RPC with parent authority | ✅ 机制完成 |

**交付物:**
- ✅ `worker-proxy-tool-factory`: 为 blueprint `customToolNames` 构建 proxy tools
- ✅ Parent client routes `tool-call` → `HostToolExecutionRouter`
- ✅ `WorkerToolResultFrame` 携带 `code` 字段 (stable error mapping)
- ✅ Abort cancels outstanding tool proxy (signal listener)
- ✅ Session drop rejects pending tool calls
- ✅ 19 个测试 (proxy factory + runtime + router integration)

**差异:**
- ⚠️ **GAP-8**: WP4 task 4 要求 MCP/web/process/browser/notes/flashcards/image_gen matrix tests。当前测试覆盖 generic web_search + bash, 未覆盖全部 7 个 tool family。

### WP5 — PiSessionBackend dual implementation + adapter switch

| Exit 标准 | 状态 |
|----------|------|
| `hostMode=rpc` product path uses worker under flag/default policy | ⚠️ Flag 已实现, 数据管道未通 |

**交付物:**
- ✅ `PiSessionBackend` interface (createSession/dropSession/dispose + mode/isolated)
- ✅ `InProcessSdkSessionBackend` (mode='sdk', isolated=false)
- ✅ `WorkerRpcSessionBackend` (mode='rpc-worker', isolated=true)
- ✅ `PiRpcAdapter` 支持 `PIWIN_RPC_WORKER=1` / `useWorkerBackend` flag
- ✅ Doctor/status: `backendMode()`, `isIsolated()`, `usesWorkerBackend()`
- ✅ `preparePromptInput` helper (image loading + per-turn resolution)
- ✅ 10 个测试 (backend mode/isolation reporting, flag honor, preparePromptInput)

**差异:**
- ⚠️ **GAP-1**: `deriveBlueprintFromInput` 是 transitional shim, 不调用 `SessionCapabilityResolver`
- ⚠️ **GAP-2**: `providers: []` 不从 live config 构建
- ⚠️ **GAP-6**: `PIWIN_RPC_SDK_FALLBACK` flag (§10.1) 未实现
- ⚠️ **GAP-9**: Extension UI proxy 未实现 (documented degradation)
- ⚠️ **GAP-10**: Worker script path 仅用 `import.meta.url`, 无 bundle 测试

### WP6 — Conformance suite

| Exit 标准 | 状态 |
|----------|------|
| CI runs conformance on every agent-host test job | ✅ 已完成 |

**交付物:**
- ✅ 10 个断言覆盖 §0.1 条件 5 的所有方面
- ✅ Blueprint parity (snapshotId, active paths, tool names)
- ✅ Prepared prompt parity (text/image mode)
- ✅ Tool router parity (permission deny, disabled behavior)
- ✅ Subagent ceiling (exact tool set, immutability)
- ✅ Empty capability ⇒ no tools

**差异:**
- ⚠️ Conformance 在数据/策略层验证, 未在 runtime 层验证 (需要 Pi 安装)

### WP7 — Deletion pass

| Exit 标准 | 状态 |
|----------|------|
| No code path silently returns to in-process SDK under `hostMode=rpc` | ⏸️ 正确推迟 |

**交付物:**
- ✅ 文档化为 next step, gated on CI green + R2
- ✅ ADR 0011/0012 更新标记 transitional
- ✅ 本 session 不删除任何代码

---

## 3. 差异点详细说明

### GAP-1: HostRuntime → worker blueprint 编译 (§8.3) — **Critical**

**现状:** `PiRpcAdapter.createSession` 调用 `deriveBlueprintFromInput(input)` 构建最小 blueprint:
```ts
{
  snapshotId: 'transitional',
  settingsRevision: 'transitional',
  activeSkillPaths: [],
  activeExtensionPaths: [],
  activePromptPaths: [],
  tools: { customToolNames: [], piBuiltinToolNames: [], ... },
}
```

**应有:** 调用 `compileSessionCapabilitySnapshot()` → `projectBlueprintForWorker()` 从真实 Settings/trust/MCP/resources 编译完整 blueprint。

**影响:** Worker 收到空资源路径和空工具列表, 创建的是 text-only 会话, 不是产品级会话。

**修复方向:** `PiRpcAdapter` 需要访问 `SessionCapabilityResolver` (或 HostRuntime 在 `CreateSessionInput` 中传递已编译的 blueprint)。

### GAP-2: Provider runtime envelope 未填充 (§6) — **Critical**

**现状:** `PiRpcAdapter.createSession` 传递 `providers: []`。

**应有:** 从 live `PiwinConfig.providers` (或 `PiModelRuntime`) 构建 `SerializableProviderRuntime[]`, 包含 providerId, protocol, baseUrl, models, auth。

**影响:** Worker 无法注册任何 model provider, 无法调用任何模型。

**修复方向:** 在 adapter 中添加 `buildProviderEnvelope(config)` 函数, 从 `loadPiwinConfig()` 读取 provider 配置并转换为 serializable envelope。

### GAP-3: Hello 握手未验证 (§4.3) — **Medium**

**现状:** `RpcSdkWorkerClient` 不解析或验证 `hello` 帧。Worker 发送 hello, client 忽略。

**应有:** Client 解析 hello, 存储 `protocolVersion` 和 `capabilities`, 拒绝不兼容版本。

### GAP-4: 无超时处理 (§4.4) — **Medium**

**现状:** `RpcSdkWorkerClient.request()` 无超时。

**应有:** worker start 5s, session/create 30s, prompt ack 2s, tool-call 10 min, abort 2s。

### GAP-5: Crash 语义未实现 (§9.3) — **Medium**

**现状:** `WorkerRpcSessionBackend` 不处理 worker `exit` 事件。

**应有:** Worker crash → 所有活跃会话标记 `failed`, 发送 terminal error event。

### GAP-6: `PIWIN_RPC_SDK_FALLBACK` flag 未实现 (§10.1) — **Low**

**现状:** 仅 `PIWIN_RPC_WORKER` 和 `PIWIN_RPC_STOCK` 被检查。

**应有:** `PIWIN_RPC_SDK_FALLBACK=1` 临时允许旧 in-process fallback (R1 后用)。

### GAP-7: `WorkerShutdownFrame` 未实现 (§4.1) — **Low**

**现状:** 协议无 `shutdown` 帧类型。

**应有:** Worker 在 `rl.on('close')` 时发送 `shutdown` 帧并注明 reason。

### GAP-8: Tool family matrix tests 不完整 (WP4 task 4) — **Low**

**现状:** 测试覆盖 generic web_search + bash, 未覆盖全部 7 个 family。

**应有:** 参数化测试验证 MCP/web/process/browser/notes/flashcards/image_gen 各自的 proxy tool 注册和 schema。

### GAP-9: Extension UI proxy 未实现 (§3.2) — **Medium**

**现状:** Worker backend 下 extension `ctx.ui.confirm` 等 UI 请求不代理回 parent。

**应有:** 添加 `extension-ui` 帧类型, proxy extension UI 请求从 worker 到 parent。

### GAP-10: Worker script path bundling (§10.3) — **Medium**

**现状:** `import.meta.url` 解析 worker script, 无 bundle 测试。

**应有:** 支持 `workerScript` option + bundle 测试验证路径可解析。

---

## 4. 修复优先级

| 优先级 | 差异点 | R1 前必须修复? |
|--------|--------|---------------|
| **Critical** | GAP-1, GAP-2 | ✅ 是 — 没有这些, worker 不是产品级会话 |
| **Medium** | GAP-3, GAP-4, GAP-5, GAP-9, GAP-10 | ✅ 是 — 生产可靠性要求 |
| **Low** | GAP-6, GAP-7, GAP-8 | ❌ 否 — R1→R2 窗口修复 |

## 5. 建议的下一步

1. **单独 PR:** 修复 GAP-1 + GAP-2 (critical) — wire `SessionCapabilityResolver` + provider envelope 到 `PiRpcAdapter`
2. **单独 PR:** 修复 GAP-3 + GAP-4 + GAP-5 (robustness) — hello validation, timeouts, crash semantics
3. **R1 rollout:** Worker backend 作为 `hostMode=rpc` 默认 (behind `PIWIN_RPC_WORKER=1` env)
4. **R1→R2 窗口:** 修复 GAP-6, GAP-7, GAP-8, GAP-9, GAP-10
5. **R2 (WP7):** CI green + soak 后删除 SDK fallback / stock RPC 路径
