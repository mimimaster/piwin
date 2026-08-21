# Note — 编排方案（Orchestration Scheme / Sub Agent 编排）功能评审与业界对照

| Field | Value |
|-------|-------|
| Date | 2026-08-19 |
| Kind | Research note / feature review（非 spec，不含实现承诺） |
| Scope | `docs/specs/orchestration-scheme.md`（v1）+ `orchestration-scheme-v2-enhancement.md`（v2）+ 底层 subagent 栈 |
| Inputs | 代码盘点（contracts / host-runtime / desktop）、ADR 0030/0046、repair & hardening plans、业界公开资料（2026-08） |
| Follow-up | 实施计划：[2026-08-19-orchestration-scheme-visibility.md](../plans/2026-08-19-orchestration-scheme-visibility.md)；用户追加：子 Agent 工作 UI 必须清楚显示正在用的模型 |

---

## 1. 一句话结论

> 架构与工程安全性在业界第一梯队，per-send opt-in 的产品形态是真差异化；短板不在「编排能力」本身，而在**回报可见性**（用户感知不到方案赚了/花了什么）、**结果回流质量**（截断式摘要）、**规模化场景缺一层**（有界 fan-out），以及**跨 provider 异构编队这个天然优势没有被产品化放大**。

---

## 2. 现状盘点（已验证）

### 2.1 已落地能力

| 层 | 能力 | 落点 |
|----|------|------|
| 交互 | Composer 下拉 per-send opt-in；Off 零注入 bit-identical；切会话回 Off；unknown id fail-closed | `OrchestrationSchemeControl.tsx`、`resolveOrchestrationScheme` |
| 方案对象 | 纪律 preamble + role 编队（role/description/profileId/model/thinking/isolation/fallback）+ 并发/思考上限 + 软泛型 | `contracts/src/orchestration-scheme.ts` |
| Host 执行 | roster 注入 model-facing prompt（transcript 隔离）；`role → member` 解析；spawn 前不可用 fallback（`main`/`none`）；turn-scoped 并发闸门 | `orchestration-scheme-admission.ts`、`host-runtime.ts` |
| Settings | 完整方案编辑器（成员 CRUD / 校验 / builtin overlay / clone） | `settings/orchestration-scheme-editor.tsx`（898 行） |
| 底层 | worktree 三方合并保父 index、冲突保留、取消安全 FIFO、清单持久化+崩溃恢复、depth=1、无隔离时诚实降级并发=1 | ADR 0030、subagent production hardening |
| UI | inline invocation block + 子会话 inspector（同主渲染器）；完成后 continue；worktree apply/retain/discard | ADR 0046 |
| 验证 | 跨模型编队 E2E 已过：DeepSeek 主 + Grok coder + Luna reviewer，worktree 集成+审查闭环 | `2026-08-11-subagent-orchestration-repair.md` |

### 2.2 关键实现事实（影响后续建议）

1. `piwin_subagent_run` 是**同步单任务**（spawn→wait→merge 一次工具调用）；并行 = 模型在一条消息里发多个并行 tool call，由 scheme 闸门限流。异步 batch（`dependsOn`/`failurePolicy`/并发调度）只存在于 Host 命令面（plan 执行在用），**模型侧不可用**。
2. 回流给父的是**流式助手文本的截断**（worker 12k 字符、merge 卡 4k），无结构化报告契约，无二次蒸馏。
3. `role` 不落在 `SubagentTaskSpec` 上——UI 只能显示 profileId，事后看不出「这是 searcher 还是 reviewer」。
4. 子代理 token/成本用量不聚合、不展示；一个 turn 的编排「回执」不存在。
5. 运行中的 child 不可干预（不能追加指示；取消走 batch 粒度）；完成后才能 continue。
6. Off 状态下并行 spawn 没有 turn 级计数闸门（只有全局/资源协调器上限）——与「Off=自由」一致，但注意与 scheme 态的不对称是有意的。
7. CLI 忽略 `subagent/stream` 推送（ADR 0046 已记为有意降级）。

---

## 3. 业界坐标（2026-08，替代 v1 spec §3 过时表）

| 产品 | 形态 | 与 piwin 对照 |
|------|------|----------------|
| **Claude Code** | 四原语：subagents（嵌套至 3 层）/ agent view（后台会话面板）/ agent teams（实验：lead+teammates、共享任务表、互发消息）/ **dynamic workflows**（模型写 JS 编排脚本、运行时后台执行、可暂停恢复、逐 agent token 计量、prompt-cache 感知的错峰 fan-out）；`/effort ultracode` = xhigh + 自动 workflow | 官方框架是「**who holds the plan**」：turn-by-turn（subagents/teams）vs 计划进代码（workflows）。piwin 只覆盖前者。workflows 的**可恢复 + 逐 agent 计量 + cache 错峰**是 piwin 没有的工程点。注意 Claude 的 `ultracode` 与 piwin「Ultra Code」同源不同义，用户两边都用时有混淆风险 |
| **Codex CLI** | Multi-Agent V2：`[agents]` 配置（max_threads=6/max_depth=1）+ `.codex/agents/*.toml` 自定义角色（model/effort/sandbox/MCP）+ `spawn_agents_on_csv` 批量 fan-out + `hide_spawn_agent_metadata`（**默认 true**）+ `/agent` 线程查看/停止 | piwin 的软泛型 = Codex 该默认值的产品化；piwin 把三份手拼配置收成一个方案对象，交互优于 Codex。Codex 领先点：**CSV fan-out**（结构化批量）与线程级查看/停止 |
| **Roo / Kilo** | Orchestrator 模式（boomerang）：`new_task` 派给其他 mode，子任务隔离、`attempt_completion` 回摘要 | 已知痛点（#3400）：orchestrator 看不到各 mode 能力描述。piwin roster 注入 description 恰好解掉这个问题——现有设计正确 |
| **Amp** | 泛型 mini-agent 子代理 + **oracle**（异构强模型做深度推理/审查，独立上下文）+ orbs 远程机 | oracle 是「花小上下文租一个更强大脑」的产品化。piwin 的 member.model 机制天然支持，且**跨 provider**（Amp oracle 固定 GPT 系）——piwin 没把这个讲出来 |
| **opencode** | primary/subagent 两态 agent，markdown 文件定义，`@` 手动点名，内置 explore 子代理带 thoroughness 参数 | 文件化定义可分享/进 git；piwin 方案锁在 `~/.piwin` settings，无导入导出 |
| **通用最佳实践**（Anthropic 生产系统、CodeDelegator 论文等） | 编排 ≈ **15x token 成本**，并发 3–5 收益峰值；**结果压缩协议**（限定 schema/字数）比自然语言摘要可靠；最小任务规模（不值 5k token 开销的不派）；逐 agent 计量与关联 ID 追踪是可调试性底线 | piwin 纪律文案已含「trivial 不派」；缺的是**结果 schema** 与**计量**两件硬事 |

---

## 4. 评价

### 4.1 做对了的（护城河，不要动）

1. **Per-send opt-in + Off bit-identical** 是全场最干净的成本控制交互。Claude ultracode 是 session 级、Codex 是配置文件级，都容易「忘了关」。逐条消息明确授权 + 用户自担，与「编排 15x 成本」的行业共识完全匹配。
2. **方案 = 单一产品对象**（纪律+编队+边界一体）直接解掉 Codex「三份配置单改一处失效」的结构病，这是 spec §0 立项判断，如今看仍然成立。
3. **工程安全性高于多数商业产品**：三方合并不动父 index、冲突 worktree 保留、取消有 commit-point、清单可恢复、无隔离诚实降级。这些在 Claude teams（不隔离 worktree、resume 有已知问题）身上都是反例。
4. **role+description 注入 roster** 提前避开了 Roo 的调度盲区问题。
5. **Host 权威 → Desktop/CLI 同语义**：方案是 Host 解析的，任何 shell 一致。竞品配置基本绑定单一 CLI 安装。

### 4.2 差距（按影响排序）

| # | 差距 | 后果 |
|---|------|------|
| G1 | 无编排回执/计量：用户选了 Ultra Code 也看不到「派了几个、每个花多少 token、省没省」 | 功能收益不可感知 → 激活率低 → 「我没主动用过类似功能」的根因，业界（Claude workflows 逐 agent 计量）已把这做成标配 |
| G2 | 回流 = 截断，不是契约化报告 | scout 报告质量随机；违背「结果压缩协议」最佳实践；4k/12k 截断可能砍掉结论 |
| G3 | 模型侧无有界 fan-out | 「审计 300 个文件」这类最能体现编排价值的场景做不了；基础设施（orchestrator dependsOn/failurePolicy）已存在却只服务 plan |
| G4 | 异构编队没有产品叙事 | 跨 provider 混编（已 E2E 验证）是 Claude/Codex 结构上做不到的事，目前只是「可以配」，不是「一眼看到的特色」 |
| G5 | role 不持久化、child 不可干预、CLI 无进度 | 观察性/操控性弱于 Codex `/agent` 与 Claude agent view |
| G6 | Ultra Code 省钱依赖用户自己钉便宜模型，无引导 | 首次体验 = 子代理与主模型同价，「省额度」承诺落空（spec §8.8 只有 host/log warn） |

---

## 5. 建议（P0 → P2）

### P0-1 编排回执（Scheme Run Receipt）

Turn 结束后在工作详情区显示本 turn 编排账单：每个 child 的 role/模型/时长/token（Pi usage 事件已有，聚合到 run）+ integration 结果。这是把「编排值不值」从玄学变成数字的唯一路径，也是 G1 的直接解。落点：agent-host usage 归一化 → run 聚合 → `turn-work-details.tsx`。

### P0-2 role 持久化 + 徽标

`role` 写入 task/invocation 投影，inline block 与 inspector 显示 `searcher`/`reviewer` 徽标而非 profileId。小改动，直接提升「编队感」。

### P0-3 结果回流契约（Report Contract）

`OrchestrationSchemeMember` 增加可选 `reportContract`（模板或字段清单），注入 child blueprint 尾部（「最后一条消息必须按此结构输出」）；merge 优先提取结构化尾部，截断只作兜底。对齐 CodeDelegator/结果压缩协议。这是提升 scout 报告密度、真正兑现「只回蒸馏结论」的关键一步。

### P0-4 未钉模型的 UI 提示

Composer 选中方案时 resolve 一次，若默认 role 无 pinned model → pill 旁一次性 hint（「searcher 未钉便宜模型，将继承主模型价位 → 设置」）。把 spec §8.8 的产品诚实从日志升级到界面。

### P1-5 有界 fan-out（不是流水线引擎）

新工具 `piwin_subagent_fanout`（或 scheme 开关 `allowFanout`）：`items[]`（≤ maxTasksPerRun）× 单一 role → 复用现有 orchestrator 批量执行 → 聚合报告一次性回父。对标 Codex `spawn_agents_on_csv` 与 Claude workflows 的最高频用例（按文件审计/迁移/大规模 grep 归纳），但**不做**脚本运行时、不做阶段机——与 v1/v2 non-goals 不冲突。基础设施已在，主要是工具面 + 闸门 + 回执整合。

### P1-6 异构编队产品化（最大的「特色」机会）

- 增加第二个内置方案（如 **Review Council**：`oracle` role 钉强模型 readonly + `searcher` 便宜探子），role 模板加 `oracle`（对标 Amp oracle，但跨 provider）。
- 文案直接讲「主便宜模型 + 关键位强模型」与「主强模型 + 探子便宜模型」两种混编策略——这是 Claude Code（Anthropic 系）与 Codex（OpenAI 系）结构上给不了的能力，且已有 E2E 背书。

### P1-7 预算护栏

Scheme 增加 `maxTotalTokens?`（估算即可）：admission gate 超预算停止 admit，并把「预算耗尽」作为工具结果告知主代理。与 P0-1 的计量同一套数据。业界「15x 成本」共识下，这是把 Ultra 系玩法交给用户前的安全带。

### P2（择机）

- **方案导入/导出**（单 JSON），后续可选 project 级*可用*方案文件（仅提供可选项，不自动启用，不违反「主动选择」）。
- **live-steer lite**：运行中 child 支持排队一条追加指示（作为其下一条 user message），或至少 per-child cancel。
- **cache 错峰**：同 profile 并行 scout 错峰启动以共享前缀缓存（Claude 做法，cap ~5s）。
- **命名评估**：「Ultra Code」与 Claude `ultracode`（现指 xhigh+自动 workflow）语义已漂移，观察用户混淆度再决定是否改名（如 Scout Pack）。
- v1 spec §3 竞品表按本文 §3 刷新。

### 明确不建议跟进的

- **Agent teams 式对等通信/共享任务表**：Claude 自己仍 experimental 且 resume/关闭行为有已知问题；单用户 shell 场景下 fan-out + 回执的收益/成本比远高于 peer messaging。观望。
- **流程图/阶段机编排器、方案市场**：维持既有 non-goal。
- **自动按复杂度启用方案**：维持否决；最多做「建议不启用」类的被动提示，且默认关。

---

## 6. 落点速查

| 建议 | 主要触点 |
|------|----------|
| P0-1 回执 | `agent-host`（usage 归一）、`host-runtime`（run 聚合/push）、`apps/desktop/turn-work-details.tsx` |
| P0-2 role 徽标 | `contracts/subagent.ts`（TaskSpec/invocation）、`subagent-invocation-block.tsx` |
| P0-3 报告契约 | `contracts/orchestration-scheme.ts`（member 字段）、child blueprint 组装、`build-subagent-merge-summary.ts` |
| P0-4 未钉模型提示 | `OrchestrationSchemeControl.tsx` + `config/get` resolve |
| P1-5 fan-out | 新 host tool + `subagent-orchestrator`（已有 dependsOn/failurePolicy）+ admission gate |
| P1-6 异构编队 | `contracts` builtin 常量 + role 模板 + Settings 文案 |
| P1-7 预算护栏 | `orchestration-scheme-admission.ts` + usage 数据 |
