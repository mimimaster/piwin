# Spec — Orchestration Scheme v2 功能修改 / 增强方案

| Field | Value |
|-------|-------|
| Status | Design for enhancement — builds on main v1, not greenfield |
| Date | 2026-08-07 |
| Base | [orchestration-scheme.md](./orchestration-scheme.md)（v1，已在 main 落地） |
| Article | 仓库根目录 [`拯救sol_ultra.md`](../../拯救sol_ultra.md) |
| Binding | AGENTS.md；contracts first；**保留** per-send opt-in / Off 零注入；Desktop/CLI 同 Host |
| Backlog prefix | ORCH-V2-* |

---

## 0. 本文定位

这是 **v1 已实现后的修改/增强方案**，不是推倒重写。

| 维度 | 做法 |
|------|------|
| 保留 | Composer 下拉、Off 默认、per-send、`PromptInput.orchestrationSchemeId`、Host 权威注入、builtin merge、软泛型执行路径、CLI `scheme` / `--scheme` |
| 增强 | **方案成员表（role）**、主纪律可编辑、Settings 真编辑器、spawn 点 `role`、不可用 fallback、Ultra Code 对齐文章 |
| 不改 | 主模型永远 = Composer 当前模型；流水线阶段图不写死；不跨会话默认方案 |

v1 一句话问题曾是：「有没有派发纪律开关」。  
v2 一句话问题是：「**选中方案后，主 agent 是否有一支可点名的编队（role+模型+描述），并按可编辑纪律自己编排任务**」。

---

## 1. v1 已实现盘点（增强基线）

### 1.1 已具备（必须保留）

| 能力 | 落点 |
|------|------|
| Per-send 方案 id | `PromptInput.orchestrationSchemeId` |
| Off / omit 零方案逻辑 | `resolveOrchestrationScheme` → `undefined` |
| 未知 id fail-closed | prompt 前校验 + `OrchestrationSchemeError` |
| 内置 Ultra Code merge | `BUILTIN_ULTRA_CODE_SCHEME` + settings 同 id 覆盖 |
| 模型侧 preamble 注入 | `mergeOrchestrationSchemeIntoPrompt`（transcript 不记纪律） |
| Turn-scoped 绑定 | `runOrchestrationSchemes` + terminate 清理 |
| Soft generic | `exposeSpawnMetadata: false` → force `defaultProfileId`、清 model、clamp thinking |
| 并发夹紧 | scheme vs 全局 `maxConcurrency` / `maxTasksPerRun` |
| Composer pill | `OrchestrationSchemeControl` + App 状态（切 session → Off） |
| Slash / CLI | `/scheme`、`/ultra-code`、`piwin scheme list\|show`、`chat --scheme` |
| Settings 只读列表 + 保存不丢 schemes | Subagents page |

### 1.2 v1 缺口（相对产品意图 + 文章）

| 缺口 | 影响 |
|------|------|
| 方案只有 **单一** `defaultProfileId`，无 **members[]** | 无法配置 scout/coder/reviewer 多角色与分模型 |
| Settings **不能**真正编辑纪律/成员（只读预览） | 「用户自己编排」落空 |
| 工具点名仍是 `profileId`，无产品级 **`role`** | 与 Claude `name` / Codex `agent_type` 不对齐 |
| Ultra Code ≈「单 explorer + 泛型 + preamble」 | 对齐文章「只读轻量探子」的**一半**；缺「便宜模型钉死」与「角色描述驱动调度」 |
| 无 spawn 前 **fallback** | 模型/role 不可用时行为未定义 |
| `waitPolicy` 名义存在、实质恒 `await-all` | 对用户无配置价值；应用纪律文案表达「等齐再干」即可 |

### 1.3 v1 对象（现状）

```text
OrchestrationSchemeSettings {
  id, name, description,
  defaultProfileId,           // 唯一工种
  allowedProfileIds?,
  exposeSpawnMetadata,
  maxConcurrency?, maxTasksPerRun?,
  waitPolicy,                 // MVP 恒 await-all
  maxSubagentThinkingLevel?,
  systemPreamble              // 主纪律（内置写死，用户难改 UI）
}
```

---

## 2. 产品决议（已与用户对齐，写入本增强）

1. **Ultra Code** = 产品**默认提供的可选内置方案**（对标 Codex/Claude 系 Ultra / max-effort 多代理特供），**不是**唯一方案形态；其它方案用户自建自编。
2. **Role** = 用户可增删改；新建必须写**工作描述**；默认模板：`scout` / `coder` / `reviewer` / `tester`（可映射现有 profile）。`searcher` 仅作为 Ultra Code 旧 overlay 的别名；资料收集类用户方案用 `researcher`，不要占用 scout。
3. **调用** = 主 agent 点 **`role`**（路径 A）；Host 解析模型/隔离/描述。
4. **流水线** = 主 agent 按任务动态推演；方案**不**写死 search→plan→code→review 状态机。
5. **Fallback** = 子 agent **spawn 前不可用** → 默认回退**主 agent 自己干** + 明确告知。
6. **主模型** = 永远 Composer 所选；方案不配置主模型。

---

## 3. 文章对照：Ultra Code 怎样才「合理有效」

依据 [`拯救sol_ultra.md`](../../拯救sol_ultra.md)。

### 3.1 文章核心论断

> Ultra 本身无罪；翻车来自 **子代理继承主模型 + 套娃派生 + 主代理不等待**。  
> 解药：子代理做成 **固定模板的只读轻量探子**（便宜模型 + low + 空上下文 + 单一模板泛型调用），并让 **等待成为纪律**。

三文件职责：

| 文章落点 | 职责 | v2 方案落点 |
|----------|------|-------------|
| AGENTS.md | 何时派、如何派、如何验 | `mainDiscipline`（可编辑；Ultra 内置默认文） |
| config.toml | 并发、协议、等待 | `maxConcurrency` + 同步 tool 等待 + 纪律中的 wait 条款；**不**虚构 Codex 全套协议 UI |
| agents/default.toml | 子代理模型与身份 | **`members[]`**（Ultra 默认至少 1 个 scout；用户方案可多 role） |

### 3.2 文章决策 → Ultra Code 内置配方（v2 写死默认，可 overlay 编辑）

| 文章决策 | piwin Ultra Code v2 | v1 已有？ |
|----------|---------------------|-----------|
| Ultra = 编排放大器，不是新模型 | 方案 opt-in + 注入纪律；主模型仍 Composer | 有 |
| 子代理 **便宜模型 + low** | member 可钉 `model`（用户在 Settings 选已配置便宜模型）+ `thinkingLevel: low` + scheme `maxSubagentThinkingLevel: low` | **半有**（thinking clamp 有；**模型钉死 UI/字段弱**） |
| **只读探子**，不改、不决策、不派生 | member `isolation: readonly`，capabilities 偏 read；depth 仍 1 | 有（explorer + depth） |
| **空上下文**（不 fork 父历史） | 保持 fresh child context | 有 |
| **泛型调用** `hide_spawn_agent_metadata` | `exposeSpawnMetadata: false`：主模型不填 model/thinking；点 `role` 或默认 scout | 有 soft generic |
| **并行后立刻 wait** | 纪律强制写清；`piwin_subagent_run` 同步已保证单次 wait | 有纪律 + 结构 |
| 并发 ~ 主+6 子 | `maxConcurrency: 6`（再夹全局） | 有 |
| 单改一处失效 | 纪律 + members + 并发同属一方案对象 | v2 补 members 后才完整 |
| 避免调度污染 | 纪律写清「实质调研/大搜索才派，别 trivial 全派」 | 应加强 preamble |

### 3.3 Ultra Code 在 v2 的产品定义（特供，但可编辑）

**定位**：内置「省成本、防腐烂的 scout 编排包」——主 agent（用户选的强模型 / 高 thinking）做综合与实现决策；子 agent 默认是 **`scout` 探子**（便宜、low、readonly）。不叫 searcher / researcher：前者过窄，后者留给用户自定义资料收集工种。

**不是**：强制多 role 流水线；不是 thinking 档位 Ultra。

**默合成员（建议）**：

| role | description（调度用，主 agent 可见） | 映射 | 默认约束 |
|------|--------------------------------------|------|----------|
| `scout` | 隔离上下文腐烂的只读探子：广搜、读大文件、并行核验、日志堆；只回高密度证据，不改代码、不做最终设计 | profile `explorer` | readonly；thinking ≤ low；**鼓励用户钉便宜 chat 模型** |
| （可选内置，默认关闭或注释）`reviewer` | 只读审查实现风险 | `reviewer` | readonly；thinking ≤ low/medium |

v2 **Ultra 最小有效集 = 1 个 scout 成员 + 强主纪律**（对齐文章「只有一种子代理模板 + 泛型」）。  
额外 role 用户可在 clone/编辑后加；**用户自建方案**才以多 role 编队为主叙事。

**内置主纪律（mainDiscipline）必须覆盖文章要点**（可中英，实现用稳定英文或 i18n）：

1. 本 turn Ultra Code 激活：积极把**会污染主上下文**的调研/广搜/核验委派给 `scout`。  
2. 子代理是探子：事实、路径、引用；不做最终产品决策。  
3. 并行派发后，**用工具等待结果**；在齐结果前不要自己重复同一广搜/乱改。  
4. 用返回摘要继续推理；不要重做 scout 已做的广搜。  
5. 调用时指定 `role: scout`（或方案默认 role）；**不要**自填昂贵 model/high thinking。  
6. 禁止套娃子代理（系统已限制 depth=1，纪律再强调）。  
7. trivial 单文件问题不必强行派子代理（防调度污染）。

**便宜模型**：  
文章 Luna 在 piwin **无同名模型**。产品诚实策略：

- Ultra 成员 `model` **默认空 = 继承父/全局 default profile 模型**（与现 builtin profile 一致）；  
- Settings 对 Ultra / scout 成员显示 **强提示**：「请为 scout 指定更便宜的已配置模型，否则子代理可能与主模型同价」；  
- **不**在代码里写死第三方模型 id。

### 3.4 文章「协议形态 / 等待边界」在 piwin 的翻译（避免空概念）

| 文章词 | piwin 现实 | v2 对用户怎么说 |
|--------|------------|-----------------|
| 协议形态 | 仅 SDK 自定义工具 `piwin_subagent_run`；无 Codex V2 path 全家桶 | 「委派工具 + role 点名」；高级项：`exposeSpawnMetadata` |
| 等待边界 | 单次 tool **同步** wait；方案级流水线靠主 agent | UI **不**卖复杂 waitPolicy；纪律写「等齐再继续」；类型可保留 await-all |
| fork_turns | 永不 fork 父历史 | 保持；文档写死 non-goal |

---

## 4. v2 目标功能形态

### 4.1 用户可见总览

```text
Settings → Subagents → 编排方案
  · Ultra Code（内置，可编辑 overlay / Clone）
  · 用户方案（CRUD）
  · 每方案：主纪律（折叠编辑）+ 成员表（role 增删）+ 并发等

Composer
  · 下拉 Off | Ultra Code | 用户方案…   （v1 保留）
  · 发送 → 本条按方案：纪律 + 成员清单注入；spawn 按 role 解析
```

### 4.2 方案 = 编队，不是阶段机

主 agent 典型行为（例子，非写死配置）：

1. 判断需要广搜/核验 → `role: scout` → 等摘要  
2. 主会话推理/规划（或再派用户自定义 `planner`）  
3. 需要实现 → `role: coder`  
4. 需要检查 → `role: reviewer` / `tester`  

顺序、是否跳过、是否并行，**全部主 agent 决定**；方案只提供 **谁可用、各用什么模型、纪律是什么**。

### 4.3 默认 role 模板（新建方案 / 空成员时的种子）

| role | 默认 description 要点 | 建议 profile | isolation |
|------|----------------------|--------------|-----------|
| scout | 隔离腐烂的只读探子，只回证据 | explorer | readonly |
| coder | 在隔离 worktree 实现 | implementer | worktree |
| reviewer | 只读审查正确性/风险 | reviewer | readonly |
| tester | 跑测与失败定位 | tester | worktree |

用户可改名、改描述、改模型、删除、新增（如 `planner`、`docs`）。

**新建 role 校验**：`role` id 合法 + **description 非空**（否则主 agent 无法调度，对齐 Claude）。

### 4.4 Settings 交互（相对 v1 只读的增强）

1. 方案列表：Ultra Code + 用户方案；Ultra 标「内置」。  
2. 选中方案 →  
   - **主纪律**：默认折叠，展开编辑，**失焦/防抖自动保存**（或显式保存，二选一；推荐防抖自动保存 + 保存中指示）。  
   - **成员表**：行 = role、description、model 下拉（已配置 models）、thinking、isolation、fallback、可选 profile 模板。  
   - **边界**：maxConcurrency、exposeSpawnMetadata、maxSubagentThinkingLevel。  
3. Ultra Code：  
   - **Edit** = 写入 `settings.schemes` 同 id overlay（source 显示 builtin+overridden）；  
   - **Reset to builtin** = 删 overlay；  
   - **Clone** = 新 id 用户方案。  
4. 全局 Profile 库仍独立；成员可「从 profile 导入」填充默认值，之后 member 字段可覆盖。

### 4.5 Composer / CLI（v1 壳保留，语义加厚）

- 下拉与 per-send **不变**。  
- 选中方案后，可选轻反馈：pill 副文案 `3 roles`（非必须 v2.1）。  
- CLI `scheme show` 打印 members。  
- `/scheme` 行为保持「只改下拉不发送」。

---

## 5. 数据模型增强（contracts）

### 5.1 新增 / 扩展类型

```ts
export type OrchestrationMemberFallback = 'main' | 'none';

/** 方案内一个可点名角色（主 agent 用 role 调用） */
export type OrchestrationSchemeMember = {
  /** 主 agent 点名用，如 scout；方案内唯一 */
  role: string;
  /** 调度描述：何时派这个角色（必填） */
  description: string;
  /** 可选：引用全局 SubagentProfile 作默认能力/隔离模板 */
  profileId?: string;
  /** 钉死模型；omit = 解析链继承 profile → 父会话模型 */
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  isolation?: SubagentIsolationMode;
  /** spawn 前不可用时：main=回退主 agent；none=硬失败 */
  fallback?: OrchestrationMemberFallback; // default 'main'
};

export type OrchestrationSchemeSettings = {
  id: string;
  name: string;
  description: string;

  /** 主纪律（原 systemPreamble，可 rename 兼容） */
  systemPreamble: string; // 或 mainDiscipline 别名，持久化保持 systemPreamble 减少迁移痛

  /** v2 核心：编队成员；Ultra 默认 ≥1 scout */
  members: OrchestrationSchemeMember[];

  /**
   * v1 兼容：无 role / 泛型时的默认成员 role 或 profile。
   * 解析：优先 members 中 defaultRole；否则 defaultProfileId。
   */
  defaultRole?: string;
  defaultProfileId?: string; // 迁移期保留；新 UI 以 defaultRole 为主

  allowedProfileIds?: string[]; // 可逐步废弃，改由 members 表达允许集
  exposeSpawnMetadata: boolean;
  maxConcurrency?: number;
  maxTasksPerRun?: number;
  waitPolicy: OrchestrationWaitPolicy; // 仍默认 await-all；UI 可隐藏
  maxSubagentThinkingLevel?: ThinkingLevel;
};
```

### 5.2 迁移（v1 → v2）

对磁盘上已有 schemes / builtin：

1. 若无 `members` 或 `members.length === 0`：  
   - 合成一个 member：  
     `role = defaultProfileId`（如 `explorer`）或映射表 `explorer→scout`（Ultra 旧 overlay 的 `searcher` 别名为 scout），  
     `description = profile.description 或占位`，  
     `profileId = defaultProfileId`。  
2. Ultra builtin 常量改为带 `members: [scout…]` + 加强 `systemPreamble`。  
3. `resolveOrchestrationScheme` 输出增加 `members: ResolvedMember[]`、`defaultRole`。

### 5.3 解析规则

```text
resolve(schemeId):
  merge builtin + settings
  migrate members if needed
  validate each member.role unique, description non-empty
  clamp concurrency / thinking
  resolve each member.model against providers（无效 model → member.unavailable）
```

`ResolvedOrchestrationScheme` 增加：

- `members: Array<{ role, description, profileId?, model?, thinkingLevel?, isolation?, fallback, available: boolean, unavailableReason? }>`  
- `defaultRole: string`

---

## 6. Host 行为增强

### 6.1 注入内容（选中非 Off）

除 preamble 外，注入 **成员清单**（有界、短）：

```text
[piwin-scheme:ultra-code]
<systemPreamble>

[piwin-scheme-roster]
- scout: <description> (model: provider/model or inherit; readonly; thinking≤low)
- coder: ...
When delegating, call piwin_subagent_run with role set to one of the roster roles.
```

Off：不注入 roster、不注入 preamble（v1 不变）。

### 6.2 `piwin_subagent_run` 增强

参数：

| 参数 | v2 |
|------|-----|
| `task` | 必填 |
| **`role`** | **方案激活时首选**；与 roster 匹配 |
| `profileId` | 无方案或 expose 时仍可用；方案 + `exposeSpawnMetadata:false` 时忽略或仅作内部 |
| `model` / `thinkingLevel` | 方案软泛型下忽略，改用 member 解析结果 |

执行：

1. 读 turn 绑定 scheme。  
2. 若有 `role` → 查 members；无则 error 或 fallback。  
3. 合并 profile 模板 + member 覆盖 → 得到 spawn 输入。  
4. Member `available === false` → 见 fallback。  
5. 无 scheme → v1/今日行为（profileId 等）。

### 6.3 Fallback（spawn 前）

| fallback | 行为 |
|----------|------|
| `main`（默认） | 工具返回明确失败/降级结果：`code: 'subagent-unavailable-fallback-main'`，message 含 role 与原因，指示**主会话自行完成**；**不**自动再开子会话 |
| `none` | `ok: false`，主 agent 必须换 role 或停 |

**不算** spawn 前不可用：仅并发排队。  
**跑半路失败**：返回失败给主 agent，默认不自动改 main 静默成功。

不可用原因示例：未知 role、model 未配置、provider 错误、方案成员 empty。

### 6.4 Soft generic 与 multi-role 的关系

文章「单一模板泛型」适用于 **Ultra 默认偏单 scout**。  
用户多 role 方案：

- `exposeSpawnMetadata: false`：**仍暴露 `role` 枚举**（或描述在 roster），**隐藏 model/thinking**；  
- Host 按 role 选模型 —— 这是「按角色泛型」，不是「全世界一个 profile」。

Ultra 默认：`exposeSpawnMetadata: false`，roster 主要一个 scout，与文章一致。

---

## 7. Ultra Code builtin 常量修订（建议正文）

```ts
BUILTIN_ULTRA_CODE_SCHEME = {
  id: 'ultra-code',
  name: 'Ultra Code',
  description:
    'Built-in scout pack for high-effort main agents: cheap readonly scout, low thinking, wait-for-scouts discipline (article-aligned).',
  source: 'builtin',
  defaultRole: 'scout',
  defaultProfileId: 'explorer', // 迁移兼容
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  maxSubagentThinkingLevel: 'low',
  members: [
    {
      role: 'scout',
      description:
        'Read-only codebase scout. Use for broad search, file reads, and evidence gathering that would pollute the main context. Return dense citations only; do not edit files or make final design decisions.',
      profileId: 'explorer',
      thinkingLevel: 'low',
      isolation: 'readonly',
      fallback: 'main',
      reportContract: ULTRA_CODE_SCOUT_REPORT_CONTRACT,
      // model: omit → user should pin cheap model in Settings
    },
  ],
  systemPreamble: ULTRA_CODE_PREAMBLE, // 8.10：何时派/不派、买压缩不退货、奠基文档留下
}
```

---

## 8. 实现分期（在 v1 代码上增量）

| 阶段 | ID | 内容 | 验收 |
|------|-----|------|------|
| **A** | ORCH-V2-01 | contracts：`members`、migrate、resolve roster、Ultra 常量修订、测试 | 旧 schemes 无 members 仍可 resolve |
| **B** | ORCH-V2-02 | Host：注入 roster；`piwin_subagent_run` 支持 `role`；member 解析；fallback main | 单测 + mock chat `--scheme ultra-code` 见 roster |
| **C** | ORCH-V2-03 | Settings：方案编辑器（纪律 + 成员 CRUD + model 下拉 + Reset/Clone） | 手动：改 Ultra scout 模型并发送生效 |
| **D** | ORCH-V2-04 | Desktop/CLI show members；可选 pill 角色数 | show 输出含 role |
| **E** | ORCH-V2-05 |（可选）Hard generic：schema 仅 role+task | 可后置 |

**不**在 v2 做：固定流水线引擎、方案市场、Side Chat 方案、跨会话默认方案。

---

## 9. 测试计划（增量）

| ID | 用例 |
|----|------|
| V2-T1 | v1 scheme 无 members → migrate 出 1 member |
| V2-T2 | Ultra resolve 含 scout + preamble 含 wait/scout |
| V2-T3 | spawn `role: scout`（及旧 `searcher` 别名）解析到 explorer + low |
| V2-T4 | 未知 role + fallback main → 结构化不可用结果 |
| V2-T5 | fallback none → ok false |
| V2-T6 | Off 仍无 preamble/roster |
| V2-T7 | settings overlay 覆盖 Ultra member model |
| V2-T8 | 空 description member → normalize 丢弃或 resolve 报 invalid |

---

## 10. 验收标准（v2 done）

1. Ultra Code 仍是下拉内置可选项；Off 行为与 v1 零注入一致。  
2. Ultra 默认配方可对照文章勾选：只读探子、low、泛型（藏 model）、wait 纪律、并发上限、fresh context、depth 1。  
3. 用户可编辑 Ultra overlay 与自建方案的 **纪律 + 多 role 成员 + 模型**。  
4. 主 agent 通过 **`role`** 调用；Host 解析成员；不可用默认 **fallback 主 agent**。  
5. 不写死任务流水线；主模型始终为 Composer 选择。  
6. typecheck/tests 覆盖 migrate 与 role spawn。

---

## 11. 与 v1 spec 文档关系

- [orchestration-scheme.md](./orchestration-scheme.md) 保留为 **v1 历史 + 交互壳（per-send）权威**。  
- **本文件**为 **v2 增强权威**；实现冲突时：壳与 opt-in 听 v1，编队/role/Ultra 文章对齐听 v2。  
- 落地完成后可把 v1 §6–9 类型段标为「被 v2 扩展」，或合并进一版修订（另开 PR）。

---

## 12. 原始需求追溯（增强后）

| 用户/文章需求 | v1 | v2 |
|---------------|----|----|
| 可选方案 / Off 自由 | ✅ | ✅ 保留 |
| 主纪律何时派如何验 | 仅内置 preamble | ✅ 可编辑 + roster |
| 并发边界 | ✅ 数字夹紧 | ✅ 同左 + UI 可编 |
| 子代理身份与模型 | ❌ 单 defaultProfile | ✅ members + model 下拉 |
| Ultra 特供对齐文章 | 部分 | ✅ 配方修订 + 提示钉便宜模型 |
| 用户自建多 role 编队 | ❌ | ✅ |
| 主 agent 动态流水线 | 隐含 | ✅ 明确 non-goal 反面：不做死阶段机 |
| 子 agent 不可用 | ❌ | ✅ fallback main |

---

## 13. Open points（实现时可定，不阻塞设计）

1. 持久化字段名：`systemPreamble` 保留 vs 展示名「主纪律」。  
2. 自动保存防抖 300–500ms vs 显式 Save（与 Subagents profiles 页一致更省事）。  
3. `role` 与全局 `profileId` 是否允许同名不同义（建议 role 独立命名空间，profileId 仅引用）。  
4. 多 role 时 tool schema 用 `enum: roles[]` 还是自由 string + Host 校验（推荐 Host 校验 + roster 注入，少动 Pi tool cache；硬 enum 作 E 期）。
