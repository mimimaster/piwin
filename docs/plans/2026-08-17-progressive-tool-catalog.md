# Progressive Tool Catalog：统一可搜索工具目录（收编 piwin_toolbox + mcp_gateway）

| Field | Value |
| ----- | ----- |
| Status | Implemented |
| Date | 2026-08-17 |
| Scope | `@piwin/host-runtime`（主要）、`@piwin/agent-host`（presentation）、docs/ADR |
| Background | `docs/notes/2026-08-17-progressive-tool-disclosure.md`（四路线分析）、`docs/plans/2026-08-12-toolbox-routed-tool-presentation.md`（routed presentation 契约） |
| Non-goals | 热路径工具改披露方式；embedding 检索；Provider 级 `defer_loading`；fork Pi |

## 1. Goal

把模型可见的低频工具面从「两套外壳、两套仪式」收敛为**一个可搜索的工具目录**：

```text
现在：
  piwin_toolbox   describe/call，target 枚举写死在 schema，无搜索
  mcp_gateway     search/describe/call/status，只覆盖 MCP

目标：
  piwin_toolbox(v2)   search/describe/call/status，一个目录覆盖
                      低频 Host 能力 + 未 pin 的 MCP 工具
```

同时保住三条现有不变量：

1. **Prompt Cache 前缀稳定**：`tools` 数组每代恒定，schema 以 tool_result 追加在对话尾部；
2. **热路径不动**：`read`/`grep`/`ls`（Pi 内置）与 `bash`/`write_file`/`web_*`/plan/subagent 等 Host 高频工具继续原生直出、完整 schema 常驻；
3. **权限按目标准入**：统一 `call` 仍按目标 registration 的 `permissionSpec` 走 `SessionHostToolExecutionPort`，MCP 保持 ADR 0033 的 trusted 语义。

这是文章四路线中的第 3 路（客户端 search + invoke）。选它的原因：piwin 是多 Provider 壳，Pi 在 `createAgentSession` 时冻结工具面，路线 1（`defer_loading`）与路线 4（Kimi 消息注入）都够不着；而路线 3 的「客户端必须自扛校验/授权/审计」在 piwin 恰好是已经付过的架构成本——execution port 本来就是唯一入口。

## 2. Current failure

1. **两套仪式**：模型要学两个外壳的说明书；MCP 是 `search → describe → call` 三跳，toolbox 是 `describe → call` 两跳但没有搜索。
2. **toolbox 不可扩展**：target 枚举写死在 descriptor 里。目标一多（或未来把更多低频家族收进来），枚举本身重新变成常驻噪声；MCP selector 根本进不了枚举。
3. **搜索结果不含 schema**：gateway `search` 只回工具名+描述，模型必须再 `describe` 一次才能拿到契约，多一跳纯浪费。
4. **用户加一堆 MCP 的真实场景**：gateway-first 挡住了 schema 爆炸（默认不铺进 `tools`），但发现体验差——system brief 只有 server 名 + 8 个样例名，模型经常靠猜。

## 3. Design

### 3.1 模型可见面（每代恒定）

```text
[Pi built-ins]     read / grep / ls
[Host direct]      bash, write_file, read_file, list_directory,
                   web_search*, web_fetch, plan_create, plan_step,
                   artifact_instructions, subagent_run, ...（现状不变）
[Pinned MCP]       mcp__server__tool ...（≤48 个 / ≤48KB，现状不变）
[Catalog shell]    piwin_toolbox（v2，唯一新增/变更项）
```

`mcp_gateway` 从模型可见面移除（执行逻辑下沉到目录服务，见 3.4）。

### 3.2 `piwin_toolbox` v2 契约

```jsonc
{
  "name": "piwin_toolbox",
  "description": "Search and call low-frequency Host capabilities and MCP tools. Host targets: image_gen, video_gen, process_*, browser_*, notes_*, flashcard_*. For anything else use search first; search results include the exact schema. MCP servers: <bounded summary>.",
  "parameters": {
    "type": "object",
    "properties": {
      "action": { "type": "string", "enum": ["search", "describe", "call", "status"] },
      "query": { "type": "string" },
      "target": { "type": "string" },
      "arguments": { "type": "object", "additionalProperties": true },
      "limit": { "type": "number" }
    },
    "required": ["action"],
    "additionalProperties": false
  }
}
```

要点：

- **`target` 从枚举改为 string**。目录可搜索之后，枚举失去存在理由（且装不下 MCP selector）。typo 防护改由 Host 校验 + 结构化错误 + search 返回精确 id 承担。
- **id 命名空间**：Host 目标用原名（`image_gen`，无点号）；MCP 用现有 selector 约定（`server.tool`，含点号）。`describe`/`call` 按是否含点号分流，无歧义。
- **Host 目标名单仍写进 description**（~8 个名字，便宜），已知目标可以跳过 search 直接 `describe → call`；这保留今天 toolbox 的最短路径。
- `status` 保留，仅报告 MCP server 健康（非连接性），与今天 gateway 一致。

### 3.3 动作语义

**search（新的核心）**

1. Host 侧：对冻结的 toolbox target registrations 做关键词匹配（name、description、参数名/参数描述），全部本地纯函数；
2. MCP 侧：复用现有 `searchValidMcpCache`（`McpMetadataCatalog.searchCached`）+ 现有有界懒发现（`MAX_LAZY_DISCOVERY_SERVERS=8`、并发 4、`discover=false` 可关）；
3. 合并排序：精确名匹配 > 前缀 > 关键词命中数；同分按 id 字典序。第一版不做 BM25 打分权重调参，规模到几百工具前不上 embedding；
4. **命中即契约**：top K（K=3）内联返回完整 JSON Schema（经 `compactModelToolDescriptor` 压缩散文，360/180 字符上限，结构不动），其余命中只回 id + 一行描述。模型下一步可直接 `call`——三跳收敛为两跳；
5. 输出预算：单次 search 的 tool_result 上限 12k 字符，超出截断并注明 `truncated`。

**describe**：单目标完整 schema。Host 目标读冻结 registration；MCP 走现有「缓存优先，已知 selector 可懒发现」路径。已发现过的 schema 留在对话历史里，同会话再调就是一跳。

**call**：

```text
target 无点号 → 冻结 toolboxTargets → cached.router.execute(target, args)
                （按目标 registration 的 permissionSpec 准入，现状不变）
target 含点号 → 目录服务 callMcp(selector, args)
                （lazy-connect 单 server，ADR 0033 trusted 语义，现状不变）
```

`arguments` 校验失败返回结构化错误（code + 缺失/非法字段），让模型修正重试——沿用今天 toolbox 的模式。

### 3.4 归属与模块切分（§3.2 反 1000 行）

新建 `packages/host-runtime/src/tool-catalog/`：

| 文件 | 责任 | 来源 |
| --- | --- | --- |
| `catalog-index.ts` | Host 目标条目模型 + 关键词匹配/排序（纯函数，单测） | 新写 |
| `catalog-service.ts` | search 合并、describe、callMcp、status；持有 McpLifecycleManager/Snapshot/Catalog | **搬移** `mcp-gateway-tool.ts` 的 search/懒发现/describe/call/status 逻辑，不是复制 |
| `catalog-tool.ts` | `piwin_toolbox` v2 registration + descriptor（shell 的 execute 仍返回 requires-port，与今天一致） | 改写 `host-toolbox.ts` |
| `catalog-brief.ts` | 统一 system brief（合并现 MCP brief 与 toolbox 提示） | 改写 `mcp-capability-brief.ts` 的 format 层，budget 上限沿用 ≤1.6k 字符 |

改动点：

- `build-session-host-tools.ts`：不再 push `mcp_gateway`；组 catalog service 并挂到 toolbox registration；`descriptorsFromTools` 过滤逻辑不变。
- `session-host-tool-port.ts`：`executeToolbox` → `executeCatalog`，新增 search/status/MCP-call 分发（保持文件瘦身：分发进 port，实现在 catalog-service）。`GenerationToolSurface.toolboxTargets` 语义不变（Host 目标仍冻结在 surface 上）。
- `blueprint-compiler.ts`：toolbox descriptor 重写处改用 `catalog-tool` 的 builder；`mcpAppendPrompt` 与 conversation prompt 改用 `catalog-brief`；`CONVERSATION_TOOLBOX_FAMILIES` 约束不变（纯聊天目录仅 flashcards/image/video，**MCP 在 conversation 保持关闭**，与今天 `mcp: false` 一致）。
- `mcp-cached-tool-definitions.ts` / `mcp-exposure-policy.ts` / pinned 直出（48/48KB）：**不动**。pin 是用户给高频 MCP 工具买原生严格 schema 的逃生舱，与目录并存。

### 3.5 冻结与 live 的双语义（显式声明，不是含糊）

- **Host 目标**：随 runtimeGeneration 冻结。search/describe/call 都打在冻结 surface 上，审计与准入语义与今天完全一致。
- **MCP**：保持今天 gateway 的「intentionally live」——`refreshConfig()` 在调用时生效，Supervisor 拥有生命周期（ADR 0033），配置变更不重建会话工具面。brief 用冻结 snapshot，执行用 live supervisor。这是现状的延续，写进 ADR 让它成为明确决策而非巧合。

### 3.6 Presentation（复用 2026-08-12 契约）

- `AgentEvent.toolName` 仍是 `piwin_toolbox`，不改写（审计事实）。
- `packages/agent-host/src/tool-presentation.ts` 扩展分类：
  - `action=call` + Host 目标 → 现有 routed 语义（`routedToolName`、image/video/process 等 kind）；
  - `action=call` + MCP selector → `kind: 'mcp'`，`routedToolName = selector`；
  - `action=search/describe/status` → 发现类 presentation（沿用「toolbox describe 是 discovery presentation」的既有决定）。
- Desktop 只读 presentation，不解析外层 JSON（既有约束），预计零改动或仅 fixture 更新。
- 历史 transcript 里的 `mcp_gateway` / 旧 toolbox 行走既有 fallback 渲染，**无迁移**。

### 3.7 投递缝（为路线 1/4 预留，但不建）

catalog-service 对外给的是结构化条目（id、descriptor、来源），「把 schema 以 tool_result 文本交给模型」只是当前唯一的投递适配。将来若 Pi 透传 `defer_loading`（路线 1）或支持消息注入工具（路线 4），agent-host 可在 backend 边界消费同一个 service 换投递方式。**本计划不为此写任何代码**，只要求 service 返回结构化数据而非拼好的字符串——这一条自然满足，不构成额外工作。

## 4. Token 收支预估

| 项 | 现在（常驻/代） | 之后 |
| --- | --- | --- |
| toolbox descriptor | ~名字枚举 + 两句说明 | 一段 description（含 ~8 个 Host 名）+ 5 字段 schema，量级相当 |
| mcp_gateway descriptor | ~200–300 tokens | **删除** |
| MCP system brief | ≤1.6k 字符 | 合并进统一 brief，同 budget 上限 |
| 每次发现 | search(名字) + describe(schema) 两个 tool_result | search 直接带 top-3 schema，一个 tool_result |

净效果：常驻略降（少一个工具 descriptor），发现路径少一跳。用 fixture 断言常驻字节数不高于基线（见 §6）。

## 5. Execution plan

按 §3.6 小提交、按关注点拆分：

- **WP1 目录服务**（host-runtime，纯逻辑先行）
  1. `catalog-index.ts`：条目模型 + 匹配排序，单测覆盖精确/前缀/关键词/空查询/截断；
  2. `catalog-service.ts`：搬移 gateway 的 search/懒发现/describe/call/status，MCP 侧行为逐一对照现 `mcp-gateway-tool.test.ts` 保持等价；
  3. `catalog-brief.ts`：合并 brief，golden 文本断言 + 长度上限断言。
- **WP2 面切换**（host-runtime）
  1. `catalog-tool.ts` v2 descriptor；`build-session-host-tools` 停注册 `mcp_gateway`；
  2. port `executeCatalog` 分发（search/describe/call/status；host/mcp 分流；准入路径断言）；
  3. `blueprint-compiler` descriptor/brief/conversation 三处接线；
  4. 更新受影响测试：`blueprint-compiler.test.ts`（`['mcp_gateway']` 期望改 catalog）、`host-toolbox.test.ts`、`tool-admission.test.ts`、`session-host-tool-port.test.ts`。
- **WP3 presentation**（agent-host）
  1. `tool-presentation.ts` 扩展 MCP routed + search/discovery 分类，fixture 断言；
  2. Desktop 冒烟确认 image_gen 经目录调用仍渲染 `ImageGenerationProgress`（2026-08-12 验收项回归）。
- **WP4 收尾**
  1. ADR：`docs/adr/00XX-progressive-tool-catalog.md`，取代 ADR 0014 中「独立 mcp_gateway 暴露面」的部分（gateway-first/lazy-connect/缓存语义保留，ADR 0033 不动）；
  2. 常驻 token 基线 fixture；
  3. 手动冒烟清单（见 §6）；
  4. `docs/guides/`、`docs/architecture.md` 中提及 mcp_gateway 的文字同步。

不做的事（明确排除）：给 search 加 embedding；把 bash/write 等热路径塞进目录；动 pinned 直出预算；改 Pi；做任何「新旧双面并存」的兼容开关——按 generation 语义自然切换，老 generation 用旧面跑完，新 generation 用新面。

## 6. Verification

自动：

1. `pnpm typecheck` 全绿；
2. host-runtime / agent-host 测试全绿，其中新增：
   - 排序与截断纯函数单测；
   - MCP search/describe/call/status 与旧 gateway 行为等价的对照测试；
   - `call` 对 Host 目标走目标 permissionSpec、对 MCP 走 trusted 的准入断言；
   - readonly subagent / conversation 会话的目录裁剪断言（沿用现有 policy 测试模式）；
   - 常驻 descriptor 字节数 ≤ 基线的 fixture。
3. presentation fixture：MCP routed call、search discovery、malformed 输入回退 generic 卡。

手动（Desktop）：

1. `piwin_toolbox search "flashcard"` → 命中带 schema → `call` 一跳成功；
2. 真实 MCP server：search（含一次懒发现）→ call round trip；
3. pinned `mcp__*` 工具仍第一类直出可用；
4. image_gen 经目录调用渲染生成进度卡，无外层 JSON 卡；
5. 长会话验证 `tools` 数组未变化（抓一次请求对比前缀）。

## 7. Risks

| 风险 | 缓解 |
| --- | --- |
| 弱模型在 `arguments` 黑盒里填错（路线 3 固有） | 结构化校验错误 + 重试；Host 目标名单常驻 description 降低误拼；与今天 toolbox 同水位，未新增 |
| search 结果撑大上下文 | 12k 字符硬上限 + limit 参数 + top-K 才带 schema |
| 去掉 target 枚举后 typo 增多 | search 返回精确 id；`tool-not-available` 错误附最近似候选 |
| 搬移 gateway 逻辑引入行为漂移 | WP1 用旧测试对照搬移，等价断言先行 |
| 模型对新仪式不适应（曾学过两套） | descriptor 里写明 search-first 工作流；brief 同步更新；观察一段真实会话后再调 description 文案 |

## 8. Open decisions（带推荐）

1. **K=3 内联 schema** 是否合适——推荐先 3，超预算自动降 1；
2. **`status` 是否保留在模型面**——推荐保留（非连接、便宜、排障有用）；
3. **工具名沿用 `piwin_toolbox`**——推荐沿用：presentation 分类器、历史 transcript、审计连续性都零成本；语义仍是「工具箱」，只是长出了搜索。
