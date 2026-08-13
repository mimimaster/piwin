# Plan — Active Jobs Strip: 输入框上方的“正在控制的程序”动态 UI

| Field | Value |
|-------|-------|
| Date | 2026-08-13 |
| Status | **Implemented**（切片 1 完成；日志视图为后续切片） |
| Scope | `contracts`（仅新增 presentation 类型，可选）、`apps/desktop` |
| Backend | 无改动 — `JobController` / `JobHostPush` / `job/*` 命令已齐备 |

## 1. 目标

在 Desktop 的 Composer（输入框）**上方**常驻一条动态 UI，实时展示当前
session 中 agent 正在控制的后台程序/服务（`process_start` 启动的 Job）：

- 每个受控程序一个 chip：状态点 + label + 运行时长 + （service 就绪时）端口
- 可停止（`job/stop`）、可查看日志（`job/logs` → 右侧 Terminal 面板）
- 随 `job/started|updated|ready|exited` 实时增减，空闲时整条消失
- 只显示当前 session 拥有的 job（`ownerSessionId` 隔离）

**明确不做**：不在输入框上方做完整 Terminal；不接管 PTY；不展示已结束的
历史 job（去右侧 Terminal 面板看）。

## 2. 竞品对照（调研结论）

| 产品 | 位置 | 内容 | 刷新 |
|------|------|------|------|
| Claude Code statusline | 输入框下方 | context/git/cost + active tools | 事件 + interval |
| claude-hud 插件 | 输入框下方常驻 | `◐ Edit: auth.ts`、running agents、todo | 事件 + 300ms debounce |
| BYO Coding Agent (Bubble Tea) | 输入框上方预留行 | spinner + 当前 subagent 名 | Tick 驱动 |
| Stoa | 聊天上方 App Preview bar | dev server → 可展开 iframe | 事件 |
| Cursor Composer | 工具栏 / Agents Window | tool pills、tab 状态点 | 事件 |
| **piwin（本计划）** | **ComposerDock 输入框上方** | **ActiveJobsStrip chips** | **JobHostPush 事件** |

共同设计要点：事件驱动、位置稳定不跳动、信息分层（tool / 服务 / 时长 / 停止）。

## 3. 现状盘点（piwin 已具备）

- `packages/process/src/job-registry.ts`：`createJobRegistry()` → `JobController`，
  OS 子进程唯一权威；emit `job/started|updated|ready|log|exited`。
- `packages/contracts/src/job.ts`：`JobRecord`（含 `kind` `command|service`、
  `status`、`label?`、`processId?`、`startedAt`、`readyAt?`、`ownerSessionId?`）、
  `JobReadinessProbe`（tcp/http 就绪探测）、`isJobActive()`。
- `packages/host-runtime/src/process-tools.ts`：模型工具 `process_start/list/logs/stop`。
- `packages/host-runtime/src/commands/job-commands.ts`：`job/start|list|get|logs|wait|stop`。
- `packages/host-runtime/src/host-runtime.ts`：`emitJobEvent()` → `this.push(event)`，
  Desktop 经 `HostPush` 实时收到。
- `apps/desktop/src/hooks/use-jobs.ts`：`jobs` + `refreshJobs` + `jobLogsById` +
  `stopJob` + `appendJobLog`。
- `apps/desktop/src/hooks/use-host-bootstrap.ts`：已监听 4 种 job push 并调 `refreshJobs()`。
- `apps/desktop/src/run-status.ts`：已有 `runningJobCount`（working 摘要显示
  “N processes active”）。
- `apps/desktop/src/composer-dock.tsx`：`ComposerDock` 已有 `composer-context-rail`
  （centered 模式位于卡片上方）——天然落点。

**缺口**：job 数据虽已在 `App.tsx`，但：

1. `useJobs` 的 `refreshWhenVisible` 只在「右侧 Terminal 面板可见」时拉取；
   输入框常驻条需要**始终**跟随 push 刷新（push 已在 bootstrap 触发 refreshJobs，
   但需把 `refreshJobs` 依赖与可见性解耦/常驻化）。
2. 无任何组件把 active jobs 渲染在 composer 上方。

## 4. 设计

### 4.1 数据流（零后端改动）

```
Agent 调用 process_start(kind='service')
  → process-tools.ts → JobController.start()
  → job-registry.ts 启动进程 + readiness probe
  → onEvent('job/started' / 'job/updated' / 'job/ready')
  → HostRuntime.push(event)
  → Desktop use-host-bootstrap.ts refreshJobs()
  → App.tsx jobs state
  → ComposerDock activeJobs prop
  → ActiveJobsStrip 渲染 chip
```

### 4.2 派生数据（App.tsx）

```ts
const activeJobsForComposer = useMemo(() => {
  return jobs.filter((job) =>
    isJobActive(job.status) &&
    job.ownerSessionId === state.activeSessionId,
  );
}, [jobs, state.activeSessionId]);
```

- 优先展示 `kind === 'service'`；`command` 也展示（build/test 进行中）。
- `status === 'ready'` 的 service 用绿色点 + 端口（若 readiness 为 tcp/http）。

### 4.3 组件落点

```
ComposerDock (footer.composer-dock)
├── [新] ActiveJobsStrip      ← 仅 activeJobs.length > 0 时渲染
├── SteerQueue（已有）
└── ComposerCard（已有）
```

新文件：`apps/desktop/src/active-jobs-strip.tsx`（组件 + 派生/格式化纯函数，
单元测试同目录）。Chip 内容：

- 状态点：`starting` 脉冲灰 / `running` 脉冲蓝 / `ready` 常亮绿 / `stopping` 半透明
- 主文本：`label`，缺省回退为 `command` 的可读形式（`argv[0]` 基名）
- 副文本：`service` 且 `ready` 且 readiness 带 port → `:port`；否则运行时长
  （`startedAt`→now，1s tick 更新，可复用 run-status 的格式化）
- 交互：chip 点击 → 打开右侧 Terminal 面板（`job/logs`）；chip 内 Stop 按钮 →
  `job/stop`（复用 `useJobs.stopJob`）

Props：

```ts
type ActiveJobsStripProps = {
  jobs: JobRecord[];              // 已按 ownerSessionId 过滤
  onStop: (jobId: string) => void;
  onViewLogs: (jobId: string) => void;
  locale?: 'zh-CN' | 'en';
};
```

### 4.4 常驻刷新修正（实现确认）

`use-host-bootstrap` 的 job push 分支调用全局 `args.refreshJobs()`，该回调
**不受** Terminal 面板可见性限制（`refreshWhenVisible` 只控制面板初始/按需
拉取）。因此 push 驱动的全量 `job/list` 刷新对 composer 常驻条天然生效，
无需新增增量 hook（方案 B 不必要）。`App.tsx` 仅派生
`activeJobsForComposer` 并传入 `ComposerDock`。

### 4.5 样式

`apps/desktop/src/styles/region-composer.css`：

```css
.composer-active-jobs-strip {
  display: flex; align-items: center; flex-wrap: wrap; gap: 6px;
  margin-bottom: 6px; padding: 0 4px; min-height: 28px;
}
.composer-active-job-chip { /* 状态点 + label + 时长 + stop */ }
.composer-active-job-dot.is-starting / .is-running / .is-ready / .is-stopping
```

遵循 `composer-v2` 圆角/阴影语言；复用 `@piwin/ui-kit` 的 IconButton（停止）
与现有 `ContextUsageRing` 风格。进入/退出用 framer-motion 淡入淡出
（项目已在用），避免布局跳动。

### 4.6 文案

`apps/desktop/src/desktop-locale.ts` 新增 composer 文案组：
`activeJobsLabel`（如 “Running programs” / 「正在运行的程序」）、
`stopJob`、`viewJobLogs`、`jobReady` 等。

## 5. 实施步骤（已完成）

1. ✅ `apps/desktop/src/active-jobs-strip.tsx` + `active-jobs-strip.test.tsx`
   （纯函数：label 回退、时长格式化、端口提取；组件渲染测试，14 用例）。
2. ✅ `App.tsx`：派生 `activeJobsForComposer`（按 `ownerSessionId` +
   `isJobActive` 过滤）；解构 `stopJob`；传给 `composerCard`。
3. ✅ 不需要增量 hook（见 4.4 修正）。
4. ✅ `composer-dock.tsx`：`ComposerDockProps` 加 `activeJobs` / `onStopJob` /
   `onViewJobLogs`；`ComposerDock` 在 SteerQueue 上方渲染 `ActiveJobsStrip`。
5. ✅ `desktop-locale.ts` 文案（`stopJob` / `viewJobLogsTitle`，zh/en）；
   `region-composer.css` 样式（状态点 pulse、chip、stop 按钮）。
6. ✅ host-client-mock 的 job push 已存在，无需改；
   `pnpm --filter @piwin/desktop typecheck` 绿；desktop 全量测试
   195 files / 1310 tests 通过。

### 5.1 后续切片（未做）

- **TerminalDock job 日志视图**：当前 `onViewLogs` 只打开右侧 Terminal
  面板；TerminalDock 尚无 job 日志渲染，`useJobs.loadJobLogs` /
  `jobLogsById` 仍未接线。后续在 Terminal 面板加 job 日志 tab（或 chip
  hover 弹出 mini logs）。
- 超过 N 个 job 折叠为 “+N”。
- 端口展示目前为 argv 启发式；如需权威端口，给 `JobRecord` 增加
  `readyPort`（contracts 变更，另行评估）。

## 6. 验收

- 会话中 agent 调用 `process_start(kind:'service', lifetime:'session')` 后，
  composer 上方出现对应 chip；`ready` 时显示端口。
- 切换/关闭会话后，非本会话 job 不出现在该条。
- Stop 按钮调用 `job/stop`，chip 变 `stopping` → 消失。
- 点击 chip 打开右侧 Terminal 面板并加载 `job/logs`。
- 全部 job 结束后 strip 消失，composer 布局不跳动。
- 新增/变更逻辑有对应单测；`pnpm typecheck`、`pnpm test` 绿。

## 7. 不做 / 边界

- 不做 inline 终端（保持右侧面板 Terminal）。
- 不展示已结束 job（历史去 Terminal 面板）。
- 不新增 contracts 类型（`JobRecord` 已够用）；如 UI 需要端口展示且
  `readinessProbe` 未透传，再考虑 contracts 增量（见 8）。
- CLI 暂不实现（Desktop-first，文档化 CLI 降级）。

## 8. 风险 / 开放问题

- `JobRecord` 不暴露 `readinessProbe` 的端口（`StartJobInput` 有但 record
  无）：方案是「service 就绪时显示 label + ready 点」，端口从
  `argv`/`label` 启发式提取，或后续在 contracts 给 `JobRecord` 增加
  `readyPort?: number`（需要 ADR/contracts 变更时另行评估）。
- push 频率：`job/log` 是节流推送；常驻条只关心 started/updated/ready/exited，
  增量 hook 需忽略 `job/log`（日志仍走 `useJobs.appendJobLog`）。
- 多 job 横向溢出：`flex-wrap` + 截断；超过 N 个折叠为 “+N”。
