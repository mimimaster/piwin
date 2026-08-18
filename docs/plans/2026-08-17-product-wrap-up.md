# piwin 收尾：把 WIP 收成一个产品

| Field | Value |
| ----- | ----- |
| Status | Active |
| Date | 2026-08-17 |

## 0. 产品切线（v1 是什么）

PRD 一句话：**私有、单用户、Host 权威的 coding-agent shell**。v1 能交货的是：

```text
本机 Desktop（Tauri sidecar）= 日常产品
        ↘
同一套 Host 契约  →  可选独立 apps/host（loopback / 私有网）
        ↗
CLI 连同一个 Host
```

v1 **不是**：iOS pairing / APNs / 公网 Web / 多租户登录 / 把所有实验分支硬 merge。

依据：`docs/prd.md`（Mobile 是 v1 non-goal）、ADR 0036（Host-first）、2026-08-17 全项目 review（真正 P0 是 Host-first 没接到运行系统）。

## 1. 禁止 git merge 的原因

| 残留 | 状态 | 为何不能 `git merge` |
| ---- | ---- | ------------------- |
| `feat/standalone-host-multi-client-continuity` | 15 提交 + 大量未提交 pairing/APNs；落后 main **81** 提交 | 会冲掉 Knowledge Center / 设置改版 / queued-turn；`host-runtime.ts` 两边都在改 |
| `feat/browser-host-token-admission` | **0** 独立提交，全是未提交 `apps/web` | 底是旧 main；应移植，不是 merge |
| `feat/doccards-rag-v2` | 仅未跟踪 `fixtures/`，落后 29 提交 | Knowledge Center **已经在 main** |
| `feat/artifact-dual-renderer` | 2 提交未进 main | ArtifactFrame 在 main 已演进；要对照再移植 |
| `rescue/session-cold-storage-r1` | 7 提交，+7909 行 | ADR 0040 管的是 runtime 驻留，不是 pack 冷存；独立功能，不挡 v1 |
| `rescue/session-history-perf` | 1 提交（08-08） | transcript SQLite 已落地，过期 |
| stash × 10 | 多为 08-12 合并前备份 | 不恢复；确认无独有提交后丢 |

**规则：手术移植，禁止对 81 提交分叉做 merge。**

## 2. 两套「replace-run」必须自洽

main 已有：

- `session/replace-run` + queued turns（本机干预：排队 / 替换下一轮）
- Host Server `rejectBusyRemotePrompt`：远程忙就硬拒绝，叫客户端去用 `session/replace-run`

worktree 另有：

- `session/prompt.foreground = if-idle | replace-run`（多端抢同一前景 Run）

收尾语义（锁定）：

| 场景 | 命令 | 语义 |
| ---- | ---- | ---- |
| 本机 sidecar 排队下一句 | `session/queued-turn-*` / `session/replace-run` | 已有，不动 |
| 远程 / 第二端发前景 prompt | `session/prompt` + `foreground: { kind: 'if-idle' }` | 忙则结构化失败 `foreground-run-mismatch` |
| 远程确认「打断并发送」 | `session/prompt` + `foreground: { kind: 'replace-run', runId }` | 取消该 Run，承认新 prompt |
| 远程省略 `foreground` | Host Server 拒绝（不得静默顶替） | 取代今天的纯字符串 busy 错误 |

本机 JSONL 可继续省略 `foreground`（单端，queued-turn 已覆盖）。

## 3. 执行顺序

### A. 冻结当前 main 工作区（已经在树上，先当产品底盘）

未提交但已实现、属于 Desktop 产品的：

- Progressive tool catalog（`piwin_toolbox` v2 收编 `mcp_gateway`）
- Desktop memory diet S0–S8
- Knowledge Center / Doc Cards（已提交）

做完：测试绿、`docs/product-status.md` 改到与代码一致。先不把实验分支叠上来。

### B. 手术移植 Host-first 脊柱（真正要「合并过来」的窝点）

从 `feat/standalone-host-multi-client-continuity` **已提交**部分移植，**不带**未提交的 pairing / Keychain / APNs：

1. contracts：`HostProblem`、`PromptForegroundAdmission`、`SessionListScopeRef`、`session/list.scopeRef`、`session/prompt.foreground`、`RUN_TERMINAL_CODES.supersededByNewPrompt`
2. `projectIdForPath` / `resolveProjectPathById`
3. host-runtime 前景准入闸 + 顶替时 abort
4. host-server：忙时用 `problem`，hydration 带 live run；能力旗标 `foregroundRunAdmission` / `logicalProjectRefs` / `activityHydration`
5. Desktop：WebSocket 连独立 Host + 运行时 chip 从 stub 变真连接（D-CTX-01b）— **已接到当前 main**
6. CLI attach 同一 `apps/host`：CLI 仍是进程内 `HostRuntime`，改成 WS 客户端不是小补丁。v1 用 **本机 sidecar + Desktop 远程 attach** 证明多端；CLI attach 记 follow-up

### C. 有条件移植（不挡 v1 日用）

| 项 | 条件 |
| -- | ---- |
| Artifact Lite/Heavy 双渲染 | 对照当前 `ArtifactFrame`；若仍减 WebContent 内存则移植，否则关 worktree |
| Browser token + `apps/web` | B 之后作为 Host 同端口面板；不做 HTTPS / pairing |
| Session cold-storage packs | v1.1；ADR 0040 已覆盖 runtime 驻留 |

### D. 丢掉 / 归档

- `feat/doccards-rag-v2` worktree
- `rescue/session-history-perf`
- 08-12 stash 备份
- pairing/APNs 未提交文件：留在 worktree，**不**进 v1

## 4. 完成定义（v1 可称为产品）

1. 本机 Desktop：聊天、工具、权限、Knowledge、MCP/Skills、Artifact、Pet 可用。
2. 低频工具只有一个目录外壳 `piwin_toolbox`（无并行 `mcp_gateway` 仪式）。
3. 产品状态：本机 sidecar 绿，独立 Host attach 可用，pairing 未做（yellow，不是 red 也不是假装绿）。
4. `apps/host` + Desktop 能连同一 Host，会话列表用 `projectId` 不泄路径；第二端 `if-idle` 不会静默顶替。CLI attach 为 follow-up。
5. `docs/product-status.md` / `todo-deferred.md` 与代码同日。
6. 过期 worktree 已移除或明确标注「归档，勿 merge」。
