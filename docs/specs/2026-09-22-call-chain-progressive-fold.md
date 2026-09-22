# 调用链渐进折叠 — 运行中的工作胶囊

- 日期：2026-09-22
- 状态：WP0 / WP1 / WP3 已实现（见 §11）；WP2 / WP4 未做
- 相关：`docs/design/deck-design-system.md` §6 Motion、`docs/specs/agent-activity-motion-matrix.html`

## 0. 一句话

**运行中给进展，完成后给结果，细节永远可追溯**；一个回合只产生一个会呼吸的工作胶囊，
已完成的阶段不是消失，而是**降级沉淀**成安静的摘要行。

---

## 1. 问题（读代码确认，非推测）

| # | 症状 | 根因 |
|---|---|---|
| 1 | 运行中调用链完全铺开，刷屏 | `projectTurnWorkDisclosure()` 开头 `if (!settled) return null` —— 回合级折叠只在结束后存在 |
| 2 | `思考过程 → bash → 思考过程 → bash` 长串 | `resolveToolClusterKind()` 把 `kind === 'shell'` 一律判 `command`；`isFlowExploratoryTool()` 只收 `read`/`search`，于是 `bash grep` 每次打断探索流 |
| 3 | 每条 assistant message 各自画一个「思考过程」标题 | `TurnWorkDetails` 是 per-message 组件，没有回合级拥有者 |
| 4 | 设置里的密度选择不完全生效 | `explore-flow-capsule.tsx:270`、`tool-batch-capsule.tsx:395` 写死 `density="compact"` |
| 5 | 展开后任务结束会自动收起 | `ExploreFlowCapsule` 的 `expanded` 从 `group.isLive` 派生，`live-open` 不跨越 settle |

已具备、**不要重造**的基建：

- 流光：`wb-shimmer` / `behavior-*-active`（`styles/behavior-activity.css`）
- 行为动效注册表：`BEHAVIOR_ACTIVITY_REGISTRY`（`behavior-activity.ts`）
- 状态轮播：`useRunActivityPhrases`（1.8s 周期，`prefers-reduced-motion` 已处理）
- 跨消息探索分组：`buildExploreFlowRoles`（`explore-flow.ts`）
- 双主题 token：`piwin-inkstone-paper` / `piwin-inkstone-ink`

## 2. 对 Cursor 的调研结论

公开可查的两点：

- **Cursor 1.4**：Compact 模式隐藏工具图标、默认收起 diff，专治长会话工具刷屏。
- **Cursor 3.4（2026-05-13）Compact Chats**：工具调用密度分三档 —— Compact「最少痕迹」、
  Balanced「重要中间步骤」、Detailed「接近完整的逐步上下文」。
- **3.10.20 起**工具调用聚合为 `Explored (N) tools` 一行。

**必须抄的**：三档密度、只让**当前正在流式输出**的那条思考带流光（更早的思考必须沉淀）、
跨消息聚合成一个胶囊。

**必须避开的**（Cursor 现存缺陷，社区已反弹、官方 Mohit Jain 已承认）：
`Explored` 分组在 **Detailed 档位下依然吞掉 MCP 调用**。用户的原话是「所有信息都被埋在
一个要点开好几层的 Explored 开关下面」。

> 由此定下本方案的**第一硬性约束**：密度档位必须被字面遵守。
> **Detailed 档位下不允许任何工具被藏在聚合标签背后**，
> 且任何有副作用的工具（写入、MCP、git 写、浏览器、未知命令）
> 永远不得被塞进只读语义的聚合里（「分析了 N 项」）。

## 3. 结构：一个回合 = 一个 WorkRun

```
WorkRun（回合级，唯一外层容器）
 └── Phase（阶段，3–5 个封顶）
      └── Item（单项：工具 / 思考 / 子代理）
           └── Detail（输出 / diff / 错误全文，默认继续折叠）
```

### 3.1 阶段种类

| 阶段 | 归入内容 | 中文标签（运行中 / 完成后） |
|---|---|---|
| `analyze` | read、search、**只读 shell** | 正在分析代码库 / 已分析 |
| `edit` | write、edit、patch | 正在修改文件 / 已修改 |
| `verify` | test、build、lint、typecheck | 正在验证 / 已验证 |
| `command` | 有副作用或**无法判定**的 shell | 正在执行命令 / 已执行 |
| `external` | web、browser、MCP、git 写 | 正在调用外部服务 / 已调用 |
| `delegate` | 子代理 | 子代理运行中 / 子代理完成 |

阶段在**种类改变**或**助手写出正文**时关闭。一个回合最多展示 5 个阶段摘要，
超出则同种类阶段合并计数。

### 3.2 强制可见（hoist）——任何密度、任何状态都不折叠

1. 权限请求、等待用户选择、plan 执行门
2. 工具失败：阶段标题打异常标记，**只自动展开失败项**，不展开整组
3. 文件写入：始终保留「已修改 N 文件 · +a −b」可点击行
4. 子代理调用块
5. **`unknown` 意图的命令**（Balanced 及以上）—— 不认识的命令绝不悄悄塞进「已分析」

取消不是错误：显示「已停止 · N 项」。

## 4. 命令意图分类器（新模块 `shell-command-intent.ts`）

现在的缺口是把 `bash` 一刀切。判定优先级：

1. 宿主给的结构化 `actionVerb`
2. 宿主 `ToolKind`
3. **命令意图分析**（本模块）
4. 工具名猜测

```ts
export type ShellIntent = 'read-only' | 'verify' | 'mutate' | 'unknown';
```

规则：

- 先按 `&&`、`||`、`;`、`|` 切段，逐段判定，取**最危险**的结果
  （`mutate` > `unknown` > `verify` > `read-only`）。
  `cat a && rm b` 必须是 `mutate`。
- 任何位置出现 `>`、`>>`、`tee` → `mutate`。
- `read-only`：`grep rg ag ls tree find fd cat head tail wc file stat du df pwd echo
  which basename dirname sort uniq diff jq yq awk`、`sed`（不带 `-i`）、`cd`、
  `git status|diff|log|show|branch|rev-parse|blame`
- `verify`：`pnpm|npm|yarn` + `test|vitest|jest|lint|typecheck|build`、`tsc`、`eslint`、
  `pytest`、`cargo test|check|clippy`、`go test`、`make test`
- `mutate`：`rm mv cp mkdir touch chmod chown ln kill curl wget ssh scp`、
  `sed -i`、`npm|pnpm install|add|remove`、`git commit|push|checkout|reset|clean|stash|rebase|merge`、
  `docker`、`kubectl`
- 其余 → `unknown`

`read-only` → 进 `analyze`；`verify` → 进 `verify`；其余各自成行。

## 5. 三档密度

对外文案改为 紧凑 / 平衡 / 详细；**存储键保持 `compact` / `comfortable` / `detailed` 不变**，
已有设置不失效。默认 平衡。

| | 紧凑 | 平衡（默认） | 详细 |
|---|---|---|---|
| 运行中 | 一条实时胶囊 + 轮播 | 胶囊 + 已完成阶段摘要 | 胶囊 + 每条工具行实时可见 |
| 完成后 | 一行总摘要 | 阶段摘要 + 关键统计 | 完整链路展开，**不自动折叠任何一项** |
| 展开后 | 阶段摘要 | 完整工具时间线 | 时间线 + 输出（逐项展开） |

密度必须真正传到子卡片：去掉 `explore-flow-capsule.tsx` 与 `tool-batch-capsule.tsx`
里写死的 `density="compact"`。

## 6. 视觉：降级阶梯（「渐进式」的核心）

一个胶囊内部三个高度层，**没有任何元素凭空出现或消失，只会下沉**：

| 层 | 状态 | 颜色 | 动效 | 高度 |
|---|---|---|---|---|
| 0 | 当前阶段（in-flight） | `--t1` | 流光 + 呼吸节点 | 2 行（标题 + 轮播） |
| 1 | 刚结束（cooling，1.2s） | `--t1 → --t3` 缓动 | 流光停止 | 2 行 → 1 行缓动 |
| 2 | 已沉淀（chip） | `--t3` | 无 | 1 行 |

`prefers-reduced-motion: reduce` 下跳过第 1 层，直接切换。

### 6.1 运行中形态

```
│ ◐  正在分析代码库                        8 项 · 3 文件 · 12s  ›
│      ↳ grep "handleStartNewSession"
```

### 6.2 多阶段运行中（降级已发生）

```
│ ✓  已分析 · 6 次搜索 · 3 文件 · 9s
│ ✓  已修改 · 2 文件 · +42 −18
│ ◐  正在验证                                            3s  ›
│      ↳ pnpm vitest run tool-group-clustering
```

### 6.3 完成后（平衡档默认）

```
│ ▸  已工作 24s · 12 个工具 · 5 个文件
```

展开后才是现有的工具时间线 —— 直接复用 `ToolCallCard` / `ExploreFlowCapsule`。

## 7. 流光（主题自适应）

三层同相位的光，全部基于既有 token，因此在 paper / ink 两个主题下自动成立。

1. **轨道流光**：胶囊左侧 1px 轨（复用 `.tool-batch-timeline-track`）承载一段向下
   行进的渐变，周期 `--shimmer`（1.6s）linear。
   底色 `--l1`，光色 `color-mix(in srgb, var(--lamp) 70%, transparent)`。
   `--lamp` 在 paper 是 `#b8801f`、ink 是 `#e7b352`，两边都是暖色，读作余烬，
   与 Deck 的 Ember Wash 是同一套语言。
2. **文字流光**：当前阶段标题复用既有 `behavior-*-active`，**不新造 class**。
3. **底缘微光**：当前行下缘 1px，`background-position` 走 `--wash-cycle`（4.8s）。

1.6s 与 4.8s 两个速度叠加，读起来是有机的呼吸，而不是进度条。

> **克制条款**（Deck 规则：流光只给真正在飞行的行）：
> **整个 transcript 同一时刻只允许一行带流光。**
> 胶囊展开时，流光从胶囊头**下移**到真正在跑的那条工具行，绝不同时亮两处。

## 8. 运行时状态轮播 —— 必须真实

新模块 `work-run-ticker.ts`。副标题内容按优先级取：

1. 有工具在跑 → 该工具的动作标签（`正在检索 handleStartNewSession`）。
   并行多个 → `正在并行执行 3 项` + 在各标签间轮播（复用 1.8s 周期）。
2. 无工具在跑但模型在流式输出 → 最近 2 条已完成动作以过去式轮播
   （`已读 use-session-actions.ts`），与运行短语交替。
3. 什么都没有（等首 token）→ 回落到既有 `RUNTIME_STATUS_PHRASES`。
   **这是全方案唯一允许出现罐头文案的位置。**

动效：扩展既有 `ActionMarquee` 为双槽交叉 —— 旧行上滑淡出、新行自 +5px 升起
（航班信息牌感），复用 `action-marquee-slide-up`，不新建组件。

15s 后沿用既有「taking too long」短语。计时数字用
`font-variant-numeric: tabular-nums`，否则秒数跳动会让整行抖。

## 9. 折叠状态所有权

- 状态键：`sessionId + turnId + phaseId`，存在 store 里，**不能只靠组件本地 state**
  （虚拟化 / 重挂载 / HMR 都会丢）。
- 用户手动展开 → 运行结束**不得**自动收回（修复当前 `live-open` 不跨 settle 的问题）。
- 用户手动收起 → 后续状态更新**不得**重新展开。
- 只有失败项自动展开，且只展开该项。
- 高度变化期间：用户不在底部时，新工具到达不得改变视口位置
  （`overflow-anchor` + 既有 `useTranscriptLocalFoldMeasure`）。

## 10. 落地文件

**新增**

| 文件 | 职责 | 状态 |
|---|---|---|
| `apps/desktop/src/shell-command-intent.ts` | 命令意图分类（纯函数） | ✅ 已建，含 23 个单测 |
| `apps/desktop/src/work-run-model.ts` | 阶段投影 | ❌ 没建 —— 见 §11.1 第 1 条 |
| `apps/desktop/src/work-run-ticker.ts` | 真实事件轮播源 | ⬜ WP2 |
| `apps/desktop/src/work-run-capsule.tsx` | 运行中的工作胶囊 | ❌ 没建，复用 `WorkFoldHeader` |
| `apps/desktop/src/styles/transcript-work-run.css` | 轨道流光、cooling、chip | ⬜ WP2 |

> §3 的阶段模型、§6 的降级阶梯、§8 的轮播**都还没实现**。已落地的是「一个回合
> 一个折叠头」，不是「一个回合若干阶段摘要」。阶段化要等 WP2。

**修改**

| 文件 | 改动 |
|---|---|
| `turn-work-disclosure-model.ts` | ✅ 新增 `projectLiveRange()`；运行中也产出区间 |
| `chat-thread.tsx` | ✅ 传入 `permissionPending` / `exploreFoldedMessageIds`；详细档默认展开 |
| `turn-work-disclosure.tsx` | ✅ `running` / `done` 两态，复用 `WorkFoldHeader` |
| `tool-group-clustering.ts` | ✅ 接入 `shell-command-intent`；`countExploredFiles` 不再把无路径的 shell 读算成文件 |
| `explore-flow.ts` | ✅ 无需改动 —— 只读 shell 现在就返回 `read`/`search`，自动入组 |
| `explore-flow-capsule.tsx`、`tool-batch-capsule.tsx` | ✅ 透传 `density`，删掉写死的 `"compact"` |
| `turn-work-details.tsx` | ✅ 向 `ExploreFlowCapsule` 传 `density`（顶层「思考过程」标题未改，见 §11.2） |
| `settings/pages/appearance-page.tsx` | ⬜ 文案未改 |

`turn-work-disclosure-model.ts` 已 375 行（AGENTS.md §3.2 的 ~400 行预警线），
因此阶段投影**新开文件**而非往里塞。

## 11. 工作包与进度

| WP | 内容 | 状态 |
|---|---|---|
| **WP0** | 命令意图分类 + clustering 接入 | ✅ 已实现 |
| **WP1** | 运行中的回合级折叠 | ✅ 已实现（复用 `WorkFoldHeader`，未新建组件） |
| WP2 | 轨道流光 / cooling / 真实轮播 | ⬜ 未做 |
| **WP3** | 密度真正传到子卡片 | ✅ 已实现 |
| WP4 | 折叠状态 store + 滚动锚定 | ⬜ 未做 |

### 11.1 实现中修正的设计（重要）

原方案里下面五条是错的或缺失的，实现时由测试逼出来：

1. **不新建 `work-run-capsule.tsx`。** `WorkFoldHeader` 已经有完整的 `running`
   状态（lamp 呼吸 + 「正在运行 · 第 N 个工具 · `code`」+ 实时时钟），双主题 CSS
   也齐全。运行中的胶囊 = 既有组件，零新 UI。

2. **整条链已经是一个 explore 胶囊时，不再套一层。**
   纯探索回合本来就只有一行，而且 `探索了 6 个文件` 比 `正在运行 · 第 8 个工具`
   信息量更大。再包一层只会多一次点击 —— 正是 Cursor 被吐槽的那个毛病。
   判据：范围内所有带工具的消息都已属于 explore 组 → 不折。

3. **只有真的有工具在跑时才敢说「正在运行」。** 工具轮结束、模型在组织语言时，
   run status footer 已经在说「正在思考」；折叠头再喊一句「正在运行」既重复又
   不真实。无工具在跑时，折叠头退回摘要形态。**折叠头只负责「做了什么」，
   footer 只负责「现在什么状态」。**

4. **纯思考不折。** 范围内没有任何工具时不折 —— 「思考中」+ 计时比
   「正在运行」有用，而且此时根本没有链可折。容器随第一个工具出现。

5. **live 范围的四种强制豁免**：运行中的子代理卡（折叠止于其上一行）、
   携带生成媒体的行、已发生的错误、打开的权限门。前两条是既有测试抓出来的
   真实回归。

另加：`toolDensity === 'detailed'` 时回合折叠默认展开 —— 「详细」就该是详细，
不该让用户再点一次。

### 11.2 WP2 / WP4 未做的原因

WP2（轨道流光、cooling 降级、真实事件轮播）需要新的 CSS 与新组件，
是纯视觉增量；WP0/WP1 已经解决「明晃晃」的主诉。建议先用一版真实会话确认
折叠粒度合适，再决定流光要做到哪一档。

## 12. 验收标准

**折叠**

1. 截图里连续的 `思考过程 + bash` 在运行时最多占 1–2 行。
2. 20 次连续搜索/读取/只读命令，默认最多显示一个 `analyze` 胶囊。
3. 一个回合最多出现 5 个阶段摘要。
4. 展开后每一条工具调用仍在，**顺序不丢**。
5. 连续思考不再重复渲染多个顶层「思考过程」。

**密度**（针对 Cursor 现存缺陷）

6. 三档确实改变展示量。
7. **详细档下不存在任何被聚合标签隐藏的工具**，MCP 调用尤其必须独立可见。
8. 未知意图的命令在平衡档及以上永不进入 `analyze` 聚合。

**强制可见**

9. 权限、错误、等待用户操作在任何密度下始终可见。
10. 失败只展开失败项，不展开整条工作链。
11. 取消显示「已停止 · N 项」，不计为错误。

**交互**

12. 用户展开后，任务完成不会自动收起；手动收起后不会被状态更新重新展开。
13. 用户向上阅读历史时，新工具到达不改变视口位置。

**视觉**

14. paper / ink 两主题下流光对比度均达标，不刺眼、不隐形。
15. 同一时刻整个 transcript 只有一行带流光。
16. `prefers-reduced-motion: reduce` 下所有流光/降级动画塌缩，状态色保留。
17. 计时数字等宽（`tabular-nums`），秒数跳动不引起行抖动。
18. 阶段降级是缓动下沉，无元素凭空出现或消失。

---

## 附：Cursor 参考来源

- [Cursor 1.4 Changelog](https://cursor.com/changelog/1-4)
- [Cursor 3.4 — Full-screen Tabs and Compact Chats](https://cursor.com/changelog/3-4)
- [Cursor 3.0 — New Interface](https://cursor.com/changelog/3-0)
- [论坛：新版违背设置隐藏工具细节](https://forum.cursor.com/t/new-version-hides-agent-tool-call-details-in-defiance-of-setting/165292)
