# Agent Mode × Permission × Plan Walkthrough Spec

> 版本：v1.0
> 状态：Ready for implementation
> 日期：2026-08-01
> 目标：删除 Debug mode；将 Plan/Ask mode 与权限管理真正绑定；Plan 执行完成后自动生成 Walkthrough Artifact；安装 subagent-driven-development skill。

## 0. 摘要

本 spec 修复三个问题并补齐一个缺失：

1. **Debug mode 无实际逻辑**，删除以减少概念噪声。
2. **Plan/Ask mode 的 read-only 权限 floor 从未生效**——`resolvePreset` 纯函数正确，但 host 调用时未传 `agentMode`。需要在 prompt 级别将 `agentMode` 传入 host 并动态解析权限。
3. **Plan 执行完成后不生成 Walkthrough Artifact**——当前只有 `PlanExecutionWalkthrough` 结构化摘要，没有调用 walkthrough 生成管线产出面向用户的 Markdown 文档。
4. **缺少 `subagent-driven-development` skill**——用户选择 subagent-driven 执行模式时，模型需要对应的 skill 指引来正确编排子代理。

## 1. 删除 Debug Mode

### 1.1 改动范围

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/agent-mode.ts` | 从 `AgentModeId` union 和 `AGENT_MODES` 数组中移除 `'debug'` |
| `packages/contracts/src/permission.ts` | 从 `AgentModeId` union 中移除 `'debug'` |
| `apps/desktop/src/agent-mode.test.ts` | 删除 debug mode 测试用例 |
| `apps/desktop/src/composer-plus-menu.tsx` | 删除 `case 'debug'` 分支 |
| `apps/desktop/src/slash/slash-catalog.ts` | 从 `MODE_SLASH_NAMES` 中移除 `'debug'` |
| `apps/desktop/src/slash/slash-parse.ts` | 从 `MODE_NAMES` 中移除 `'debug'` |
| `apps/desktop/src/slash/slash-types.ts` | 从 `modeId` union 中移除 `'debug'` |
| `packages/contracts/src/permission.test.ts` | 删除 `resolvePreset('auto', 'debug')` 测试用例 |

### 1.2 约束

- 不修改 `resolvePreset` 函数本身——`debug` 分支本就不触发 read-only floor，删除 union 成员后 default `'agent'` 行为不变。
- `AgentModeId` 缩减为 `'agent' | 'plan' | 'ask'`。

## 2. Plan/Ask Mode 权限绑定

### 2.1 问题

`resolvePreset(preset, agentMode)` 在 `packages/contracts/src/permission.ts:124` 正确实现了 Plan/Ask → read-only floor。但：

- `sdk-adapter.ts:527` 调用 `resolvePreset(presetFromConfig).mode`——**未传 `agentMode`**，始终 default 到 `'agent'`。
- `agentMode` 只在 Desktop UI 层通过 `applyAgentModeToPrompt` 前缀注入 prompt text，从未作为结构化字段传给 host。
- 权限模式在 session creation 时固定，不是 per-prompt 动态的。

### 2.2 方案

**在 `PromptInput` 中增加可选 `agentMode` 字段，host 在 prompt 处理时动态解析权限 floor。**

#### 2.2.1 Contracts 改动

`packages/contracts/src/host.ts` — `PromptInput` 增加：

```typescript
export type PromptInput = {
  text: string;
  attachments?: PromptAttachment[];
  model?: ModelRef;
  thinkingLevel?: ThinkingLevel;
  streamingBehavior?: 'steer' | 'followUp';
  /** Agent collaboration mode for this prompt. When set to 'plan' or 'ask',
   *  the host raises the permission floor to read-only (ask-all + read-only
   *  sandbox) regardless of the session's configured preset. */
  agentMode?: AgentModeId;
};
```

`packages/contracts/src/host.ts` 需 import `AgentModeId` from `./permission.js`。

#### 2.2.2 Host 改动

`packages/agent-host/src/commands/session-live-commands.ts` — 在 prompt preparation 中：

1. 读取 `command.input.agentMode`（可能为 undefined，backward compat）。
2. 如果 `agentMode` 是 `'plan'` 或 `'ask'`，加载 config，调用 `resolvePreset(preset, agentMode)` 得到 `ResolvedPreset`。
3. 将 resolved mode 注入到当前 prompt 的 permission context 中。

**实现方式**：在 `HostCommandContext` 中增加一个 `resolvePermissionForPrompt` seam，或者更简单地——在 `session-live-commands.ts` 的 prompt preparation 中，当 `agentMode` 是 plan/ask 时，直接将 resolved mode 设置到 session 的 in-memory permission override 中。

具体来说，`sdk-adapter.ts` 在创建 Pi session 时使用 `effectivePermissionMode`。我们需要一个 per-prompt override 机制：

- 在 `HostCommandContext` 中增加 `sessionPermissionOverrides: Map<string, PermissionMode>`。
- `session-live-commands.ts` 在处理 prompt 时，如果 `agentMode` 是 plan/ask，计算 `resolvePreset(preset, agentMode).mode` 并写入 override map。
- `sdk-adapter.ts` 的 permission gate 读取时优先检查 override map。

**更简洁的替代方案**：由于 plan/ask 的 read-only floor 主要是告诉模型不要修改文件（通过 system preamble 已经做了），加上 permission policy 的 `ask-all` 模式，可以在 `session-live-commands.ts` 中直接注入一个 permission directive 到 prompt context，而不需要修改 sdk-adapter 的 session-level permission mode。

**决策点 A**：是否需要真正在 Pi SDK 层面切换 permission mode（阻止 file-write 工具注册），还是只靠 system preamble + permission policy 的 ask-all 就够了？

- **选项 1（完整绑定）**：per-prompt override 传到 sdk-adapter，动态切换 permission mode。更安全但实现复杂。
- **选项 2（轻量绑定）**：在 `session-live-commands.ts` 中，当 plan/ask mode 时，注入一个 `[piwin-permission:read-only]` directive 到 prompt text，同时在 `permission-policy.ts` 的 evaluate 中检测该 directive 并强制 ask-all。中等复杂度。
- **选项 3（最小绑定）**：只在 `resolvePreset` 调用时传入 agentMode，用于 session creation 时的初始 permission mode。Per-prompt 切换留到后续。最小改动但不能动态切换。

**推荐选项 1**——完整绑定，因为这是用户明确要求的"绑定"。

#### 2.2.3 UI 改动

`apps/desktop/src/hooks/use-composer-media.ts` — 在构建 `session/prompt` input 时，将 `args.agentMode` 作为 `agentMode` 字段传入 `PromptInput`，而不仅仅是 prefix 到 text。

`applyAgentModeToPrompt` 保留——它仍然注入 system preamble 让模型知道 mode 约束。但 `agentMode` 同时作为结构化字段传给 host 用于权限解析。

### 2.3 Plan Mode 自动切换

用户设想：模型遇到复杂任务时自动切换到 plan mode。

**实现方式**：在 `agent` mode 的 system preamble 中增加指引：

```
When you encounter a task that requires multiple steps or touches multiple files,
switch to Plan Mode by calling piwin_plan_create. Do not implement until the plan
is approved.
```

这不需要 host 逻辑变更——模型通过 `writing-plans` skill 或直接调用 `piwin_plan_create` 工具触发 plan 创建，UI 检测到 plan draft 后自动显示 PlanCard。

**决策点 B**：是否需要 host 自动切换 `agentMode` 字段（从 `'agent'` → `'plan'`），还是只靠模型行为（调用 plan-create 工具）就够了？

- **选项 A**：模型调用 `piwin_plan_create` 时，host 自动将 session 的 agentMode 切换为 `'plan'`，UI 同步更新。需要 host → UI 事件。
- **选项 B**：不自动切换 agentMode，只靠 plan artifact 的出现来引导 UI。更简单。

**推荐选项 B**——plan artifact 已经驱动 UI（PlanCard 渲染），agentMode 切换是 UX 锦上添花，可以后续加。

## 3. Plan 执行完成后生成 Walkthrough Artifact

### 3.1 现状

- `plan-execution-coordinator.ts` 有 `buildWalkthrough()` 返回 `PlanExecutionWalkthrough`（结构化摘要：completedStepIds, failedStepIds 等）。
- `PlanExecutionWalkthrough` 是纯数据，不生成 Markdown，不调用 walkthrough completion 管线。
- `walkthrough-commands.ts` 的 `handleWalkthroughGenerate` 可以生成 walkthrough artifact，但 plan 执行完成后没有人调用它。

### 3.2 方案

在 `plan-commands.ts` 的 `runPlanExecution` 中，当 plan 执行完成（`markCompleted`）后，自动触发 walkthrough 生成：

1. **收集 evidence**：使用 `collectWalkthroughEvidence` 收集 plan 执行过程中的消息。Plan 执行的 evidence 包括：
   - 用户原始请求
   - Plan 本身（goal, steps, execution mode）
   - 每步的执行结果（inline 的 assistant response，subagent-driven 的 child session results）
   - 变更路径
   - 验证结果

2. **生成 walkthrough**：调用现有的 `startWalkthroughGeneration` 管线，使用 `DEFAULT_WALKTHROUGH_PROMPT`（已包含 Mermaid 指引）。

3. **输出**：
   - 聊天区域：模型给出简洁结论（2-3 句总结）
   - Walkthrough Artifact：详细文档（JSON + .md），包含 plan 执行的完整 walkthrough

### 3.3 实现细节

`packages/agent-host/src/commands/plan-commands.ts` — `markCompleted` 后：

```typescript
// After plan completion, auto-generate a walkthrough artifact.
// This aligns with Google Antigravity: plan execution → walkthrough.
if (context.walkthrough?.context && context.walkthrough?.registry) {
  const messages = await loadTranscriptMessages(sessionId);
  const finalAssistant = findFinalAssistantMessage(messages, sessionId);
  if (finalAssistant && isWalkthroughEligibleMessage(finalAssistant, messages)) {
    const config = await context.loadConfig();
    if (config.walkthrough?.enabled) {
      await startWalkthroughGeneration(
        sessionId,
        finalAssistant.id,
        resolvedModel,
        resolvedProvider,
        'default',
        config.walkthrough,
        finalAssistant,
        messages,
        context.walkthrough.context,
        context.walkthrough.registry,
      );
    }
  }
}
```

**决策点 C**：plan walkthrough 是否需要包含 plan-specific evidence（steps, execution mode, child sessions），还是复用通用的 `collectWalkthroughEvidence`？

- **选项 A**：扩展 `collectWalkthroughEvidence` 增加 plan evidence（plan steps, execution mode, child session summaries）。更丰富但改动大。
- **选项 B**：复用现有 `collectWalkthroughEvidence`，plan 信息已经通过 plan context injection 出现在 assistant response 中，evidence 收集会自然包含。更简单。

**推荐选项 B**——plan context 已经通过 `formatPlanForModelContext` 注入到 prompt 中，assistant response 会引用 plan steps，evidence 收集自然包含这些信息。

### 3.4 HostCommandContext 改动

`HostCommandContext` 需要增加 walkthrough seam 的访问：

```typescript
export type HostCommandContext = {
  // ... existing fields ...
  walkthrough?: {
    context: WalkthroughCommandContext;
    registry: WalkthroughGenerationRegistry;
  };
};
```

检查 `host-runtime.ts` 中 `buildCommandContext` 是否已经包含 walkthrough seam——如果是，只需在 `plan-commands.ts` 中使用它。

## 4. 安装 subagent-driven-development Skill

### 4.1 操作

从 superpowers 全局 skill 安装到 piwin skills 目录：

```bash
cp -r ~/.config/devin/skills/subagent-driven-development skills/subagent-driven-development
```

或者通过 piwin marketplace install 机制（如果支持全局 skill 安装）。

### 4.2 Skill 内容

`skills/subagent-driven-development/SKILL.md` 需要适配 piwin 的工具名称：
- `piwin_plan_create` 而非通用 plan tool
- `piwin_plan_set_step` 更新步骤状态
- subagent spawn/merge 通过 host seam

### 4.3 约束

- Skill 是 Markdown 指引文件，不引入代码依赖。
- 遵循 piwin skill 格式（YAML frontmatter + Markdown body）。
- Skill id: `subagent-driven-development`。

## 5. 改动文件清单

| 文件 | 改动类型 | 说明 |
|------|----------|------|
| `packages/contracts/src/host.ts` | 修改 | `PromptInput` 增加 `agentMode` 字段 |
| `packages/contracts/src/permission.ts` | 修改 | `AgentModeId` 移除 `'debug'` |
| `packages/contracts/src/permission.test.ts` | 修改 | 删除 debug 测试 |
| `apps/desktop/src/agent-mode.ts` | 修改 | 移除 debug mode 定义 |
| `apps/desktop/src/agent-mode.test.ts` | 修改 | 删除 debug 测试 |
| `apps/desktop/src/composer-plus-menu.tsx` | 修改 | 删除 debug icon case |
| `apps/desktop/src/slash/slash-catalog.ts` | 修改 | 移除 debug |
| `apps/desktop/src/slash/slash-parse.ts` | 修改 | 移除 debug |
| `apps/desktop/src/slash/slash-types.ts` | 修改 | 移除 debug |
| `apps/desktop/src/hooks/use-composer-media.ts` | 修改 | 传入 `agentMode` 到 PromptInput |
| `packages/agent-host/src/commands/session-live-commands.ts` | 修改 | 读取 `agentMode`，解析权限 floor |
| `packages/agent-host/src/sdk-adapter.ts` | 修改 | 支持 per-prompt permission override |
| `packages/agent-host/src/commands/plan-commands.ts` | 修改 | plan 完成后触发 walkthrough 生成 |
| `packages/agent-host/src/commands/host-command-context.ts` | 修改 | 增加 walkthrough seam 访问 |
| `skills/subagent-driven-development/SKILL.md` | 新增 | subagent-driven-development skill |

## 6. 测试要求

| 改动 | 测试 |
|------|------|
| Debug mode 删除 | 现有 typecheck + test 通过 |
| PromptInput.agentMode | contracts type test |
| resolvePreset with agentMode | permission.test.ts 已有覆盖 |
| session-live-commands 权限注入 | 新增 unit test：plan/ask mode 时 permission override 生效 |
| sdk-adapter per-prompt override | 新增 integration test |
| plan-commands walkthrough 触发 | 新增 unit test：plan 完成后 walkthrough 生成被调用 |
| subagent-driven-development skill | skill scanner test 通过 |

## 7. 验证

```bash
pnpm typecheck
pnpm test
```

手动验证：
1. 切换到 Plan mode，发送 prompt，确认权限变为 read-only。
2. `/writing-plans` 生成 plan，PlanCard 出现，点击 Process，选择执行模式。
3. Plan 执行完成后，聊天区域有简洁总结，Walkthrough Artifact 生成（JSON + .md）。
4. `/subagent-driven-development` skill 可被 slash command 调用。

## 8. 实现顺序

1. 删除 Debug mode（contracts → desktop UI → tests）
2. `PromptInput.agentMode` 字段（contracts）
3. Host 权限绑定（session-live-commands + sdk-adapter）
4. UI 传入 agentMode（use-composer-media）
5. Plan 完成后 walkthrough 生成（plan-commands）
6. 安装 subagent-driven-development skill
7. 全量 typecheck + test
