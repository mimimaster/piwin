# Coding Agent 长任务 Dogfooding Review 计划

| 字段 | 值 |
|---|---|
| 日期 | 2026-08-15 |
| 状态 | Completed with bounded native/live evidence; DF-00–DF-11 closed |
| 评测载荷 | Run Interventions Stage 4：Host-owned queued turns + Replace Run |
| 建议时长 | 2–3 个工作日，约 12–18 小时有效执行时间 |
| 主验证路径 | Native Tauri + live Host sidecar + RPC worker |
| 对照路径 | SDK backend；browser mock 仅用于 UI 回归 |
| 目标 | 在真实拆分开发中发现产品 bug，并判断 piwin coding agent 是否可用于日常复杂开发 |

## 1. 结论先行

本轮不把“测试通过”直接等同于“coding agent 可用”。评测同时检查四件事：

1. 能否把一个跨 6 个边界的真实功能拆成正确、无重叠的工作包；
2. 能否在长会话、子任务、权限等待、暂停/恢复、重连和需求调整下保持状态真实；
3. 能否交付符合架构、带测试、可复现且没有虚假完成声明的实现；
4. piwin 自身是否出现丢消息、重复执行、错误归属、卡死、恢复失败或 UI/Host 状态分叉。

评测载荷选择
[`Run Interventions Stage 4`](./2026-08-15-run-interventions-implementation.md)，原因是它是当前仓库已经确认的下一条真实垂直切片，天然覆盖：

- `@piwin/contracts` 的跨客户端合同；
- `@piwin/session` 的 durable queue；
- `@piwin/host-runtime` 的 Run admission、drain 与 cancellation；
- `@piwin/host-server` / `@piwin/host-transport` 的 replay、hydration 与慢客户端；
- Desktop 的 Composer/queue projection；
- CLI 的 inspect/edit/cancel；
- SDK/RPC、重启和竞态等价性。

这比独立小功能更容易暴露“局部代码能写、端到端状态却不可信”的问题。

## 2. 当前基线与执行前置条件

计划编写时，仓库位于 `main@cdf96f2`，工作区约有 65 个 modified/staged 项和 26 个 untracked 项，主要是 Run Intervention Stages 1–3 与 Desktop renderer/memory 相关在途工作。

本轮按用户指令在当前共享脏工作区继续执行，保留了所有既有改动；没有 stash、commit、reset、删除或批量格式化。基线和新增证据均已落盘到 `docs/evidence/2026-08-15-coding-agent-stage4/`。

执行前必须满足：

1. 由所有者先保存当前工作：提交、建立明确 checkpoint，或创建可恢复的备份；评测 agent 不得擅自 stash、commit、reset 或清理这些改动。
2. 从确定的 commit 创建专用 clean worktree，并使用隔离的临时 `PIWIN_ROOT`、临时 Git fixture 和测试 provider 配置。
3. 记录 baseline commit、Node/pnpm 版本、backend、transport、provider 与 capability；不得从设置文案推断实际能力。
4. 先执行 baseline gate；既有失败单独记录，不归因于本轮改动，也不能被本轮“顺手修掉”后隐去。
5. 所有 dirty-base、冲突、崩溃、secret-path 与破坏性探针只在临时 fixture 中运行，绝不对真实项目或真实 `~/.piwin` 注入故障。

建议 baseline 命令：

```bash
git rev-parse HEAD
git status --short
node --version
pnpm --version
pnpm typecheck
pnpm test
pnpm test:architecture
pnpm format:check
pnpm --filter @piwin/desktop build
pnpm e2e:smoke
pnpm e2e:host-jsonl
```

`pnpm e2e:desktop` 使用 browser mock，不能作为 live sidecar 或 native Tauri 证据。凭据化的 `pnpm e2e:subagent-real` 只在用户明确配置测试 provider 后运行，日志不得输出 secret。

计划期盘点还发现四个门禁盲点，执行时不能忽略：

- 当前 workspace 的 `lint` 脚本只是输出成功文案，不是真正的 lint gate；
- 包测试普遍带 `--passWithNoTests`，所以“test 绿色”不能证明每个包有测试；
- `apps/host`、`apps/mobile` 当前没有直接测试，Desktop E2E 也不经过真实 Host；
- 默认 `pnpm check` 不包含 Desktop E2E、live JSONL、Cargo、bundle smoke 或 mobile build。

计划期只读基线中，`pnpm typecheck` 与 `pnpm test:architecture` 通过；一次全量测试在受限执行环境里因测试监听 `127.0.0.1` 被 `EPERM` 拒绝而中止。正式评测必须在允许 loopback 的隔离环境重跑，既不能把它记成产品回归，也不能把未完成的全量测试写成绿色。

### 2.1 执行快照（2026-08-15）

本轮已完成一条 Stage 4 垂直切片：contracts → SQLite queue → Host drain/Replace → remote projection → Desktop reducer/composer → CLI → 分层验证。实际发现并修复了 queue reorder 唯一约束冲突、远程媒体 opaque ref 丢失、编辑后 aggregate bounds 可超限、queued-started egress 顺序、queue revision stale、slash-mode 冻结错误、CLI reorder positional 解析和幂等结构键序问题；每项均补了回归测试或 focused evidence。

当前仍不能宣称“Native Tauri 长会话可用”：浏览器 E2E 在共享 dirty baseline 中出现已有 selector/snapshot 漂移并于 300 秒超时，Native Tauri 仅完成 build/Cargo 单测，尚未完成真实 Provider/双客户端/重启观察。最终结论按这些边界记录为“条件可用”，不能只依据 unit 绿色。

## 3. 评测问题与假设

### 3.1 产品问题

- Host 是否始终是 queued turn、Replace Run 与 Run terminal 的唯一权威？
- ACK 超时、客户端断开、Host 重启或 replay 后，队列是否不丢、不重、不乱序？
- stale `runId`、stale revision 和重复 idempotency key 是否 fail closed？
- Replace Run 是否等待准确旧 Run terminal 后才创建普通新 Run？
- 取消超时或 generation quarantine 后，是否可能让旧执行与新 Run 同时写入？
- Desktop、CLI 与第二客户端是否看到相同顺序和状态？

### 3.2 Agent 可用性问题

- 是否先读权威文档并识别文档漂移，而不是照过时状态表实现？
- 是否先固化合同/状态机，再让子任务并行？
- 子任务是否边界清晰，避免多人同时修改 `ipc.ts`、`session-live-commands.ts` 或 Desktop composition root？
- agent 是否能区分“命令已接受”“工作已执行”“测试已通过”“产品已可用”？
- 中断、权限拒绝、失败测试、冲突或上下文压缩后，是否能从 durable 状态继续？
- 最终报告是否能给出可复现证据，并诚实列出未验证层和已知失败？

## 4. 长任务的产品范围

### 4.1 用户可见结果

完成 Stage 4 后，活跃 Run 期间的三个意图必须明确分离：

| 用户意图 | 产品动作 | 关键语义 |
|---|---|---|
| 调整当前方向 | Run intervention | 绑定准确当前 Run，在安全 checkpoint 应用 |
| 下一步做这个 | Queued turn | 持久化等待，当前 Run 结束后创建普通新 Run |
| 停止并改做这个 | Replace Run | 先持久化 replacement intent，再取消准确旧 Run，terminal 后创建普通新 Run |

Stage 4 包含：

- queued-turn contract、状态、稳定错误码、bounds 与 idempotency；
- durable create/list/edit/cancel/reorder 与 transcript projection；
- Host-owned 单项 drain、准确 Run admission 和 Replace Run workflow；
- push、replay、hydration、remote validation 与慢客户端策略；
- Desktop 从本地 waiting queue 迁移到 Host projection；
- CLI inspect/submit/edit/cancel/reorder；
- SDK/RPC、双客户端、restart 与 race-heavy tests；
- 文档和 capability honesty 更新。

### 4.2 明确不在本轮

- 不执行 Stage 5 的所有 legacy API 删除；只有在 capability-compatible clients 全部迁移后另开任务。
- 不扩展 Run intervention 的 attachment/context-ref/Skill/template 支持。
- 不增加新顶层 package 或新依赖。
- 不改变 Pi，不把 queue 权威下放给 `@piwin/agent-host` 或 UI。
- 不把 permission layer 误称为 OS sandbox。
- 不顺手重构无关 renderer、media、MCP 或 provider 代码。

### 4.3 开发前必须冻结的设计决定

Agent 在写实现前必须把以下问题写入 spec/ADR delta，并获得 review checkpoint：

1. `QueuedTurnStatus` 的完整状态机、terminal 状态和稳定错误码；
2. submit fingerprint、idempotency、per-session sequence 与 revision 规则；
3. Host 重启后 pending queue 是自动 drain 还是等待显式恢复，以及为何不会意外执行；
4. Replace Run 遇到 bounded-cancellation timeout/quarantined generation 时的 admission barrier；
5. Run terminal push、queued-turn state push 和新 Run start 的严格可观察顺序；
6. reorder 与同时 edit/cancel 的 CAS 语义；
7. 普通 prompt 的 attachments/context refs/model/thinking snapshot 在排队时还是 drain 时冻结；
8. queue bounds、文本/媒体限制与 remote payload validation。

如果这些语义没有先冻结，后续代码即使通过局部测试也不得进入并行开发。

## 5. 工作分解与依赖图

| ID | 工作包 | 主要归属 | 依赖 | 可并行组 | 退出条件 |
|---|---|---|---|---|---|
| DF-00 | 冻结基线与证据目录 | root/docs | — | — | baseline 与既有失败有记录 |
| DF-01 | 现状审查与 spec/ADR delta | docs | DF-00 | — | 已完成；Stage 4 语义写入 spec/ADR |
| DF-02 | Contracts 与纯状态机 | contracts | DF-01 | — | 已完成；类型、错误码、bounds、CAS 单测通过 |
| DF-03 | Durable queued-turn store | session | DF-02 | A | 已完成；transaction、idempotency、reorder、restart、edit-bounds 测试通过 |
| DF-04 | Push/replay/remote policy | host-server/host-transport | DF-02 | A | 已完成；terminal barrier、remote media ref、validation 测试通过 |
| DF-05 | Desktop Host projection | desktop/ui-kit | DF-02 | A | 已完成；mock/Reducer/Host projection 无第二权威 |
| DF-06 | Host drain + Replace workflow | host-runtime | DF-03、DF-04 | — | 已完成；single-drain、exact cancellation、normal admission/race 测试通过 |
| DF-07 | CLI operations | cli | DF-02、DF-03 | B | 已完成；list/edit/cancel/reorder/replace helper 与 CLI typecheck 通过 |
| DF-08 | Desktop live integration | desktop | DF-05、DF-06 | B | 已完成代码与 focused/full unit；Native Tauri 尚未做真实长会话 |
| DF-09 | 跨后端和故障矩阵 | host/session/transport/apps | DF-06–08 | — | 自动化 SDK/RPC/mock 矩阵通过；双客户端/native 仅部分验证 |
| DF-10 | 文档、迁移与 capability honesty | docs/apps | DF-09 | — | 已完成；残余未验证层和基线失败已记录 |
| DF-11 | 全量验证与交付 review | all | DF-10 | — | 已完成；证据、bug register、scorecard 与残余风险均已归档 |

建议执行波次：

```text
DF-00 → DF-01 → DF-02
                    ├─ DF-03 ─┐
                    ├─ DF-04 ─┼→ DF-06 ─┬→ DF-09 → DF-10 → DF-11
                    └─ DF-05 ─┘         ├→ DF-08
                              DF-03 ─────└→ DF-07
```

### 5.1 子任务使用规则

- 父 agent 保留计划、合同整合、`host-runtime` 核心 workflow 和最终验证所有权。
- 合同必须先单独落地；之后才允许三个写子任务并行：session store、transport policy、Desktop mock/projection。
- 写子任务使用独立 worktree；同一文件只有一个 owner。合并通过父 agent 串行完成。
- 只读 architecture reviewer 可与写任务并行，但不得改代码。
- 两个相同 task text 的只读子任务要故意运行一次，用来验证 invocation 仍按 `toolCallId`/child session 区分，而不是按标题匹配。
- 任何子任务失败或 integration conflict 都不得自动 retry/resolve；先保存 worktree 和证据，再由父 agent决定新任务。
- backend 未报告真实 process isolation 时，预期并发降为 1；不得把配置的 concurrency 当作实际隔离。

## 6. Dogfooding 执行协议

### Phase A — Plan-only（约 60–90 分钟）

向被测 agent 只给目标、约束和验收，不给文件级答案。要求它：

1. 读取 `AGENTS.md`、架构、ADR 0030/0031/0042/0046/0050/0051、Stage 4 spec/plan；
2. 做只读代码盘点；
3. 把自己的实施计划写到 `docs/plans/`；
4. 在 review checkpoint 前不修改实现文件；
5. 指出文档矛盾、现有未提交状态和需要决策的语义。

评审它是否找全 §4.3、是否正确安排 contracts-first，以及是否避免重叠写入。

### Phase B — 分波开发（约 6–9 小时）

按 §5 波次执行。观察者只做三类干预：

1. 正常澄清：要求 agent 解释当前事实、下一个 barrier 和未验证内容；
2. 产品内建控制：Run intervention、queued follow-up、Pause/Resume、Stop；
3. 受控故障：权限拒绝、客户端断连、测试失败、临时 fixture 冲突。

每次干预都记录发送时间、Host ACK、Run/child 状态变化、最终结果和是否需要人工救援。不得为了让分数好看而即时删除异常证据。

### Phase C — 独立验收（约 3–4 小时）

Agent 首次声明完成后，reviewer 执行 evaluator-owned black-box probes。探针类别公开，但具体时序和 id 值不进入开发提示，以验证实现不是只拟合可见测试。

### Phase D — Bug 修复回路（约 2–3 小时）

- 所有发现先进入 bug register，再开始修复；
- P0/P1 各自成为独立、可复现的修复任务；
- 先加失败测试，再实现，再重跑相关矩阵；
- 修复不得篡改 baseline 或删除失败证据；
- P2/P3 是否修复由时间盒决定，未修复项必须进入 backlog。

### Phase E — 交付 review（约 60–90 分钟）

检查架构、完整 diff、测试层级、证据边界、未完成项和 scorecard。普通聊天完成不应伪造 Walkthrough；如果通过 Plan execution 完成，必须验证只生成一个、且绑定准确 `finalAssistantMessageId + runId + planId`。

## 7. 故障与竞态矩阵

| ID | 场景 | 注入方法 | 必须观察到的结果 |
|---|---|---|---|
| FI-01 | 两客户端重复 submit | 相同 id 与相同 payload 同时发送 | 返回同一 durable record；只执行一次 |
| FI-02 | idempotency 冲突 | 相同 id、不同 payload | 稳定冲突错误；原记录不变 |
| FI-03 | edit 与 drain 竞态 | safe boundary 前后交错 CAS | 只有一个 revision 胜出；无混合 payload |
| FI-04 | cancel 与 drain 竞态 | pending→starting 边界取消 | 明确 terminal 结果；不能既 cancelled 又启动 |
| FI-05 | Run terminal 与 queue admission | terminal barrier 两侧 submit | 按冻结 spec 进入明确状态；不掉到错误 Run |
| FI-06 | Replace + cancellation timeout | fixture 让 abort 不合作 | 旧 generation 被隔离；新 Run admission 顺序真实且无双写 |
| FI-07 | ACK 后客户端断连 | 接受后断开 Desktop | Host 继续；重连只恢复一条记录 |
| FI-08 | Host restart | pending、starting、replacement 各重启一次 | 按 spec reconciliation；无自动重放副作用 |
| FI-09 | replay-too-old / snapshot | 落后 cursor 再连接 | snapshot 后状态一致；无重复 transcript row |
| FI-10 | 慢客户端 | 阻塞一个 client 消费 | Agent Run 不被拖住；控制状态不丢失 |
| FI-11 | 切 Session 时后台完成 | A 排队，界面切到 B | A 的 push 不污染 B 的 composer/queue |
| FI-12 | dirty-base 并行写 | 临时 repo 加无害未提交文件 | Continue/Prepare first/Cancel 三条路径都真实，Host 不 stash/commit |
| FI-13 | permission 等待中取消/reload | ask 后取消 Run 或替换 generation | execute 前再校验；工具副作用为 0 |
| FI-14 | Pause 边界 | 无 child 与有 active child 各一次 | 无 child 可 checkpoint/resume；有 child 稳定拒绝 |
| FI-15 | 子任务 integration conflict | 两临时 worktree 制造同文件冲突 | 状态为 integration-required；worktree 保留；不自动解决 |
| FI-16 | 长历史和大输出 | 40+ turns、并行 child stream、>256 KiB tool output | 状态完整；展示有界；无重复或永久 running |
| FI-17 | SDK/RPC 对照 | 同一 lifecycle fixture 参数化运行 | 状态序列和 stable errors 等价；RPC 不静默 fallback |
| FI-18 | agent 上下文压缩 | 长会话中触发/等待自然 compaction | 从 durable plan/任务状态继续，不重做已完成步骤 |

发生真实数据丢失、secret 泄漏、跨 Session/Run 执行、不可停止副作用或错误的“已完成”声明时，立即停止本轮，不继续注入更多故障。

## 8. Bug 记录与归因

每个异常先分类，避免把 provider、环境或任务规格问题误报成产品 bug：

| 类别 | 示例 |
|---|---|
| Product/Host | 丢 queue、重复执行、错误 Run admission、terminal 卡死 |
| Product/Desktop | optimistic row 不回收、切 Session 串状态、快捷键语义错误 |
| Transport | replay 重复、push barrier 丢失、慢客户端拖住 execution |
| Agent behavior | 计划漂移、误用工具、子任务重叠写、虚假验证声明 |
| Model/provider | provider error、模型不遵循但 Host lifecycle 正确 |
| Environment | 端口占用、缺 Chromium、fixture 权限或依赖问题 |
| Spec/test | 期望未定义、测试与已批准状态机矛盾 |

严重度：

- **P0**：数据/secret 泄漏、错误副作用、跨 Run/Session 执行、不可恢复损坏；
- **P1**：主流程不可用、状态虚假、恢复失败、不可停止或稳定重复；
- **P2**：有 workaround 的功能错误、明显竞态/性能/可理解性问题；
- **P3**：文案、呈现和低风险 polish。

Bug 模板：

```markdown
## BUG-XXX — 标题

- Severity / category / layer:
- Baseline commit / dirty state:
- Backend / transport / provider:
- Session / Run / generation / task / intervention ids:
- Preconditions:
- Reproduction steps:
- Expected:
- Actual:
- Frequency:
- Side effects:
- Evidence links (redacted logs/screenshots/tests/diff):
- Suspected owner package:
- Workaround:
- Regression test status:
```

日志与截图必须脱敏；不保存 prompt secret、API key、原始 credential ref、用户真实绝对路径或未截断的大工具输出。

## 9. 可用性评分

| 维度 | 权重 | 核心判断 |
|---|---:|---|
| 功能正确性 | 25 | Stage 4 acceptance 与 black-box probes |
| 状态与恢复 | 20 | pause/reconnect/restart/race 后不丢不重不乱 |
| 架构纪律 | 15 | contracts-first、边界、单一权威、无无关改动 |
| 计划与自治 | 15 | 拆分质量、依赖管理、低人工救援、压缩后续接 |
| 协作透明度 | 10 | 状态真实、阻塞明确、子任务可追踪 |
| 测试与证据 | 10 | 分层证据、失败可复现、无虚假绿色 |
| 效率 | 5 | 无重复大范围读取/返工，子任务并行有收益 |

额外记录但不直接奖励“跑得快”：

- 首次正确计划耗时；
- 有效无人值守时长；
- 人工救援次数与原因；
- 子任务失败、冲突、重试次数；
- 无关文件改动数与返工行数；
- 首次完成声明后的 P0/P1/P2 数量；
- 每层验证用时与 flaky rerun 次数。

判定：

- **可用于日常复杂开发**：总分 ≥ 85；无 P0/P1；所有 mandatory gates 通过；人工救援 ≤ 2；无虚假完成声明。
- **条件可用**：70–84；无 P0；最多 2 个有明确 workaround 的 P1；核心状态可恢复；需列出限制。
- **暂不可用**：< 70，或出现任一 P0、跨 Run/Session 副作用、secret 泄漏、不可恢复卡死、重复执行，或声称运行了实际未运行的验证。

## 10. 验证层级与最终门禁

### 10.1 必须自动化

1. queued-turn pure lifecycle、bounds、CAS、idempotency；
2. session transaction/restart reconciliation；
3. Host drain、terminal barrier、Replace exact-cancel；
4. transport revision/replay/slow-client policy；
5. Desktop reducer/reconciliation/session switching；
6. CLI parse/output/error contract；
7. SDK/RPC 参数化 lifecycle；
8. architecture boundary。

最终命令至少包括：

```bash
pnpm typecheck
pnpm test
pnpm test:architecture
pnpm format:check
pnpm --filter @piwin/desktop build
pnpm e2e:smoke
pnpm e2e:host-jsonl
pnpm e2e:desktop
cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml
cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml
```

FI-01–FI-09 与 FI-17 这类时序敏感用例应在 SDK/mock 和 RPC/mock 下各重复至少 3 次；任何 flaky rerun 都记录首次失败，不允许只保留最后一次绿色结果。

### 10.2 必须人工或半自动

- Native Tauri：长 Run 中 Send/Adjust/Replace、窗口切换、Stop、重连；
- Desktop + CLI 连接同一 Host：queue 顺序与 edit/cancel 冲突；
- RPC worker PID/实际 isolation 与无静默 SDK fallback；
- 30 分钟长会话观察：响应性、重复 listener、WebContent/Host memory slope；
- 屏幕录制或时间戳截图必须注明证据层。

Browser mock 绿色只证明 React projection；live JSONL 只证明 sidecar transport；只有 native Tauri 证据可以支持真实桌面可用性声明。

## 11. 交付物

执行结束后所有结果必须落盘：

```text
docs/plans/<agent-produced-stage4-plan>.md
docs/evidence/<date>-coding-agent-stage4/
  manifest.md
  baseline.md
  bug-register.md
  scorecard.md
  command-results.md
  native-smoke.md
docs/notes/<date>-coding-agent-stage4-review.md
```

`manifest.md` 记录 commit、配置事实、backend/transport/provider、证据层和文件校验；不复制 secrets。最终 review 必须包含：

- 一个 content-free correlation ledger：`clientId`、`hostInstanceId`、push `seq/eventId`、`sessionId`、`runId`、`runtimeGenerationId`、queued-turn/replacement id、revision、terminal code 和时间戳；
- 两个客户端最终收敛后的 transcript/queue id 集合，用于证明无丢失和无重复；

1. 实现结果和未完成范围；
2. P0–P3 bug 清单与最小复现；
3. agent 行为问题与产品问题的分离归因；
4. 自动化、live sidecar、native 三层证据；
5. scorecard 与“可用 / 条件可用 / 暂不可用”结论；
6. 后续修复顺序，不以“测试大多通过”掩盖关键失败。

## 12. 建议给被测 Agent 的启动提示

```text
在已冻结的 clean worktree 中完成 Run Interventions Stage 4：Host-owned
queued turns + Replace Run。先做只读审查并将实施计划写入 docs/plans；在
review checkpoint 通过前不要修改实现文件。

遵守 AGENTS.md 与 ADR 0051：contracts first，HostRuntime 是 queue/Run 权威，
RunRegistry 是唯一 terminal authority，Desktop/CLI 只消费 Host projection，
SDK/RPC 必须等价。使用独立、无重叠写入的子任务；父任务保留合同整合、
host-runtime workflow 与最终验证所有权。不得自动 stash/commit 用户工作，
不得把 permission layer 当 sandbox，不得删除 legacy path 直到兼容迁移完成。

交付前执行分层验证，保存 evidence manifest，并明确区分已验证、未验证、
已知失败和新增回归。遇到数据丢失、secret 泄漏、跨 Run/Session 副作用或
不可恢复状态时立即停止并记录 P0。
```

## 13. 权威参考与已知文档漂移

执行时以以下文件为主要约束：

- [`AGENTS.md`](../../AGENTS.md)
- [`architecture.md`](../architecture.md)
- [`dev-plan.md`](../dev-plan.md)
- [ADR 0030](../adr/0030-safe-parallel-subagent-execution.md)
- [ADR 0031](../adr/0031-dirty-base-parallel-write-consent.md)
- [ADR 0042](../adr/0042-session-pause-as-resumable-checkpoint.md)
- [ADR 0046](../adr/0046-inline-subagent-invocation-projection.md)
- [ADR 0050](../adr/0050-tool-execution-pipeline-v2.md)
- [ADR 0051](../adr/0051-host-owned-run-interventions.md)
- [`run-interventions.md`](../specs/run-interventions.md)

已知漂移必须纳入 review，而不是悄悄选择有利版本：

- `prd.md` / `artifact-research.md` 仍有“图片路径注入默认”的旧描述；当前规则是 native `ImageContent` 优先，路径文本仅为显式 fallback。
- `product-status.md` 比最近的 Host Server、RPC 与 runtime 工作更旧；实际 capability 以代码、`host/status` 和运行证据为准。
- permission 是审批层，不是 OS sandbox；危险测试只能在隔离 fixture 中完成。
- CLI 当前不显示完整 subagent stream，这是已知降级，不能误报为本轮 Stage 4 回归。
