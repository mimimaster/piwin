# Spec: 会话树（会话内）与 Fork Chat（新会话）

| Field | Value |
|-------|-------|
| Status | v1 implementation |
| Date | 2026-08-27 |
| Related | ADR 0055, [session-conversation-tree](./session-conversation-tree.md), [session-fork-product-adaptation](./session-fork-product-adaptation.md) |
| Binding | Product owner direction 2026-08-27: Fork 与树分开；顶栏「会话树」画当前会话内分岔 |

## 1. Product one-liner

**树**是这条会话里的分岔地图。**Fork Chat** 是从某句另开一条独立会话。两套动作可以挂在同一条助手消息上，结果不进同一棵节点树。

## 2. Locked decisions

| ID | Decision |
|----|----------|
| ST-D1 | Fork 不叫树，不出现在顶栏会话树里。 |
| ST-D2 | 源会话 **不改名**。新会话标题为 `(1) 原标题`、`(2) 原标题`，号码在同一标题家族内递增。兼容旧名 `· Branch`：新 Fork 仍按 `(n)` 编号。 |
| ST-D3 | Fork 两个入口：助手消息结尾 **Fork Chat**；侧栏会话右键 **Fork Chat**（从该会话活跃路径上最后一条已完成助手回复截取）。 |
| ST-D4 | Duplicate / 复制仍留在会话菜单，不进消息条，也不加入 `(n)` 编号家族。 |
| ST-D5 | 顶栏「会话树」只读 `session/branch-list`（ADR 0055）。空态教编辑重发 / 再生成，不提 Fork。 |
| ST-D6 | 主对话区只播当前活跃路径。切换分岔时，分叉点以上不动，以下整段替换。 |
| ST-D7 | 树上的节点是 **用户轮次 / 分叉点**，不是每一条助手、思考或工具消息。线性多轮收成叶子上的轮次计数。 |
| ST-D8 | v1 树面板 = 已有分叉点清单（`BranchPointsPanel`）升到顶栏，不做平移缩放的图形树。 |

## 3. Fork Chat

### 3.1 Naming

`buildForkSessionName(sourceName, sourceId, usedNames)`：

1. 标题根：去掉前导 `(n)` 和旧后缀 ` · Branch` / ` · Branch N`。
2. `usedNames` 含源会话名 + 同一血统上已有会话名（lineage 节点），避免从子会话再 Fork 时撞 `(1)`。
3. 从 1 起找第一个未占用的 `(n) 根标题`。

例：`鹈鹕骑自行车HTML动画` → 第一次 Fork → `(1) 鹈鹕骑自行车HTML动画`；源会话标题不变。

### 3.2 Host

`session/fork.messageId` 改为可选。省略时取活跃路径上最后一条 `role=assistant && status=done`。没有已完成助手回复则失败。

### 3.3 Desktop

- 消息条：文案 `Fork Chat` / `分叉会话`。有直系 Fork 时仍可显示相关会话跳转（不叫「会话树」）。
- 会话菜单：在 Duplicate 旁增加 `fork-chat`；Host 不支持 `session/fork` 时隐藏。

## 4. 顶栏会话树

### 4.1 Data

`useBranchActions.branchPoints`。徽章 = 所有分叉点上 `max(0, siblings.length - 1)` 之和（额外分岔数）。有分岔时 `data-has-branches=true`。

### 4.2 Empty

> 当前还没有分岔。编辑已发送的消息再发送，或点再生成，就会在这条会话里分叉；原来的后续会留下来。主对话区始终只显示当前这一路。

### 4.3 Populated

沿用 `BranchPointsPanel` 分组清单：每个分叉点一组，每行一条兄弟分支（预览 + 叶预览 + 消息数）。点击非当前行走 `session/branch-switch`。流式时禁用切换。

右栏工作台不放「分支」瓷砖；会话内分岔只从顶栏「会话树」（全图）和消息侧 `‹ n/m ›` 进出。点 `n / m` 展开**该分叉点**的清单；`‹ ›` 仍切相邻兄弟。

## 5. Out of v1

- 把 Fork 出来的 `(n)` 画进会话树当子节点
- 源会话改成 `(1)`
- 图形化平移缩放树
- 侧聊 / 子代理进这棵树
- 新会话顶部「Branched from」分隔条（可随后补）

## 6. Docs follow-through

本文件落地后，[session-fork-product-adaptation](./session-fork-product-adaptation.md) 的用户用词改为 Fork Chat；ADR 0055 注明顶栏会话树 = 会话内分叉点清单。
