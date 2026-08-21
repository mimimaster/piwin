# Plan — 编排方案可见性与实用化（2026-08-19）

| Field | Value |
|-------|-------|
| Status | Ready for implementation — phased, not one PR |
| Date | 2026-08-19 |
| Trigger | [评审笔记](../notes/2026-08-19-orchestration-scheme-review.md)；用户追加：子 Agent 工作 UI 必须清楚显示正在用的模型 |
| Related | [orchestration-scheme.md](../specs/orchestration-scheme.md)、[v2 enhancement](../specs/orchestration-scheme-v2-enhancement.md)、ADR 0030 / 0046 |
| Binding | AGENTS.md；contracts first；Off 零注入；per-send opt-in；不做阶段机 / 不做自动启用 / 不做 agent teams |
| Backlog prefix | ORCH-VIS-* |

---

## 0. 目标与不变量

**产品目标：** 选中编排方案后，用户能**看见编队在干什么、用什么模型、花了多少、回报什么**；主代理能按 role 点名、按契约拿回蒸馏结论；规模任务有有界 fan-out。

**本轮用户点名的额外验收：** 子 Agent 干活时的 inline 卡片（以及 inspector 头）必须清楚显示**当前使用的模型**（provider 图标 + 可读名），不能只是一个几乎看不见的 `modelId`。

### 不变量（任何阶段不得破坏）

1. Off / omit → 零方案逻辑（ORCH-G3）。
2. 方案仍是 per-send opt-in；不跨会话默认、不自动启用。
3. `SubagentOrchestrator` 仍是唯一批量调度权威。
4. depth 仍 = 1；fresh child；不 fork 父历史。
5. 用户 transcript 不写 preamble / roster。
6. 主模型永远 = Composer 当前模型。
7. 不做流程图、方案市场、peer messaging。

---

## 1. 现有能力（不要重做）

| 已有 | 缺口 |
|------|------|
| Composer 方案下拉、Settings 方案编辑器、role roster 注入 | 选了方案后几乎无「本 turn 发生了什么」的回执 |
| `SubagentInvocation.model` + `SessionSummary.subagentModel`；Host `prepareSubagentBatch` 已把 **pinned 或继承父模型** 写回 `task.model` | Desktop 只渲染 muted 的 `modelId`；starting 态常还没有 child；用户感知 = 「没显示模型」 |
| `SubagentInvocation.profileId` 当 meta | **role 不持久化**，卡片显示的是 `explorer` 不是 `searcher` |
| CE-OBS `usage/update` + `UsageRecord`（session 级） | 没有 **parent turn → 各 child** 的编排账单 |
| 回流 = 流式文本截断（12k / merge 4k） | 无 `reportContract` |
| orchestrator 已有 `dependsOn` / `failurePolicy` / 并发 | 模型侧只有同步单任务 `piwin_subagent_run` |
| Ultra Code 内置 scout | 异构编队（oracle）没有开箱方案 |

---

## 2. 分期总览

```text
A  身份可见     role 持久化 + 工作模型芯片 + 未钉模型提示     ← 本轮先做
B  编排回执     turn 级账单（role / 模型 / 时长 / token）
C  报告契约     member.reportContract → child 尾部 → merge 优先提取
D  有界 fan-out  piwin_subagent_fanout（复用 orchestrator）
E  异构编队     内置 Review Council + oracle 模板
F  预算护栏     scheme.maxTotalTokens（依赖 B 的计量）
```

A 可单独合；B 为 F 的数据前提；C 独立；D 独立但应吃 A/B 的 identity + 回执；E 几乎是常量+文案；F 最后。

建议 PR 切分：**A → B → C → D → E+F**（E 可提前夹在 C 之后，若只想先把卖点做出来）。

---

## 3. Phase A — 身份可见（role + 工作模型）

> 对应评审 P0-2、P0-4 + **用户追加：干活时看到模型**。

### 3.1 问题根因（已核对代码）

`apps/desktop/src/subagent-invocation-block.tsx` **已经有**模型字段：

```ts
const role = props.child?.subagentProfileId ?? props.invocation?.profileId;
const model = props.child?.subagentModel?.modelId ?? props.invocation?.model?.modelId;
```

但体验失败，因为：

1. **文案错位**：`role` 实际渲染的是 profile id（`explorer`），不是方案 role（`searcher`）。`role` 只在工具参数里走一遭，不进 `SubagentTaskSpec` / `SubagentInvocation`。
2. **展示太弱**：muted `0.86em` 纯 `modelId`，无 provider 图标、无 Settings 里的 `label`。异构编队时（Grok vs Luna）扫一眼分不清。
3. **时序空洞**：卡片在 `tool/start` 立刻出现（ADR 0046），此时可能还没有 `child`。`invocation.model` 依赖 `task.model`；`prepareSubagentBatch` 会回填，但 UI 没有「解析中 / 继承主模型」的明确态，也没有把 `ModelRef` 做成芯片。
4. Inspector 头同样只拼 ` · ${modelId}`。

### 3.2 产品形态

```text
┌ 子代理任务 ─────────────────────────────────────┐
│ ◉  广搜 auth 中间件          searcher   [🐋 DeepSeek V4 Flash]
│     正在执行 grep …
└─────────────────────────────────────────────────┘
```

规则：

| 态 | 模型芯片 |
|----|----------|
| queued / starting，已有 resolved `ModelRef` | 立刻显示（不写「继承」二字，显示**实际将用的模型**） |
| 尚无 ModelRef | 芯片文案「解析模型…」/ `Resolving model…`，不假装主模型 |
| running / 完成 / 失败 | 持续显示同一芯片；完成后不摘掉 |
| fallback 未 spawn | 不显示假模型；活动行说明回退主会话 |

芯片内容：`ProviderIcon`（已有 `provider-icons.tsx`）+ `label`（`buildEnabledModelOptions` 查到则用 label，否则 `modelId`）。tooltip：`providerId / modelId`。

未钉模型提示（P0-4）：Composer 方案 pill 旁，仅当选中非 Off **且** 默认 role 的 member 无 `model` 时显示一次性 muted hint：

> 中文：`searcher 未指定模型，将使用当前主模型价位`  
> 英文：`searcher has no pinned model — it will use the composer model`

点 hint → Settings 编排方案。**不**自动弹 Settings；**不**改 Off 行为。

### 3.3 合同

`packages/contracts/src/subagent-orchestration.ts`

- `SubagentTaskSpec.role?: string`
- `SubagentInvocation.role?: string`
- `SubagentTaskResult.role?: string`

`packages/contracts/src/host.ts` `SessionSummary`

- `subagentRole?: string`（与 `subagentProfileId` 并列；role 是产品点名，profile 是工种配方）

`packages/contracts/src/orchestration-scheme.ts`

- 不改 resolve 形状也可；Desktop 用已有 `ResolvedOrchestrationMember.model` 判断是否钉模型。

### 3.4 Host

| 文件 | 改动 |
|------|------|
| `host-runtime.ts` `getSubagentSeam` / `prepareSubagentBatch` | `applySchemeToSubagentSpawnInput` 得到的 `role` 写入 task；resolved model（pinned **或** parent inherit）必须在**第一次** `updateInvocation` 之前就在 `task.model` 上（现状 `prepareSubagentBatch` L3996–3999 已做 inherit，补测：scheme 未钉 + 父有模型 → invocation.model 非空） |
| `subagent-orchestrator.ts` `updateInvocation` | 抄 `task.role` |
| `session-summary-map.ts` | 投影 `subagentRole` |
| `subagent-run-store.ts` | manifest 读写 `role`（已有 model） |
| `subagent-reconciliation.ts` | 恢复时保留 role / model |

### 3.5 Desktop

| 文件 | 改动 |
|------|------|
| **新建** `subagent-identity-chip.tsx` | `SubagentRoleChip` + `SubagentModelChip`；吃 `role?` + `ModelRef?` + locale + model options |
| **新建** `subagent-identity-chip.test.tsx` | 有 model 显示 label+icon；无 model 显示 resolving；role 优先于 profileId |
| `subagent-invocation-block.tsx` | 用芯片替换两行 muted text；`role` 取 `invocation.role ?? child.subagentRole`，profile 仅作 fallback |
| `subagent-session-dialog.tsx` | header 同一套芯片 |
| `OrchestrationSchemeControl.tsx` | 未钉模型 hint |
| `styles/region-transcript.css` / `subagent-session-inspector.css` | 芯片布局：图标 14px、不挤压 title |

复用：`ProviderIcon`、`buildEnabledModelOptions`。**禁止**在 invocation-block 里再手写一套模型名映射。

### 3.6 测试

- contracts：task/invocation 带 role 的 round-trip。
- host-runtime：Ultra Code 未钉模型 → invocation.model === 父 session model；钉死 member.model → 用 member。
- host-runtime：`role: searcher` 出现在 invocation 与 session summary。
- desktop：block 在无 child、仅有 invocation.model 时就能看到芯片（覆盖 starting）。
- desktop：hint 仅非 Off + 默认 member 无 model。

### 3.7 Phase A 验收

1. 选 Ultra Code 发送后，inline 卡片在「正在启动 / 工作中」就能看到实际模型芯片（图标+可读名）。
2. 异构编队两个并行 child 的模型一眼可分。
3. 卡片 meta 显示 `searcher` 而不是 `explorer`（有 scheme 时）。
4. Off 路径不出现方案 hint；行为与今日一致。
5. Inspector 头与卡片同一套身份。

---

## 4. Phase B — 编排回执（Scheme Run Receipt）

> 对应评审 P0-1。解决「选了方案也感觉不到值不值」。

### 4.1 产品形态

父 turn 的工作详情区（`turn-work-details.tsx`）在本 turn 至少有一次 subagent 调用时，追加一块 **编排回执**（scheme 开或 Off 都显示——Off 时标题用「本轮子代理」，有 scheme 时用方案名）：

```text
编排 · Ultra Code                         3 个子代理 · 42s · 18.4k tokens
  searcher  DeepSeek V4 Flash   12s   4.1k   完成
  coder     Grok 4.5            21s   9.8k   已集成
  reviewer  GPT-5.6 Luna         9s   4.5k   完成
```

数字来自已有 `usage/update`（`assistant-usage` / `host-estimate`）。某 child 没有 usage 时该行 token 显示 `—`，不编造。

### 4.2 合同

新文件或扩 `packages/contracts/src/subagent-orchestration.ts`：

```ts
export type SubagentTurnReceiptRow = {
  invocationId: string;
  childSessionId?: string;
  role?: string;
  profileId?: string;
  model?: ModelRef;
  status: SubagentInvocationStatus;
  durationMs?: number;
  usage?: Pick<UsageBucket, 'promptTokens' | 'completionTokens' | 'totalTokens'>;
  integrationStatus?: SubagentIntegrationStatus;
};

export type SubagentTurnReceipt = {
  parentSessionId: string;
  parentRunId: string;
  schemeId?: string; // omit when Off
  schemeName?: string;
  rows: SubagentTurnReceiptRow[];
  totals: { childCount: number; durationMs?: number; totalTokens?: number };
};
```

HostPush 新变体或挂在现有 `subagent/invocation-updated` 旁：`subagent/turn-receipt`（父 run 终结时发一次；运行中可用同一通道增量更新 totals）。**不要**把账单写进用户 transcript。

### 4.3 Host

- 每个 child 的 `usage/update` 已按 `sessionId` 进 ledger（`recordUsageToLedger`）。
- 新增聚合：`parentRunId` → 其 descendant child sessionIds（invocation 已有 `parentRunId`）→ 按 session 滤 ledger / 内存 usage 快照。
- 聚合器保持纯函数：`buildSubagentTurnReceipt(invocations, usageBySessionId, scheme?)`，单测覆盖缺 usage、缺 role、混合完成态。
- 落点：`packages/host-runtime/src/subagent-turn-receipt.ts`（新文件，避免再涨 `host-runtime.ts`）。

### 4.4 Desktop

- `turn-work-details.tsx` 订阅 receipt；行点击仍打开既有 inspector（ADR 0046 锚点不变）。
- CLI：本阶段仍可只打一行文本摘要（ADR 0046 已承认 CLI 降级）；不要为此上新 TUI。

### 4.5 验收

1. 一次 Ultra Code turn 结束后，回执行数 = 实际 spawn 的 invocation 数。
2. 有 usage 的 child 显示 token；没有的显示 `—`。
3. Off 时若主代理仍派了子代理，回执仍出现（无方案名）。
4. 刷新 / 重连后能从 invocation + ledger 重建（不依赖当场 push）。

---

## 5. Phase C — 报告契约（Report Contract）

> 对应评审 P0-3。兑现「只回蒸馏结论」。

### 5.1 合同

`OrchestrationSchemeMember.reportContract?: string`

- 非空纯文本；Settings 成员行可编辑（textarea，必填校验可后置，空 = 不注入）。
- Ultra Code 内置 searcher 给默认契约（英文，稳定，便于模型遵守），例如：

```text
Return a dense evidence report only:
- Findings: numbered facts with file:line citations
- Dead ends: searches that found nothing (one line each)
- Open questions: at most 3
Do not edit files. Do not restate the whole file.
```

### 5.2 Host

- `buildSubagentSeedPrompt`（或 blueprint 尾部）在 scheme 激活且 member 有 contract 时追加：

```text
[piwin-report-contract]
<contract>
Your last assistant message must follow this contract. The parent only reads that message.
```

- `build-subagent-merge-summary.ts`：优先取最后一条助手消息；若能识别契约段落则整段回传（仍受现有上限约束，但**不要先砍掉 Findings 标题后的内容**——截断从死路/开放问题砍起）。无契约则保持今日截断。

### 5.3 Settings

`orchestration-scheme-editor.tsx` 成员表加一列/折叠「回报格式」。Ultra overlay 可改、可 Reset。

### 5.4 验收

1. Off：seed 无 contract 块。
2. Ultra Code：child 首条用户消息含 contract。
3. merge 摘要以 Findings 开头的夹具不被 4k 上限从头部截断。
4. 用户改 overlay 后，下一条（不是当前 run）生效。

---

## 6. Phase D — 有界 fan-out

> 对应评审 P1-5。对标 Codex `spawn_agents_on_csv` / Claude workflow 的最高频用例。**不是**脚本运行时。

### 6.1 工具

`piwin_subagent_fanout`（仅 SDK/自定义工具路径；与 `piwin_subagent_run` 并列注册）：

```ts
{
  role?: string;          // scheme 激活时首选；否则 defaultRole / explorer
  items: string[];        // 每项一个独立 scout 任务（路径、URL、问题…）
  sharedBrief?: string;   // 所有 child 共享的上下文前缀
}
```

约束：

- `items.length` ∈ [1, `min(scheme.maxTasksPerRun, global, 8)`]；超长 **reject**，不静默截断。
- 全部同一 role / 同一 resolved model。
- 复用 `SubagentOrchestrator.startBatch`（已有并发）；scheme admission 按 item 计数。
- 同步工具：等齐再返回一条聚合结果（每 item：status + summaryPreview + childSessionId）。
- Desktop：父 transcript 仍按 **每个 child 一张** inline 卡片（每个 item 一个 `parentToolCallId` 或 fan-out 下一组 invocation）。不要合成一张假卡片。

### 6.2 不做

- `dependsOn` 图在模型侧暴露（plan 路径继续用）。
- JS/工作流脚本、暂停/恢复 runtime（Claude workflows 那套后置观察）。
- Off 时禁止 fan-out？**不禁止**——Off 仍可用，只是没有 roster 纪律；items 上限走全局 cap。

### 6.3 验收

1. 5 个文件路径 fan-out → 5 个 child + 1 条聚合 tool result。
2. 9 个 item → 明确错误，0 spawn。
3. 回执（Phase B）把 5 行都算进去。
4. 卡片上各自模型芯片正确（Phase A）。

---

## 7. Phase E — 异构编队产品化

> 对应评审 P1-6。把「跨 provider 混编」从能配变成开箱。

### 7.1 内置第二方案

`id: review-council`（kebab，合法 scheme id）

| role | 默认 | 说明 |
|------|------|------|
| `searcher` | explorer / readonly / low / **不钉模型**（hint 走 Phase A） | 便宜探子 |
| `oracle` | reviewer / readonly / medium+ / **不在代码里写死第三方 model id** | 深度审查；Settings 强提示「请钉一个更强的已配置模型」 |

`systemPreamble`：主代理综合；searcher 广搜；需要设计/风险判断再派 `oracle`；等齐；trivial 不派。

`DEFAULT_ORCHESTRATION_ROLE_TEMPLATES` 增加 `oracle` 种子。

### 7.2 UI 文案

下拉描述直接写混编策略，例如：

> Review Council — 便宜探子搜集证据，强模型只读会审（请为 oracle 指定模型）

Ultra Code 描述保持 scout pack，避免和 Claude `ultracode` 叙事纠缠；本阶段**不改名**（评审 P2）。

### 7.3 验收

1. 下拉出现 Review Council；Off 仍置顶。
2. 未钉 oracle 模型时，Phase A hint 出现在 oracle（默认 role 若是 searcher，hint 仍说 searcher；额外：oracle 无模型时 Settings 行标黄）。
3. 不引入新 provider / 不写死 `gpt-…` id。

---

## 8. Phase F — 预算护栏

> 对应评审 P1-7。**依赖 Phase B** 的 usage 聚合。

### 8.1 合同

`OrchestrationSchemeSettings.maxTotalTokens?: number`

- 仅估算/计量到的 `totalTokens` 之和（child + 本 turn 父，或仅 child——**锁死为 child only**，父思考是用户自己选的 thinking 档，方案不抢）。
- Settings 数字框；空 = 不限制。

### 8.2 Host

`orchestration-scheme-admission.ts` 增加 token 维：

- `admit` / `wait` / `reject` 之外，`reject` 原因 `scheme token budget exhausted`。
- 工具结果给主代理：已用 / 上限 / 建议自己完成剩余。
- 并发 wait 不消耗预算；只有 **started** child 的已记录 usage 计入。无 usage 的 running child **按 0 计**（诚实：宁漏限，不瞎估阻塞）。

### 8.3 验收

1. 预算 1、第一个 child 已报 2k → 第二个 spawn 被拒，第一个不受影响。
2. Off 无预算字段逻辑。
3. 回执 totals 与 gate 使用同一聚合函数。

---

## 9. 文件地图（按阶段）

| Phase | 新建 | 改 |
|-------|------|----|
| A | `apps/desktop/src/subagent-identity-chip.tsx` + test | `contracts` TaskSpec/Invocation/Summary；`host-runtime` prepare/seam；`subagent-orchestrator`；`session-summary-map`；`subagent-run-store`；`subagent-invocation-block`；`subagent-session-dialog`；`OrchestrationSchemeControl`；相关 CSS |
| B | `packages/host-runtime/src/subagent-turn-receipt.ts` + test | contracts HostPush / 类型；`host-runtime` 终结钩子；`turn-work-details.tsx`；`apps/desktop` 轻量 i18n |
| C | — | `orchestration-scheme.ts` member 字段 + Ultra 默认；`subagent-lifecycle-service` seed；`build-subagent-merge-summary.ts`；scheme editor |
| D | `packages/host-runtime/src/subagent-fanout-tool.ts` + test | `build-session-host-tools.ts`；admission 按 item；Desktop 多 invocation 绑定（应已由 A/0046 支撑） |
| E | — | `BUILTIN_*` 常量、role templates、scheme list 文案、editor 黄标 |
| F | — | scheme settings 字段；`orchestration-scheme-admission.ts`；Settings 数字框 |

`host-runtime.ts` 已很大：**禁止**把 receipt / fan-out 逻辑继续堆进去，只留接线。

---

## 10. 明确不做（本计划全文）

- Agent teams / 子代理互发消息 / 共享任务表。
- 流程图编排器、方案市场、project 默认方案。
- 按复杂度自动开方案。
- 运行中 live-steer、per-child cancel 独立按钮（P2；取消仍走现有 batch/parent abort）。
- Claude 式 workflow JS runtime、prompt-cache 错峰（P2）。
- 把 preamble 写进用户气泡。
- 为显示模型而再造一套图标库（用 `ProviderIcon`）。

---

## 11. 文档同步

- 落地 A 后：本计划勾选进度；v2 spec 加「invocation 必须带 resolved model + role」。
- 落地 B 后：`docs/specs/orchestration-scheme.md` §3 竞品表换成评审笔记 §3（过时）。
- 不新开 ADR，除非 HostPush 身份模型要改（B 的 `subagent/turn-receipt` 若被反对，可改挂在 `session/prompt` 完成推送的附属字段，避免新 push 族）。

---

## 12. 建议实施顺序（给执行会话）

1. **先做 Phase A**（用户刚点名的模型可见 + role 徽标 + 未钉提示）。小、可独立验收、立刻改善「编队感」。
2. Phase B 回执。
3. Phase C 契约（提升 scout 质量，和可见性正交）。
4. 再评估 D/E/F 是否同一条竖切；D 工作量最大。

---

## 13. Phase A 执行清单（下一会话可直接开工）

- [x] contracts：`role` 上 TaskSpec / Invocation / Result / SessionSummary
- [x] Host：scheme role 写入 task；invocation/summary 投影 role + resolved model
- [x] Desktop：`subagent-identity-chip`；invocation block + inspector
- [x] Composer：未钉模型 hint
- [x] `pnpm` 相关包 typecheck + 单测
- [ ] 手动：Ultra Code 未钉模型 → 卡片显示主模型名；钉便宜模型 → 卡片显示该模型
