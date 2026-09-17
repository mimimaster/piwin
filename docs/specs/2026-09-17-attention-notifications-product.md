# piwin 注意力通知（Attention Notifications）产品与实施方案

| 字段 | 值 |
|------|-----|
| 状态 | **v2 可执行方案 · 代码事实已核对 · 开放问题已由 owner 拍板（2026-09-17，见 §14）· 可开工** |
| 日期 | 2026-09-17 |
| 范围 | Desktop（Tauri 2，macOS 为 P0 门禁）· Mobile（Tauri 2 iOS，M1 本地）· Host 边界（P0 零改动）。**当前只有 Apple shell（macOS / iOS）**，Windows / Linux / Android 相关项暂缓 |
| 相关 | ADR 0036 / 0037 / 0063 · `run/*`、`permission/*`、`extension/ui_request` HostPush · `activity/summary` · Docking 工作台 |
| 新增 ADR | `docs/adr/0064-client-local-attention-notifications.md`（T0 落盘） |
| 非目标 | 公共多租户推送云 · 微信小程序通道 · Host 内嵌 Node 到手机 · 从通知直接批准权限 |

---

## 0. 一句话与本版修订

用户把 Agent 丢到后台跑；**跑完、失败或卡在权限/提问上时**，桌面 Dock 角标 + macOS 系统通知把他拉回来，**点通知直达该会话**；前台看别的会话时只给应用内提示；手机先做「前台跨会话提醒 + 回到前台时的离开期间摘要」，真正的离线推送是独立阶段。

### 0.1 v1 草案 → v2 的关键修正（均来自代码/上游核对）

| # | v1 假设 | 核对结果 | v2 处理 |
|---|---------|----------|---------|
| 1 | `tauri-plugin-notification` 点击通知可 `onAction` 回到会话 | 插件文档：`onAction`/`registerActionTypes` **仅移动端**；桌面端无点击事件 | macOS 自建 `UNUserNotificationCenter` 原生桥（Rust / objc2，仓库已有 objc2 先例）；P0 **不引入**该插件 |
| 2 | 首次 `requestPermission` 获取系统授权 | 插件桌面实现 `request_permission`/`permission_state` **恒返回 Granted**；macOS 走 `notify-rust`（NSUserNotification，dev 下冒充 `com.apple.Terminal`） | 授权状态由原生桥给真实值（granted / denied / not-determined / unsupported） |
| 3 | 需新建 `AttentionStore` 未读队列 | Desktop reducer **已有** `completedAttentionSessionIds` / `failedAttentionSessionIds`（侧栏标记，打开会话即清）与全局 `permissionQueue`（requestId 去重、`permission/reconcile` 重建） | 不新建 Store；扩展 reducer 的「是否已看见」判定，角标由现有状态派生 |
| 4 | `run/terminal` 有 "cancelled by user" | `ExecutionRunStatus` 无触发者字段；暂停被记为 `interrupted` + `terminalCode: paused`；替换输入记为 `superseded-by-new-prompt` | §5.2 用 status × terminalCode 分类表 |
| 5 | 事件即实时 | 重连 / 冷启动时 cursor replay、`hydration`、`snapshot` 会**重放**旧的 `run/terminal`、`permission/request` | §5.6 catch-up 门闸 + 持久化「已通知账本」 |
| 6 | 通知正文可带「最后一句助手话」 | 后台会话的 transcript/event 属 session 受众，**未订阅时不下发**；只有 `run/*`(session-turn，global)、`permission/*`、`extension/ui_request`(inbox) 全量到达 | 摘要正文降为 P1，需额外读取（§8 P1） |
| 7 | 只有权限算 Waiting | questionnaire 走 `extension/ui_request`（ADR 0023），同样阻塞 turn | needs-input 来源 = 权限 + 提问 |
| 8 | 在现有文件里接线 | `workbench-app.tsx` 1042 行、`desktop-locale.ts` 1648 行已超 1000 行上限；`use-host-bootstrap.ts` 941 行临界 | 新逻辑全部新文件；会话打开逻辑顺带抽出（净减 `workbench-app.tsx` 行数） |
| 9 | iOS 后台短时仍可本地通知 | WKWebView 进入后台秒级挂起，WS 基本不可用 | M1 价值重心改为前台跨会话提醒 + 回前台「离开期间」摘要；后台横幅仅尽力 |
| 10 | P0 3–5 人日 | 含原生桥、reducer、设置、实机门禁 | 重估 ≈ 7.5 人日（§9） |

---

## 1. 问题与动机

- 单次 turn 常需数分钟，用户会切到浏览器 / IDE；回来时不知道是还在跑、已完成、还是卡在权限上白等。
- Docking 多会话并行时更需要「哪几个会话需要你」的聚合信号，而不是每个 tool 的打扰。

生态共识（Claude Code / Codex / Cursor 的 hook + notifier 类工具）：

| 状态 | 含义 | 是否打扰 |
|------|------|----------|
| Running | 模型在流、工具在跑 | 否 |
| **Waiting（needs-input）** | 权限 / 提问 待处理 | **是，最高优**：每分钟都在烧工期 |
| Complete / Failed | 本轮结束 | 仅在用户**没在看**时 |

要点：Waiting ≠ Idle；完成通知必须带「你不在」条件；文案要带会话名；**点击必须回到对应会话**，否则通知几乎无转化。

---

## 2. 代码事实基线（实施以此为准）

| 事实 | 位置 | 影响 |
|------|------|------|
| `ExecutionRunKind`：`session-turn` / `plan-execution` / `subagent-batch` / `subagent-task`；`ExecutionRunStatus` 含 `completed/failed/cancelled/interrupted` | `packages/contracts/src/run.ts` | 只对 `session-turn` 发注意力 |
| 暂停 → `interrupted`（`run-terminalizer.ts:103`）；中止原因 `user-stop / pause-requested / superseded-by-new-prompt / host-shutdown / tool-loop-stalled` | `packages/host-runtime/src/run-abort-reason.ts` | §5.2 分类 |
| Host 可能先发 terminal 形态的 `run/updated` 再发（或不发）`run/terminal` | `chat-reducer-envelope.ts` 注释 | 两种 push 都要识别，按 runId 去重 |
| 受众：`run/*` 的 session-turn = global；`permission/*`、`extension/ui_request` = inbox；其余会话流 = session | `packages/host-transport/src/host-push-audience.ts` | 后台会话的完成/权限必达；transcript 不可得 |
| `permission/request` 带 `sessionId / requestId / action / detail / context / runId`；`detail`、`context.command/paths` 含路径命令 | `packages/contracts/src/ipc-host-push.ts`、`host.ts` | 通知只用 `sanitizeActivityPermissionAction(action)` |
| 侧栏注意力标记 `completedAttentionSessionIds` / `failedAttentionSessionIds`，判定条件为 `state.activeSessionId !== run.sessionId`，`session/set` 等路径清除 | `chat-reducer-run.ts:251`、`chat-reducer-envelope.ts:118`、`chat-reducer-session.ts:369` 等 | 复用；把判定升级为「在场 × 可见」 |
| 全局 `permissionQueue`（上限 16，requestId 去重）+ `permission/reconcile` | `permission-queue.ts`、`chat-reducer.ts:263`、`hooks/reconcile-pending-permissions.ts` | 角标 needs-input 部分直接派生 |
| 提问请求为 bootstrap hook 内单槽状态 `extensionUiRequest`，run 终态时清除 | `hooks/use-host-bootstrap.ts:264/591/376` | 角标加入该 sessionId |
| 焦点监听已有一处：`renderer-self-heal.ts` 使用 `onFocusChanged` | `apps/desktop/src/renderer-self-heal.ts:191` | 抽共享 `window-focus-signal.ts`，不重复监听 |
| 会话打开：侧栏 `onResumeSession` 内联闭包（含 Docking `openOrFocusSession`、pane 绑定、scope 判断）→ `handleResumeSession(sessionId, { scope })` | `workbench-app.tsx:583`、`hooks/use-session-resume.ts:125`、`workbench/docking/view-commands.ts:109` | 抽为 `openSessionFromShell`，通知点击复用 |
| 窗口唤起命令 `show_main_window` 已存在；app 命令无 ACL manifest（默认放行） | `src-tauri/src/lib.rs:211`、`build.rs` | 原生桥可直接注册命令 |
| capability 仅 size/drag；`core:window:default` 已含 `allow-is-focused`；无 badge / attention 权限 | `src-tauri/capabilities/default.json`、`gen/schemas` | 补 `set-badge-count`、`set-badge-label`、`request-user-attention` |
| Tauri 2.11.5；objc2 0.6 / objc2-foundation 0.3 / block2 0.6；`define_class!` 先例 | `Cargo.lock`、`src-tauri/src/artifact_bridge.rs` | 新增 `objc2-user-notifications 0.3` 同代际 |
| 偏好存储：localStorage `piwin.desktop.*` | `ui-preferences.ts` | 新增独立 `attention-preferences.ts` |
| 设置分区注册表 | `settings/section-registry.ts` | 新增 `notifications` 分区 |
| 应用内 toast：`notification-queue.ts` → `@piwin/ui-kit` | — | 前台跨会话提示复用 |
| Mobile：`mobile-activity-summary.ts` 已按 `run/*`、`permission/*` 刷新 Inbox；`NotificationsSheet` 为 demo 开关；无 notification 插件、无 `UIBackgroundModes` | `apps/mobile/src/…` | M1 复用同一纯模块 |

---

## 3. 产品原则

1. **Host 只发事实，Shell 决定打扰。** 继续 fan-out `HostPush`；每个客户端按自己的在场状态/偏好本地发通知。Host 不调 OS API。
2. **三类注意力。** `needs-input`（权限、提问）· `turn-complete` · `turn-failed`。
3. **看见即已读，不在才打扰。** 在场且会话可见 → 无提示；在场但看别的会话 → 应用内提示；不在场 → 角标 + 系统通知。
4. **角标 = 需要你处理的会话数**，不是完成总数，也不是运行中数量。
5. **needs-input 只有被处理才消失。** 回到窗口不会清掉待批权限。
6. **隐私。** 通知只含：类别标题、项目名、会话名、权限 classifier token（如 `bash`）。永不含 `detail`、命令、路径、密钥。
7. **手机诚实分层。** 连着才能喊；不承诺杀进程后推送。

---

## 4. 用户故事与表面

### 4.1 Desktop

1. 切到浏览器；Agent 跑完 → Dock 红色数字 + 通知中心一条「已完成 · piwin · 重构会话列表」；点击 → 窗口前置并打开该会话，角标 −1。
2. Agent 卡在 `bash` 权限 → 即使关了「完成通知」也提醒；Dock 弹跳一次；角标在批准/拒绝前一直计入。
3. 正盯着该会话流式输出 → 无通知、无角标。
4. 正在看会话 A，后台会话 B 完成 → 应用内 toast「B 已完成 [查看]」，不弹系统横幅；侧栏 B 显示完成标记；角标 +1。
5. 离开 20 分钟，三个会话先后完成 → 前两条独立横幅，第三条起合并为「3 个会话需要你」一条（同一标识替换）。
6. 合上笔记本、次日打开 → 重连重放的旧终态**不**逐条弹横幅；若离开期间有未处理项，只给一条汇总。

### 4.2 表面矩阵

| 表面 | Desktop（P0 macOS） | Mobile（M1） | 触发 |
|------|---------------------|--------------|------|
| Dock / 图标角标 | `setBadgeCount`；>99 用 `setBadgeLabel('99+')` | M1 前 spike，不保证 | 注意力会话数 > 0 |
| 系统通知横幅 | 原生 `UNUserNotificationCenter` 桥 | `tauri-plugin-notification` 本地通知 | 不在场 + 偏好允许 |
| Dock 弹跳 | `requestUserAttention(Informational)`，仅 needs-input | n/a | 不在场 |
| 应用内提示 | ui-kit toast（带「查看」） | Inkstone 顶部轻 banner | 在场但会话不可见 |
| 侧栏 / Inbox 标记 | 现有完成/失败标记 + 权限状态 | 现有 Inbox + activeRun 点 | 与角标同源 |
| 点击深链 | 原生 delegate → `attention://activate` → `openSessionFromShell` | 插件 `onAction` → conversation 路由 | 通知 userInfo / extra |
| 离开期间汇总 | catch-up 结束一条汇总 | 回前台汇总 sheet | 重放 / 恢复连接 |

---

## 5. 领域模型与策略

### 5.1 信号来源映射（`readAttentionSignals(push)`）

| HostPush | 条件 | 产出 |
|----------|------|------|
| `permission/request` | 恒 | `raise needs-input`，key `permission:{requestId}`，`permissionAction = sanitizeActivityPermissionAction(action)` |
| `permission/resolved` | 恒 | `settle` key `permission:{requestId}` |
| `extension/ui_request` | 恒 | `raise needs-input`，key `question:{requestId}`（source=`question`） |
| `run/terminal` 或 terminal 形态 `run/updated` | `run.kind === 'session-turn'` 且 §5.2 非 silent | `raise turn-complete / turn-failed`，key `run:{runId}`；并 `settle-questions {sessionId}` |
| `run/terminal` silent 类 | 同上 | 仅 `settle-questions {sessionId}` |
| `hydration` / `snapshot` 帧 | — | 进入 catch-up（§5.6） |
| `host/replay-done` | — | 结束 catch-up |
| 其他 | — | 无 |

子代理（`subagent-*`）与 `plan-execution` 默认不产出；它们的结果会通过父 session-turn 终态体现。

### 5.2 终态分类（`classifyRunTerminalAttention(run)`）

| status | terminalCode | 分类 | 理由 |
|--------|--------------|------|------|
| `completed` | 任意 | turn-complete | |
| `failed` | 任意 | turn-failed | |
| `cancelled` | `tool-loop-stalled`、`timeout`、`job-cleanup-failed` | turn-failed | 非用户意图的中止 |
| `cancelled` | 其他（含 `user-stop`、`superseded-by-new-prompt`、`host-shutdown`、缺省） | silent | 用户自己停/换题/退出 |
| `interrupted` | `paused` | silent | 用户暂停 |
| `interrupted` | `host-shutdown` | silent | 退出/重启 Host |
| `interrupted` | 其他（`worker-crash`、`runtime-memory-pressure`、缺省…） | turn-failed | 意外中断，需要用户决定是否继续 |

> T1 核实项：`integration-required` 是否会出现在 session-turn 上（目前只见于 subagent 终态）。若出现，归 turn-failed，文案「需要合并冲突」。多端场景下（手机上点停止）桌面同样 silent，符合预期。

### 5.3 在场（presence）与可见（visible）

- **presence = active** ⇔ 主窗口 focused **且** `document.visibilityState === 'visible'`（最小化/隐藏即 inactive）。
- **visibleSessionIds**：
  - Docking 开启：每个 stage group 当前前台 view 若为 session，则其 sessionId；
  - 旧 conversation panes：所有 leaf 的 sessionId；
  - 单栏：`activeSessionId`；
  - 设置子页 / 覆盖层遮住会话区时（`activeSubPage !== null` 或 overlay 打开）：空集。
- **seen(sessionId)** ⇔ presence active 且 sessionId ∈ visibleSessionIds。

P1：窗口 focused 但 5 分钟无键鼠输入视为 inactive（「走开了」），默认关闭。

### 5.4 判定表（`decideAttention(signal, ctx)`）

| 信号 | seen | 在场，不可见 | 不在场 | catch-up 中 |
|------|------|--------------|--------|-------------|
| needs-input | 计入角标；无提示（卡片已在眼前） | 计入角标；应用内 toast | 计入角标；**系统通知**；Dock 弹跳（偏好） | 计入角标；不逐条提示，进汇总 |
| turn-complete | 不标记；无提示 | 标记；应用内 toast（偏好 `foregroundToast`） | 标记；系统通知（偏好 `onComplete`） | 标记；进汇总 |
| turn-failed | 不标记（现有错误卡片可见） | 标记；应用内 toast | 标记；系统通知（偏好 `onFailure`） | 标记；进汇总 |
| settle | 移除对应标记/已投递通知 | 同左 | 同左 | 同左 |

总开关 `enabled=false`：不发系统通知、不 toast、不弹跳；角标仅受 `badge` 开关控制；侧栏标记不受影响。

### 5.5 已读 / 清除规则

| 动作 | complete/failed 标记 | needs-input |
|------|----------------------|-------------|
| 打开会话（`session/set`，现有） | 清该会话 | 不清 |
| 会话变为可见且 presence active（新增） | 清该会话 | 不清 |
| presence inactive → active（新增） | 清**当前可见**会话的标记 | 不清 |
| `permission/resolved` | — | 清该 requestId |
| 用户回答提问 / 该会话 run 终态 | — | 清该会话 question |
| 点击系统通知 | 打开会话 → 按第一行清 | 打开会话但**不**清（需实际处理） |

每次清除后，若该会话已无任何注意力，调用 `removeDelivered(['piwin.attention.{sessionId}'])`，避免通知中心残留过期条目。

### 5.6 去重、重放门闸、突发合并

1. **已通知账本（持久化）**：key → 时间戳，LRU 上限 256，TTL 24h，localStorage `piwin.desktop.attention.ledger.v1`。任何横幅/toast/弹跳前检查，发出后记录。解决：重连重放、`run/updated` + `run/terminal` 双发、应用重启后 pending 权限被 reconcile 再次到达。
2. **catch-up 门闸**：收到 `hydration`/`snapshot` 帧或 transport 从断开恢复 → `catchingUp = true`；收到 `host/replay-done` 或连续 1500ms 无 push 后结束。期间只更新 reducer（标记照常），信号进入待汇总集合；结束时过滤掉账本已有项，若剩余 ≥1：不在场 → 一条系统通知「离开期间 N 个会话需要你」；在场 → 一条应用内 toast。
3. **新鲜度兜底**：`run.endedAt` 早于本地 now − 15min 的终态不单独横幅（容忍远程 Host 时钟偏差，只作兜底，主机制是 1、2）。
4. **单会话替换**：系统通知 identifier 固定为 `piwin.attention.{sessionId}`，`threadIdentifier` = projectId 或 `general`；同会话新事件替换旧横幅。
5. **突发合并**：滚动 60s 内第 4 条起不再单发，改为投递/替换 `piwin.attention.summary`「N 个会话需要你」；needs-input 在汇总标题中优先（「有 K 个等待批准」）。

### 5.7 角标计数

```text
attentionSessionIds = keys(completedAttention) ∪ keys(failedAttention)
                    ∪ permissionQueue[].sessionId ∪ { extensionUiRequest?.sessionId }
count = |attentionSessionIds|
0 → 清除（setBadgeCount(undefined)）；1..99 → 数字；>99 → setBadgeLabel('99+')
```

按会话去重：同一会话既 needs-input 又 complete 只算 1。`badge=false` 时始终清除。

### 5.8 文案（zh-CN / en，纯函数 `formatAttentionNotification`）

| kind | title (zh / en) | body |
|------|-----------------|------|
| needs-input · permission | 需要你的批准 / Approval needed | `{project} · {session} · {action}` |
| needs-input · question | Agent 在等你回答 / Agent is asking | `{project} · {session}` |
| turn-complete | 已完成 / Finished | `{project} · {session}` |
| turn-failed | 运行失败 / Run failed | `{project} · {session}` |
| summary | {n} 个会话需要你 / {n} sessions need you | 有 {k} 个等待批准 · … |

- `session` 取客户端会话列表名称，缺失用「未命名会话 / Untitled session」（不暴露 id）；`project` 取项目显示名，General 空间省略。
- 每段截断 48 字符；`action` 不合法（sanitize 失败）则省略。
- 不含 error message、terminalCode 原文、detail。

---

## 6. Desktop 实施设计

### 6.1 数据流

```text
HostClient.subscribe ──► stream buffer ──► chatUiReducer ──► completed/failed markers
       │                                         ▲               permissionQueue
       │                                         │ attention/presence, attention/visible-sessions
       ▼                                         │
DesktopAttentionController ◄── window-focus-signal + visible-sessions selector
  ├─ readAttentionSignals / decideAttention / ledger / burst   (@piwin/host-client, 纯)
  ├─ in-app toast  ──► notification-queue (ui-kit)
  ├─ badge         ──► selectAttentionSessionIds ─► DesktopAttentionOs.setBadge
  └─ banner/bounce ──► DesktopAttentionOs ─► Rust attention_notifications.rs ─► UNUserNotificationCenter
                                                   │ delegate didReceive
                                                   ▼
                          emit "attention://activate" ─► openSessionFromShell(sessionId)
```

### 6.2 文件清单

| 操作 | 文件 | 职责 | 行数预算 |
|------|------|------|----------|
| 新增 | `packages/host-client/src/attention-signal.ts` | push → 信号；终态分类 | ≤160 |
| 新增 | `packages/host-client/src/attention-policy.ts` | 判定表 | ≤160 |
| 新增 | `packages/host-client/src/attention-notify-ledger.ts` | 账本 LRU + 突发窗口（纯） | ≤140 |
| 新增 | `packages/host-client/src/attention-copy.ts` | zh/en 文案 + 截断 | ≤120 |
| 修改 | `packages/host-client/src/index.ts` | 导出以上 4 个模块 | +4 |
| 新增 | 上述各自 `*.test.ts` | golden cases（§10.1） | — |
| 新增 | `apps/desktop/src/chat-reducer-attention.ts` | presence/visible 状态、`shouldMarkTurnAttention`、清除逻辑 | ≤150 |
| 修改 | `apps/desktop/src/chat-ui-types.ts` | 新增 2 个 state 字段 + 2 个 action | +15 |
| 修改 | `apps/desktop/src/chat-reducer.ts` | 路由 `attention/*` 到新模块；初始 state | +10 |
| 修改 | `apps/desktop/src/chat-reducer-run.ts`、`chat-reducer-envelope.ts` | 两处 `activeSessionId !== sessionId` → `shouldMarkTurnAttention` | ±6 |
| 新增 | `apps/desktop/src/attention-badge-model.ts` | 角标派生 + 格式化 | ≤80 |
| 新增 | `apps/desktop/src/workbench/docking/visible-sessions.ts` | Docking / panes / 单栏 → visibleSessionIds | ≤90 |
| 新增 | `apps/desktop/src/window-focus-signal.ts` | 单例 `onFocusChanged` + visibilitychange，多订阅者 | ≤90 |
| 修改 | `apps/desktop/src/renderer-self-heal.ts` | 改用 `window-focus-signal`（纯重构） | −15 |
| 新增 | `apps/desktop/src/hooks/use-shell-session-open.ts` | 从 `workbench-app.tsx:583` 抽出 `openSessionFromShell`（纯重构） | ≤120 |
| 修改 | `apps/desktop/src/workbench-app.tsx` | 使用抽出的 hook；挂载 `useDesktopAttention` | 净减 ≥40 |
| 新增 | `apps/desktop/src/desktop-attention-os.ts` | `DesktopAttentionOs` 接口 + `createDesktopAttentionOs()` 选择实现 | ≤60 |
| 新增 | `apps/desktop/src/desktop-attention-os-tauri.ts` | invoke 原生命令 + window badge/attention API | ≤160 |
| 新增 | `apps/desktop/src/desktop-attention-os-noop.ts` | 浏览器/mock：横幅降级为 toast，badge no-op | ≤50 |
| 新增 | `apps/desktop/src/desktop-attention-controller.ts` | 非 React 编排：订阅、catch-up、账本持久化、调用 OS | ≤300 |
| 新增 | `apps/desktop/src/hooks/use-desktop-attention.ts` | React 接线：state 选择器、偏好、激活监听 | ≤180 |
| 新增 | `apps/desktop/src/attention-preferences.ts` | 读写 `piwin.desktop.attention.v1` | ≤100 |
| 新增 | `apps/desktop/src/settings/notifications-copy.ts` | 设置页 zh/en 文案（不进超限的 `desktop-locale.ts`） | ≤100 |
| 新增 | `apps/desktop/src/settings/pages/notifications-page.tsx` | 设置 → 通知 | ≤250 |
| 修改 | `settings/section-registry.ts`、`settings/pages/index.ts`、`settings/settings-search-index.ts` | 注册分区与搜索 | +10 |
| 新增 | `apps/desktop/src/attention-opt-in-banner.tsx` | 一次性授权引导条（ui-kit） | ≤80 |
| 新增 | `apps/desktop/src-tauri/src/attention_notifications.rs` | macOS 原生桥；非 macOS 返回 unsupported | ≤350 |
| 修改 | `apps/desktop/src-tauri/src/lib.rs` | `mod`、注册命令、`setup` 安装 delegate | +12 |
| 修改 | `apps/desktop/src-tauri/Cargo.toml` | `objc2-user-notifications`；objc2-foundation 增加 `NSDictionary`/`NSError`/`NSArray`/`NSBundle` features | +3 |
| 修改 | `apps/desktop/src-tauri/capabilities/default.json` | 3 个 window 权限 | +3 |
| 新增 | `docs/adr/0064-client-local-attention-notifications.md` | 决策记录 | — |
| 修改 | `docs/guides/`（桌面使用说明，如有通知章节则补） | 用户可见行为 | — |

### 6.3 共享纯模块 API（`@piwin/host-client`）

```ts
// attention-signal.ts
export type AttentionKind = 'needs-input' | 'turn-complete' | 'turn-failed';
export type AttentionRaise = {
  type: 'raise';
  kind: AttentionKind;
  key: string;                       // permission:{id} | question:{id} | run:{runId}
  sessionId: string;
  source: 'permission' | 'question' | 'run';
  runId?: string;
  permissionAction?: string;         // sanitized classifier token only
  endedAt?: string;
};
export type AttentionSignal =
  | AttentionRaise
  | { type: 'settle'; sessionId: string; key: string }
  | { type: 'settle-questions'; sessionId: string };
export function classifyRunTerminalAttention(run: ExecutionRunRecord): 'turn-complete' | 'turn-failed' | 'silent' | null;
export function readAttentionSignals(push: HostPush): AttentionSignal[];

// attention-policy.ts
export type AttentionPresence = 'active' | 'inactive';
export type AttentionPreferences = {
  enabled: boolean; onNeedsInput: boolean; onComplete: boolean; onFailure: boolean;
  badge: boolean; sound: boolean; bounceOnNeedsInput: boolean; foregroundToast: boolean;
};
export const DEFAULT_ATTENTION_PREFERENCES: AttentionPreferences;
export type AttentionContext = {
  presence: AttentionPresence;
  visibleSessionIds: ReadonlySet<string>;
  catchingUp: boolean;
  preferences: AttentionPreferences;
  alreadyNotified: boolean;
  now: number;
};
export type AttentionDecision = {
  seen: boolean;
  delivery: 'none' | 'in-app' | 'system' | 'catch-up-summary';
  bounce: boolean;
};
export function decideAttention(signal: AttentionRaise, context: AttentionContext): AttentionDecision;

// attention-notify-ledger.ts
export const ATTENTION_LEDGER_MAX_ENTRIES = 256;
export const ATTENTION_LEDGER_TTL_MS = 86_400_000;
export type AttentionNotifyLedger = { entries: ReadonlyArray<{ key: string; at: number }> };
export function hasAttentionNotified(ledger: AttentionNotifyLedger, key: string, now: number): boolean;
export function recordAttentionNotified(ledger: AttentionNotifyLedger, key: string, now: number): AttentionNotifyLedger;
export function readAttentionNotifyLedger(raw: unknown): AttentionNotifyLedger;
export type AttentionBurstWindow = { deliveredAt: readonly number[] };
export function admitAttentionBanner(window: AttentionBurstWindow, now: number): { window: AttentionBurstWindow; mode: 'single' | 'summary' };

// attention-copy.ts
export type AttentionCopyLocale = 'zh-CN' | 'en';
export function formatAttentionNotification(input: {
  locale: AttentionCopyLocale;
  kind: AttentionKind | 'summary';
  source?: 'permission' | 'question' | 'run';
  projectName?: string; sessionTitle?: string; permissionAction?: string;
  count?: number; needsInputCount?: number;
}): { title: string; body: string };
```

约束：零 DOM / Tauri / Node 依赖（host-client 已被 Mobile 使用）；`contracts` 不变。

### 6.4 Reducer 变更（`chat-reducer-attention.ts`）

```ts
// ChatUiState 新增
attentionPresence: 'active' | 'inactive';          // 初始 'active'
attentionVisibleSessionIds: Record<string, true>;   // 初始 {}

// ChatUiAction 新增
| { type: 'attention/presence'; presence: 'active' | 'inactive' }
| { type: 'attention/visible-sessions'; sessionIds: readonly string[] }

export function isSessionSeen(state: ChatUiState, sessionId: string): boolean;
export function shouldMarkTurnAttention(state: ChatUiState, sessionId: string): boolean; // = !isSessionSeen
```

- `attention/presence` 由 inactive → active：清除当前可见会话的 completed/failed 标记。
- `attention/visible-sessions`：presence active 时清除**新增可见**会话的标记；内容不变返回原 state（避免重渲染）。
- `isSessionSeen` 在 visible 集为空时回退 `activeSessionId`（兼容单栏与测试 harness）。
- 行为变化（写入 ADR）：Docking 中可见但非 active 的 pane 完成时，侧栏不再出现完成标记 —— 修正现有「看得见却标未读」的不一致。

### 6.5 Controller（`desktop-attention-controller.ts`）

```ts
export type DesktopAttentionControllerDeps = {
  hostClient: { subscribe(listener: (message: HostServerMessage) => void): () => void };
  os: DesktopAttentionOs;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  now: () => number;
  getSnapshot: () => {
    presence: AttentionPresence;
    visibleSessionIds: ReadonlySet<string>;
    preferences: AttentionPreferences;
    locale: DesktopLocale;
    describeSession: (sessionId: string) => { sessionTitle?: string; projectName?: string };
  };
  showInAppNotice: (input: { title: string; body: string; sessionId?: string }) => void;
};
export function createDesktopAttentionController(deps: DesktopAttentionControllerDeps): {
  syncBadge(sessionIds: readonly string[]): void;          // hook 在状态变化时调用
  settleDelivered(sessionIdsWithoutAttention: readonly string[]): void;
  dispose(): void;
};
```

- 独立 `hostClient.subscribe`（不改 941 行的 bootstrap），与 reducer 读同一条消息流；直接读原始 push，不经过 stream buffer 延迟。
- 顺序保证：决策只依赖 presence/visible/偏好/账本，不依赖 reducer 是否已标记，因此与 buffer flush 顺序无关。
- 横幅投递失败（未授权/unsupported）→ 降级为应用内 toast 仅当在场；不在场则静默（角标仍在）。
- `sound`：`delivery === 'system'` 时传 `sound: preferences.sound`。

`use-desktop-attention.ts`：
- 订阅 `window-focus-signal` → dispatch `attention/presence`；
- `visible-sessions` 选择器结果变化 → dispatch `attention/visible-sessions`；
- `selectAttentionSessionIds` 变化 → `controller.syncBadge`；消失的会话 → `settleDelivered`；
- 挂载时 `os.takePendingActivation()`，并订阅 `os.subscribeActivation` → `openSessionFromShell(sessionId)`；会话不存在 → toast「该会话已不可用」。

### 6.6 OS 适配接口（`desktop-attention-os.ts`）

```ts
export type AttentionAuthorization = 'granted' | 'denied' | 'not-determined' | 'unsupported';
export type DockBadge = { kind: 'clear' } | { kind: 'count'; value: number } | { kind: 'label'; value: string };
export type AttentionActivation = { sessionId: string; attentionKey: string };
export type DesktopAttentionOs = {
  getAuthorization(): Promise<AttentionAuthorization>;
  requestAuthorization(): Promise<AttentionAuthorization>;
  deliver(input: {
    identifier: string; threadId: string; title: string; body: string;
    sessionId: string; attentionKey: string; sound: boolean;
  }): Promise<'delivered' | 'not-authorized' | 'unsupported'>;
  removeDelivered(identifiers: readonly string[]): Promise<void>;
  setBadge(badge: DockBadge): Promise<void>;
  requestAttention(): Promise<void>;
  takePendingActivation(): Promise<AttentionActivation | null>;
  subscribeActivation(listener: (activation: AttentionActivation) => void): () => void;
  openSystemSettings(): Promise<void>;
};
```

`createDesktopAttentionOs()`：Tauri 运行时 → tauri 实现；Vite 浏览器 / mock host → noop 实现（便于 UI 调试与单测）。

### 6.7 Rust 原生桥（`attention_notifications.rs`）

**命令**（注册到 `generate_handler!`）：

| 命令 | 入参 | 返回 | 说明 |
|------|------|------|------|
| `attention_authorization_status` | — | `"granted" \| "denied" \| "not-determined" \| "unsupported"` | `getNotificationSettings` |
| `attention_request_authorization` | — | 同上 | options = alert \| sound \| badge |
| `attention_deliver` | `{ identifier, threadId, title, body, sessionId, attentionKey, sound }` | `"delivered" \| "not-authorized" \| "unsupported"` | `UNMutableNotificationContent` + `UNNotificationRequest`（trigger nil），userInfo `piwin.sessionId`/`piwin.attentionKey` |
| `attention_remove_delivered` | `{ identifiers: string[] }` | `()` | `removeDeliveredNotificationsWithIdentifiers` |
| `attention_take_pending_activation` | — | `Option<{ sessionId, attentionKey }>` | 冷启动点击缓冲 |
| `attention_open_system_settings` | — | `()` | 打开「系统设置 → 通知」（`x-apple.systempreferences:com.apple.Notifications-Settings.extension?id=<bundle id>`，NSWorkspace 打开） |

**实现要点**：

1. **支持性判定**：`NSBundle.mainBundle` 的 `bundleIdentifier` 非空且 `bundlePath` 以 `.app` 结尾才触碰 `UNUserNotificationCenter`（裸二进制 `tauri dev` 下调用会抛异常）；否则所有命令返回 `unsupported`。
2. **Delegate**：`define_class!` 实现 `UNUserNotificationCenterDelegate`（照 `artifact_bridge.rs` 写法）；在 `.setup` 中安装，实例用 `OnceLock` 持有（center.delegate 为 weak）。
   - `didReceiveNotificationResponse`：读取并校验 userInfo（字符串、≤128 字节、`[A-Za-z0-9:_-]`），唤起主窗口（unminimize → show → set_focus，与 `show_main_window` 共享实现），`emit_to("main", "attention://activate", payload)`；若前端未就绪（启动后尚未调用过 `attention_take_pending_activation`）则写入 `Mutex<Option<…>>` 缓冲；最后调用 completion handler。
   - `willPresentNotification`：completion 传空 options（应用在前台时不展示横幅，与策略双保险）。
3. **校验**：`title`/`body` 在 Rust 侧再截断到 256 字节；identifier/threadId 同字符集校验；拒绝时返回错误字符串，前端记录 warn 不抛到 UI。
4. **非 macOS**：同名命令编译为返回 `unsupported` 的 stub（`#[cfg(not(target_os = "macos"))]`），保证前端接口一致。
5. **单测**：payload 校验、userInfo 解析、支持性判定的纯函数部分放 `#[cfg(test)]`（与 `artifact_bridge.rs` 一致）。

**门禁前置 spike（T4 第一步，0.5 天，go/no-go）**：本地 `pnpm --filter <desktop pkg> package` 产物（ad-hoc 签名）能否 `requestAuthorization` 并投递、点击回调。
- Go → 按上面实现。
- No-go（例如未签名无法授权）→ 回退方案：P0 引入 `tauri-plugin-notification 2.4`（无点击回调），并加「回到窗口 60s 内出现 *跳转到 {会话}* 应用内 chip」作为深链替代；原生桥推迟到签名发布流水线就绪。
- **owner 已确认（2026-09-17）：no-go 时不等签名流水线，回退方案即为 P0 出货标准。** 回退实现仍保留 `DesktopAttentionOs` 接口不变，原生桥就绪后只替换 `desktop-attention-os-tauri.ts` 的横幅/激活部分。

### 6.8 依赖与权限

```jsonc
// src-tauri/capabilities/default.json 追加
"core:window:allow-set-badge-count",
"core:window:allow-set-badge-label",
"core:window:allow-request-user-attention"
```

```toml
# src-tauri/Cargo.toml [target.'cfg(target_os = "macos")'.dependencies]
objc2-user-notifications = { version = "0.3", default-features = false, features = ["std", "block2", "UNUserNotificationCenter", "UNNotification", "UNNotificationContent", "UNNotificationRequest", "UNNotificationResponse", "UNNotificationSettings", "UNNotificationSound", "UNNotificationTrigger"] }
# objc2-foundation features 追加 "NSDictionary", "NSError", "NSArray", "NSBundle"（以编译通过为准，最小集）
```

- `allow-is-focused` 已包含在 `core:default`；`onFocusChanged` 走 `core:event:default`，均无需新增。
- 窗口唤起在 Rust 侧完成，不需要给前端 `allow-set-focus`。
- Entitlements 不需要 push（`aps-environment`）；本地通知无需新 entitlement。
- 两个 bundle identifier（`app.piwinwin.desktop` 与 `.shell`）在系统设置中是**两个独立的通知条目**，文档写明。

### 6.9 点击激活与会话路由

1. T2 将 `workbench-app.tsx` 中侧栏 `onResumeSession` 闭包原样抽成 `useShellSessionOpen()` → `openSessionFromShell(sessionId)`（关闭子页/覆盖层 → Docking `openOrFocusSession` / pane 绑定 → `handleResumeSession(sessionId, { scope })`）。纯重构提交，现有测试须全绿。
2. 通知激活调用同一函数；目标会话不在当前 scope 时，传入 `resolveEntityScope(state, sessionId)` 让 `handleResumeSession` 负责项目切换。
3. 会话不在列表（已删除/归档）→ 仅前置窗口 + toast。
4. T5 核实：权限请求的 `sessionId` 是否可能为子代理 child session；若是，路由到其父会话（依据会话实体上的 lineage 字段）。
5. Remote Host 断线时（`shouldBlockRemoteHostGesture`）沿用现有提示，不额外处理。

### 6.10 设置页与偏好

**设置 → 通知**（分区 id `notifications`，group `application`，排在 `general` 之后）：

| 控件 | 偏好键（`piwin.desktop.attention.v1` JSON 字段） | 默认 |
|------|-----------------------------------------------|------|
| 系统通知状态行：已开启 / 已关闭（按钮「打开系统设置」）/ 未请求（按钮「开启」）/ 当前运行方式不支持（dev 裸二进制） | —（实时读 `getAuthorization`） | — |
| 启用注意力提醒（总开关） | `enabled` | on |
| 等待批准或回答时提醒 | `onNeedsInput` | on（关闭时二次确认「可能错过阻塞的任务」） |
| 完成时提醒 | `onComplete` | on |
| 失败时提醒 | `onFailure` | on |
| 前台查看其他会话时显示应用内提示 | `foregroundToast` | on |
| Dock 角标 | `badge` | on |
| 声音 | `sound` | on |
| 需要批准时弹跳 Dock 图标 | `bounceOnNeedsInput` | on |

**授权引导**（不在启动时弹系统对话框）：用户首次成功发送消息且授权为 `not-determined` → 会话区顶部一次性引导条「任务在后台完成或需要批准时提醒你？ [开启] [以后再说]」。「开启」→ `requestAuthorization`；「以后再说」→ 写 `piwin.desktop.attention.optInDismissedAt`，7 天内不再出现，设置页仍可开启。

偏好为本机 localStorage，不进 Host、不跨设备同步（P1 再议）。

### 6.11 Windows / Linux（暂缓：当前只有 Apple shell，出现对应 shell 时再启用本节）

| 能力 | Windows | Linux |
|------|---------|-------|
| 角标 | `setOverlayIcon`（生成红点 PNG，不显示数字） | `setBadgeCount`（部分桌面环境） |
| 横幅 | `tauri-plugin-notification 2.4`（仅安装版显示正确应用名） | 同插件（libnotify） |
| 点击回到会话 | 插件无回调 → 回窗 60s 内「跳转到 {会话}」chip | 同左 |
| 弹跳 | `requestUserAttention` 任务栏闪烁 | 视 WM |

---

## 7. Mobile 方案

### 7.1 约束（写进设置文案）

| 模式 | iOS 实际 | 承诺 |
|------|----------|------|
| 前台 | JS + WS 正常 | 跨会话应用内 banner、Inbox |
| 刚进后台 | WKWebView 秒级挂起，WS 很快断 | 尽力本地通知，不保证 |
| 被杀 / 久后台 | 无连接 | 无通知，直到 M3 |
| 回到前台 | 重连 + cursor replay | **离开期间汇总** |

### 7.2 M1 — 本地注意力（可执行清单）

1. 依赖：`apps/mobile/src-tauri/Cargo.toml` 加 `tauri-plugin-notification = "2.4"`，前端加 `@tauri-apps/plugin-notification`，`apps/mobile/src-tauri/capabilities/default.json` 加 `notification:default`，`lib.rs` 注册插件。
2. 复用 `@piwin/host-client` 的 signal / policy / ledger / copy；presence = `document.visibilityState`，visible = 当前 conversation 路由的 sessionId。
3. 新增 `apps/mobile/src/mobile-attention-controller.ts`（订阅方式与 `mobile-activity-summary.ts` 一致），ledger 存 localStorage `piwin.mobile.attention.ledger.v1`。
4. 前台其他会话 → Inkstone 顶部 banner（点击进会话）。
5. 后台 → `sendNotification({ title, body, extra: { sessionId } })`；`onAction` → 路由到会话。
6. 回前台 → catch-up 结束后若有未处理项，显示「离开期间」sheet（列表复用 Inbox 行组件 + `resolveActivitySessionName`）。
7. `NotificationsSheet` 从 demo 改为真实：权限状态行（插件 `isPermissionGranted`/`requestPermission`，移动端为真实值）+「完成 · 失败 · 等待批准」三个开关 + 诚实说明「App 在后台被系统挂起后无法提醒」；删除「仅改变原型偏好」文案。
8. 图标角标：M1 开工前 0.5 天 spike（插件/Tauri 是否可设 iOS badge）；不可行则 M1 不做。
9. 不加 `UIBackgroundModes`，不宣称保活。

### 7.3 M2 / M3（仅立项口径，不在本方案实施）

- **M2 Android 连接保活**：暂缓（当前无 Android shell）。iOS 不做（BGAppRefresh 不能当连接保活）。
- **M3 Remote Push — 已进路线图，直接用 APNs（owner 2026-09-17 决定；不做 ntfy/FCM 过渡）**：
  - ADR：扩展 ADR 0037（通知后期 → APNs 远程推送）。
  - contracts：新增 `device/push/register { platform: 'apns'; token; environment: 'sandbox' | 'production'; bundleId }`、`device/push/unregister`；token 绑定已配对 device credential，Host 侧存 device registry。
  - Host：在 `run/terminal`（§5.2 非 silent）、`permission/request`、`extension/ui_request` 时，对「该 device 近期不在线或 App 在后台」的设备经 APNs HTTP/2（token-based `.p8` 认证）下发；负载 path-free，与 §5.8 文案同源；`apns-collapse-id = piwin.attention.{sessionId}` 实现同会话替换。
  - 密钥：APNs `.p8` 仅存 Host 配置（`~/.piwin`，keychain/env 引用），不进客户端、不进日志；Gateway 仍不持有。
  - iOS：`aps-environment` entitlement + Push Notifications capability；注册 token 需原生接入（评估第三方 `tauri-plugin-mobile-push` 或自建小插件，仓库已有 `plugins/healthkit` 自建先例）。
  - 去重：客户端在线收到同一 key 时本地不再弹（复用 ledger）；Host 记录「已推送 key」避免重连重放二次推送。
  - 前置：Apple Developer 账号 APNs Key、真机测试；独立立项，不阻塞 Desktop P0 与 M1。

---

## 8. 分阶段交付

| 阶段 | 内容 | 门禁 |
|------|------|------|
| **P0 Desktop macOS** | §6 全部（原生桥、角标、应用内提示、catch-up 汇总、设置、授权引导、点击直达） | §11.1 全部通过（packaged `.app` 实机） |
| P1 Desktop 抛光 | （原生桥 no-go 时）签名流水线就绪后补点击直达 · 「显示摘要」正文（后台会话需额外读取末页 transcript，另评隐私）· 无操作 5 分钟视为离开 · 计划草案待批专用文案（`plan/updated` 为 session 受众，需订阅或 Host 投影）· 多台 Desktop 重复通知抑制 · 偏好跨设备同步 | 各项独立验收 |
| P2 Mobile M1 | §7.2 | §11.2 |
| P3 Mobile M3（APNs） | ADR 0037 扩展 + contracts + Host APNs 发送 + iOS token 注册（§7.3） | 独立立项 |
| 暂缓 | Windows / Linux（§6.11）· Android M2 | 出现对应 shell 时 |

---

## 9. 任务拆解（P0）

| 任务 | 内容 | 依赖 | 测试 / 完成定义 | 估时 |
|------|------|------|-----------------|------|
| **T0** | ADR 0064：客户端本地注意力通知（Shell 决策、原生桥、角标语义、侧栏标记行为变化） | — | 文档落盘 | 0.5d |
| **T1** | host-client 四个纯模块 + 导出；核实 `integration-required` 出现位置 | T0 | §10.1 用例全绿；`pnpm --filter @piwin/host-client typecheck test` | 1d |
| **T2** | 纯重构：抽 `use-shell-session-open.ts`、`window-focus-signal.ts`（self-heal 改用） | — | 行为不变；desktop 现有测试全绿；`workbench-app.tsx` 行数下降；单独提交 | 0.5d |
| **T3** | reducer attention 状态与动作；两处判定替换；`attention-badge-model.ts`；`visible-sessions.ts` | T1 | §10.2 reducer 用例；`background-run-delivery.test.ts` 更新并扩展 | 1d |
| **T4** | spike（go/no-go）→ `attention_notifications.rs` + 命令注册 + Cargo + capabilities | — | `cargo test`；packaged 手测授权/投递/点击；no-go 时执行 §6.7 回退并记录 | 1.5d |
| **T5** | `desktop-attention-os*.ts` + controller + `use-desktop-attention.ts` 挂载 | T1 T2 T3 T4 | §10.3 controller 用例（fake hostClient + fake os + 假时钟） | 1.5d |
| **T6** | 设置页、授权引导条、文案模块、搜索索引 | T5 | 组件测试：开关写入偏好、授权状态四态渲染 | 1d |
| **T7** | macOS 实机门禁 §10.4，证据存 `docs/plans/evidence/2026-09-attention-notifications/` | T6 | 截图/录屏 + 勾选清单 | 0.5d |
| | **合计** | | | **≈7.5d** |

每个任务满足 AGENTS.md §3.8：typecheck 绿、触及包测试绿、无文件超 1000 行（提交前 `wc -l` 检查）、重构与行为变更分提交。

---

## 10. 测试计划

### 10.1 纯模块 golden cases（T1）

`classifyRunTerminalAttention` / `readAttentionSignals`：
1. session-turn completed → turn-complete，key `run:{id}`
2. session-turn failed → turn-failed
3. cancelled + `user-stop`/缺省 → silent（仍产出 settle-questions）
4. cancelled + `tool-loop-stalled` → turn-failed
5. interrupted + `paused` → silent；interrupted + `worker-crash` → turn-failed
6. subagent-task completed → 无 raise
7. terminal 形态 `run/updated` 与 `run/terminal` 产出相同 key
8. running 的 `run/updated` → 无信号
9. `permission/request` action `bash` → permissionAction `bash`；action 含 `/` 或空格 → 省略
10. `permission/request` 的 `detail` 永不出现在任何信号字段
11. `permission/resolved` → settle 同 key；`extension/ui_request` → question raise

`decideAttention`：
12. 在场 + 可见 + complete → seen，none
13. 在场 + 不可见 + complete + foregroundToast → in-app
14. 不在场 + complete + onComplete=false → none（但非 seen，标记照常）
15. 不在场 + needs-input + onComplete=false → system + bounce
16. enabled=false → none、bounce=false
17. catchingUp → catch-up-summary
18. alreadyNotified → none

账本 / 突发 / 文案：
19. 超过 256 条淘汰最旧；超过 24h 视为未通知；非法 raw → 空账本
20. 60s 内第 4 次 → summary；窗口滑出后恢复 single
21. zh/en 各 kind 标题；会话名缺失 → 「未命名会话」；48 字截断；General 空间省略项目名

### 10.2 Reducer（T3）

- 单栏：活跃会话完成且 presence active → 无标记；presence inactive → 有标记。
- Docking：可见但非 active 的会话完成 → 无标记；不可见会话 → 有标记。
- inactive → active：仅清可见会话标记；needs-input（permissionQueue）不变。
- `attention/visible-sessions` 相同集合 → 返回同一 state 引用。
- `selectAttentionSessionIds`：同会话 complete + permission 只计 1；`formatDockBadge(0/1/99/100)`。

### 10.3 Controller（T5）

- 不在场收到 `run/terminal` → `os.deliver` 一次，identifier `piwin.attention.{sessionId}`；随后同 runId `run/updated` → 不再投递。
- `hydration` 后重放 5 个终态 → 0 次单条投递；catch-up 结束 → 1 次 summary。
- 账本从 storage 恢复后，重复 `permission/request` 不投递。
- `deliver` 返回 `not-authorized` + 在场 → 应用内提示；不在场 → 静默。
- 会话注意力清空 → `removeDelivered` 被调用。
- 激活事件 → `openSessionFromShell` 以正确 sessionId 调用；pending activation 在挂载时被消费一次。
- 浏览器 noop 实现下不抛错。

### 10.4 macOS 实机门禁（T7，packaged `.app`）

| # | 步骤 | 期望 |
|---|------|------|
| G1 | 首次发送消息 | 出现授权引导条；点「开启」弹系统授权；设置页显示「已开启」 |
| G2 | 发送长任务 → 切到浏览器 → 完成 | Dock 数字 1；通知中心一条，标题「已完成」，含项目·会话名 |
| G3 | 点击 G2 通知 | 窗口前置、打开该会话；角标清除 |
| G4 | 留在该会话看完成 | 无通知、无角标 |
| G5 | 看会话 A 时 B 完成 | 应用内 toast「查看」可跳转；无系统横幅；角标 1 |
| G6 | 触发 `bash` 权限 → 切走 | 系统通知含 `bash`、无命令/路径；Dock 弹跳一次；回到窗口角标仍在，批准后消失，通知中心条目被移除 |
| G7 | 关闭「完成时提醒」重复 G2 | 无横幅；角标仍增加 |
| G8 | 总开关关闭，触发权限 | 无横幅无弹跳；角标随 badge 开关 |
| G9 | 系统设置中拒绝通知 | 设置页显示「已关闭」+「打开系统设置」可跳转；角标仍工作 |
| G10 | 离开时 3 个会话完成 + 1 个权限，断网再恢复 / 睡眠唤醒 | 不逐条重复横幅；最多一条汇总，标题突出等待批准 |
| G11 | 应用退出状态下点击通知中心旧条目 | 应用启动后打开该会话（pending activation） |
| G12 | Docking 双 pane 同时可见两个会话，均在前台完成 | 无标记无通知 |
| G13 | `tauri dev` 裸二进制 | 设置页显示「当前运行方式不支持系统通知」；角标与应用内提示正常；无崩溃 |

---

## 11. 验收标准

### 11.1 Desktop P0

- [ ] §10.4 G1–G13 全部通过，证据落盘（原生桥 no-go 时：G3/G11 以「回窗 60s 内跳转 chip 可达该会话」验收，G13 不适用）
- [ ] 任意通知内容不含 permission `detail`、命令、路径、error 原文（代码审查 + 用例 10）
- [ ] 重连 / 重启不产生重复横幅（G10 + 10.3）
- [ ] 新增/修改文件均 < 1000 行；`workbench-app.tsx` 行数下降
- [ ] `pnpm typecheck`、`@piwin/host-client` 与 desktop 测试、`cargo test`（src-tauri）通过
- [ ] ADR 0064 与本 spec 状态更新为「已实施」

### 11.2 Mobile M1

- [ ] 前台其他会话完成/等待批准 → 应用内 banner，可跳转
- [ ] 回前台时离开期间的完成/待批以一个汇总 sheet 呈现，不重复
- [ ] 后台短时 permission → 本地通知（尽力；实机记录成功率）
- [ ] 设置页授权状态真实、无「仅原型」文案、不承诺杀进程后推送

---

## 12. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 本地 ad-hoc 签名包无法获得 UN 授权 | T4 首日 spike；no-go 走插件 + 回窗 chip 回退并直接出货（§6.7，owner 已确认） |
| M3 依赖 Apple Developer APNs Key 与真机 | 独立立项；Key 仅存 Host 配置 |
| dev 裸二进制不支持原生通知，调试不便 | noop/unsupported 明确降级；门禁以 packaged 为准；需要时 `tauri build --debug` 出 `.app` |
| Dock 角标是否受「通知 → 标记应用图标」设置影响 | G9 验证并在设置页说明 |
| 焦点事件抖动（系统文件对话框使窗口失焦） | 决策只在事件到达时取样；对话框期间完成弹横幅可接受 |
| 多台 Desktop / Desktop+Mobile 连同一 Host 重复提醒 | P0 接受；P1 评估 client lease 抑制 |
| 远程 Host 时钟偏差 | 主去重不依赖时间（账本 + catch-up 门闸），`endedAt` 仅作宽松兜底 |
| 侧栏标记行为变化（可见 pane 不再标未读） | ADR 记录；属于修正 |
| 用户嫌烦 | 前台只做应用内提示；完成/失败可单独关；突发合并 |
| 两个 bundle id 各自有通知授权 | 文档说明；shell 包首次同样走引导 |

---

## 13. 明确不做

- Host 进程直接弹通知（`osascript` 等）
- 每个 tool_call / 子代理完成通知
- 角标显示运行中数量
- 从通知直接批准/拒绝权限，或「永久 bypass」
- 通知正文含命令、路径、密钥、permission detail、错误原文
- 假装 iOS 后台 WS 保活等于推送
- 启动即弹系统授权对话框

---

## 14. 决策记录

### 14.1 已锁定（原开放问题，按建议定稿；owner 可推翻）

| 问题 | 决定 |
|------|------|
| 角标何时清 | complete/failed：打开会话，或在场时会话可见；needs-input：必须处理 |
| 完成通知默认 | on，且仅在不在场时发系统通知；在场看别处时发应用内提示 |
| Mobile 是否与 Desktop P0 并行 | 否；Desktop P0 先，M1 复用纯模块紧随 |
| 多 Desktop 双通知 | P0 接受，P1 评估 |
| 授权时机 | 首次发送后的应用内引导，不在启动时弹 |
| 前台其他会话完成 | 应用内 toast，不用系统横幅 |

### 14.2 owner 拍板（2026-09-17）

| 问题 | 决定 | 落点 |
|------|------|------|
| Remote Push 是否进路线图、用什么通道 | **进路线图，直接 APNs**（当前只有 Apple shell，不做 ntfy/FCM） | §7.3、§8 P3 |
| needs-input 提醒能否关闭 | **允许关闭**（保留关闭时的二次确认提示） | §6.10 |
| T4 原生桥 no-go 时 | **先做，不等签名流水线**：插件 + 回窗 chip 作为 P0 出货标准 | §6.7、§11.1 |
| 平台范围 | 当前只有 Apple shell；Windows / Linux / Android 暂缓 | §6.11、§7.3、§8 |

---

## 15. 参考

- 代码：`packages/contracts/src/run.ts`、`ipc-host-push.ts`、`activity-summary.ts`；`packages/host-transport/src/host-push-audience.ts`；`packages/host-runtime/src/run-abort-reason.ts`、`run-terminalizer.ts`；`apps/desktop/src/chat-reducer-run.ts`、`chat-reducer-envelope.ts`、`permission-queue.ts`、`hooks/use-host-bootstrap.ts`、`hooks/use-session-resume.ts`、`workbench-app.tsx`、`workbench/docking/view-commands.ts`、`renderer-self-heal.ts`、`ui-preferences.ts`、`settings/section-registry.ts`；`apps/desktop/src-tauri/{Cargo.toml,capabilities/default.json,src/lib.rs,src/artifact_bridge.rs}`；`apps/mobile/src/mobile-activity-summary.ts`、`inkstone/sheets/session-sheets.tsx`
- ADR：0023 questionnaire · 0036 Host 多客户端 · 0037 Mobile 远程 shell（通知后期）· 0063 多 pane 工作区
- 外部：
  - [Tauri Notification 插件文档](https://v2.tauri.app/plugin/notification/)（Actions 仅移动端；Windows 仅安装版）
  - [plugins-workspace notification desktop.rs](https://github.com/tauri-apps/plugins-workspace/blob/v2/plugins/notification/src/desktop.rs)（桌面授权恒 Granted；macOS dev 使用 `com.apple.Terminal`）
  - [Tauri Window JS API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)（`setBadgeCount` Windows 不支持；`setBadgeLabel` 仅 macOS）
  - [tauri-plugin-notification crate](https://crates.io/crates/tauri-plugin-notification)（2.4.0，2026-08-31）
  - [tauri-plugin-notifications（第三方）](https://crates.io/crates/tauri-plugin-notifications)、[tauri-plugin-mobile-push（第三方）](https://github.com/yanqianglu/tauri-plugin-mobile-push)（M3 参考）
  - [Apple UserNotifications 讨论](https://developer.apple.com/forums/thread/809552)
