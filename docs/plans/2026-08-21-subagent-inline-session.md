# Plan — 子代理会话内嵌化（弹窗 → 锚点下拉）（2026-08-21）

| Field | Value |
|-------|-------|
| Status | Implemented（本文档随实现同 PR 落盘） |
| Date | 2026-08-21 |
| Trigger | 用户否决弹窗式子代理检查器：要求内嵌展开、去掉「继续向子代理追问」输入框 |
| Related | [subagent-activity-inspector plan](../superpowers/plans/2026-08-03-subagent-activity-inspector.md)、ADR 0030 |
| Binding | AGENTS.md；观察-only；不新增 Host 命令 |

---

## 0. 动机与产品裁决

1. **弹窗打断上下文。** 子代理是主代理某个 turn 的派生工作，属于转录的一部分；Modal 把它抬成了独立窗口，割裂调用现场。
2. **用户不与子代理对话。** 旧弹窗底部的「继续向子代理追问」composer 允许用户绕过主代理直接驱动子会话——与编排模型冲突（主代理是子代理会话的唯一 owner）。业界同类产品也没有这种设计。裁决：**彻底移除该入口**（`subagent/continue` Host 命令保留，Desktop 不再调用）。
3. **调用链显示与父转录一致。** 子会话内的工具调用沿用 `TurnWorkDetails` 同一套渲染，无需单独视觉语言。

## 1. 交互设计

- **锚点即手风琴头。** 转录中两类锚点可展开：
  - `SubagentInvocationBlock`（turn 工具组内的调用块），anchor = 父 toolCallId；
  - `SubagentActivityCard`（PSR D5 持久化活动卡），anchor = `card:<childSessionId>`。
- 点击锚点 → 面板在其正下方**原位下拉展开**（非弹窗、非跳转）；再点同一锚点收起；点其他锚点则单面板移动过去（全局单选）。
- 面板内容：状态胶囊（含 live 呼吸点）+ 身份 chips（role/model）+「打开完整会话 ↗」+ 收起按钮；只读转录（内部滚动，`max-height: min(52vh, 540px)`，自动跟随 + 回到最新）；保留 worktree 应用/保留/丢弃操作栏（含丢弃确认）。
- 收起/切换永不中止子代理（与旧检查器语义一致）。

## 2. 结构（apps/desktop 内部，无跨包变更）

| 部件 | 职责 |
|------|------|
| `subagent-inspector-context.tsx` | 双 context：`toggle`（selection + toggle，仅展开/收起时变化）与 `panel`（转录/live/worktree 数据，仅唯一挂载面板消费）。App 组合根统一供值，深层节点零 props 钻孔 |
| `subagent-inline-session.tsx` | 内嵌面板本体（原弹窗的转录 + worktree 能力，去掉 composer/footer/Dialog 壳） |
| `SubagentInspectorSelection.anchorId` | 锚点归属；`use-subagent-session-inspector` hook 本身不变 |
| App `handleInspectSubagent` | 改为 toggle 语义（同锚点二次点击 = 收起） |
| 删除 | `subagent-session-dialog.tsx`（含测试）、`DeferredSubagentSessionDialog`、`handleContinueSubagent` |

嵌套子转录不传 `onInspectSubagent`，嵌套调用块保持禁用（与旧弹窗行为一致），不会出现面板套面板。

## 3. 验证

- `subagent-inline-session.test.tsx`：无 composer 回归、worktree apply/discard 确认流、收起、打开完整会话。
- `turn-tool-group.test.tsx`：anchorId 归属、选中锚点展开面板、无 provider 时保持收起。
- Desktop 全量 vitest 292 文件 / 1948 用例通过；`pnpm --filter @piwin/desktop typecheck` 通过。
