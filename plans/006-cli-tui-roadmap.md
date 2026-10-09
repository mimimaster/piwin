# CLI TUI 产品路线（feat/cli-tui 续作）

| 字段 | 值 |
|---|---|
| 更新 | 2026-10-08 |
| 分支 | `feat/cli-tui`（c34ca780，未推送；相对 main 100 文件 +10.7k） |
| 角色 | leader 规划/裁决 · sidekick 实现 · tester 测试与 review |
| 对标 | Claude Code、Codex CLI、opencode、Gemini CLI、Aider；以及 piwin Desktop 自身已 green 的会话能力 |

## 原则（所有任务通用，tester 按此打回）

1. **TUI 只是 Host 的一个客户端**。会话状态、删除/置顶/导出、搜索全部走 Host 请求；TUI 不直接读写会话文件。Desktop 已有的 Host 能力（rename/archive/delete/duplicate、pin+search、cold storage）优先复用，缺的在 Host 侧补 contract，Desktop 和 CLI 共用。
2. **一项功能 = contract + controller + view + 命令表条目 + 测试**，沿用 `TuiSessionFeaturesPort` / `tui-*-controller.ts` 模式；controller 不碰终端渲染，view 是纯函数（可快照测）。
3. **命令统一注册**：斜杠命令、快捷键、命令面板都从 `tui-command-table.ts` 一张表派生，带 `when`（idle/running/embedded）条件，自动生成 `/help`。
4. **嵌入模式（Desktop 内嵌 PTY）**：会话归属以 Desktop 为准；破坏性操作（删除、切换当前会话）发给 Desktop 决定，不在 TUI 里各做一套。
5. **破坏性操作 archive-first + 二次确认**，与 Desktop PD-SESS 规则一致；不做硬删除快捷键。
6. 不新增对 pi 0.x 将在 1.x 失效 API 的依赖（tester 会单列检查）。

## M0 收尾（先做，阻塞后续）

| ID | 任务 | 验收 |
|---|---|---|
| M0-1 | 查清全量测试 382 中偶发失败的 1 个 | 定位根因并修复（不是加 retry/放宽超时）；`pnpm test` 连跑 5 次全绿；PR 说明写根因 |
| M0-2 | mock Host 支持子代理与改动记录 | `mock-session` 能产出 subagent 生命周期事件和 per-turn file changes；`tui-e2e` 覆盖：起子代理→看结果→follow up；改文件→看 diff→undo |
| M0-3 | 推送 `feat/cli-tui` 到 origin（Yorick 点头后，禁止 force） | 远端分支存在，tester 能拉到同一 commit |

## M0 审查遗留

M0 的 13 个提交审查后留下的问题。已做的留一行记录，没做的在动 M1 相关功能前处理。

| ID | 问题 | 状态 |
|---|---|---|
| R-1 | 建会话失败、排队被拒时消息原文丢失 | 已做：没被 Host 接下的消息连同排在它后面的一起放回输入框，本地回显撤掉（`tui-prompt-sender.ts`） |
| R-2 | 发送队列不能取消 | 已做：状态栏显示「待发送 N 条」，Ctrl+C 取回；已发出的那条仍靠 host-client 的请求超时结束 |
| R-3 | 等待中的消息会跟着切换发到别的会话；迟到的建会话把用户拉回旧草稿 | 已做：消息绑定输入时所在的对话，切走后放回输入框 |
| R-4 | 准备阶段点停止仍白跑一次冷启动 | 已做：容量准入之后、建运行时之前各查一次。外部代理会话在停止后由后来的 turn 自己启动（不再挂到已结束的 run 上），只是被停的那次仍会打开一次外部会话再释放 |
| R-5 | cold activation 取消的测试替换 Host 私有方法、读内部 run 记录 | 已做：`HostRuntimeOptions.activationProbe` 是正式的测试接入点，两条测试只用它、Host 命令和推送 |
| R-6 | TUI `branches.load()` 失败当成 0；Desktop 模拟 Host 只发早的那次分支推送 | 已做：同一会话的重载读失败时保留原计数；模拟 Host 在新分支落库后再推一次 |
| R-7 | 不相关的 done 更新可能提前耗掉子代理追问计数 | 已做：`SessionSummary.subagentBatchRunId` 标出驱动子会话的 batch，TUI 用 `subagent/continue` 回包里的 run id 精确匹配；Desktop 还没用这个字段 |
| R-8 | foreground-run 回包盖掉推送来的新一轮 | 已做：提问期间只要有 run 推送改过状态，回包就丢弃 |
| R-9 | `tui-app.ts`、`session-product-commands.ts` 接近 1000 行上限 | 部分：`tui-app.ts` 870 → 818（发送逻辑已拆出）；M1 加会话管理前继续拆会话生命周期。`session-product-commands.ts` 967 行未动 |
| R-10 | 未注册的 `--project-path` 静默退回；side chat 状态栏显示「对话」；`/back` 后上下文百分比消失；「会把1 个文件」缺空格；出错分支显示「（空）」 | 已做 |

## M1 会话管理（对齐 Desktop + Claude Code `/resume`、Codex resume picker、opencode sessions）

| ID | 任务 | 验收 |
|---|---|---|
| M1-1 | 会话选择器升级：分组（置顶 / 今天 / 更早 / 已归档折叠）、相对时间、项目过滤、模糊搜索标题 | 已做：^P 循环项目、Tab 展开已归档；空态与加载失败在选择器内提示；500 行纯分组过滤 < 200ms |
| M1-2 | 置顶/取消置顶、重命名 | 已做：选择器 `^T` 置顶、`/pin` 切换当前；`/rename` 与 `^R` 沿用；`session/index-updated` 推送刷新选择器 |
| M1-3 | 归档/删除 | 已做：`/archive` 后 `/unarchive` 撤销；删除需输入标题确认；运行中禁删并说明原因；选择器 `^X` 归档、`^D` 删已归档；内嵌模式不开放选择器 |
| M1-4 | 导出 `/export [md|json] [path]` | 已做：`md`/`json`/`html` 走 `session/export`；JSON schema `piwin.session-transcript.v1`；默认 Host exports 目录并打印路径；`--all-branches` 暂提示未支持（当前叶子） |
| M1-5 | 跨会话全文搜索 `/search` | 已做：TUI `/search` 与 `piwin session[s] search` 共用 Host `session/search`（index+transcript 扫描）；回车打开会话；SQLite FTS 升级仍属 Host 侧既有 W1 实现 |
| M1-6 | 嵌入联动：TUI 新建会话即成为 Desktop 当前会话；Desktop 切换会话不结束 TUI、TUI 跟随 | e2e：两端各切一次，状态一致、无重复订阅/泄漏 |
| M1-7 | `--continue` / `--resume <id>` 启动参数 | 已做：`-c`/`--continue` 续最近；`-r`/`--resume [id]` 有 id 打开该会话、无参打开选择器 |

## M2 会话内体验（对标 Claude Code / opencode）

| ID | 任务 | 验收 |
|---|---|---|
| M2-1 | 会话内搜索（`Ctrl-F` 或 `/find`）：高亮、n/N 跳转、对虚拟化 transcript 生效 | 2000 条消息下跳转不卡；命中在折叠工具输出里会自动展开 |
| M2-2 | 用量与上下文 `/usage` `/context` | 显示本会话 token/费用、上下文占用条（系统/工具/历史/附件分项，参考 Claude Code `/context`），数据来自 Host 已有 context-usage；状态栏常驻精简版 |
| M2-3 | `/compact [指令]` 手动压缩 + 自动压缩提示阈值 | 压缩前后 token 对比显示；压缩可回退到压缩前分支 |
| M2-4 | 回溯：`Esc Esc` 打开消息列表，选中后从该处 fork/改写（复用已做的 branches/rewrite） | 与 Desktop 分支模型一致，测试覆盖 |
| M2-5 | 输入体验：`Ctrl-R` 历史提示词搜索、`Ctrl-G` 用 `$EDITOR` 编辑长提示、多行粘贴折叠为 `[粘贴 N 行]` | 历史按项目隔离持久化；编辑器退出码非 0 时不覆盖输入 |

## M3 打磨与可配置（成熟度）

| ID | 任务 | 验收 |
|---|---|---|
| M3-1 | 快捷键可配置（`~/.piwin/keybindings.json`），冲突检测 | 非法配置启动时报错并回退默认 |
| M3-2 | 主题跟随 Desktop theme 包，支持亮/暗/高对比，`NO_COLOR` | 快照测试三套 |
| M3-3 | 回合结束通知：终端 bell / OSC 9 / OSC 777，可关 | 仅在窗口失焦或运行 > N 秒时提示 |
| M3-4 | 自定义状态栏（模型、分支、git 脏状态、上下文%、费用） | 参考 Claude Code statusline，配置为模板字符串 |
| M3-5 | 无交互模式对齐：`piwin -p "..." --output-format json|stream-json` | 与 TUI 共用同一 turn 执行路径，CI 可用 |

## 流程

每项一个 commit（或一组小 commit），sidekick 交付时在群里给：ID、改动摘要、测试命令与结果。tester 回报 通过 / 可合并后修 / 打回 + 复现步骤，leader 裁决。顺序：M0 → M1（1→7）→ M2 → M3；M1-5 Host 索引可与 M1-1~3 并行设计，但先合入 M1-1。
