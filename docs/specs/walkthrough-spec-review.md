# Walkthrough 定义与流程理顺 Spec — 审查意见

> 审查对象：`~/.gemini/antigravity/brain/3d0d614c-7eab-4f62-9c06-e8c6b19c4ad9/implementation_plan.md`
> 日期：2026-08-01
> 结论：**无冲突**，文档事实基本准确；发现 3 处文档遗漏的代码问题 + 2 处文档自身问题。

## 1. 与当前实现的核对结果

| 文档声明 | 核实结果 |
|:---|:---|
| `PlanExecutionWalkthrough` 存在且仅 Host 内部使用 | ✅ `contracts/plan-execution.ts:35`；`buildWalkthrough()` 在 `plan-execution-coordinator.ts:156`；apps/ 无引用，重命名安全 |
| `createDefaultWalkthroughConfig()` 默认 `autoGenerate: true` | ✅ `contracts/walkthrough.ts:84` |
| 原始 spec 说"默认不自动调用模型" | ✅ `docs/specs/walkthrough-artifact.md:14` + §4.2 明确"不增加 autoGenerate 配置"——分叉属实 |
| `concisePrompt` 注入逻辑 `enabled && autoGenerate && concisePrompt` | ✅ `packages/agent-host/src/commands/session-live-commands.ts:273` |
| `triggerPlanWalkthrough()` 在 plan 完成后触发 | ✅ `packages/agent-host/src/commands/plan-commands.ts:454` |
| `maybeTriggerAutoWalkthrough()` 在 run terminal 触发 | ✅ `packages/agent-host/src/host-runtime.ts:2255` |
| `WalkthroughGenerationRegistry` 用 `sessionId:messageId` in-flight 去重 | ✅ `packages/agent-host/src/commands/walkthrough-commands.ts:87-115` |

**结论**：文档的四步方案（重命名 / autoGenerate 默认值 / 双轨制文档化 / 触发去重文档化）全部是命名 + 文档 + 产品决策类改动，不涉及与现有实现冲突。

## 2. 文档遗漏的 3 处代码问题

### 2.1 两条触发路径的行为不对称（最重要）

- 自动路径 `maybeTriggerAutoWalkthrough` 有 `isAutoWalkthroughEligible()` 门槛——**要求该 run 至少用过一次工具**（纯 Q&A 不触发）。
- 但 plan 路径 `triggerPlanWalkthrough` 只检查 `isWalkthroughEligibleMessage()`，**没有工具使用门槛**。plan 的验证轮（verify directive）如果没用工具，也会生成 walkthrough。

文档的改动 6 只讨论去重，没有讨论这个行为差异。建议 plan 路径也加 `isAutoWalkthroughEligible` 或工具证据检查，使两条路径语义一致。

### 2.2 `concisePrompt` 的注释与代码不一致

- `contracts/walkthrough.ts:27` 和 `:60-63` 的注释说 "when autoGenerate is on **and a plan is active**"。
- 但实际注入代码 `session-live-commands.ts:273` **不检查 plan**，只要 `enabled && autoGenerate` 就注入。代码是有意为之（session-live-commands 里已有注释 "applies regardless of plan state"），但 contracts 的注释是过时的。

### 2.3 重命名范围缺了常量

- 改动 1 只列了类型和函数，但 `contracts/plan-execution.ts:49` 的 `MAX_PLAN_WALKTHROUGH_UNRESOLVED` 常量名也含 "WALKTHROUGH"，重命名后应一并处理，文档没提。

## 3. 文档自身的问题

### 3.1 内部表述矛盾

混淆 B 把"全局注入 concisePrompt"描述成问题（"和用户的理解之间存在间隙"），但改动 4 又说"保持当前逻辑不变（它已经是正确的）"。逻辑上自洽（靠文档解释解决），但措辞自相矛盾。

### 3.2 改动 3 的 Q1 是真正需要用户决策的点

`autoGenerate: true` 意味着每个 coding turn 都额外消耗 token。文档推荐选项 B（保持 true、更新 spec），合理，但这是产品决策，需要用户确认。

## 4. 建议

文档整体方向正确，无需改代码。若要执行：

1. 重命名时把 `MAX_PLAN_WALKTHROUGH_UNRESOLVED` 一起改。
2. 给 `triggerPlanWalkthrough` 补上工具使用门槛（对齐自动路径）。
3. 修掉 contracts 里 "and a plan is active" 的过时注释。
