# Spec — Fusion 编排方案（中文）

| 字段 | 值 |
|------|-----|
| 状态 | 草案，待实现 |
| 日期 | 2026-09-18 |
| 产品入口 | Composer「编排方案」下拉第三项：**Fusion** |
| 方案 id | `fusion` |
| 依赖 | [编排方案](./orchestration-scheme.md)、[ADR 0030](../adr/0030-safe-parallel-subagent-execution.md)、[子代理档案](../adr/0030-safe-parallel-subagent-execution.md) |
| 对照 | Devin Fusion（Cognition，2026）；不是 Ultra Code，也不是 Reviewed Delivery |

> 本文件是 Fusion 的中文设计说明，给人审、给实现对照。注入模型的 preamble / reportContract **仍用英文**（与 Ultra Code、Reviewed Delivery 一致），避免主模型纪律和现有方案分裂。

---

## 0. 一句话

**Fusion 不是再开一套调度器，也不是「多个子代理开会」。**  
它是：用户对着 **Lead（当前会话的前沿模型）** 说话；Lead 只做计划、解释歧义、终审；机械实现丢给 **一条可复用的便宜 Sidekick 子会话**；两边 **只交换 brief 和 result**，永远不传完整对话历史。

和现有两套内置方案的分工：

| 方案 | 解决什么 | 角色 |
|------|----------|------|
| Ultra Code | 主上下文腐烂 | 只读 `scout` 扇出探路 |
| Reviewed Delivery | 合入质量 | `worker` 出候选 + `reviewer` 结构化裁决 |
| **Fusion** | **降本且不掉智** | 父会话 = Lead；唯一 child = `sidekick` |

---

## 1. 必须遵守的十条（硬约束）

实现时每一条都要能指出「代码哪一处保证」，不能只写在提示词里。

### 1. 永远不在模型之间传完整对话历史

只传 **brief**（任务范围 + 约束 + 成功标准）和 **result / feedback**。

这是 Fusion 降本且不掉智的第一原理：

- Advisor / Smart Friend 把整段上下文重送给另一个模型 → 缓存全灭，贵。
- Fusion 让 Lead 和 Sidekick **各自长自己的缓存**；交接只有短 brief / 短 result。

本仓对应：

- 子会话 seed **不得**拷贝父 transcript（现有 `prepareSubagentTask` 已是 task 文本，回归测试锁死）。
- Fusion 下 Host 再包一层 brief 信封，写明隔离。
- `piwin_subagent_wait` 只回流 `summaryPreview`（Result），不回流 child 工具轨迹。
- Lead 若把整段对话粘进 `task`，信封挡不住恶意粘贴，但 preamble 禁止；Host 不把父消息当第二参数。

### 2. Lead 始终握有计划、歧义解释、终审

Sidekick 默认 **执行 + 回报**，不是自己拍板。

- 父会话 / composer = Lead，**不是** child role。
- Sidekick 回报首行只能是 `done` / `blocked` / `escalate`。
- `escalate` 或成员 `fallback: main` = Lead 收回自己做。
- 不另设 reviewer 角色（那是 Reviewed Delivery）。

### 3. 「判断即交付物」禁止下放到便宜模型

官方反例：跨团队搜索栏 React/Redux 功能，成本降 28%，分数从 **54 掉到 27**。

- 架构选择、交互争议、需求含糊、API 形状未定 → Lead 自己做。
- 机械重构、按已定接口改文件、跑已有测试、修明确报错 → 可以给 Sidekick。
- Host **不能**自动分类题型，不假装有 Cognition 的分类器。纪律写在 preamble。

### 4. 动态升级 / 降级只发生在「反正要 cache miss」的边界

官方挂在 **context compaction**，不是每个 turn 换模型。

本仓这一轮：

- Fusion 选中期间 **配对粘住**：Lead = 当前会话模型；Sidekick = 方案成员钉的模型（或继承，不推荐）。
- **不**每个 turn 换模。
- compact 时给 Sidekick 换模 = 后续钩子（现有 `SessionCompactionRecord` 没有换 child 模型的 API）。**本文件不声称已经做了。**

### 5. 评估指标是 price-per-task，不是 price-per-token

更强的 Lead 或更强的 Sidekick 都可能让 **整单更便宜**，因为返工轮次下降。

- 本轮 **不做**费用看板。
- Settings 里 Sidekick 不钉便宜模型 → 继承主模型价位。Composer 已有 unpinned 提示，保留：这通常是更差的 price-per-task。

### 6. 写操作尽量单线程

额外代理优先贡献 **智力**（探索、审查、对比），而不是同时写同一工作树。

- Fusion：`maxConcurrency: 1`，唯一 writer = sidekick。
- 只读扇出走 Ultra Code，不要塞进 Fusion。
- 阶段依赖走 SessionPlan / executing-plans，不要让 Lead 口头催多个 writer。

### 7. 子代理必须有 profile，禁止在 prompt 里点名模型

Profile 管：模型、工具白名单、是否可写、是否可嵌套。

- Fusion `sidekick` → 档案 `implementer`（worktree），Settings overlay 可钉 `member.model`。
- `exposeSpawnMetadata: false`：模型不能在 spawn 参数里乱填。
- roster 在 `exposeSpawnMetadata === false` 时 **不得打印** `providerId/modelId`。
- Fusion sidekick **去掉 `delegate` 能力**，禁止再派子代理。

前台 / 后台：本仓用 `piwin_subagent_start`（先派后干）+ `piwin_subagent_wait`（汇合），不新增 profile 字段。

### 8. 扇出 + 汇总 / 阶段依赖，不要用协调者口头催娃

那种编排用 **确定性脚本（Dynamic Workflows）+ 结构化 schema**。

- Fusion **不是** Workflows。
- 本仓已有 SessionPlan + `executing-plans` / 子代理执行。Fusion preamble 禁止把 `start` 当 map-reduce。
- **本轮不造** Python/TS 工作流 DSL，也不做 prompt 哈希缓存。

### 9. 隔离级别必须写清楚

| 级别 | 含义 | 本仓 |
|------|------|------|
| 同会话双车道 | 一个运行时里两条 agent loop | **没有，本轮不做**（要动 Pi 内核） |
| 同机独立对话链 | 父子会话、各自 transcript | **Fusion 落在这一层**：一条可复用 Sidekick 子会话 |
| 独立 VM | Managed Devin | 没有；worktree 只隔离写入 |

每个 brief 必须写清：**你看不到父上下文。这份 brief 就是全部任务。**

产品可以叫 Fusion；spec 和代码注释 **不准**写成 same-session dual-loop。

### 10. 可恢复性不靠协调者记忆

官方 Workflows 靠 prompt + schema + 执行设置的哈希。Fusion 本轮对应：

- retained worktree
- Sidekick 自己的 transcript（它的缓存）
- `continuationSessionId` 续同一条 lane

不做工作流哈希缓存（那是原则 8 的东西）。

---

## 2. 用户怎么用

1. Settings → 子代理编排：可 overlay Fusion，给 `sidekick` **钉一个更便宜的模型**。
2. Composer 编排方案选 **Fusion**（或 `/fusion`、`/scheme fusion`）。
3. 发送。本条才注入 Fusion 纪律。Off 时与今天 bit-identical。
4. 用户只跟 Lead 说话。Sidekick 出现在父消息里的子代理卡片，不进主会话列表。
5. 切会话 / New Agent → 下拉回到 Off（编排方案既有规则，不改）。

不设为默认、不跨会话记住。

---

## 3. 方案配方（实现锁死）

| 字段 | 值 |
|------|-----|
| `id` | `fusion` |
| `name` | Fusion |
| `source` | builtin（不写入默认 `config.json`） |
| `defaultRole` | `sidekick` |
| `defaultProfileId` | `implementer` |
| 成员 | 仅 `sidekick` 一个 |
| `isolation` | `worktree` |
| `fallback` | `main` |
| `exposeSpawnMetadata` | `false` |
| `waitPolicy` | `await-all`（现有 Host 已强制） |
| `maxConcurrency` | `1` |
| `maxTasksPerRun` | `8` |
| thinking 上限 | 不另钳（不要套 Ultra Code 的 low） |
| 模型 | 方案 **不硬编码** provider；overlay `members[].model` |

Lead = 当前会话模型，不是 roster 里的角色。

### 3.1 Sidekick 回报合同（模型英文，语义如下）

最后一条助手消息：

```text
done | blocked | escalate
- 摘要
- 改动路径
- 检查：命令 / 退出码
- 残留风险
- 若 escalate：原因
```

### 3.2 Brief 信封（Host 包，不靠模型自觉）

Host 在 Fusion + role=sidekick 时包裹任务文本，大意：

- 隔离：cli-subagent lane（独立子会话，不是父会话里的第二条 loop）
- **你看不到父对话**
- 这份 brief 是全部任务
- 然后才是 Lead 写的 goal / scope / constraints / success_criteria

续跑同一条 lane 时：只追加新 brief，**不再**把父历史灌进去。

---

## 4. 持久 Sidekick lane（相对「只加 preamble」多出来的部分）

只加提示词、每次 `start` 都新建 child，Sidekick **自己的 prompt cache 也没有**，原则 1 不成立。

Host 行为：

1. 本父会话已有 `subagentRole=sidekick` 且 retain worktree、还能续的 child → 设 `continuationSessionId`，走现有续跑路径，**不**绑定 Reviewed Delivery 的 review。
2. 否则新建 worktree child，`retainWorktree: true`。
3. `maxConcurrency: 1`，不会两个 writer 抢同一棵树。
4. 子会话自己的 transcript 作为它的缓存；Lead 仍然只看见 Result。

这是「同机独立对话链 + 复用」，对标开源 Fusion 的 `fusion_delegate` 复用同一 child，**不是** Devin 进程内双车道。

---

## 5. 和现有代码的衔接（改什么、不改什么）

**用现成的：**

- 编排方案 opt-in、Composer 下拉、`listOrchestrationSchemes`
- `piwin_subagent_start` / `run` / `wait` / `cancel`
- Profile `implementer`、worktree、admission 并发
- 子会话 index 上的 `subagentRole`、`subagentRetainWorktree`
- `continuationSessionId`（今日只给审查续跑用；Fusion 续 lane **不**要 `reviewOf`）

**本轮要加：**

- `BUILTIN_FUSION_SCHEME`（独立文件，勿把 `orchestration-scheme.ts` 堆过 1000 行）
- brief 信封纯函数 + 隔离句
- roster：`exposeSpawnMetadata === false` 时隐藏模型 id
- Host：Fusion sidekick 去 `delegate`、lane 复用、回归「父 transcript 永不进 seed」
- `/fusion` slash、builtin reset 覆盖 fusion、prompt-system 中文对照

**本轮不做：**

- 同一个 Pi 会话里跑两条模型 loop
- compact 分类器换模
- 剥夺 Lead 的写工具（官方允许收回自己写；剥掉就收不回）
- Dynamic Workflows DSL / prompt 哈希
- price-per-task 看板
- 把 scout / reviewer 塞进 Fusion roster

---

## 6. 实现切片（与 SessionPlan 对齐）

1. **Spec**：本文 + ADR 0030 短附录（Fusion 是方案，不是第二套 Orchestrator）。
2. **contracts**：`orchestration-scheme-fusion.ts`、列表顺序 `ultra-code` → `reviewed-delivery` → `fusion` → 用户方案、单测。
3. **Host**：信封、去嵌套、持久 lane、单测。
4. **桌面 / 文档**：`/fusion`、Settings 重置所有 builtin、`prompt-system.md` 中英对照。

验证：`@piwin/contracts` 与 `@piwin/host-runtime` 相关 vitest 绿；slash 解析 `/fusion` → scheme `fusion`。

---

## 7. 反模式（看到就停）

- 把父会话全文当 Sidekick 的 system / seed
- 每个机械步骤都新开一个 child（拆掉 Sidekick 缓存）
- Fusion 里并行多个 worktree writer
- 在 preamble 里写死「用 gpt-x / claude-y」
- 把含糊的产品功能丢给便宜模型然后说「节省了 token」
- 声称已经做了 compaction 换模或同会话双 loop
