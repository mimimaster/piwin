# Main 稳定性修复执行计划（问题 2–6）——修订版

> 日期：2026-08-13（原计划同日上午写就，同日下午修订；残余项同日落地）  
> 原基线：`main` / `ce56d46`（待执行、干净 worktree 重做）  
> 修订时状态：问题 1–6 的修复已在当前 `main` 工作区落地并通过全仓 `pnpm typecheck` + `pnpm test`（见 `docs/notes/2026-08-13-main-12h-feature-closure-review.md` 的修复记录）  
> 本修订版：记录已落地部分的证据，只保留经代码核实仍然成立的残余工作（§3）。  
> 残余项状态（2026-08-13 下午）：R1、R2、R3.1、R3.2 已实现并通过定向测试；R3.3 热更新集成级用例按计划跳过。

## 1. 修订说明（为什么不按原计划执行）

原计划把当前工作区视为"未验证的候选草稿"，要求在独立 worktree 中从 `ce56d46` 重新推导全部修复（估算 14–22 小时）。修订时逐条核实的实际情况：

1. 问题 2–6 的修复已按 TDD 流程落地（每项先写失败测试再实现），全仓 typecheck 与测试全绿。整包重做没有收益。
2. 原计划明确排除的问题 1（远程扩展激活 default-deny）同样已落地：`packages/host-server` 默认拒绝 `extensions/set_enabled` / `extensions/apply`，`allowRemoteExtensionActivation` 显式 opt-in，`apps/host` 暴露 `PIWIN_HOST_ALLOW_EXTENSION_ACTIVATION=1`，ADR 0047 §12 已记录。排除条款作废。
3. 原计划对候选实现的技术批评**核实成立四项**（恢复无条件 `active`、恢复失败不 fail-closed、tool-only 空段丢失、30 段封顶后停止刷新），另有两项低危硬化点（journal 同 id 异 session 覆盖、Desktop 推送无去重）。这些构成 §3 的全部内容。

## 2. 已落地部分（不再执行）

| 原工作包 | 已落地内容 | 证据 |
|---|---|---|
| WP1 主体 | blueprint 主会话传递 `nativeSearchAdapter`；settings `providers` 域变更触发 web-search 即时限制；`hasUsableWebSearch` 改为只判断外部出口 | `blueprint-compiler.test.ts` 新增 vendor-adapter 回退用例；`settings-service.test.ts` 新增 4 个 providers 域用例；ADR 0043 已记录 `nativeSearchAdapter` 章节 |
| WP2 部分 | 启动恢复 promise + `extensions/apply` 等待恢复；re-ACK 以进程内所有权判定；Desktop 消费 `extension/deployment-updated` 并对 `rolled-back` / `restart-required` 弹本地化失败通知 | `host-runtime.test.ts` 启动恢复用例；`use-host-bootstrap.test.ts` `describeExtensionDeploymentFailure` 用例 |
| WP3 主体 | `scope/set`、`project/set`、`project/clear`、`session/remove`(active) 四条路径同步清空 `transcriptOwnerSessionId` | `chat-reducer.test.ts` 守卫用例 |
| WP4 主体 | `completedSegments` 多消息投影；tool/start 按 `responseMessageId`、update/end 按 `toolCallId` 回填 completed segment；inspector 每完成一段刷新历史并按 messageId 去重 | `chat-reducer.test.ts`、`subagent-session-projection.test.ts`、`use-subagent-session-inspector.test.tsx` 新用例 |
| WP5 主体 | Phase 0 全套：失败附件独立失败区 + retry/remove；发送前三选确认框（重试 / 发送其余 / 返回）；只剩失败附件时主按钮变重试；hook 层拒绝 silent send；错误分类 connection/policy/local；全部文案进 `desktop-locale.ts` | `composer-dock.test.tsx`、`use-composer-media.test.tsx` 新用例；ADR 0045 已记录 Phase 0 与 known debt |
| 问题 1 | host-server 远程激活 default-deny + opt-in | `host-server.test.ts` 2 个用例；ADR 0047 §12 |

## 3. 残余工作（经代码核实成立的缺口）

### R1 Extension deployment 恢复真实性（原 WP2 核心批评，最大残项）

核实结果（`packages/host-runtime/src/host-runtime.ts`）：

- `recoverInterruptedExtensionDeployments` 无条件把 in-flight 记录标 `active`，未比对 `record.targetRegistryRevision` 与当前 `registry.revision`；被后续 revision 覆盖的部署会被误报成功。
- 恢复失败在构造函数被 `.catch` 吞掉后 promise 正常 resolve，`extensions/apply` 照常放行（应 fail-closed）。
- 同 deploymentId、不同 sessionId 的请求绕过 re-ACK 分支（守卫要求 `persisted.sessionId === command.sessionId`），落到新建路径直接覆盖 journal 记录（应稳定冲突错误）。
- Desktop `extension/deployment-updated` 处理无 `deploymentId + phase` 去重，reconnect/replay 会重复弹失败通知；无 `superseded` 文案。

#### 合同变更（contracts-first）

向 `ExtensionDeploymentPhase` 增加 additive terminal phase `superseded`：

- 语义：journal 中的目标 revision 已不是 registry 当前期望值。
- 不可对同一 deployment id 重试；调用方须读取当前 registry 后用新 deployment id 发起。
- 同步更新所有 exhaustive switch、`extension-revision-store` parser 与 UI 映射；未知 phase 仍被拒绝，既有 journal fixture 保持兼容。

#### Host 恢复决策表

| Journal 状态 | 目标 revision 与当前期望一致 | 当前进程拥有 continuation | 结果 |
|---|---:|---:|---|
| 已是终态 | 任意 | 任意 | 不修改 |
| 非终态 | 是 | 否（冷启动恢复） | 标记 `active`，不伪造旧 generation id |
| 非终态 | 否 | 否 | 标记 `superseded`，记录稳定、无敏感信息的原因 |
| 非终态 | 任意 | 是 | 由当前进程 continuation 继续，恢复不抢占 |
| 任意 | registry/store 读取失败 | 任意 | recovery fail-closed：记录边界日志，拒绝新的 apply，不误报成功 |

补充实现点：

1. 同 id、不同 session id：返回稳定冲突错误，不覆盖 journal。
2. continuation 终态先持久化再推送；push 失败只影响通知，不回滚已落盘终态。

#### Desktop

1. `extension/deployment-updated` 按 `deploymentId + phase` 去重 reconnect/replay。
2. 增加 `superseded` 本地化文案（该次部署已被更新的扩展配置覆盖）。
3. 成功（`active`）保持静默是当前刻意的产品选择，可不实现"观察过过程态才弹成功"。

#### 先写的失败测试

Host：目标 revision 一致→`active` 只收口一次；revision 被覆盖→`superseded` 绝不 `active`；恢复幂等；恢复失败时新 apply 稳定失败且不启动 runtime；同 id 异 session 被拒且 journal 不被覆盖；push 失败不影响 journal 终态。  
Contracts/extensions：`superseded` 在合同与 store parser 正确往返；未知 phase 仍被拒。  
Desktop：`superseded` 文案正确；相同 `deploymentId + phase` 重放不重复弹通知。

#### 定向验证

```bash
pnpm --filter @piwin/contracts typecheck
pnpm --filter @piwin/extensions exec vitest run src/extension-revision-store.test.ts
pnpm --filter @piwin/host-runtime exec vitest run src/host-runtime.test.ts
pnpm --filter @piwin/desktop exec vitest run src/hooks/use-host-bootstrap.test.ts
```

提交：`fix(extensions): supersede stale interrupted deployments`

### R2 Subagent 投影两处边界（原 WP4 批评，成立）

核实结果（`apps/desktop/src/chat-reducer.ts`、`hooks/use-subagent-session-inspector.ts`）：

- `finishCurrentSubagentSegment` 对空消息 no-op：tool-only assistant（Pi 正常顺序 `message/end` → `tool/start` → `tool/end`）的空壳不固化，晚到工具落在 current 区后被下一条 `message/start` 的 `tools: []` 直接清除——运行中丢工具卡，直到下次历史刷新才恢复。
- inspector 刷新 key 为 `${childId}#${completedSegments.length}`，30 段封顶后 length 恒为 30，刷新停止。

#### 方案

1. `message/end` 固化 segment shell，即使 text/thinking/tools 当时为空（保留 `currentMessageId === null` 的 no-op 守卫，去掉"内容非空"前提）。
2. `SubagentStreamState` 增加单调递增 `completionRevision`，每完成一条 assistant message 递增（达到 30 段封顶后继续递增）；inspector 用它替代 length 作为刷新 key。

#### 先写的失败测试

1. tool-only assistant：`message/start` → 空 `message/end` → 晚到 tool start/end → 下一条 message，工具仍属于原 message。
2. `message/end` 后到达的 tool update/end 更新正确 completed segment（如现有用例未覆盖则补）。
3. 完成超过 30 条后只保留最新 30 条，但第 31、32 条仍各触发一次 history refresh。

其余原 WP4 用例（多消息保留、aborted 尾段、history 去重、快速切换 child、有界字段）已有覆盖，对照查漏即可。

#### 定向验证

```bash
pnpm --filter @piwin/desktop exec vitest run \
  src/chat-reducer.test.ts \
  src/subagent-session-projection.test.ts \
  src/hooks/use-subagent-session-inspector.test.tsx
pnpm --filter @piwin/desktop typecheck
```

提交：`fix(desktop): retain tool-only subagent segments and unbounded refresh`

### R3 小项（低优先级，可选）

1. WP3 残留：`use-session-actions` 的 owner 守卫无 action 级测试（reducer 级已补）；可补一个行为级用例或接受现状。
2. WP5 残留：失败确认框默认焦点当前落在"返回"（Radix 首个可聚焦元素），原计划要求落在"重试失败附件"；一处 autoFocus 即可。
3. WP1 残留：providers 域撤销的 hot-apply 集成级用例（即时限制分类已有 4 个单元测试；集成级可补可不补）。

## 4. 原计划中不成立或作废的点

1. **干净 worktree 重做策略**：作废。直接在当前工作区继续；先把已落地修复按关注点提交，残余项按 R1 → R2 → R3 独立提交。
2. **问题 1 排除条款**（不修改 host-server / apps/host / ADR 0047 相关内容）：作废，问题 1 已落地且经测试。
3. **原 WP1 失败测试第 2 条**（"vendor-native 执行失败时只有配置了有效外部 provider 才允许回退"）：与 ADR 0043 矛盾——fallback 是请求开始前的能力可用性判定，不是执行失败后的静默重发。删除该用例。
4. **原 WP5 整包**：已落地，仅剩 R3.2 焦点小项。
5. **原 WP0 基线盘点**：作废，全仓门禁已在落地后全绿跑过一轮。

## 5. 提交顺序与门禁

1. 先收口已落地工作（按关注点拆分提交，可沿用原计划的提交信息 1–5 加一条 docs 提交）。
2. 再执行 R1、R2（、R3），各自独立提交、可单独 revert。
3. R1 含 additive contract phase：回滚时须整包回滚 contracts、store parser、Host、Desktop；journal 不做破坏性迁移。
4. 全部完成后依次执行（脚本均已核实存在于根 `package.json`）：

```bash
git diff --check
pnpm check          # typecheck + test + test:architecture
pnpm e2e:host-jsonl
pnpm e2e:desktop
pnpm --filter @piwin/desktop build
```

架构审计保留原计划命令（`rg "@earendil-works/pi-" apps packages --glob '!packages/agent-host/**'` 等）。

## 6. 修订后预估

| 残项 | 预计时间 | 风险 |
|---|---:|---|
| R1 deployment 真实性 | 3–5 小时 | 中高（合同 + parser + Host + Desktop 四层联动） |
| R2 subagent 两处边界 | 1–2 小时 | 低 |
| R3 小项 | <1 小时 | 低 |

最不应压缩的仍是 R1 的恢复决策表测试——那里正是"把过期部署误报成功"的假成功来源。
