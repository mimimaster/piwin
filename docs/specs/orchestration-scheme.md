# Spec — Orchestration Scheme（编排方案）

| Field | Value |
|-------|-------|
| Status | Ready for implementation — product + technical design locked |
| Date | 2026-08-07 |
| Trigger | GPT-5.6 Sol / Codex Ultra 多代理配置实践；piwin 已有 Subagent Profile 与同步 `piwin_subagent_run`，缺「主代理派发纪律 + 角色组合 + 并发边界」的可选用打包 |
| Related | [ADR 0030](../adr/0030-safe-parallel-subagent-execution.md), [ADR 0024](../adr/0024-run-modes-and-sandbox.md), [CE-SUB / CE-SUB-PROF](./w2-subagent-compaction-pty.md), [agentMode × permission](./agent-mode-permission-plan-walkthrough.md), [Runtime Refactor](./runtime-refactor.md) |
| Binding | AGENTS.md；contracts first；product transcript is history truth；Desktop/CLI share Host；**opt-in only** |
| Backlog prefix | ORCH-* |
| Worktree (impl) | `/Users/yorickjue/Developer/piwin-orch` · branch `feature/orchestration-scheme` |

---

## 0. 原始需求与问题背景

### 0.1 从哪里来

本能力来自对 Codex / Claude Code 生态「Ultra / ultracode / MultiAgent V2」实践的复盘（社区文章《拯救 5.6 Sol》系列及同类配置经验），以及 piwin 自身已有子代理栈的缺口。

公开/社区侧的集中不满不是「模型完全不能写代码」，而是：

1. **Ultra 被当成神秘新模型**，实际是**编排放大器**（多代理提示 + 高思考档），配置不当会烧额度、拖很久、任务完不成。
2. **子代理继承主模型 + 套娃派生 + 主代理不等待** 时，界面上「四个代理都在动」，信息增量却只有一份。
3. **上下文腐烂**：grep、读文件、死路留在主上下文，有效结论与低价值中间产物抢注意力。
4. 子代理本应把污染隔离在一次性上下文，**只回流蒸馏后的结论**；但若每个子代理都是 Sol max/ultra，成本与延迟爆炸。

文章侧可操作的配置落在三份文件上（Codex 心智模型）：

| Codex 落点 | 职责 |
|------------|------|
| `AGENTS.md` | 主代理**何时派、如何派、如何验** |
| `config.toml` | **并发、协议形态、等待边界** |
| `agents/default.toml` | 子代理**用什么模型、以什么身份工作** |

单改一处会失效：只换子模型但主代理不等待；只加等待但重复检索；只写「积极用子代理」会变成**调度污染**。

### 0.2 用户要什么（piwin 产品语言）

用户明确要的是一种 **「子代理 / 编排方案」** 产品能力，而不是再藏一个 skill：

1. 能预先配置好「主代理派发纪律 + 并发/等待边界 + 子代理身份（review / search / explorer…）」。
2. **可以选用方案干活，也可以不用**（自由模式、不加限制）。
3. 可以自己制定方案，选择后执行。
4. **不要**做成「只有 `/exe-ultra-subagent` 才触发」的深藏 skill——方案一多难管理，功能发现性差。
5. 交互最终敲定为：**设置里配好方案；对话框附近下拉框选方案；打过去（发送）这条消息按方案跑**。
6. **不做跨会话保持、不做设为默认、不做静默自动启用**——「主动选择才会应用；用户自己承担」。

### 0.3 一句话问题陈述

> piwin 已有子代理**工种（Profile）**与同步委派工具，缺的是用户可见、可开关、可配置的 **「本条消息是否按某套编排纪律跑」** 的产品对象。

### 0.4 成功时用户感知

| 场景 | 感知 |
|------|------|
| 下拉 Off | 与今日完全一致：无新系统提示、无强制探子、无 schema/并发特殊约束 |
| 选 Ultra Code 再发送 | 本条更倾向拆只读探子、等证据再综合；子代理偏 low 思考；不乱填 model/thinking |
| Settings | 能看到内置 Ultra Code，可 clone 改纪律/profile/并发 |
| 切会话 / 重启 | 下拉回到 Off；没有「上次方案自动跟过来」的惊喜惊吓 |

---

## 1. Product one-liner

> **编排方案（Orchestration Scheme）** 是**逐条消息的 opt-in 工作方式**：用户在 Composer 下拉选中非 Off 方案并发送后，本条 prompt 才注入主代理派发纪律，并按方案收紧子代理角色、并发与（可选）工具 schema；**Off 时与实现前行为 bit-identical**。

中文产品名：**编排方案**。英文类型名：`OrchestrationScheme`。  
内置方案名：**Ultra Code**（与主代理 thinking 档位 **Ultra** 无关，禁止共用配置或混名叙事）。

---

## 2. 功能形态（用户可见）

### 2.1 形态总览

```text
Settings（配）          Composer（选）           Host（本条生效）
  方案库                  下拉 Off | Ultra Code     仅当 id ≠ off：
  · 内置 Ultra Code        | 用户自建…              · 注入纪律 preamble
  · 用户 clone / 新建      发送 → PromptInput       · 约束子代理
  · 引用 Subagent Profile    .orchestrationSchemeId · 可选收窄 spawn schema
```

三层对象（对用户可简化为两层 UI：档案 + 方案）：

| 层 | 名称 | 用户感知 | 技术 |
|----|------|----------|------|
| L1 | 子代理档案 Profile | 「探子 / 审查 / 实现用什么模型与能力」 | 已有 CE-SUB-PROF |
| L2 | 派发纪律 Policy | 通常不单独露出；写在方案的 preamble 与开关里 | `systemPreamble`、wait、exposeSpawnMetadata… |
| L3 | 编排方案 Scheme | 下拉里的一项：「Ultra Code」「我的审查包」 | 引用 Profile + 纪律 + 并发边界 |

### 2.2 Composer 主入口（已敲定）

```text
[ 🤖 model · thinking ] [ ⚡ RunMode ] [ 🛰 编排方案: Off ▾ ]
[ 输入消息……                                         ] [发送]
```

- **位置**：输入框附近，与 model/thinking、Run Mode **同排**（一等公民控件，不是 slash 深处）。
- **控件**：紧凑 pill + Popover（复用 `RunModeControl` / `ThinkingEffortControl` 范式）。
- **列表顺序**：
  1. **Off**（永远置顶，不可删）— 文案：自由干活，不加限制
  2. 内置 **Ultra Code**
  3. 用户自建方案（Settings 定义顺序）
- 每项：名称 + 一行描述；Ultra Code 可带徽标（只读 / 泛型 / low）。
- Footer：仅 **「管理方案…」** → Settings → Subagents → 编排方案。**无「设为默认」。**
- 非 Off 时 pill 高亮显示短名（如 `Ultra Code`）。

### 2.3 发送语义（核心功能形态）

| 下拉 | 用户操作 | 系统行为 |
|------|----------|----------|
| Off / 空 | 发送 | **零方案逻辑**：不读方案库、不注入 preamble、不收窄 schema、不覆盖并发 |
| 合法 scheme id | 发送 | 本条 `PromptInput.orchestrationSchemeId = id`；Host 解析并生效 |
| 已删 / 非法 id | 发送 | **Host 失败返回明确错误**（不静默当 Off）；Desktop 发送前应校验 |

规则（锁死）：

1. **选中才注入，没选就不注入**（对齐「有选才带结构化字段」；参考 agentMode 的意图，但实现更干净，见 §8）。
2. 下拉是**普通 UI 内存态**：改了就显示新值；**新会话、应用重启 → Off**。
3. 同一次 app 内下拉**可以**保持显示（用户自己改）；**产品不实现、不承诺跨会话记忆**。
4. 运行中可改下拉；**当前 run 不变**，下一条消息才用新值。
5. **用户 transcript 只记用户原文**；方案纪律只进 model-facing 准备路径。

### 2.4 Settings 形态

- 并入 **Settings → Subagents**，新增 section **「编排方案」**。
- 内置 Ultra Code：**只读 + Clone**（clone 出可编辑副本，新 id）。
- 用户方案：CRUD。
- **Profile 独立编辑**；方案只通过 `defaultProfileId` / 可选 `allowedProfileIds` **引用**，不内嵌 API key / 不新建 provider。

### 2.5 辅助入口（非本体）

| 入口 | 行为 |
|------|------|
| `/scheme` | 列出 Off + 可用方案 |
| `/scheme off` \| `ultra-code` \| `<id>` | **只改下拉状态，不发送** |
| CLI `piwin scheme list \| show <id>` | 只读 |
| CLI prompt `--scheme <id>` | 本条 prompt 带 id；省略 = Off |

Slash / CLI **不是**「执行一次 ultra 脚本」；真正生效永远是**带 id 的那次 prompt**。

### 2.6 明确不做的功能形态（v1）

| 不做 | 原因 |
|------|------|
| 左栏常驻「当前工作方式」+ 跨会话保持 | 用户否决；语义过重 |
| 设为默认 / 项目默认方案 | 与「主动选择才应用」冲突 |
| 纯 skill + `/exe-…` 作主入口 | 藏得深、方案一多难管 |
| 自动按任务复杂度开方案 | 额度与调度不可预期（Sol Ultra 翻车点） |
| 内置多个方案 | 先一个 Ultra Code 打穿；其余用户自建 |
| 发送后强制下拉回 Off | 无必要；切 session 再回 Off 即可 |
| 方案市场 / 流程图编排器 | 超出 v1 |
| Side Chat 应用方案 | Side Chat 无 delegate；v1 忽略 |
| 子代理 fork 父完整历史 | piwin 已是 fresh context；禁止改回 |

### 2.7 与相邻控件的正交关系（用户侧）

| 控件 | 管什么 | 与编排方案 |
|------|--------|------------|
| Thinking / Ultra thinking | 主代理本 turn 思考强度 | 无关；Ultra Code ≠ thinking ultra |
| Run Mode（Ask/Auto/YOLO） | 权限与沙箱 | 无关 |
| Agent Mode（Agent/Plan/Ask） | 主代理协作模式与权限 floor | 可叠加；见 §8.6 |
| 编排方案 | 派发纪律 + 子代理约束 | 本功能 |
| Subagent Profile | 子代理工种配方 | 被方案引用 |

---

## 3. 市场与竞品对照

| 产品 | 类似能力 | 与本方案差距 |
|------|----------|--------------|
| Claude Code | Subagents（角色 md）+ Agent Teams（多 session，实验） | 有角色；弱「一键编排方案」；Teams ≠ 单 turn 方案 |
| Codex | Multi-agent V2 + Ultra 开关 + agents.toml / AGENTS.md | 最接近，但是**三份配置手工拼**，无产品级开关对象 |
| OpenCode 等 | ultracode 关键词插件 | 开关/插件，不是可管理方案库 |
| Cline / Roo | Custom Modes | 偏主代理人格，不是主+子编排包 |
| **piwin 现状** | Profile + `piwin_subagent_run` + Orchestrator | 有 L1 与批量调度；**缺 L3 方案 + Composer 显式选择 + 派发纪律注入** |

本方案填的是 **Orchestration Preset** 空白，**不是**再发明第四种 agent 类型。

---

## 4. 术语与定义

| Term | Meaning |
|------|---------|
| **Subagent Profile** | 已有：模型、思考、能力、隔离、技能。L1。 |
| **Orchestration Scheme** | 派发纪律 + Profile 引用 + 并发/思考边界 + 名字。L3。 |
| **Off** | 伪方案：零注入、零收窄、零覆盖。默认。 |
| **Generic spawn（泛型调用）** | `exposeSpawnMetadata = false`：模型侧不暴露（或不采纳）`profileId/model/thinkingLevel`，强制默认 Profile。对应 Codex `hide_spawn_agent_metadata`。 |
| **Per-send selection** | 下拉值只作用于**即将发送的这一条** `session/prompt`。 |
| **Soft generic（MVP）** | 工具 JSON schema 可仍完整；Host **execute 强制** defaultProfile + clamp。见 §9。 |
| **Hard generic** | 本 turn 注册收窄后的 tool descriptor；Off 后须恢复全量 schema。见 §9。 |

必须保持独立的概念：Agent Mode、Run Mode、Thinking Ultra、Skill、Side Chat、Subagent child session、Plan。

---

## 5. Goals / Non-goals

### 5.1 Goals

| ID | Goal |
|----|------|
| ORCH-G1 | Composer 输入框旁编排方案下拉；默认 Off |
| ORCH-G2 | **仅当选中非 Off 并发送时** Host 才注入纪律与运行时约束 |
| ORCH-G3 | Off 时零注入——与实现前 bit-identical |
| ORCH-G4 | 内置 Ultra Code：只读探子倾向、泛型调用语义、等待纪律、子代理 thinking ≤ low |
| ORCH-G5 | 用户可 clone/自建；方案只引用 Profile |
| ORCH-G6 | `PromptInput.orchestrationSchemeId`；Host 为权威执行点 |
| ORCH-G7 | Desktop 与 CLI 共享 Host 语义 |
| ORCH-G8 | 与 agentMode / runMode / thinking 正交 |

### 5.2 Non-goals（v1）

ORCH-N1..N9：见 §2.6 表（跨会话持久化、默认方案、自动启用、skill 主入口、市场、流程图、Side Chat 方案、混名 Ultra、fork-all 历史）。

---

## 6. 概念模型与配置形状

```text
PiwinConfig.subagents
  ├── profiles[]                 # L1 已有
  ├── defaultProfileId?          # L1 全局（Off 时子代理仍可用）
  ├── maxConcurrency / maxTasksPerRun / processIsolation / …
  └── schemes[]                  # L3 新增（用户自建；内置不写死进磁盘默认）
        └── OrchestrationSchemeSettings
```

内置 Ultra Code：**Host（或 contracts 只读常量）merge**，模式对齐 builtin profiles：  
`createDefaultSubagentConfig()` **不**把 Ultra Code 写入默认磁盘 config。

### 6.1 与现有 subagent 栈

| 组件 | 方案如何影响 |
|------|----------------|
| `piwin_subagent_run` | 激活时：默认 profile、强制/忽略元数据、thinking 上限 |
| `SubagentOrchestrator` | 本 turn 并发/任务上限 clamp（不超过全局硬顶） |
| `SubagentProfileResolver` | 解析 `defaultProfileId` |
| Child context | 仍 fresh；方案不得改为继承父历史 |
| Depth | 仍 max 1；方案不得开放套娃 |

### 6.2 waitPolicy 与同步工具

`piwin_subagent_run` **已是同步 spawn+merge**，「立刻 wait」在工具层**结构性成立**。  
仍保留 `waitPolicy` + preamble：防主代理绕过工具自己乱搜；为未来异步 batch 预留。

v1：`await-all` 为 Ultra Code 值；`fire-and-continue` 可留在类型中，**Settings 不暴露**；保存用户方案时拒绝或强制 `await-all`。

---

## 7. Contracts

### 7.1 文件

- 新：`packages/contracts/src/orchestration-scheme.ts`
- 改：`config.ts`（`SubagentConfig.schemes?`）、`host.ts`（`PromptInput.orchestrationSchemeId?`）、`index.ts` export

### 7.2 核心类型

```ts
export type OrchestrationWaitPolicy = 'await-all' | 'fire-and-continue';

export type OrchestrationSchemeSettings = {
  id: string;
  name: string;
  description: string;
  defaultProfileId: string;
  allowedProfileIds?: string[];
  /** false = 泛型调用语义（Ultra Code 默认） */
  exposeSpawnMetadata: boolean;
  maxConcurrency?: number;
  maxTasksPerRun?: number;
  waitPolicy: OrchestrationWaitPolicy;
  maxSubagentThinkingLevel?: ThinkingLevel;
  systemPreamble: string;
};

export type OrchestrationScheme = OrchestrationSchemeSettings & {
  source: 'builtin' | 'settings';
};

export const ORCHESTRATION_SCHEME_OFF_ID = 'off' as const;

/** UI 用 summaries；完整 builtin 配方由 host-runtime merge（对齐 profile 模式） */
export const BUILTIN_ORCHESTRATION_SCHEME_SUMMARIES: readonly {
  id: string;
  name: string;
  description: string;
}[] = [
  {
    id: 'ultra-code',
    name: 'Ultra Code',
    description:
      'Read-only scout pack: low subagent thinking, generic spawn, wait-all; pin a cheap model on explorer for cost',
  },
] as const;
```

### 7.3 PromptInput

```ts
export type PromptInput = {
  text: string;
  // …existing…
  agentMode?: AgentModeId;
  /**
   * Per-send scheme id. Omit or 'off' → no scheme work.
   * Unknown / invalid id → prompt fails with explicit error (never silent Off).
   */
  orchestrationSchemeId?: string;
};
```

### 7.4 Resolve

```ts
export type ResolvedOrchestrationScheme = {
  schemeId: string;
  scheme: OrchestrationScheme;
  defaultProfileId: string;
  exposeSpawnMetadata: boolean;
  maxConcurrency: number;
  maxTasksPerRun: number;
  waitPolicy: OrchestrationWaitPolicy;
  maxSubagentThinkingLevel?: ThinkingLevel;
  systemPreamble: string;
};

/** off / omit → undefined（调用方跳过全部方案逻辑） */
/** unknown id 或 defaultProfile 无法解析 → error，不得返回「假装 Off」 */
export function resolveOrchestrationScheme(
  config: PiwinConfig,
  schemeId: string | undefined,
): ResolvedOrchestrationScheme | undefined;
```

并发：`min(scheme?, global, hard caps)`。  
Thinking 全序 clamp：`off < minimal < low < medium < high < xhigh < max < ultra`。

### 7.5 IPC

- 仅扩展现有 `session/prompt` 的 `input`；**无** `scheme/set` session API。
- 方案库经 `config/get` 的 `subagents.schemes` + builtin merge 暴露给 UI。

### 7.6 无效 id（锁死）

| 情况 | 行为 |
|------|------|
| omit / `off` | 跳过方案 |
| 未知 id | **prompt 失败** + 稳定错误码/文案 |
| `defaultProfileId` 缺失 | **方案 invalid** → 失败 |
| Desktop 发送前发现无效 | 禁用发送或回 Off 并提示（体验）；Host 仍是最后防线 |

---

## 8. Host 行为

### 8.1 选中才注入

```text
if (!id || id === 'off') {
  // ORCH-G3: zero scheme work
} else {
  resolved = resolveOrchestrationScheme(config, id) // or fail
  bind resolved to this run (turn-scoped)
  inject model-facing preamble (§8.2)
  apply subagent force/clamp on spawn (§8.3)
  apply concurrency clamp for this turn (§8.4)
}
```

- 绑定在**本条 prompt 的 run** 上，不写 session 永久字段。
- 同 session 下一条 Off **不得**残留上一方案的强制逻辑。

### 8.2 纪律注入（锁死落点）

对齐现有 `preparePrompt`：**改 model-facing `promptInput.text`**（与 plan / files / contextRefs 同构），  
**`recordUserPrompt` / transcript 仍用 `command.input.text` 原文**。

```text
[piwin-scheme:ultra-code]
{systemPreamble}

---
{user text}
```

- Desktop **只传** `orchestrationSchemeId`，**禁止**把 preamble 写入用户可见 text 作为主路径（不要学历史 `applyAgentModeToPrompt` 污染 transcript）。
- v1 **不**依赖独立 system/developer 通道；ORCH-O3 默认 = prepare 前缀。

### 8.3 泛型调用：MVP vs 完整

现网工具面按 **`sessionId + runtimeGenerationId`** 缓存合成，**不是**天然 per-prompt 重建。

| 级别 | 行为 | 阶段 |
|------|------|------|
| **Soft generic（ORCH-02 MVP）** | schema 可仍暴露 profileId/model/thinking；**execute 忽略并强制** `defaultProfileId` + thinking clamp | 必做 |
| **Hard generic（ORCH-05）** | 本 run 注册收窄 descriptor；Off 后 invalidate/换 generation 恢复全量 schema | 后置 |

Acceptance：v1 以 **Host 强制行为**为准；硬 schema 收窄可后置但须测「同 session Ultra→Off 无残留强制」。

`exposeSpawnMetadata === true`（用户方案）：允许模型选 profile（须 ∈ allowlist）；仍 clamp `maxSubagentThinkingLevel`；仍不得 widen capabilities。

### 8.4 并发

方案 `maxConcurrency` / `maxTasksPerRun` 仅作用于**本 turn 主代理发起的 subagent batch**，经 run 上下文传入 Orchestrator，**不改全局 Settings 磁盘值**。

### 8.5 子代理思考上限

只管子代理；**不**改父 turn `thinkingLevel`。

### 8.6 与 agentMode 叠加

| agentMode | scheme | 行为 |
|-----------|--------|------|
| agent | Off | 今日 |
| agent | Ultra Code | 纪律 + 子代理约束 |
| plan/ask | Off | 现有 read-only floor |
| plan/ask | Ultra Code | 两者都生效；只读探子可辅助 plan |

**plan/ask + 可写 profile（implementer 等）**：v1 **强制 readonly 或拒绝 worktree 写**，工具结果说明（ORCH-O2 锁死为强制 readonly + 说明）。

### 8.7 Side Chat / RPC

- Side Chat：**忽略** scheme id；Composer 可不展示下拉。
- RPC 无 custom tools：preamble 仍可注入，委派不可用——capability 诚实，不假装一定派得动。

### 8.8 便宜模型预期（产品诚实）

Builtin `explorer` **默认不钉死便宜模型**（inherit 父模型）。Ultra Code 保证的是 **low 思考 + 只读 + 纪律**，不是自动 Luna。

- 下拉/Settings 描述须提示：为 explorer **指定更快更便宜模型** 才能明显省额度。
- 可选：resolve 时 profile 无 model → `host/log` warn（非失败）。

---

## 9. 内置方案：Ultra Code

Host-owned 完整配方（示例；实现以代码常量为准）：

```ts
{
  id: 'ultra-code',
  name: 'Ultra Code',
  description:
    'Read-only scout pack: low subagent thinking, generic spawn, wait-all; pin cheap model on explorer for cost',
  source: 'builtin',
  defaultProfileId: 'explorer',
  exposeSpawnMetadata: false,
  maxConcurrency: 6,
  maxTasksPerRun: 8,
  waitPolicy: 'await-all',
  maxSubagentThinkingLevel: 'low',
  systemPreamble: [
    'Orchestration scheme Ultra Code is active for this turn.',
    'You may proactively spawn read-only subagents when work splits into independent investigation workflows and parallel scouts clearly improve speed or quality.',
    'Subagents are scouts only: gather facts, paths, and citations; return dense evidence reports.',
    'Do not ask subagents to make final product decisions or large design calls; you synthesize and verify.',
    'After a parallel wave of spawns, wait for all results before continuing analysis, search, commands, or edits.',
    'Do not re-do the same broad search the scouts were assigned; use their reports.',
    'Prefer the default scout profile; do not try to pick exotic models or high thinking for subagents.',
  ].join(' '),
}
```

对应文章配置映射：

| 文章（Codex） | piwin |
|---------------|-------|
| AGENTS.md 派发纪律 | `systemPreamble` + Host prepare 注入 |
| config 并发/等待 | `maxConcurrency` / `maxTasksPerRun` / `waitPolicy` |
| agents/default.toml Luna low | `defaultProfileId: explorer` + `maxSubagentThinkingLevel: low` + 用户钉 Profile 模型 |
| hide_spawn_agent_metadata | `exposeSpawnMetadata: false`（MVP 软强制 / 后硬 schema） |
| fork_turns=none | 已有 fresh child |
| 立刻 wait_agent | 同步工具 + preamble |
| Ultra 思考档 | **不是**本功能 |

---

## 10. Desktop

### 10.1 状态

```ts
const [orchestrationSchemeId, setOrchestrationSchemeId] = useState('off');
```

- 切换 active session → **强制 `off`**
- 应用启动 → `off`
- 无跨会话、无 localStorage 方案记忆（v1）

### 10.2 发送

```ts
const input: PromptInput = { text: userVisibleText, agentMode, /* … */ };
if (orchestrationSchemeId && orchestrationSchemeId !== 'off') {
  input.orchestrationSchemeId = orchestrationSchemeId;
}
```

### 10.3 组件

- `OrchestrationSchemeControl.tsx`（仿 RunModeControl）
- `composer-dock` 接线；i18n：「编排方案」/ Orchestration scheme
- Settings schemes section + Clone Ultra Code
- Slash `kind: 'scheme'`：只改 state

### 10.4 轻反馈

- pill 高亮；可选 muted「本条按 Ultra Code 编排」
- 不做会话列表 badge、不做左栏常驻

---

## 11. CLI

```text
piwin scheme list
piwin scheme show <id>
piwin session prompt --scheme ultra-code "..."
```

省略 `--scheme` = Off。无全局 `scheme set` 持久化命令。

---

## 12. 边界情况

| 情况 | 行为 |
|------|------|
| Off 发送 | 零方案逻辑 |
| 选中后改回 Off 再发送 | Off |
| 方案/profile 被删 | invalid；Host 错误；Settings 标红 |
| 运行中切换下拉 | 当前 run 不变 |
| 切 session | 下拉 Off |
| 与 thinking ultra 同开 | 允许；互不影响 |
| 与 YOLO | 允许；方案不管权限 |
| 空 preamble 用户方案 | Settings 拒绝保存 |
| id 字符 | `[a-z0-9\-]+`；内置 `ultra-code` |
| scheme 并发 > global | clamp |
| 模型在软泛型下仍传 model | Host 忽略 |
| 多模态 + 方案 | 附件照常；方案只加纪律与子代理约束 |
| RPC 无 subagent 工具 | 诚实降级 |

---

## 13. 实现分期

| Phase | ID | 内容 |
|-------|-----|------|
| A | ORCH-01 | contracts 类型、summaries、resolve、config-store `schemes`、PromptInput 字段、单测 |
| B | ORCH-02 | Host：resolve、prepare 注入、run 上下文、**软泛型**强制 profile/thinking、并发 clamp、transcript 隔离测例 |
| C | ORCH-03 | Desktop 下拉、发送、切 session 回 Off、Settings 基础、slash |
| D | ORCH-04 | CLI list/show/prompt flag |
| E | ORCH-05 | 硬 schema 收窄 + generation invalidate；Settings 完整校验 UX；plan/ask 写护栏抛光 |

**建议顺序**：A → B → C → D；E 不挡 MVP。

**MVP 砍法（产品叙事不变）**：A+B+C 最小竖切；Settings 完整 CRUD 与 CLI 可紧随。

---

## 14. 测试计划

| ID | Case | Layer |
|----|------|-------|
| ORCH-T1 | resolve off / ultra-code / unknown | contracts |
| ORCH-T2 | schemes config round-trip | config-store |
| ORCH-T3 | 无 scheme：无 preamble、无强制 | host |
| ORCH-T4 | ultra-code：有 preamble；spawn 强制 explorer + thinking≤low | host |
| ORCH-T5 | 同 session Ultra 再 Off：第二 turn 无残留强制 | host |
| ORCH-T6 | concurrency min(scheme, global) | host |
| ORCH-T7 | transcript user text 无 preamble | host/session |
| ORCH-T8 | Desktop payload 含/不含 id | desktop |
| ORCH-T9 | 切 session 下拉 off | desktop |
| ORCH-T10 | slash 只改 state | desktop |
| ORCH-T11 | CLI --scheme / omit | cli |
| ORCH-T12 | unknown id → 明确失败 | host |

---

## 15. Acceptance criteria

1. 默认 Off：与加功能前一致。  
2. 选 Ultra Code 发送：model-facing 有纪律；子代理强制/倾向 explorer；thinking ≤ low；并发有上限。  
3. 用户 transcript 无大段方案说明书冒充用户。  
4. 切会话 / 重启：下拉 Off。  
5. 可 clone Ultra Code；下拉出现副本（Settings 交付后）。  
6. Desktop 与 CLI 对同一 id 语义一致。  
7. 与 agentMode / runMode / thinking 可同时用且职责不覆盖。  
8. unknown scheme id **不**静默当 Off。

---

## 16. 设计 review 结论（已吸收）

| 议题 | 结论 |
|------|------|
| 产品方向 | **通过**；per-send opt-in 正确 |
| 无效 id | **失败，不静默 Off** |
| 工具 schema per-turn | 现网 generation 缓存 → **MVP 软泛型，硬收窄后置** |
| Builtin 归属 | summaries 在 contracts；**完整 Ultra Code 在 host merge**（对齐 profile） |
| preamble 落点 | **prepare 前缀**，transcript 隔离 |
| 便宜模型 | **产品诚实描述**；不假装自动 Luna |
| waitPolicy | 保留；UI 不暴露 fire-and-continue |
| 是否新 ADR | 默认 **不需要**；复用 ADR 0030 + Profile；若改 Run 身份模型再补 |

---

## 17. 否决回潮清单

- 左栏工作方式 + 跨会话保持  
- 设为默认 / 项目默认  
- skill 主入口  
- 自动启用  
- 内置方案膨胀  
- Desktop 污染用户 text  
- 方案改 fork-all / depth>1  
- 与 thinking Ultra 混配置  

---

## 18. Open points（实现期微调）

| ID | 默认 |
|----|------|
| ORCH-O1 硬泛型是否隐藏 mode/applyPolicy | 后置硬泛型时 **隐藏**，强制 readonly explorer |
| ORCH-O2 plan/ask + 可写 profile | **强制 readonly** + 工具结果说明 |
| ORCH-O3 preamble 通道 | **prepare 前缀**（已锁） |
| ORCH-O4 fire-and-continue | 类型可留；保存拒绝或强制 await-all |

---

## 19. Backlog map

| ID | Item | Phase |
|----|------|-------|
| ORCH-01 | Contracts + resolve + config-store | A |
| ORCH-02 | Host turn binding + soft generic + clamp | B |
| ORCH-03 | Desktop control + settings + slash | C |
| ORCH-04 | CLI | D |
| ORCH-05 | Hard generic + polish | E |

跟踪：[`docs/todo-deferred.md`](../todo-deferred.md) ORCH-01..05 行。

---

## 20. 最小用户故事

1. 打开 piwin，下拉 Off，正常聊天——无变化。  
2. 选 **Ultra Code**，问「这个报错根因在哪」。  
3. 主代理按纪律派 1–N 个 explorer 探子；Host 强制默认 profile 与 low 思考；探子只读回证据。  
4. 主代理综合后回答。  
5. 拨回 Off，下一条随意聊——无方案残留。  
6. Settings clone Ultra Code，改 preamble / profile，下拉出现自定义项。  

---

## 21. 原始需求追溯（验收对照）

| 原始诉求 | 本 spec 落点 |
|----------|----------------|
| 配好主代理何时/如何派发与验证 | `systemPreamble` + Ultra Code 文案 |
| 并发、协议、等待边界 | maxConcurrency/Tasks、exposeSpawnMetadata、waitPolicy、同步工具 |
| 子代理模型与身份（review/search） | Profile 引用 + defaultProfileId explorer |
| 可用可不用 | Off 默认 + 下拉 opt-in |
| 可自建方案 | Settings schemes CRUD / clone |
| 不要只靠深藏 skill | Composer 一等下拉；slash 仅快捷 |
| 选了才注入 | §2.3 / §8.1 |
| 用户自己承担、不跨会话保持 | §2.3 / §10.1 |
| 一个 Ultra Code，其余自配 | §9 / §2.6 |

---

*本文为编排方案的执行权威。实现以 contracts → host-runtime → Desktop/CLI 为序；与本文冲突的临时捷径不得合入主路径。*
