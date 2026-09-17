# piwin 注意力通知（Attention Notifications）方案 · 并发执行版

| 字段 | 值 |
|------|-----|
| 状态 | **v3 并发执行版 · 决策已拍板（2026-09-17）· 可开工** |
| 日期 | 2026-09-17 |
| 编号前缀 | `AN-`（Attention Notifications） |
| 范围 | Desktop macOS（P0）· Mobile iOS（M1 本地）· Remote Push APNs（独立史诗）。**当前只有 Apple shell**，Windows / Linux / Android 暂缓 |
| 相关 | ADR 0023 / 0036 / 0037 / 0063 · 新增 ADR 0064 |
| 修订 | v1 调研草案 → v2 代码核对 → **v3 按工作包拆分、冻结接口、独占文件所有权，供并发子代理执行** |

---

## 0. 使用说明

### 0.1 编号体系

| 类别 | 前缀 | 含义 | 谁引用 |
|------|------|------|--------|
| 事实 | `AN-F##` | 代码/上游核对结果，实施基线 | 所有工作包 |
| 决策 | `AN-D##` | 已拍板的产品/架构决定，不再讨论 | 所有工作包 |
| 规则 | `AN-R##` | 行为规则（策略、清除、去重、文案、隐私） | 实现与测试 |
| 接口 | `AN-I##` | **冻结**的类型/函数签名/命令名/存储键 | 跨包协作的唯一约定 |
| 工作包 | `AN-<轨道><序号>` | 可派给一个子代理的最小执行单元 | 协调者 |
| 波次 | `W0`–`W4`（桌面）、`W5`（移动）、`W6+`（APNs） | 同一波次内工作包互不依赖，可并发 | 协调者 |
| 测试用例 | `AN-T##` | 自动化用例，归属到具体工作包 | 执行者 |
| 实机门禁 | `AN-G##` | macOS packaged `.app` 手测项 | AN-Q1 |
| 验收 | `AN-A##` | 阶段出货标准 | 协调者 / owner |
| 风险 | `AN-K##` | 风险与缓解 | 协调者 |

### 0.2 轨道代码

| 轨道 | 含义 | 主要目录 |
|------|------|----------|
| `C` | 协调（基线、接口冻结、合并） | 全仓（仅 W0 / 合并时） |
| `D` | 文档 / ADR | `docs/` |
| `S` | 共享纯逻辑 | `packages/host-client/src/attention-*` |
| `R` | 桌面 reducer / 派生状态 | `apps/desktop/src/chat-reducer-attention.ts` 等 |
| `X` | 抽取式纯重构 | `apps/desktop/src/hooks/use-shell-session-open.ts` 等 |
| `K` | ui-kit 原语 | `packages/ui-kit/src/notifications.ts` |
| `N` | macOS 原生桥 | `apps/desktop/src-tauri/` |
| `O` | 桌面 OS 适配与编排 | `apps/desktop/src/desktop-attention-*` |
| `U` | 设置界面 / 引导 | `apps/desktop/src/settings/`、`attention-opt-in-banner.tsx` |
| `Q` | 质量门禁 | `docs/plans/evidence/` |
| `M` | Mobile M1 | `apps/mobile/` |
| `P` | Remote Push（APNs） | contracts / host-runtime / mobile |

### 0.3 并发执行铁律（每个子代理必须遵守）

1. **只写自己拥有的文件**（§5 所有权矩阵）。需要改别人的文件 → 停止，回报协调者。
2. **不改冻结接口**（§4 `AN-I##`）。签名不够用 → 停止，回报「接口变更请求：AN-I## + 理由 + 建议签名」。
3. **不扩大范围**：只实现本工作包列出的规则与用例；发现的额外问题写进回报，不顺手修。
4. 遵守 `AGENTS.md`：严格 TS、ESM `.js` 后缀、无 `any`、单文件 < 1000 行、重构与行为变更分提交、不引入未列出的依赖。
5. 完成前自跑本包「验证命令」，全部通过才回报完成。
6. **禁止 `git stash`**（历史上误弹过用户旧 stash）；需要对照旧版本用 `git show HEAD:path`。
7. 回报格式固定（§7.2）。

---

## 1. 目标与范围

用户把 Agent 丢到后台跑；**完成、失败或卡在权限/提问上时**，macOS Dock 角标 + 系统通知把用户拉回来，**点通知直达该会话**；前台看别的会话时只给应用内提示；重连/唤醒后不重复轰炸，只给一条汇总。手机端先做前台跨会话提醒与「离开期间」汇总；锁屏离线推送走 APNs 独立史诗。

| 阶段 | 内容 | 波次 |
|------|------|------|
| **P0 Desktop macOS** | 角标、系统通知、点击直达、应用内提示、catch-up 汇总、设置、授权引导 | W0–W4 |
| P1 Desktop 抛光 | 摘要正文、无操作视为离开、计划待批文案、多 Desktop 去重、（no-go 时）补点击直达 | 另行拆包 |
| P2 Mobile M1 | 本地通知 + 前台 banner + 离开期间汇总 + 真实设置页 | W5 |
| P3 Remote Push | APNs：contracts、Host 发送、iOS token 注册 | W6+ |
| 暂缓 | Windows / Linux / Android | — |

非目标：Host 直接弹通知；每个 tool / 子代理完成都通知；角标显示运行中数量；从通知直接批准权限；通知含命令/路径/密钥/permission detail/错误原文；伪装 iOS 后台保活；启动即弹系统授权框。

---

## 2. 事实基线（AN-F）

| 编号 | 事实 | 位置 |
|------|------|------|
| AN-F01 | `ExecutionRunKind`：`session-turn` / `plan-execution` / `subagent-batch` / `subagent-task`；`ExecutionRunStatus` 含 `completed/failed/cancelled/interrupted`；无「谁取消」字段 | `packages/contracts/src/run.ts` |
| AN-F02 | 暂停 → `interrupted` + `terminalCode: paused`；中止原因 `user-stop / pause-requested / superseded-by-new-prompt / host-shutdown / tool-loop-stalled` | `host-runtime/src/run-terminalizer.ts:103`、`run-abort-reason.ts` |
| AN-F03 | Host 可能先发 terminal 形态的 `run/updated`，再发或不发 `run/terminal` | `apps/desktop/src/chat-reducer-envelope.ts` 注释 |
| AN-F04 | 受众：`run/*`(session-turn) = global；`permission/*`、`extension/ui_request` = inbox；transcript/event = session（后台未订阅会话收不到） | `packages/host-transport/src/host-push-audience.ts` |
| AN-F05 | `permission/request`：`sessionId/requestId/action/detail/defaultDecision/context?/runId?`；`detail`、`context.command/paths` 含敏感内容；`sanitizeActivityPermissionAction` 已存在 | `contracts/src/ipc-host-push.ts`、`activity-summary.ts` |
| AN-F06 | 重连 / 冷启动有 `hydration`、`snapshot` 帧与 cursor replay（`host/replay-done` 结束），会重放旧 `run/terminal`、`permission/request` | `packages/host-client/src/host-client.ts`、`contracts/src/ipc-host-responses.ts` |
| AN-F07 | reducer 已有 `completedAttentionSessionIds` / `failedAttentionSessionIds`，判定为 `activeSessionId !== run.sessionId`，`session/set` 等路径清除；侧栏据此显示标记 | `chat-reducer-run.ts:251`、`chat-reducer-envelope.ts:118`、`chat-reducer-session.ts:369`、`session-row-item.tsx:191` |
| AN-F08 | 全局 `permissionQueue`（上限 16，requestId 去重）+ `permission/reconcile` | `permission-queue.ts`、`chat-reducer.ts:263`、`hooks/reconcile-pending-permissions.ts` |
| AN-F09 | 提问请求为 bootstrap hook 内单槽状态 `extensionUiRequest`，run 终态清除 | `hooks/use-host-bootstrap.ts:264/376/591` |
| AN-F10 | 焦点监听已有一处 `onFocusChanged` | `renderer-self-heal.ts:191` |
| AN-F11 | 侧栏打开会话是 `workbench-app.tsx:583` 的内联闭包（Docking `openOrFocusSession`、pane 绑定、scope 判断）→ `handleResumeSession(sessionId, { scope })` | `workbench-app.tsx`、`hooks/use-session-resume.ts:125`、`workbench/docking/view-commands.ts:109` |
| AN-F12 | 文件体量：`workbench-app.tsx` 1042 行、`desktop-locale.ts` 1648 行（均超上限）、`use-host-bootstrap.ts` 941 行 | — |
| AN-F13 | Tauri 2.11.5；objc2 0.6 / objc2-foundation 0.3 / block2 0.6；`define_class!` 先例；`show_main_window` 命令已存在；app 命令无 ACL manifest | `src-tauri/Cargo.lock`、`artifact_bridge.rs`、`lib.rs:211`、`build.rs` |
| AN-F14 | capability 无 badge / attention 权限；`allow-is-focused` 已含于 `core:default` | `src-tauri/capabilities/default.json` |
| AN-F15 | `tauri-plugin-notification`（2.4.0）桌面端：无点击回调（`onAction` 仅移动端）；授权恒返回 Granted；macOS 经 notify-rust，dev 下冒充 `com.apple.Terminal` | 上游文档与 `plugins/notification/src/desktop.rs` |
| AN-F16 | Tauri `setBadgeCount`（Windows 不支持）、`setBadgeLabel`（仅 macOS） | Tauri Window API |
| AN-F17 | ui-kit `showUiNotification` 无按钮/action 字段 | `packages/ui-kit/src/notifications.ts` |
| AN-F18 | 偏好存 localStorage `piwin.desktop.*`；设置分区在 `settings/section-registry.ts` | `ui-preferences.ts` |
| AN-F19 | Mobile：`mobile-activity-summary.ts` 按 `run/*`、`permission/*` 刷新 Inbox；`NotificationsSheet` 为 demo；无 notification 插件、无 `UIBackgroundModes`；iOS 后台 WKWebView 秒级挂起 | `apps/mobile/src/…` |

---

## 3. 决策（AN-D）与规则（AN-R）

### 3.1 决策

| 编号 | 决策 |
|------|------|
| AN-D01 | Host 只发事实，Shell 本地决定是否打扰；Host 不调 OS API |
| AN-D02 | 不新建 AttentionStore；复用 AN-F07 / AN-F08 状态，升级「已看见」判定 |
| AN-D03 | macOS 横幅与点击直达走自建 `UNUserNotificationCenter` 原生桥；P0 默认不引入 `tauri-plugin-notification` |
| AN-D04 | 原生桥 spike no-go 时**不等签名流水线**：插件 + 回窗跳转 chip 即 P0 出货标准（owner 2026-09-17） |
| AN-D05 | needs-input 提醒**允许关闭**，关闭时二次确认（owner 2026-09-17） |
| AN-D06 | 完成/失败默认提醒，仅不在场时发系统通知；在场看别的会话 → 应用内提示 |
| AN-D07 | 授权在首次发送消息后以应用内引导请求，不在启动时弹 |
| AN-D08 | Mobile M1 在 Desktop P0 之后，复用 `@piwin/host-client` 纯模块 |
| AN-D09 | Remote Push 进路线图，直接 APNs，不做 ntfy/FCM（owner 2026-09-17） |
| AN-D10 | 当前仅 Apple shell；Windows / Linux / Android 暂缓 |
| AN-D11 | 多台 Desktop 连同一 Host 的重复通知 P0 接受 |
| AN-D12 | 行为修正：Docking 中「可见但非 active」的会话完成不再显示侧栏未读标记 |

### 3.2 规则

#### AN-R01 信号来源映射（`readAttentionSignals`）

| HostPush | 条件 | 产出信号 |
|----------|------|----------|
| `permission/request` | 恒 | `raise needs-input`，key `permission:{requestId}`，source `permission`，`permissionAction = sanitizeActivityPermissionAction(action)`（失败则省略） |
| `permission/resolved` | 恒 | `settle`，key `permission:{requestId}` |
| `extension/ui_request` | 恒 | `raise needs-input`，key `question:{requestId}`，source `question` |
| `run/terminal`，或 status 为终态的 `run/updated` | `run.kind === 'session-turn'` 且 AN-R02 非 silent | `raise turn-complete/turn-failed`，key `run:{runId}`，携带 `endedAt`；**另产出** `settle-questions {sessionId}` |
| 同上 | AN-R02 为 silent | 仅 `settle-questions {sessionId}` |
| 非 session-turn 的 `run/*`、非终态 `run/updated`、其他 push | — | 无 |

#### AN-R02 终态分类（`classifyRunTerminalAttention`）

| status | terminalCode | 结果 |
|--------|--------------|------|
| 非终态 | — | `null` |
| `completed` | 任意 | `turn-complete` |
| `failed` | 任意 | `turn-failed` |
| `cancelled` | `tool-loop-stalled` / `timeout` / `job-cleanup-failed` | `turn-failed` |
| `cancelled` | 其他或缺省 | `silent` |
| `interrupted` | `paused` / `host-shutdown` | `silent` |
| `interrupted` | 其他或缺省 | `turn-failed` |

（kind 过滤在 AN-R01 做；本函数只看 status × terminalCode。`integration-required` 若出现在 session-turn 上按 `failed` 处理，AN-S1 核实并在回报中说明。）

#### AN-R03 在场

`presence = 'active'` ⇔ 主窗口 focused **且** `document.visibilityState === 'visible'`；否则 `'inactive'`。

#### AN-R04 可见会话

- Docking 开启：每个 stage group 的前台 view 若为 session → 其 sessionId；
- 旧 conversation panes：所有 leaf 的 sessionId；
- 以上都不适用：`[activeSessionId]`（非空时）；
- `conversationCovered === true`（设置子页或覆盖层遮住会话区）：空集。

#### AN-R05 已看见

`seen(sessionId)` ⇔ presence active **且** `conversationCovered === false` **且**（sessionId ∈ visible **或** visible 为空且 sessionId === activeSessionId）。

#### AN-R06 判定表（`decideAttention`）

优先级自上而下，命中即返回：

| # | 条件 | seen | delivery | bounce |
|---|------|------|----------|--------|
| 1 | `preferences.enabled === false` | 按 AN-R05 | `none` | false |
| 2 | `alreadyNotified` | 按 AN-R05 | `none` | false |
| 3 | AN-R05 为真 | true | `none` | false |
| 4 | `catchingUp` | false | `catch-up-summary` | false |
| 5 | kind 对应偏好关闭（needs-input→`onNeedsInput`，complete→`onComplete`，failed→`onFailure`） | false | `none` | false |
| 6 | presence active | false | `foregroundToast ? 'in-app' : 'none'` | false |
| 7 | presence inactive | false | `system` | `kind === 'needs-input' && bounceOnNeedsInput` |

`seen` 仅供调用方参考；reducer 标记不依赖该返回值（AN-R08 自行判定）。

#### AN-R07 总开关

`enabled=false`：无系统通知、无应用内提示、无弹跳；角标只受 `badge` 控制；侧栏标记不受影响。

#### AN-R08 标记与清除（reducer）

| 事件 | complete/failed 标记 | needs-input |
|------|----------------------|-------------|
| 会话 turn 终态（completed/failed） | 若 **非** AN-R05 已看见 → 标记；否则清除 | — |
| `session/set`（现有） | 清该会话 | 不变 |
| `attention/visible-sessions` 且 presence active | 清**新增可见**会话 | 不变 |
| `attention/presence` inactive → active | 清当前可见会话 | 不变 |
| `permission/resolved` / reconcile（现有） | — | 队列移除 |
| 用户回答提问 / 该会话 run 终态（现有 AN-F09） | — | 清 question |

#### AN-R09 已通知账本

key → 时间戳；LRU 上限 256；TTL 24h；存 localStorage（AN-I10）。任何 `in-app` / `system` / `bounce` 投递前查询，投递后记录。catch-up 汇总中的每个 key 同样记录。

#### AN-R10 catch-up 门闸

- 进入：收到 `hydration` 或 `snapshot` 帧；或 HostClient 状态从非 ready 恢复为 ready。
- 期间：`delivery === 'catch-up-summary'` 的 raise 放入待汇总集合（按 key 去重）。
- 退出：收到 `host/replay-done`；否则 1500ms 空闲。空闲计时**只**被注意力相关消息重置：`hydration`、`snapshot`、`host/replay-done`、`permission/request`、`permission/resolved`、`extension/ui_request`、`run/terminal`、`run/updated`。`host/log`、`browser/frame`、`pet/state` 等非注意力消息不得重置计时、不得把 catchingUp 挂住。hydration/snapshot 进入与 HostClient 非 ready→ready 进入共用此规则。
- 退出时：过滤账本已有 key；剩余 ≥1 → presence inactive 投递一条 `system` 汇总（identifier `piwin.attention.summary`），active 投递一条 `in-app` 汇总；记录所有 key。

#### AN-R11 新鲜度兜底

`raise` 带 `endedAt` 且早于 `now − 15min` → 视为 catch-up（并入汇总，不单发）。主去重不依赖时间。

#### AN-R12 通知标识

- 单会话：identifier `piwin.attention.{sessionId}`，threadId = 项目 id，General 空间为 `general`；同会话新事件替换旧横幅。
- 汇总：identifier `piwin.attention.summary`。
- 某会话注意力全部清空（AN-R14 集合中消失）→ `removeDelivered(['piwin.attention.{sessionId}'])`。

#### AN-R13 突发合并

滚动 60s 窗口内已投递 3 条 `system` 后，第 4 条起改投 `piwin.attention.summary`（替换更新计数），窗口滑出后恢复单发。`in-app` 不受限。

#### AN-R14 角标

```text
ids = keys(completedAttentionSessionIds) ∪ keys(failedAttentionSessionIds)
    ∪ permissionQueue[].sessionId ∪ { extensionUiRequest?.sessionId }
count = |ids|；badge 偏好关闭时视为 0
0 → { kind: 'clear' }；1..99 → { kind: 'count', value }；≥100 → { kind: 'label', value: '99+' }
```

#### AN-R15 文案（zh-CN / en）

| kind / source | title zh | title en | body |
|---------------|----------|----------|------|
| needs-input / permission | 需要你的批准 | Approval needed | `{project} · {session} · {action}` |
| needs-input / question | Agent 在等你回答 | Agent is asking | `{project} · {session}` |
| turn-complete | 已完成 | Finished | `{project} · {session}` |
| turn-failed | 运行失败 | Run failed | `{project} · {session}` |
| summary | {n} 个会话需要你 | {n} sessions need you | 有 {k} 个等待批准 / {k} waiting for approval（k=0 省略） |

- `session` 缺失 → 「未命名会话 / Untitled session」；`project` 缺失（General）→ 省略该段及分隔符；`action` 缺失 → 省略。
- 每段截断到 48 个字符（超出以 `…` 结尾）。
- summary 单数英文：`1 session needs you`。

#### AN-R16 隐私红线

通知与应用内提示**只能**出现：R15 标题、项目名、会话名、sanitize 后的 action token、计数。禁止：permission `detail`、`context.*`、命令、路径、error、terminalCode 原文、sessionId。

#### AN-R17 授权引导

- 条件：`getAuthorization() === 'not-determined'` 且用户本次启动后首次成功发送消息，且 `optInDismissedAt` 不在 7 天内。
- UI：会话区顶部一次性引导条「任务在后台完成或需要批准时提醒你？ [开启] [以后再说]」。
- 「开启」→ `requestAuthorization()`；「以后再说」→ 写 `optInDismissedAt`。
- 设置页始终可发起授权；`denied` 时提供「打开系统设置」。

#### AN-R18 偏好默认值

`enabled=true, onNeedsInput=true, onComplete=true, onFailure=true, foregroundToast=true, badge=true, sound=true, bounceOnNeedsInput=true`。关闭 `onNeedsInput` 需确认（AN-D05）。

#### AN-R19 点击激活

原生 delegate → 唤起主窗口（unminimize → show → focus）→ 事件 `attention://activate {sessionId, attentionKey}`；前端未就绪时缓冲，由 `take_pending_activation` 取一次。前端调用 `openSessionFromShell(sessionId)`；会话不存在 → 应用内提示「该会话已不可用」。若 sessionId 为子代理 child session → 打开其父会话（AN-O3 核实字段）。

#### AN-R20 投递失败降级

`deliver` 返回 `not-authorized` / `unsupported`：presence active → 改为 `in-app`；inactive → 静默（角标仍更新）。

#### AN-R21 无点击回调时的回窗跳转

`capabilities.clickActivation === false` 时：记录最近一次 `system` 投递的 `{sessionId, at}`；presence 变为 active 且 `now − at ≤ 60s` → 应用内提示带「跳转到 {会话}」按钮（调用 `openSessionFromShell`），每次投递最多触发一次。

---

## 4. 冻结接口（AN-I）

> W0 由协调者（AN-C1）按本节创建桩文件与导出，之后只有「接口变更请求」流程可以改动。桩函数体统一 `throw new Error('AN-xx not implemented')`，类型与常量须为最终值。

### AN-I01 信号（`packages/host-client/src/attention-signal.ts`，实现方 AN-S1）

```ts
import type { ExecutionRunRecord, HostPush } from '@piwin/contracts';

export type AttentionKind = 'needs-input' | 'turn-complete' | 'turn-failed';
export type AttentionSource = 'permission' | 'question' | 'run';
export type AttentionRaise = {
  type: 'raise';
  kind: AttentionKind;
  key: string;
  sessionId: string;
  source: AttentionSource;
  runId?: string;
  permissionAction?: string;
  endedAt?: string;
};
export type AttentionSignal =
  | AttentionRaise
  | { type: 'settle'; sessionId: string; key: string }
  | { type: 'settle-questions'; sessionId: string };

export function classifyRunTerminalAttention(
  run: ExecutionRunRecord,
): 'turn-complete' | 'turn-failed' | 'silent' | null;
export function readAttentionSignals(push: HostPush): AttentionSignal[];
```

### AN-I02 策略（`attention-policy.ts`，实现方 AN-S2）

```ts
import type { AttentionRaise } from './attention-signal.js';

export type AttentionPresence = 'active' | 'inactive';
export type AttentionPreferences = {
  enabled: boolean;
  onNeedsInput: boolean;
  onComplete: boolean;
  onFailure: boolean;
  foregroundToast: boolean;
  badge: boolean;
  sound: boolean;
  bounceOnNeedsInput: boolean;
};
export const DEFAULT_ATTENTION_PREFERENCES: AttentionPreferences; // AN-R18
export type AttentionContext = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  conversationCovered: boolean;
  catchingUp: boolean;
  preferences: AttentionPreferences;
  alreadyNotified: boolean;
  now: number;
};
export type AttentionDelivery = 'none' | 'in-app' | 'system' | 'catch-up-summary';
export type AttentionDecision = { seen: boolean; delivery: AttentionDelivery; bounce: boolean };

export const ATTENTION_STALE_TERMINAL_MS = 900_000; // AN-R11
export function isAttentionSessionSeen(
  sessionId: string,
  context: Pick<AttentionContext, 'presence' | 'visibleSessionIds' | 'activeSessionId' | 'conversationCovered'>,
): boolean; // AN-R05
export function decideAttention(signal: AttentionRaise, context: AttentionContext): AttentionDecision; // AN-R06 + AN-R11
```

### AN-I03 账本与突发（`attention-notify-ledger.ts`，实现方 AN-S3）

```ts
export const ATTENTION_LEDGER_MAX_ENTRIES = 256;
export const ATTENTION_LEDGER_TTL_MS = 86_400_000;
export const ATTENTION_BURST_WINDOW_MS = 60_000;
export const ATTENTION_BURST_MAX_SINGLE = 3;

export type AttentionNotifyLedger = { entries: ReadonlyArray<{ key: string; at: number }> };
export const EMPTY_ATTENTION_LEDGER: AttentionNotifyLedger;
export function hasAttentionNotified(ledger: AttentionNotifyLedger, key: string, now: number): boolean;
export function recordAttentionNotified(ledger: AttentionNotifyLedger, key: string, now: number): AttentionNotifyLedger;
export function readAttentionNotifyLedger(raw: unknown): AttentionNotifyLedger;

export type AttentionBurstWindow = { deliveredAt: readonly number[] };
export const EMPTY_ATTENTION_BURST_WINDOW: AttentionBurstWindow;
export function admitAttentionBanner(
  window: AttentionBurstWindow,
  now: number,
): { window: AttentionBurstWindow; mode: 'single' | 'summary' };
```

### AN-I04 文案（`attention-copy.ts`，实现方 AN-S4）

```ts
import type { AttentionKind, AttentionSource } from './attention-signal.js';

export type AttentionCopyLocale = 'zh-CN' | 'en';
export const ATTENTION_COPY_SEGMENT_MAX = 48;
export function formatAttentionNotification(input: {
  locale: AttentionCopyLocale;
  kind: AttentionKind | 'summary';
  source?: AttentionSource;
  projectName?: string;
  sessionTitle?: string;
  permissionAction?: string;
  count?: number;
  needsInputCount?: number;
}): { title: string; body: string };
```

`packages/host-client/src/index.ts` 由 AN-C1 追加四行 `export * from './attention-*.js'`。

### AN-I05 Reducer（实现方 AN-R1）

```ts
// apps/desktop/src/chat-ui-types.ts —— AN-C1 追加
// ChatUiState:
attentionPresence: 'active' | 'inactive';          // 初始 'active'
attentionVisibleSessionIds: Record<string, true>;   // 初始 {}
// ChatUiAction:
| { type: 'attention/presence'; presence: 'active' | 'inactive' }
| { type: 'attention/visible-sessions'; sessionIds: readonly string[] }

// apps/desktop/src/chat-reducer-attention.ts
export function isChatSessionSeen(state: ChatUiState, sessionId: string): boolean;        // 调用 AN-I02 isAttentionSessionSeen
export function shouldMarkTurnAttention(state: ChatUiState, sessionId: string): boolean;  // = !isChatSessionSeen
export function reduceAttentionAction(
  state: ChatUiState,
  action: Extract<ChatUiAction, { type: 'attention/presence' | 'attention/visible-sessions' }>,
): ChatUiState; // AN-R08；内容不变返回原引用
```

AN-C1 在 `chat-reducer.ts` 中预先接好 `case 'attention/presence': case 'attention/visible-sessions': return reduceAttentionAction(state, action);` 与初始 state。

### AN-I06 派生状态（实现方 AN-R2）

```ts
// apps/desktop/src/attention-badge-model.ts
import type { DockBadge } from './desktop-attention-os.js';
export function selectAttentionSessionIds(input: {
  completedAttentionSessionIds: Readonly<Record<string, true>>;
  failedAttentionSessionIds: Readonly<Record<string, true>>;
  permissionQueue: ReadonlyArray<{ sessionId: string }>;
  questionSessionId: string | null;
}): string[];                                       // 排序后去重，AN-R14
export function formatDockBadge(count: number): DockBadge;

// apps/desktop/src/workbench/docking/visible-sessions.ts
import type { WorkspaceState } from './types.js';
import type { ConversationPaneLayout } from '../../conversation-pane-layout.js';
export function selectVisibleSessionIds(input: {
  dockingState: WorkspaceState | null;               // Docking 未启用传 null
  paneLayout: ConversationPaneLayout | null;         // 旧 panes 未启用传 null
  activeSessionId: string | null;
  conversationCovered: boolean;
}): string[];                                         // AN-R04，排序后去重
```

### AN-I07 OS 适配（`apps/desktop/src/desktop-attention-os.ts`，AN-C1 创建完整类型；实现方 AN-O1）

```ts
export type AttentionAuthorization = 'granted' | 'denied' | 'not-determined' | 'unsupported';
export type AttentionOsCapabilities = {
  nativeCenter: boolean;          // 原生 UNUserNotificationCenter 可用
  clickActivation: boolean;       // 点击通知能回调到会话
  authorizationReliable: boolean; // getAuthorization 是真实值
};
export type DockBadge =
  | { kind: 'clear' }
  | { kind: 'count'; value: number }
  | { kind: 'label'; value: string };
export type AttentionActivation = { sessionId: string; attentionKey: string };
export type AttentionDeliverInput = {
  identifier: string;
  threadId: string;
  title: string;
  body: string;
  sessionId: string;
  attentionKey: string;
  sound: boolean;
};
export type AttentionDeliverResult = 'delivered' | 'not-authorized' | 'unsupported';
export type DesktopAttentionOs = {
  getCapabilities(): Promise<AttentionOsCapabilities>;
  getAuthorization(): Promise<AttentionAuthorization>;
  requestAuthorization(): Promise<AttentionAuthorization>;
  deliver(input: AttentionDeliverInput): Promise<AttentionDeliverResult>;
  removeDelivered(identifiers: readonly string[]): Promise<void>;
  setBadge(badge: DockBadge): Promise<void>;
  requestAttention(): Promise<void>;
  takePendingActivation(): Promise<AttentionActivation | null>;
  subscribeActivation(listener: (activation: AttentionActivation) => void): () => void;
  openSystemSettings(): Promise<void>;
};
export function createDesktopAttentionOs(): DesktopAttentionOs; // 桩；AN-O1 实现选择逻辑
```

### AN-I08 原生命令（Rust，实现方 AN-N1；调用方 AN-O1）

| 命令 | 参数（camelCase JSON） | 返回 |
|------|------------------------|------|
| `attention_capabilities` | — | `AttentionOsCapabilities` |
| `attention_authorization_status` | — | `AttentionAuthorization` |
| `attention_request_authorization` | — | `AttentionAuthorization` |
| `attention_deliver` | `{ input: AttentionDeliverInput }` | `AttentionDeliverResult` |
| `attention_remove_delivered` | `{ identifiers: string[] }` | `null` |
| `attention_take_pending_activation` | — | `AttentionActivation \| null` |
| `attention_open_system_settings` | — | `null` |

- 事件：`attention://activate`，payload `AttentionActivation`，仅发往 `main` 窗口。
- 所有命令在任何平台/运行方式下都已注册；不支持时返回 `unsupported` 或 capabilities 全 false，**永不 panic**。
- go 路线：`nativeCenter/clickActivation/authorizationReliable` 均 true（packaged `.app`）；dev 裸二进制全 false。
- no-go 路线（AN-D04）：`attention_deliver` 改用 `tauri-plugin-notification` Rust builder；capabilities = `{ nativeCenter: false, clickActivation: false, authorizationReliable: false }`；状态命令返回 `granted`。前端接口不变。
- Dock 角标与弹跳由前端 JS window API 完成（capability 由 AN-N1 添加），不走命令。

### AN-I09 编排器（`apps/desktop/src/desktop-attention-controller.ts`，实现方 AN-O2）

```ts
import type { HostServerMessage } from '@piwin/contracts';
import type { AttentionPreferences, AttentionPresence } from '@piwin/host-client';
import type { DesktopLocale } from './desktop-locale.js';
import type { DesktopAttentionOs } from './desktop-attention-os.js';

export type DesktopAttentionSnapshot = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  activeSessionId: string | null;
  preferences: AttentionPreferences;
  locale: DesktopLocale;
  hostReady: boolean;
  describeSession: (sessionId: string) => { sessionTitle?: string; projectName?: string; projectId?: string };
};
export type InAppAttentionNotice = {
  title: string;
  body: string;
  action?: { label: string; sessionId: string };
};
export type DesktopAttentionControllerDeps = {
  hostClient: { subscribe(listener: (message: HostServerMessage) => void): () => void };
  os: DesktopAttentionOs;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  setTimer: (callback: () => void, ms: number) => () => void;
  getSnapshot: () => DesktopAttentionSnapshot;
  showInAppNotice: (notice: InAppAttentionNotice) => void;
};
export type DesktopAttentionController = {
  onPresenceChanged(presence: AttentionPresence): void;     // AN-R10 ready 恢复检测、AN-R21
  syncAttentionSessions(sessionIds: readonly string[]): void; // 角标 AN-R14 + 清理 AN-R12
  dispose(): void;
};
export function createDesktopAttentionController(deps: DesktopAttentionControllerDeps): DesktopAttentionController;
```

### AN-I10 偏好与存储键（实现方 AN-U1；读取方 AN-O2 / AN-O3）

```ts
// apps/desktop/src/attention-preferences.ts
export const ATTENTION_PREFERENCES_KEY = 'piwin.desktop.attention.v1';
export const ATTENTION_LEDGER_KEY = 'piwin.desktop.attention.ledger.v1';
export const ATTENTION_OPT_IN_DISMISSED_KEY = 'piwin.desktop.attention.optInDismissedAt';
export function readAttentionPreferences(storage?: Pick<Storage, 'getItem'>): AttentionPreferences;
export function writeAttentionPreferences(next: AttentionPreferences, storage?: Pick<Storage, 'setItem'>): void;
export function subscribeAttentionPreferences(listener: (next: AttentionPreferences) => void): () => void;
```

`ATTENTION_LEDGER_KEY` 常量由 AN-C1 一并写入此文件，AN-O2 只读引用。

### AN-I11 会话打开（`apps/desktop/src/hooks/use-shell-session-open.ts`，实现方 AN-X1）

```ts
export type ShellSessionOpen = (sessionId: string) => Promise<void>;
export function useShellSessionOpen(args: ShellSessionOpenArgs): ShellSessionOpen;
// ShellSessionOpenArgs 由 AN-X1 按现有闭包依赖定义（非冻结），返回值类型冻结。
```

### AN-I12 窗口在场信号（`apps/desktop/src/window-focus-signal.ts`，实现方 AN-X2）

```ts
export type WindowPresenceSnapshot = { focused: boolean; documentVisible: boolean };
export function getWindowPresence(): WindowPresenceSnapshot;
export function subscribeWindowPresence(listener: (snapshot: WindowPresenceSnapshot) => void): () => void;
// 进程内单例：只注册一次 onFocusChanged + visibilitychange；非 Tauri 环境 focused 取 document.hasFocus()
```

### AN-I13 ui-kit 通知按钮（实现方 AN-K1）

```ts
// packages/ui-kit/src/notifications.ts —— UiNotificationInput 增加可选字段
action?: { label: string; onClick: () => void };
```

### AN-I14 设置与引导（实现方 AN-U1 / AN-U2）

```ts
// settings：SettingsSectionId 增加 'notifications'，group 'application'，位于 'general' 之后（AN-U1）
// apps/desktop/src/attention-opt-in-banner.tsx（AN-U2）
export function AttentionOptInBanner(props: {
  visible: boolean;
  locale: DesktopLocale;
  onEnable: () => void;
  onDismiss: () => void;
}): ReactElement | null;
// apps/desktop/src/attention-opt-in-policy.ts（AN-U2）
export function shouldShowAttentionOptIn(input: {
  authorization: AttentionAuthorization;
  hasSentThisLaunch: boolean;
  dismissedAt: number | null;
  now: number;
}): boolean; // AN-R17
```

---

## 5. 文件所有权矩阵

> 同一文件只有一个写入方。「C1」表示协调者在 W0 创建桩，之后归所列实现方独占。

| 文件 | 写入方 | 波次 |
|------|--------|------|
| `packages/host-client/src/index.ts` | AN-C1 | W0 |
| `packages/host-client/src/attention-signal.ts` + `.test.ts` | AN-S1 | W1 |
| `packages/host-client/src/attention-policy.ts` + `.test.ts` | AN-S2 | W1 |
| `packages/host-client/src/attention-notify-ledger.ts` + `.test.ts` | AN-S3 | W1 |
| `packages/host-client/src/attention-copy.ts` + `.test.ts` | AN-S4 | W1 |
| `apps/desktop/src/chat-ui-types.ts` | AN-C1（仅 AN-I05 字段） | W0 |
| `apps/desktop/src/chat-reducer.ts` | AN-C1（仅接线与初始值） | W0 |
| `apps/desktop/src/chat-reducer-attention.ts` + `.test.ts` | AN-R1 | W1 |
| `apps/desktop/src/chat-reducer-run.ts`、`chat-reducer-envelope.ts`（仅替换判定） | AN-R1 | W1 |
| `apps/desktop/src/background-run-delivery.test.ts` | AN-R1 | W1 |
| `apps/desktop/src/attention-badge-model.ts` + `.test.ts` | AN-R2 | W1 |
| `apps/desktop/src/workbench/docking/visible-sessions.ts` + `.test.ts` | AN-R2 | W1 |
| `apps/desktop/src/hooks/use-shell-session-open.ts` + `.test.tsx` | AN-X1 | W1 |
| `apps/desktop/src/workbench-app.tsx` | AN-X1（W1）→ AN-O3（W3） | W1 / W3 |
| `apps/desktop/src/window-focus-signal.ts` + `.test.ts` | AN-X2 | W1 |
| `apps/desktop/src/renderer-self-heal.ts`（+ 其测试） | AN-X2 | W1 |
| `packages/ui-kit/src/notifications.ts`（+ 测试、必要 CSS） | AN-K1 | W1 |
| `apps/desktop/src-tauri/**`（`attention_notifications.rs`、`lib.rs`、`Cargo.toml`、`Cargo.lock`、`capabilities/default.json`） | AN-N1 | W1 |
| `apps/desktop/package.json`、`pnpm-lock.yaml`（仅 no-go 时加插件 JS 包） | AN-N1 | W1 |
| `apps/desktop/src/desktop-attention-os.ts`（选择逻辑） | AN-C1 类型 → AN-O1 | W0 / W1 |
| `apps/desktop/src/desktop-attention-os-tauri.ts`、`desktop-attention-os-noop.ts` + 测试 | AN-O1 | W1 |
| `apps/desktop/src/attention-preferences.ts` + `.test.ts` | AN-C1 常量 → AN-U1 | W0 / W1 |
| `apps/desktop/src/settings/notifications-copy.ts` | AN-U1 | W1 |
| `apps/desktop/src/settings/pages/notifications-page.tsx` + `.test.tsx` | AN-U1 | W1 |
| `apps/desktop/src/settings/section-registry.ts`、`settings/pages/index.ts`、`settings/settings-search-index.ts`（及其测试） | AN-U1 | W1 |
| `apps/desktop/src/attention-opt-in-banner.tsx`、`attention-opt-in-policy.ts` + 测试 | AN-U2 | W1 |
| `apps/desktop/src/desktop-attention-controller.ts` + `.test.ts` | AN-O2 | W2 |
| `apps/desktop/src/hooks/use-desktop-attention.ts` + `.test.tsx` | AN-O3 | W3 |
| `docs/adr/0064-client-local-attention-notifications.md` | AN-D1 | W1 |
| `docs/guides/*`（用户说明）、本 spec 状态更新 | AN-D2 | W4 |
| `docs/plans/evidence/2026-09-attention-notifications/**` | AN-Q1 | W4 |

**未列出的文件一律只读。** 若实现需要改动未列出文件，停止并回报。

---

## 6. 波次与依赖

```text
W0  串行   AN-C0 基线 ─► AN-C1 接口冻结（桩 + 导出 + reducer 接线），typecheck 必须绿
            │
W1  并发   AN-D1  AN-S1  AN-S2  AN-S3  AN-S4
            AN-R1  AN-R2  AN-X1  AN-X2  AN-K1
            AN-N1  AN-O1  AN-U1  AN-U2
            │     （全部只依赖 W0 冻结接口；AN-N1 建议最先启动：首日 go/no-go）
            │     合并：任意顺序；每合并一个跑 pnpm typecheck
W2  并发   AN-O2（依赖 S1–S4 已合并）
            │
W3  串行   AN-O3 集成挂载（依赖 W1 全部 + O2）
            │
W4  并发   AN-Q1 实机门禁   AN-D2 文档收尾
            │
W5  Mobile M1：AN-M0 ─► AN-M1 ‖ AN-M2 ─► AN-M3 ‖ AN-M4
W6+ APNs：AN-P1 ─► AN-P2 ‖ AN-P3 ─► AN-P4
```

| 工作包 | 依赖 | 可同时运行 | 估时 |
|--------|------|------------|------|
| AN-C0 | — | — | 0.25d |
| AN-C1 | C0 | — | 0.5d |
| AN-D1 | C1 | W1 全部 | 0.5d |
| AN-S1 / S2 / S3 / S4 | C1 | W1 全部 | 0.5d / 0.5d / 0.25d / 0.25d |
| AN-R1 | C1 | W1 全部 | 0.75d |
| AN-R2 | C1 | W1 全部 | 0.5d |
| AN-X1 | C1 | W1 全部 | 0.5d |
| AN-X2 | C1 | W1 全部 | 0.25d |
| AN-K1 | C1 | W1 全部 | 0.25d |
| AN-N1 | C1 | W1 全部 | 1.5d |
| AN-O1 | C1 | W1 全部 | 0.5d |
| AN-U1 | C1 | W1 全部 | 0.75d |
| AN-U2 | C1 | W1 全部 | 0.25d |
| AN-O2 | S1–S4 | — | 1d |
| AN-O3 | W1 全部、O2 | — | 0.75d |
| AN-Q1 | O3 | D2 | 0.5d |
| AN-D2 | O3 | Q1 | 0.25d |

人日合计 ≈ 9.75d；并发下日历时长 ≈ 4 天（W0 0.75d + W1 1.5d + W2 1d + W3 0.75d + W4 0.5d）。建议同时在跑的子代理 ≤ 6 个，W1 按 N1 → S* / R* → 其余 的顺序启动。

---

## 7. 协调协议

### 7.1 分支与工作树

- 集成分支：`feat/attention-notifications`，由 AN-C0 从 `main` 创建。
- 每个工作包在独立 worktree 的分支 `an/<编号小写>`（如 `an/s1`）上工作，基于**集成分支当前头**（W1 包基于 C1 合并后的头）。
- 合并：协调者按完成顺序 fast-forward 或 merge 到集成分支，每次合并后跑 `pnpm typecheck`；失败则退回该包。
- 冲突预期为零（所有权独占）；若出现冲突，说明所有权被违反，退回违规包。

### 7.2 子代理回报格式

```text
工作包: AN-xx
结果: 完成 | 阻塞
改动文件: <列表，须全部属于本包所有权>
实现的规则: AN-R..
通过的用例: AN-T..
验证命令输出摘要: <typecheck / test / cargo 等>
偏离与发现: <接口变更请求 / 规则歧义 / 范围外问题；无则写「无」>
```

### 7.3 接口变更请求

子代理回报「接口变更请求」→ 协调者判断：
1. 拒绝：给出在现有接口内的做法；
2. 接受：协调者修改本 spec 的 AN-I## 与桩文件，提交到集成分支，通知所有受影响在跑的工作包 rebase。

### 7.4 子代理派单模板

```text
你是 piwin 工作包 {AN-xx} 的执行者。仓库：/Users/yorickjue/Developer/piwin，分支 an/{xx}（基于 feat/attention-notifications）。
先读：AGENTS.md；docs/specs/2026-09-17-attention-notifications-product.md 的 §0.3、§3、§4、§5 以及工作包卡 {AN-xx}。
只允许写入工作包卡「拥有文件」；冻结接口 AN-I 不得修改；需要越界时停止并按 §7.2 回报。
实现卡片列出的规则与用例，运行「验证命令」全部通过后，提交（Conventional Commits，scope 用 attention），按 §7.2 格式回报。
不要使用 git stash。
```

---

## 8. 工作包卡

### W0

#### AN-C0 基线准备（协调者）
- **目标**：建立干净的集成基线。
- **步骤**：
  1. 确认 `main` 上未提交改动的处理方式（由 owner 决定提交或保留在 main 工作区）；worktree 只包含已提交内容，未提交改动不会进入子代理视野。
  2. 从确定的基线创建 `feat/attention-notifications`。
  3. 记录基线 commit 到本卡。
- **完成定义**：集成分支存在，`pnpm typecheck` 绿。

#### AN-C1 接口冻结（协调者）
- **拥有文件**：§5 中标注 AN-C1 的全部文件。
- **步骤**：
  1. 按 AN-I01–I04 创建 host-client 桩文件（类型、常量为最终值，函数体抛错），`index.ts` 追加导出。
  2. 按 AN-I05 修改 `chat-ui-types.ts`、`chat-reducer.ts`（初始值 + case 接线），创建 `chat-reducer-attention.ts` 桩：`reduceAttentionAction` 暂时原样返回 state，`isChatSessionSeen` 暂时返回 `state.activeSessionId === sessionId`（保证现有测试不变）。
  3. 按 AN-I06 创建两个桩文件；按 AN-I07 创建 `desktop-attention-os.ts`（完整类型 + 桩工厂）；按 AN-I09 创建控制器桩；按 AN-I10 创建 `attention-preferences.ts`（常量为最终值，函数桩）；按 AN-I11/I12/I14 创建桩。
  4. `pnpm typecheck`、desktop 与 host-client 现有测试绿后提交 `chore(attention): freeze AN interfaces`。
- **完成定义**：所有 AN-I 符号可被 import；无行为变化。

### W1

#### AN-D1 ADR 0064
- **拥有文件**：`docs/adr/0064-client-local-attention-notifications.md`
- **内容**：Context（AN-F04/F07/F15）、Decision（AN-D01–D04、D06、D12）、Consequences（侧栏行为修正、两个 bundle id 独立授权、no-go 路线）、Alternatives（Host 弹通知、仅插件、新建 Store）。
- **完成定义**：格式对齐现有 ADR；引用本 spec 编号。

#### AN-S1 信号映射
- **拥有文件**：`packages/host-client/src/attention-signal.ts`、`attention-signal.test.ts`
- **规则**：AN-R01、AN-R02、AN-R16（信号字段不得携带 detail/context）
- **用例**：AN-T01–T11
- **核实项**：在 `packages/host-runtime/src` 中确认 `integration-required` 是否可能出现在 `session-turn` 上，写入回报。
- **验证命令**：`pnpm --filter @piwin/host-client typecheck && pnpm --filter @piwin/host-client test`

#### AN-S2 判定策略
- **拥有文件**：`attention-policy.ts`、`attention-policy.test.ts`
- **规则**：AN-R05、AN-R06、AN-R11、AN-R18
- **用例**：AN-T12–T19
- **说明**：只依赖 AN-I01 类型，不调用 S1 函数；测试中手写 `AttentionRaise`。
- **验证命令**：同 AN-S1

#### AN-S3 账本与突发
- **拥有文件**：`attention-notify-ledger.ts`、`attention-notify-ledger.test.ts`
- **规则**：AN-R09、AN-R13
- **用例**：AN-T20–T23
- **验证命令**：同 AN-S1

#### AN-S4 文案
- **拥有文件**：`attention-copy.ts`、`attention-copy.test.ts`
- **规则**：AN-R15、AN-R16
- **用例**：AN-T24–T27
- **验证命令**：同 AN-S1

#### AN-R1 Reducer 注意力
- **拥有文件**：`chat-reducer-attention.ts`（替换桩）、`chat-reducer-attention.test.ts`；`chat-reducer-run.ts` 与 `chat-reducer-envelope.ts` 中把 `state.activeSessionId !== run.sessionId`（及 envelope 中无条件标记）替换为 `shouldMarkTurnAttention(state, run.sessionId)`；`background-run-delivery.test.ts` 更新
- **规则**：AN-R04（消费已存状态）、AN-R05、AN-R08、AN-D12
- **用例**：AN-T28–T32
- **说明**：`isChatSessionSeen` 调用 host-client 的 `isAttentionSessionSeen`；若 W1 期间 S2 尚未合并，测试会因桩抛错失败 → 本包可在分支内临时基于 S2 分支 rebase，或等待 S2 合并后再跑测试并回报。
- **验证命令**：`pnpm --filter @piwin/desktop typecheck && pnpm --filter @piwin/desktop exec vitest run chat-reducer background-run-delivery`

#### AN-R2 角标与可见会话派生
- **拥有文件**：`attention-badge-model.ts`、`workbench/docking/visible-sessions.ts` 及测试
- **规则**：AN-R04、AN-R14
- **用例**：AN-T33–T36
- **说明**：Docking stage group 与前台 view 的判定读取 `workbench/docking/types.ts`、`topology.ts` 的现有结构（只读）。
- **验证命令**：desktop typecheck + 对应测试

#### AN-X1 抽取会话打开（纯重构）
- **拥有文件**：`hooks/use-shell-session-open.ts`、`hooks/use-shell-session-open.test.tsx`、`workbench-app.tsx`
- **目标**：把 `workbench-app.tsx` 侧栏 `onResumeSession` 闭包原样搬入 `useShellSessionOpen`，侧栏改为传入返回的函数。
- **约束**：零行为变化；不做 AN-R19 的子代理父会话路由（留给 AN-O3）。
- **用例**：AN-T37（单栏 / Docking 同 scope / 旧 panes 多 leaf 三种路径调用正确下游）
- **完成定义**：`workbench-app.tsx` 行数下降；desktop 全量测试绿；单独提交 `refactor(attention): extract shell session open`。

#### AN-X2 共享窗口在场信号（纯重构）
- **拥有文件**：`window-focus-signal.ts` + 测试、`renderer-self-heal.ts`（+ 其测试）
- **目标**：实现 AN-I12；`renderer-self-heal` 改用 `subscribeWindowPresence`。
- **用例**：AN-T38（单例只注册一次；多订阅者；退订；非 Tauri 回退）
- **完成定义**：self-heal 现有测试绿。

#### AN-K1 ui-kit 通知按钮
- **拥有文件**：`packages/ui-kit/src/notifications.ts`（+ 测试、必要时同包 CSS）
- **目标**：AN-I13；按钮点击调用 `onClick` 并关闭该通知；样式沿用 tone 体系。
- **用例**：AN-T39
- **验证命令**：`pnpm --filter @piwin/ui-kit typecheck && pnpm --filter @piwin/ui-kit test`

#### AN-N1 macOS 原生桥
- **拥有文件**：`apps/desktop/src-tauri/**`；no-go 时另含 `apps/desktop/package.json`、`pnpm-lock.yaml`
- **步骤**：
  1. **Spike（≤0.5d，先做）**：最小实现 `attention_request_authorization` + `attention_deliver` + delegate 回调，`pnpm --filter @piwin/desktop package` 产出 `.app`，实机确认授权对话框、横幅、点击回调。立即回报 go / no-go。
  2. **go**：新增 `src/attention_notifications.rs`（macOS `cfg`，非 macOS stub）：
     - 支持性：`NSBundle.mainBundle` 有 `bundleIdentifier` 且 `bundlePath` 以 `.app` 结尾，否则 capabilities 全 false、状态 `unsupported`。
     - `define_class!` 实现 `UNUserNotificationCenterDelegate`，`.setup` 安装，`OnceLock` 持有；`didReceiveNotificationResponse` 校验 userInfo（`piwin.sessionId`、`piwin.attentionKey`，≤128 字节，`[A-Za-z0-9:_-]`）→ 唤起主窗口（复用 `show_main_window` 实现）→ `emit_to("main", "attention://activate", …)`；前端未取过 pending 前写入 `Mutex<Option<…>>`；`willPresentNotification` 传空 options。
     - `attention_deliver`：`UNMutableNotificationContent`（title/body Rust 侧再截 256 字节，threadIdentifier，userInfo，sound 可选）+ `UNNotificationRequest`（trigger nil）。
     - `attention_open_system_settings`：打开 `x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=<bundle id>`。
     - `Cargo.toml` macOS 依赖增加 `objc2-user-notifications = "0.3"`（最小 features）；objc2-foundation 增加所需 features。
  3. **no-go**：加入 `tauri-plugin-notification = "2.4"` 与 `@tauri-apps/plugin-notification`，按 AN-I08 no-go 语义实现同名命令。
  4. 两条路线都：`lib.rs` 注册 7 个命令；`capabilities/default.json` 增加 `core:window:allow-set-badge-count`、`core:window:allow-set-badge-label`、`core:window:allow-request-user-attention`（no-go 另加 `notification:default`）。
- **规则**：AN-R12（identifier 由前端给）、AN-R16、AN-R19、AN-I08
- **用例**：AN-T40–T42（`#[cfg(test)]`：userInfo 校验、截断、支持性判定纯函数）
- **验证命令**：`cd apps/desktop/src-tauri && cargo test && cargo clippy -- -D warnings`（若仓库未启用 clippy 门禁则仅 `cargo test` + `cargo build`）
- **回报必须包含**：go/no-go 结论与证据（截图路径）。

#### AN-O1 OS 适配实现
- **拥有文件**：`desktop-attention-os.ts`（选择逻辑）、`desktop-attention-os-tauri.ts`、`desktop-attention-os-noop.ts` + 测试
- **目标**：
  - tauri 实现：命令名严格按 AN-I08；`setBadge` → `getCurrentWindow().setBadgeCount(value | undefined)` / `setBadgeLabel`；`requestAttention` → `requestUserAttention(UserAttentionType.Informational)`；`subscribeActivation` → `listen('attention://activate')`；payload 运行时校验（非法丢弃并 `console.warn`）。
  - noop 实现：capabilities 全 false，状态 `unsupported`，`deliver` 返回 `unsupported`，其余 no-op。
  - `createDesktopAttentionOs()`：Tauri 运行时 → tauri 实现；否则 noop（判定方式复用 desktop 现有 Tauri 检测，不新写）。
- **用例**：AN-T43–T44（mock `@tauri-apps/api` 的 invoke/window/event）
- **验证命令**：desktop typecheck + 对应测试

#### AN-U1 偏好与设置页
- **拥有文件**：`attention-preferences.ts`（实现）+ 测试、`settings/notifications-copy.ts`、`settings/pages/notifications-page.tsx` + 测试、`settings/section-registry.ts`、`settings/pages/index.ts`、`settings/settings-search-index.ts`（及其测试）
- **规则**：AN-R07、AN-R17（设置页部分）、AN-R18、AN-D05
- **页面**：授权状态行（granted「已开启」/ denied「已关闭 · 打开系统设置」/ not-determined「开启」/ unsupported「当前运行方式不支持系统通知」；`authorizationReliable=false` 时显示「由系统设置管理」+ 打开系统设置）；8 个开关（AN-I02 字段）；关闭 `onNeedsInput` 弹 ui-kit 确认。
- **依赖接口**：页面通过 props 或 `createDesktopAttentionOs()` 获取状态（只读调用 AN-I07），不 import 控制器。
- **用例**：AN-T45–T47
- **验证命令**：desktop typecheck + 对应测试

#### AN-U2 授权引导条
- **拥有文件**：`attention-opt-in-banner.tsx`、`attention-opt-in-policy.ts` + 测试
- **规则**：AN-R17
- **用例**：AN-T48–T49
- **说明**：纯展示组件 + 纯策略函数；挂载与状态来源由 AN-O3 负责。使用 ui-kit 原语，不手写按钮。

### W2

#### AN-O2 桌面编排器
- **拥有文件**：`desktop-attention-controller.ts` + `desktop-attention-controller.test.ts`
- **规则**：AN-R01、AN-R06、AN-R09–R13、AN-R15、AN-R16、AN-R20、AN-R21
- **实现要点**：
  - 独立 `hostClient.subscribe`，直接处理原始消息；`push/batch` 帧展开其 items。
  - 信号流水线：`readAttentionSignals` → 对 raise 计算 `alreadyNotified`（账本）→ `decideAttention` → 按 delivery 分派；`system` 先过 `admitAttentionBanner`。
  - `settle` / `settle-questions` 不直接操作 OS；清理由 `syncAttentionSessions` 根据集合差集执行（AN-R12）。
  - 文案：`formatAttentionNotification` + `snapshot.describeSession`；locale 映射 `DesktopLocale` → `AttentionCopyLocale`。
  - catch-up：状态机 `idle → catchingUp → idle`；`host/replay-done` 立即退出；否则 1500ms 空闲，计时用注入的 `setTimer`，且只被注意力相关消息重置（AN-R10），不被 `host/log` / `browser/frame` / `pet/state` 重置。
  - 账本读写 `ATTENTION_LEDGER_KEY`，写入节流（同一 tick 合并）。
  - `onPresenceChanged` 负责 AN-R21 回窗跳转提示（仅 `clickActivation=false`）；capabilities 在创建时读取一次并缓存。
  - `syncAttentionSessions` 按 `preferences.badge` 调 `formatDockBadge` → `os.setBadge`；相同 badge 不重复调用。
- **用例**：AN-T50–T58（fake hostClient、fake os、内存 storage、假时钟）
- **验证命令**：desktop typecheck + 对应测试

### W3

#### AN-O3 集成挂载
- **拥有文件**：`hooks/use-desktop-attention.ts` + 测试；`workbench-app.tsx`（仅挂载 hook 与引导条，净增 ≤ 15 行）
- **职责**：
  1. 创建 os 与 controller（单例，随 hostClient 生命周期）。
  2. `subscribeWindowPresence` → dispatch `attention/presence` + `controller.onPresenceChanged`。
  3. `selectVisibleSessionIds`（Docking state / pane layout / `activeSubPage`、overlay → `conversationCovered`）变化 → dispatch `attention/visible-sessions`。
  4. `selectAttentionSessionIds`（含 bootstrap 的 `extensionUiRequest?.sessionId`）变化 → `controller.syncAttentionSessions`。
  5. 激活：挂载时 `takePendingActivation`；订阅 `subscribeActivation` → AN-R19（核实子代理 child → 父会话字段）→ `openSessionFromShell`。
  6. `showInAppNotice` → ui-kit `showUiNotification`（带 AN-I13 action）。
  7. 引导条：`shouldShowAttentionOptIn`，「开启」调用 `os.requestAuthorization`。
  8. `describeSession`：会话列表名称（`session-list-lookup.ts`）+ 项目显示名（`project-display-name.ts`）。
- **用例**：AN-T59–T61
- **验证命令**：`pnpm typecheck && pnpm --filter @piwin/desktop test`；`wc -l` 确认无文件超 1000 行

### W4

#### AN-Q1 macOS 实机门禁
- **拥有文件**：`docs/plans/evidence/2026-09-attention-notifications/**`
- **内容**：packaged `.app` 执行 AN-G01–G13，每项截图/录屏 + 结论表；no-go 路线按 AN-A01 的替代口径验收。

#### AN-D2 文档收尾
- **拥有文件**：本 spec（状态、基线 commit、go/no-go 结果）、`docs/guides/` 用户说明
- **内容**：状态改为「已实施」；记录 no-go 与否；用户说明写明两个 bundle id 独立授权、dev 不支持系统通知。

### W5 Mobile M1（Desktop P0 验收后启动）

| 编号 | 内容 | 拥有文件 | 依赖 |
|------|------|----------|------|
| AN-M0 | Spike：iOS 图标角标可行性（插件 / Tauri API） | 仅回报，不改代码 | — |
| AN-M1 | 接入 `tauri-plugin-notification 2.4`（Cargo、lib.rs、capabilities、package.json） | `apps/mobile/src-tauri/**`、`apps/mobile/package.json` | M0 |
| AN-M2 | `mobile-attention-controller.ts`：复用 S1–S4；presence = `visibilityState`；visible = 当前 conversation 路由；前台 banner、后台本地通知（`extra.sessionId`，`onAction` 路由）；ledger `piwin.mobile.attention.ledger.v1` | `apps/mobile/src/mobile-attention-controller.ts` + 测试 | M1 |
| AN-M3 | `NotificationsSheet` 真实化：权限状态、三个开关、诚实说明；删除「仅改变原型偏好」 | `apps/mobile/src/inkstone/sheets/session-sheets.tsx` 中 `NotificationsSheet`、相关 demo-state 字段 | M2 |
| AN-M4 | 回前台「离开期间」汇总 sheet（复用 Inbox 行 + `resolveActivitySessionName`） | 新增 sheet 文件 + 挂载点 | M2 |

验收 AN-A02。不加 `UIBackgroundModes`，不宣称保活。

### W6+ Remote Push · APNs（独立史诗，AN-D09）

| 编号 | 内容 | 所在层 |
|------|------|--------|
| AN-P1 | ADR 0037 扩展；contracts：`device/push/register { platform: 'apns'; token; environment: 'sandbox' \| 'production'; bundleId }`、`device/push/unregister`；token 绑定已配对 device credential | `docs/adr`、`packages/contracts` |
| AN-P2 | Host APNs 发送：HTTP/2 + token-based `.p8`（密钥仅存 `~/.piwin` 配置 / keychain 引用，不入日志）；触发 = AN-R01 raise；负载 AN-R15/R16；`apns-collapse-id = piwin.attention.{sessionId}`；Host 侧已推送 key 去重；仅对非在线/后台设备推送 | `packages/host-runtime`（新 application 服务） |
| AN-P3 | iOS token 注册：`aps-environment` entitlement、Push capability；原生插件（评估第三方 `tauri-plugin-mobile-push`，或参照 `plugins/healthkit` 自建） | `apps/mobile/src-tauri` |
| AN-P4 | 客户端去重：在线收到同 key 不再本地弹（复用 ledger）；点击推送深链到会话 | `apps/mobile/src` |

前置：Apple Developer APNs Key、真机。验收另立。

---

## 9. 测试用例（AN-T）

| 编号 | 工作包 | 用例 |
|------|--------|------|
| T01 | S1 | session-turn completed → turn-complete，key `run:{id}`，带 endedAt |
| T02 | S1 | session-turn failed → turn-failed |
| T03 | S1 | cancelled + `user-stop`/缺省 → 仅 settle-questions |
| T04 | S1 | cancelled + `tool-loop-stalled` → turn-failed |
| T05 | S1 | interrupted + `paused` → silent；+ `worker-crash` → turn-failed |
| T06 | S1 | subagent-task completed → 无 raise |
| T07 | S1 | terminal 形态 `run/updated` 与 `run/terminal` 产出相同 key |
| T08 | S1 | running 的 `run/updated` → 空数组 |
| T09 | S1 | `permission/request` action `bash` → permissionAction `bash`；含 `/` 或空格 → 字段缺省 |
| T10 | S1 | 信号 JSON 序列化后不含 permission `detail` 与 `context` 任何值 |
| T11 | S1 | `permission/resolved` → settle 同 key；`extension/ui_request` → question raise |
| T12 | S2 | 在场 + 可见 + complete → seen, none |
| T13 | S2 | 在场 + visible 为空 + activeSessionId 匹配 + covered=false → seen |
| T13b | S2 | 在场 + conversationCovered + visible 空 + active 匹配 → unseen, in-app；enabled=false → none, seen=false |
| T14 | S2 | 在场 + 不可见 + foregroundToast → in-app；foregroundToast=false → none |
| T15 | S2 | 不在场 + complete + onComplete=false → none, seen=false |
| T16 | S2 | 不在场 + needs-input → system + bounce；bounceOnNeedsInput=false → bounce false |
| T17 | S2 | enabled=false → none；alreadyNotified → none |
| T18 | S2 | catchingUp → catch-up-summary；endedAt 早于 15min → catch-up-summary |
| T19 | S2 | `DEFAULT_ATTENTION_PREFERENCES` 等于 AN-R18 |
| T20 | S3 | 记录后命中；24h 后不命中 |
| T21 | S3 | 第 257 条淘汰最旧；重复 key 更新时间不重复占位 |
| T22 | S3 | 非法 raw（null、错类型、缺字段）→ 空账本 |
| T23 | S3 | 60s 内第 4 次 → summary；第 1 次滑出窗口后 → single |
| T24 | S4 | zh-CN / en 五种 title |
| T25 | S4 | 会话名缺失 → 未命名会话；General 省略项目段 |
| T26 | S4 | 49 字符会话名截断为 48 且以 `…` 结尾 |
| T27 | S4 | summary：k=0 省略批准句；en 单复数 |
| T28 | R1 | 单栏：active 会话完成，presence active → 无标记；inactive → 有标记 |
| T29 | R1 | Docking：可见非 active 会话完成 → 无标记；不可见 → 有标记 |
| T30 | R1 | inactive → active：只清可见会话标记，permissionQueue 不变 |
| T31 | R1 | `attention/visible-sessions` 相同集合 → 返回同一 state 引用 |
| T32 | R1 | `background-run-delivery` 原场景仍通过（后台会话被标记） |
| T33 | R2 | 同会话 complete + permission 计 1；question 会话计入 |
| T34 | R2 | `formatDockBadge` 0 / 1 / 99 / 100 |
| T35 | R2 | Docking 两组各有前台 session → 两个 id；非 session view 忽略 |
| T36 | R2 | `conversationCovered` → 空集；无 Docking 无 panes → activeSessionId |
| T37 | X1 | 三种打开路径调用正确下游（行为与抽取前一致） |
| T38 | X2 | 单例注册一次、多订阅、退订、非 Tauri 回退 |
| T39 | K1 | action 渲染按钮，点击触发 onClick 并关闭 |
| T40 | N1 | userInfo 校验：合法通过；超长/非法字符/缺字段拒绝 |
| T41 | N1 | title/body 256 字节截断不切断 UTF-8 |
| T42 | N1 | 支持性判定：无 bundle id / 非 `.app` → unsupported |
| T43 | O1 | tauri 实现命令名与参数形状符合 AN-I08；非法激活 payload 被丢弃 |
| T44 | O1 | noop 实现各方法返回约定值且不抛错 |
| T45 | U1 | 偏好读写往返；非法 JSON → 默认值；新增字段缺省补默认 |
| T46 | U1 | 授权四态 + `authorizationReliable=false` 渲染 |
| T47 | U1 | 关闭 onNeedsInput 需确认，取消则不写入 |
| T48 | U2 | `shouldShowAttentionOptIn` 各分支（状态、是否发送过、7 天内 dismiss） |
| T49 | U2 | 引导条按钮回调 |
| T50 | O2 | 不在场 `run/terminal` → deliver 一次，identifier `piwin.attention.{sessionId}`、threadId 为项目 id |
| T51 | O2 | 随后同 runId 的 terminal `run/updated` → 不再 deliver |
| T52 | O2 | hydration 后重放 5 个终态 → 0 次单发；1500ms 后 1 次 summary |
| T53 | O2 | `host/replay-done` 立即结束 catch-up |
| T54 | O2 | 从 storage 恢复账本后重复 permission/request 不投递 |
| T55 | O2 | deliver 返回 not-authorized：在场 → in-app；不在场 → 静默 |
| T56 | O2 | syncAttentionSessions：集合移除会话 → removeDelivered；badge 相同不重复 setBadge；badge 偏好关 → clear |
| T57 | O2 | 60s 内第 4 条 system → identifier `piwin.attention.summary` |
| T58 | O2 | clickActivation=false：投递后 60s 内回到 active → 一次带跳转按钮的 in-app；超过 60s 不触发 |
| T59 | O3 | 激活事件 → openSessionFromShell(sessionId)；会话不存在 → 提示 |
| T60 | O3 | 挂载消费 pending activation 一次 |
| T61 | O3 | presence / visible 变化分别 dispatch 对应 action |

---

## 10. 实机门禁（AN-G，packaged `.app`，由 AN-Q1 执行）

| 编号 | 步骤 | 期望 |
|------|------|------|
| G01 | 首次发送消息 | 出现引导条；「开启」弹系统授权；设置页显示已开启 |
| G02 | 长任务 → 切到浏览器 → 完成 | Dock 数字 1；通知中心一条「已完成 · 项目 · 会话」 |
| G03 | 点击 G02 通知 | 窗口前置并打开该会话；角标清除 |
| G04 | 留在该会话看完成 | 无通知、无角标 |
| G05 | 看会话 A 时 B 完成 | 应用内提示可跳转；无系统横幅；角标 1 |
| G06 | 触发 `bash` 权限后切走 | 通知含 `bash`、无命令路径；Dock 弹跳一次；回窗角标仍在；批准后角标与通知中心条目消失 |
| G07 | 关闭「完成时提醒」重复 G02 | 无横幅，角标增加 |
| G08 | 总开关关闭，触发权限 | 无横幅无弹跳；角标随 badge 开关 |
| G09 | 系统设置拒绝通知 | 设置页「已关闭 · 打开系统设置」可跳；角标仍工作 |
| G10 | 离开时 3 完成 + 1 权限，断网恢复 / 睡眠唤醒 | 无重复横幅；最多一条汇总，突出等待批准 |
| G11 | 应用退出后点击通知中心旧条目 | 启动后打开该会话 |
| G12 | Docking 双组同时可见两会话，前台完成 | 无标记无通知 |
| G13 | `tauri dev` 裸二进制 | 设置页「当前运行方式不支持」；角标与应用内提示正常；不崩溃 |

---

## 11. 验收（AN-A）

| 编号 | 阶段 | 标准 |
|------|------|------|
| AN-A01 | P0 Desktop | G01–G13 通过并留证（no-go 路线：G03/G11 改为「回窗 60s 内跳转按钮可达该会话」，G13 不适用）；T01–T61 绿；`pnpm typecheck` 与 `cargo test` 绿；无文件超 1000 行且 `workbench-app.tsx` 行数下降；AN-R16 代码审查通过；ADR 0064 落盘；本 spec 状态更新 |
| AN-A02 | P2 Mobile M1 | 前台跨会话 banner 可跳转；回前台离开期间汇总不重复；后台短时权限本地通知（尽力，记录成功率）；设置页授权状态真实且无保活承诺 |
| AN-A03 | P3 APNs | 另立（杀进程状态下完成/权限推送可达、点击直达、无敏感负载、Key 不外泄） |

---

## 12. 风险（AN-K）

| 编号 | 风险 | 缓解 |
|------|------|------|
| AN-K01 | ad-hoc 签名包无法获得 UN 授权 | AN-N1 首日 spike；no-go 按 AN-D04 出货 |
| AN-K02 | 并发工作包桩函数抛错导致依赖方测试失败 | 依赖方可基于上游分支 rebase 自测；合并以 W 顺序为准；AN-O2 放 W2 |
| AN-K03 | 子代理越权改文件造成冲突 | §5 所有权 + 回报必须列改动文件；协调者合并前核对 |
| AN-K04 | `main` 未提交改动不在 worktree 中，合并回 main 时冲突 | AN-C0 先决定基线；集成分支合回前与 main 最新状态 rebase |
| AN-K05 | Dock 角标受「通知 → 标记应用图标」设置影响 | G09 验证，设置页说明 |
| AN-K06 | 系统对话框导致失焦，完成时误弹横幅 | 可接受；决策按事件时刻取样 |
| AN-K07 | 远程 Host 时钟偏差 | 主去重不依赖时间；AN-R11 仅宽松兜底 |
| AN-K08 | 两个 bundle id 独立授权 | AN-D2 用户说明 |
| AN-K09 | APNs 依赖开发者账号与真机 | 独立史诗，不阻塞 P0/M1 |

---

## 13. 参考

- 代码：见 AN-F01–F19 所列路径。
- ADR：0023 questionnaire · 0036 Host 多客户端 · 0037 Mobile 远程 shell · 0063 多 pane 工作区。
- 外部：
  - [Tauri Notification 插件文档](https://v2.tauri.app/plugin/notification/)
  - [plugins-workspace notification desktop.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/src/desktop.rs)
  - [Tauri Window JS API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)
  - [tauri-plugin-notification crate](https://crates.io/crates/tauri-plugin-notification)
  - [tauri-plugin-mobile-push（第三方）](https://github.com/yanqianglu/tauri-plugin-mobile-push)
  - [tauri-plugin-notifications（第三方）](https://crates.io/crates/tauri-plugin-notifications)
  - [Apple Developer Forums：UserNotifications](https://developer.apple.com/forums/thread/809552)
