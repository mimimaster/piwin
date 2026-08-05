 # 工具接入面收敛式改造分析（新架构下）

 > 前提：假设 `2026-08-04-runtime-authority-cutover.md` 已全部落地、旧架构（agent-host
 > 组合根 / ActiveRunRegistry / 旧 process 面 / RPC fallback）已清理。本文分析的是
 > “在新架构的 host-runtime 组合根上，现有各功能模块的工具接入方式与调用方式是否
 > 需要一波全面接入改造，以及如何分模块改造”。
 >
 > 结论先行：**不需要重写**。工具组合点已经收敛到
 > `buildSessionHostTools` + `descriptorsFromTools` + Blueprint 单一路径；真正需要的是
 > 一次**收敛式改造**——4 条横切主线 + 若干按模块的差异修正。调用方式（异步循环）已
 > 大部分完成现代化（调度 wave → work-conserving race），剩余是 UI 轮询 → push、
 > 工具关联 id → Run 域 id 两处。

 | 字段 | 值 |
 |---|---|
 | 日期 | 2026-08-05 |
 | 状态 | 分析 + 改造草案（待确认执行顺序） |
 | 前置 | `2026-08-04-runtime-authority-cutover.md` Tasks 5-10 全部通过 deletion gate |
 | 主要包 | `host-runtime`、`contracts`、`tools-web`、`browser`、`mcp`、`skills`、`notes`、`flashcards`、`process`、`desktop`、`cli` |

 ---

 ## 1. 现状盘点（新架构假设下）

 ### 1.1 工具如何进 session —— 已经收敛

 ```text
 buildSessionHostToolsForSession (host-runtime.ts:1825)   ← 唯一组合点
   └─ buildSessionHostTools (tools/build-session-host-tools.ts)
        └─ HostToolDefinition[]（含 executor + 权限包装）
             ├─ SDK 路径:  descriptorsFromTools → blueprint.tools.hostTools
             │              → agent-host backends/sdk-backend-session.ts → Pi customTools
             └─ Worker 路径: descriptorsFromTools → blueprint.tools.hostTools
                              → agent-host rpc/worker-proxy-tool-factory.ts
                              → proxy customTools → 父进程 HostToolExecutionPort
 ```

 每个模块的工具工厂（process/browser/web/notes/flashcards/plan/subagent/image_gen/
 filesystem/mcp）都以 `HostToolDefinition` 产出**精确 JSON schema**（hardcoded object 或
 MCP cached `inputSchema`）。worker proxy 与 SDK backend 都直接复制 descriptor，
 **不猜 schema**。这是已经正确的部分。

 ### 1.2 遗留的坏点（本改造要处理的）

 | # | 坏点 | 位置 |
 |---|------|------|
 | G1 | **工具名列表在 5 处各自枚举，已经漂移**：browser 组合 11 个 / blueprint 政策 10 个（缺 `browser_wait`）/ capability ceiling 4 个 | `build-session-host-tools.ts`、`blueprint-compiler.ts buildToolPolicy`、`capabilities/tool-policy-resolver.ts FAMILY_CUSTOM_TOOLS`、`tools/tool-manifest-builder.ts` |
 | G2 | **`runId` 是传输关联 id，不是 RunRegistry 的 run id**：SDK 传 Pi `toolCallId`，worker 传 `frame.id`（`${sessionId}|${tool}-ts-rand`） | `pi-backend-tool-adapter.ts:42-48`、`worker-rpc-session-backend.ts:214-216`、`rpc-sdk-worker-protocol.ts:58-66` |
 | G3 | **权限是“execute 包装器”约定，不是 descriptor 声明的元数据**：manifest 无法回答“哪些工具会 ask”；`plan`/`subagent`/7 个 browser 工具无门禁 | 各工具工厂 + `session-tools.ts`、`notes-tools.ts`、`process-tools.ts`、`browser-tools.ts` |
 | G4 | **`enabledMcpServerIds` 恒为空、ContextManifest 恒空**：MCP 服务器、AGENTS.md 上下文没进入 SessionToolPolicy / ContextManifest | `blueprint-compiler.ts:451`、`:211-214` |
 | G5 | **三个纯 resolver 是死代码**：`resolveResourceActivations`、`resolveContextManifest`、`resolveToolPolicy` 有测试但没接入编译路径；live 路径用手写 `buildResourceManifest`/`buildToolPolicy` 代替 | `capabilities/resource-policy-resolver.ts`、`context-policy-resolver.ts`、`tool-policy-resolver.ts` |
 | G6 | **没有 ResourceCatalog 构建器**：skills/prompts/extensions 只出路径列表，没有统一目录/优先级/影子诊断 | 缺失（`contracts/src/resource.ts` 类型已存在） |
 | G7 | **`allowedSources: ['user']` 与真实加载矛盾**：project 资源被加载，但快照政策只允许 user | `blueprint-compiler.ts:515-534` |
 | G8 | **web 工具门禁不一致**：`config.web` 存在即广告 `web_search`，但零 enabled source 时每次调用都失败 | `build-session-host-tools.ts:102` vs `search-provider.ts:42` |
 | G9 | **死代码/重复面**：`parametersForHostTool`（Type.Any fallback）、`createMcpSessionBridge`（未接线）、`toPiCustomTools`/`attachToolsToPiSession`（未调用）、`gated-bash-tool`/`gated-file-tools`（导出无生产调用） | `pi-tool-adapter.ts:60`、`mcp-session-bridge.ts`、`session-tools.ts:166`、`index.ts:115-117` |
 | G10 | **inline handler**：`notes/*`、`flashcards/*`、`doccards/*`、`subagent/batch-*` 仍在 `host-runtime.ts` 的 switch 里，且 `job/*` 有重复 inline case（死代码） | `host-runtime.ts:642-940` |
 | G11 | **descriptor 携带的 `runtimeGenerationId` 与 worker frame 不对齐**：frame 只带 sessionId+event/toolCall，没有 generation/真实 runId | `rpc-sdk-worker-protocol.ts:48-96` |
 | G12 | **reload 后 UI 用 3s setInterval 轮询 runtime 状态**：应以 push 驱动 | `apps/desktop/src/settings/pages/session-runtime-page.tsx:39` |

 ### 1.3 调用方式（异步循环）现状

 | 模式 | 位置 | 结论 |
 |---|---|------|
 | 调度 wave（Promise.all 固定波次） | 旧 scheduler | **已改造** → work-conserving `Promise.race`（`subagent-orchestrator.ts:322-360`） |
 | Queue-drain 循环 | CLI dispatcher / stream-batcher | **保留**（传输层正确） |
 | worker request/response pending-map + 超时 | `rpc-sdk-worker-client.ts` | **保留**（传输层），但 frame 应带真实 run/generation id |
 | Desktop push 消费（rAF 合并） | `stream-event-buffer.ts` + chat-reducer | **保留**（已事件驱动） |
 | UI 状态轮询 setInterval(3s) | session-runtime-page | **改为 push** |
 | 测试 fixture 轮询 | `delayed-session-fixture.ts` | **保留**（仅测试） |
 | transcript 持久化重试循环 | `transcript-recorder.ts:409` | 保留，注意幂等 |

 ---

 ## 2. 判断：要不要“全方面接入改造”

 **要，但是一次收敛式改造，不是重写。** 理由：

 1. 组合点已经收敛（§1.1），工具面没有“多入口”问题，重写会破坏已正确的 descriptor
    直通路径。
 2. 但存在 G1-G12 这类“名义上接入、实际漂移/死代码/占位”的问题。它们在新架构下会
    表现为：工具名列表不一致导致 subagent ceiling 漏工具、权限行为不可声明、
    真实 Run 关联无法建立、MCP/context 永远空。
 3. 调用方式层面只有两处需要改：UI 轮询 → push；工具关联 id → Run 域 id。其余保留。

 一句话：**改造目标是把“每个模块自己约定接入方式”统一成“descriptor 即事实源 +
 descriptor 声明权限 + Run 域关联 + 单一策略编译”。**

 ---

 ## 3. 横切改造主线（先做这 4 条）

 ### T1. 工具名单一事实源（修 G1）

 从 `buildSessionHostTools` 组合出的 `HostToolDefinition[]` 派生所有名字列表：

 - `descriptorsFromTools`（已有）→ `SessionToolPolicy.hostTools`
 - `buildToolPolicy.enabledFamilies` / `FAMILY_CUSTOM_TOOLS` / `CAPABILITY_CUSTOM_TOOLS`
   全部改为 `deriveFamilyMembership(tools)` 生成，删除手工枚举；
 - 添加一条架构测试：对每个组合的 `HostToolDefinition.name` 断言它属于某个 family，
   且 policy/ceiling 不遗漏（browser 11 个必须全在）。

 交付物：一个纯函数 `toolFamilyIndex(tools): Map<family, string[]>`，五处列表全部由它
 派生，漂移在 typecheck/architecture 层消除。

 ### T2. 权限元数据进 descriptor（修 G3）

 给 `HostToolDefinition` 增加声明的权限字段（contracts 层）：

 ```ts
 type ToolPermissionDeclaration = {
   action: string;                 // 'process:start' | 'network:web_search' | ...
   risk: PermissionRiskKind;       // 复用 ADR 0019 的 risk
   defaultDecision: PermissionDecision;  // 'ask' | 'allow' | 'deny'
   rememberable?: boolean;         // 可否 session/project 记住
 };
 ```

 - 每个工具工厂在 descriptor 上**声明**，而不是在 execute 包装器里隐式 gate；
 - `HostToolExecutionRouter` 按声明统一走 ADR 0019 规则引擎（auto/ask-all/bypass、
   session/project 记忆），删除 `wrap*ToolWithPermission` 各模块各自实现的包装器约定
   （`session-tools.ts`、`notes-tools.ts`、`process-tools.ts`、`browser-tools.ts`、
   `flashcard-tools.ts`）；
 - `plan`、`piwin_subagent_run`、browser 无门禁工具补上显式 `allow` 声明
   （行为不变，但 manifest 可回答“哪些会 ask”）；
 - manifest 增加 `requiresApproval: string[]` 投影，Desktop/CLI 可直接展示。

 ### T3. 真实 Run identity 进执行端口（修 G2/G11）

 目标：`HostToolExecutionInput.runId` 是 RunRegistry 的真实 run id，而不是传输关联 id。

 - contracts 不变（字段已有）；
 - host-runtime 增加 `runContext` 投影：`(sessionId, toolName) → 当前 active runId`，
   在 `SessionHostToolExecutionPort.execute()` 里用 RunRegistry 的
   “当前 session 前台 run” 查询替换 `runExecutionContext` 的猜测；
 - worker 协议：`tool-call` frame 增加 `runId`（由 worker 从 task run 上下文带入），
   `WorkerEvent` 增加可选 `generationId`/`runId`；后端创建/prompt 帧携带真实
   `taskRunId`（`worker-task-runner.ts:81-102` 现在没传）；
 - `RunEventCorrelator` 保留为 message/tool 归属投影，但不再负责把 transport id
   翻译成 run id（那是帧自身应携带的）；
 - worker crash 的 terminal 事件用真实 runId 归属到对应 Run。

 ### T4. 删除死代码/重复面（修 G9/G10）

 - 删除 `parametersForHostTool` 及其 `Type.Any()` fallback（`pi-tool-adapter.ts`）；
   若 `toPiCustomTools`/`attachToolsToPiSession` 无生产调用则一并删除；
 - 删除未接线的 `createMcpSessionBridge`（live 路径用
   `mcp_gateway` + cached direct tools，保留 `mcp-cached-tool-definitions.ts`）；
 - `gated-bash-tool`/`gated-file-tools`：二选一——要么接线为 SDK 路径的 Pi built-in
   override（`bash`/`write`/`edit` 门禁），要么删除。建议**接线**（SDK 模式门禁完整性），
   并把 `buildHostFilesystemTools` 与 gated 系列合并成一份 filesystem 工具清单；
 - 把 `notes/*`、`flashcards/*`、`doccards/*`、`subagent/batch-*` 移出
   `host-runtime.ts` switch，进 `commands/notes-commands.ts`、
   `commands/flashcard-commands.ts`、`commands/subagent-commands.ts`（后者 Task 8 本就要建）；
 - 删除 `job/*` 的重复 inline case（`job-commands.ts` 已处理）。

 ### T5. 接入纯 resolver，替换手写编译（修 G4/G5/G6/G7）

 把三个已测试的纯 resolver 接入 `blueprint-compiler.ts` 编译路径：

 - 新增 `ResourceCatalogBuilder`（G6）：扫 skills/prompts/extensions → 统一
   `ResourceCatalog`（含 source、disabled、优先级、影子诊断）；
 - `resolveResourceActivations`（基于 catalog + trust + disabledIds）替换
   `buildResourceManifest`/`buildResourcePolicy` 手写版，修 `allowedSources: ['user']`
   与 project 资源真实加载的矛盾（G7）；
 - `resolveContextManifest` 接入，替换恒空的 `contextManifest`（G4）：AGENTS.md/
   CLAUDE.md/SYSTEM.md/APPEND_SYSTEM.md 进入编译；
 - `resolveToolPolicy`（family × backing availability）替换 `buildToolPolicy` 手写版，
   让 `enabledMcpServerIds` 来自真实 enabled MCP 服务器列表（G4）；
 - 顺带修 placeholder revision：`rulesRevision/settingsRevision/projectRevision/mcpRevision/
   resourceCatalogRevision` 使用真实修订（规则合并结果、`project-scope`、`mcp-static`
   全部替换）。

 ### T6. 调用方式现代化（修 G12）

 - `session-runtime-page.tsx` 的 3s 轮询改为消费 `run/updated` + `session/runtime-status`
   的 push 派生（reload 真正启用后由 RunHostPush 驱动）；
 - worker 传输层保留 request/response + pending map，但 frame 增加真实 run/generation id
   （T3 的一部分）；
 - 其余异步循环（queue-drain、race 调度、rAF 合并）保持不变。

 ---

 ## 4. 分模块改造表

 ### 4.1 MCP

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 动态工具 | `mcp_gateway`（search/describe/call/status）+ cached direct tools（`mcp__server__tool`，schema 来自 `inputSchema`，**已是精确 descriptor 先例**） | 保留；删除未接线的 `createMcpSessionBridge`（T4） |
 | enabledMcpServerIds | 恒 `[]` | T5：从 `listEnabledServers(config)` 编译进 `SessionToolPolicy` |
 | 权限 | `assertMcpToolCallAllowed`（enabled server 默认信任，ADR 0019 §5） | T2：声明为 `mcp:<server>:<tool>`/`mcp:tool-call`，规则引擎统一 |
 | IPC | `mcp-commands.ts` 已完整 | 无变化 |
 | 缓存 | `mcp/start` prime metadata cache；direct tools 依赖 `isServerCacheValid` | 保持；cache 失效触发 `run/updated` 提示 runtime 过期（新-runtime 语义） |

 ### 4.2 Skills / Prompts / Extensions（资源清单）

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 扫描 | `scanSkills`/`scanPrompts`/`scanExtensions` + `ensure-bundled-*` | **保留**（纯 inventory，B2 决策已定不抽包） |
 | 模型可见面 | 路径列表 → Pi `DefaultResourceLoader`（`activeSkillPaths` 等） | T5：改由 `ResourceCatalog` + `resolveResourceActivations` 产出 `ResourceManifest` |
 | disabled | 各 scanner `disabledIds` + loader 过滤 | 统一到 catalog 的 `disabled`/`allowedSources`（T5） |
 | 上下文 | `contextManifest` 恒空 | T5：`resolveContextManifest` 接入（AGENTS.md 等） |
 | id 归一 | scanner 各自 slug 化，`normalizeResourceId` 未被 scanner 使用 | 统一用 `contracts/src/resource.ts:31-49` 的 canonical 函数（G6 附带） |
 | IPC | `catalog-commands.ts` `skills/*`、`extensions/*`、`prompts/*` | 无变化 |

 ### 4.3 Process（Job 面）

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具名 | `process_start/list/logs/stop`（产品语言，保留） | 保留 |
 | 执行 | 已全走 `JobController` | 无变化 |
 | run 归属 | 模型工具启动的 Job **无** `ownerRunId`（T3 前置） | T3 后把真实 runId 传入，`process_start` 设 `lifetime:'run'` + `ownerRunId` |
 | 权限 | `process:start/stop` → ask | T2 声明化 |
 | 配置 | `maxProcesses` 未接进 JobController | 构造时从 `config.process` 注入 `maxJobs`；`enabled` 参与 `enabledFamilies` |

 ### 4.4 Web（tools-web）

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具 | `web_search`/`web_fetch`（精确 schema） | 保留 |
 | 门禁 | 存在 `config.web` 即广告，但零 enabled source 时调用必失败（G8） | 编译时按 enabled sources 决定是否进 `enabledFamilies.webSearchReady/webFetchReady`；`createSearchProvider` 抛错改为编译期排除 |
 | 权限 | `network:web_search`/`network:web_fetch` + 项目记忆 | T2 声明化 |

 ### 4.5 Browser

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具 | 11 个（navigate/snapshot/click/type/fill_form/scroll/screenshot/find/back/forward/wait） | 保留 |
 | 漂移 | blueprint 10 / capability 4（G1） | T1 全量派生，11 个必须都在 |
 | 权限 | 仅 `browser_navigate` 有门禁 | T2：其余显式 `allow` 声明 |
 | push | `browser/frame`、`state`、`picked` | 保留 |

 ### 4.6 Notes / Flashcards（+ doccards）

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具 | `note_*` 6 个、`flashcard_*` 4 个（精确 schema + 权限包装已内联） | T2 声明化 |
 | IPC | **inline 在 `host-runtime.ts`**（G10） | 移到 `commands/notes-commands.ts`、`commands/flashcard-commands.ts` |
 | 配置门 | `enabled !== false` 已正确 | 保留 |
 | RAG/FSRS | hybrid search + FSRS | 无变化 |

 ### 4.7 Filesystem / Bash

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具 | `buildHostFilesystemTools`（read_file/write_file/list_directory/bash/run_bash）是活跃路径；`gated-bash-tool`/`gated-file-tools` 死代码 | T4：合并为一份清单；SDK 路径 Pi built-in `bash`/`write`/`edit` override 接线（或明确删除） |
 | 权限 | `file-write`、`bash` | T2 声明化 |

 ### 4.8 Plan

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具 | `piwin_plan_create`/`piwin_plan_set_step`（精确 schema） | 保留；T2 显式 `allow` |
 | Run | `plan/execute` 无 `plan-execution` Run（前置 Task 8 缺口） | 依赖 cutover 计划修复后，工具与 Run 树关联 |
 | push | `plan/updated`、`plan/execution-updated` | 保留 |

 ### 4.9 Subagent

 | 项 | 现状 | 改造 |
 |---|---|---|
 | 工具 | `piwin_subagent_run` → `SubagentRunSeam` → orchestrator.startBatch（已是单入口） | 保留 |
 | Run id | worker frame 无真实 taskRunId | T3：frame 带真实 runId/generationId |
 | IPC | inline `subagent/batch-*` | 移入 `commands/subagent-commands.ts`（T4） |
 | ceiling | browser 等 family 列表漂移影响 ceiling | T1 修复 |

 ### 4.10 Session / Media / Artifact / 其他

 - **session**：无模型工具；`session/reload-runtime` 依赖 cutover 后启用；runtime 页
   轮询改 push（T6）。
 - **media**：非工具面，`ImageContent` 结构类型已对；无改动（若未来要 `image_*`
   工具则按 descriptor 新加）。
 - **artifact**：纯服务，Desktop 渲染侧；无改动。
 - **image_gen**：`network:image-gen` 门禁 + media 落盘；T2 声明化。
 - **git/theme/pet/automation/marketplace/plugin/remote/usage/secrets/pty/project**：
   纯 IPC/服务，无模型工具；不进入本次改造（除 G10 的 inline 迁移）。

 ---

 ## 5. 执行顺序与门

 | 顺序 | 内容 | 门 |
 |---|---|---|
 | R1 | T4 死代码删除 + inline handler 迁移（低风险、可先做） | 删除 gate：`parametersForHostTool`、`createMcpSessionBridge`、`toPiCustomTools`、inline `job/*` case 零残留 |
 | R2 | T1 工具名单一事实源（`toolFamilyIndex` + 架构测试） | browser 11/11、全部 family 无漂移；`test:architecture` 增工具族断言 |
 | R3 | T2 权限声明化（contracts 类型 + 各工具工厂迁移 + 规则引擎统一） | `requiresApproval` 投影上线；无 `wrap*ToolWithPermission` 包装器残留 |
 | R4 | T3 真实 Run identity（port 查询 + worker frame + correlator 收敛） | worker frame 带 runId/generationId；`process_start` 有 `ownerRunId` 集成测试 |
 | R5 | T5 纯 resolver 接入（ResourceCatalog + ContextManifest + ToolPolicy + 真实 revision） | `enabledMcpServerIds`/`contextManifest` 非空；无 placeholder revision |
 | R6 | T6 调用方式（runtime 页 push 化） + 各模块差异修正（web 编译期门禁、maxProcesses 注入、G7 allowedSources） | Desktop 无轮询；web 零 source 不广告 |

 依赖关系：R1 可并行；R2 是 R3 的前置（权限声明依赖工具清单稳定）；R4 独立；
 R5 依赖 R1（删除旧编译路径）且是 R6 中“模块差异”的前置。

 ## 6. 验证

 ```bash
 pnpm --filter @piwin/contracts test
 pnpm --filter @piwin/host-runtime test
 pnpm --filter @piwin/desktop test
 pnpm --filter @piwin/cli test
 pnpm test:architecture
 pnpm typecheck
 ```

 新增专项测试：
 - `toolFamilyIndex` 全量一致性（browser 11、notes 6、flashcard 4、process 4、web 2、plan 2、filesystem 5）；
 - 每个 descriptor 有权限声明；manifest `requiresApproval` 与门禁行为一致；
 - worker tool-call frame 携带真实 runId，parent 端口按 run 归属；
 - `ResourceCatalog` 影子/优先级 golden case；
 - MCP 服务器 disable 后 `enabledMcpServerIds` 立即变化并触发 runtime 过期 push。

 ---

 ## 附：本次改造不做的（明确反例）

 - 不新建“工具注册中心”或配置驱动的动态工具框架（保持 `buildSessionHostTools`
   为组合点）；
 - 不把 IPC-only 模块（git/theme/pet/automation 等）改成模型工具；
 - 不改 worker 传输层协议风格（保留 request/response + push 并存），只加真实身份字段；
 - 不引入 `@piwin/agent-resources` 包（B2 决策）。
