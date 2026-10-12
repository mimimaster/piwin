# Study Space — 当前会话直接实现验收记录

用户将执行方式从子代理改为当前会话直接实现。本轮没有启动子代理，没有安装/启用用户环境中的扩展，没有发布或提交。废弃的第 2 步失败候选已 discard，后续不要再应用它。

## 已落盘

- `packages/host-runtime/src/flashcard-study-tools.ts`：独立 132 行领域工具模块，复用原生 IPC mutation/sanitize 和既有 singleton StudyService；经现有 Toolbox/permission/Run/generation admission，不复制 FSRS 或广播路径。
- `flashcard_study_read/write`：scheduled-only，写入前拒绝 sequence，明确检查实际 principal 控制权，幂等键按 product session 隔离；保留 CAS/abort/未知结果查询及原生 undo。
- `packages/agent-host/standalone-extensions/study-space/`：topicless TA 无课程/主题弹窗、idle 角色切换、默认 off、显式 resume、跨进程锁/CAS、证据/同意制卡、实际结果对账。删除 unchecked find 断言，独立配置开启 exactOptionalPropertyTypes。
- `study-space.integration.test.ts` / `study-space.test-fixture.ts`：真实 Pi SDK 和真实 spawned RPC worker，同一扩展，当前 Run 的 admitted Toolbox，实际原生卡片和 FSRS，UI bridge 确认，rating/undo 和 replacement/resume。本地 HTTP SSE 脚本替代付费模型响应，未替代 Pi 引擎。
- `docs/guides/study-space.md` 与独立 README/LICENSE/NOTICE、仅生产文件的 package manifest。`npm pack` 产出 `piwin-study-space-0.1.0.tgz`（16.0 kB，10 个生产文件，无 tests/node_modules，shasum `b025c42eceaabd1878f3bd4f8b6b9a14a61d4986`）。

## 实际执行结果

| 检查 | 结果 |
| --- | --- |
| standalone 扩展测试 | 4 文件 / 93 项通过 |
| standalone typecheck | 退出 0，strict/noUnchecked/exactOptional |
| Host 复习/权限/port focused | 5 文件 / 56 项通过 |
| 真实 SDK / spawned RPC 链路 | 2 项通过，Host 全套中亦通过 |
| 原生 flashcards 全套 | 11 文件 / 109 项通过 |
| contracts 全套 | 104 文件 / 808 项通过 |
| agent-host 全套 | 87 文件 / 750 项通过 |
| Host-runtime 全套 | 后续复跑 CHT-803 两项现已通过（exit 0）；不再作为本功能阻塞 |
| 根 `pnpm typecheck` | 退出 0（按既有脚本选择 33/35 packages；不包含 mobile） |
| `pnpm test:architecture` | Package boundaries OK |
| `git diff --check`（触及 tracked 源文件） | 退出 0 |
| 新增/触及生产模块行数 | 均 <1000；新增 tool132，扩展单文件最大177 |

日志：`/tmp/piwin-study-space-contract-tests.log`、`/tmp/piwin-study-space-agent-tests.log`、`/tmp/piwin-study-space-host-tests.log`（临时文件，重启/清理后不保证仍存在）。

## Desktop 隔离 UI 验收（临时 PIWIN_ROOT，非操作者配置）

真实 HostServer + 已启用 `piwin-study-space` + Desktop Vite `http://127.0.0.1:14390`，模型由本地 SSE fixture 脚本驱动。

走通：`/teacher ta`（无课程）→ `/teacher learn file lifecycle` → 记录 evidence → 记录 intention → `piwin_toolbox` 调用 `flashcard_batch_create` → 扩展确认弹窗「Study Space: create native cards?」展示真实 gap/卡片正文 → 用户点继续 → 两张原生卡写入 `study-space:<courseId>` deck，intention `resolved` 并关联真实 cardId。对话内原生卡片 UI 显示「生成了 2 张知识卡片」，可翻面。`/teacher review` → `flashcard_study_write` start/checkpoint → rate 确认弹窗展示 rating=good 与 CAS 字段 → 确认后 FSRS `reps=1`。斜杠菜单列出 `/teacher`（扩展）。`/teacher off` 后状态条不再显示教学角色。直接调用未暴露的 `flashcard_batch_create` 会 `Tool not found`，必须经 toolbox；这与设计一致。

未安装到操作者 `~/.piwin`，未改真实用户扩展/权限，未市场发版。脚本化模型不代表教学质量。

## 独立扩展仓库与市场上架

- 源码仓库（公开）：https://github.com/mimimaster/piwin-study-space
- 钉死 commit：`e5cb59d459a612e8ffbb1962785a46e1c6c0c68d`（0.1.0）
- 市场目录 PR：https://github.com/mimimaster/piwin-extensions/pull/8（`mimimaster/piwin-study-space`）
- 主仓目录仅保留给 Host 集成测试，不是安装路径。
- 未安装到操作者 `~/.piwin`。目录 PR 合并后才能在扩展市场一键安装。

## 明确未验证

1. 真实付费模型教学质量、自动评分、无模型离线教学。
2. 操作者本机 sidecar/`~/.piwin` 安装启用（需市场目录合并后用户安装）。
3. 多端抢占控制权的 Desktop 手工回归（已由 Host 工具单测/SDK+RPC 集成覆盖）。
