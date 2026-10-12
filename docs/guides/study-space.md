# Study Space：可选教学扩展

Study Space 是一个主动启用的 Extension，不是新的卡库、FSRS 算法或外部服务。课程、练习证据和偏好属于扩展；原生卡片、到期队列、评分和 undo 属于 Host。普通编码会话不会因为加载扩展自动变成课堂。

## 安装前提与边界

独立源码仓库：[mimimaster/piwin-study-space](https://github.com/mimimaster/piwin-study-space)。市场条目 id：`mimimaster/piwin-study-space`（[目录 PR](https://github.com/mimimaster/piwin-extensions/pull/8)）。主仓 `packages/agent-host/standalone-extensions/study-space/` 只给 Host 集成测试用，不随产品自动安装。测试过的 Pi API 是 0.84.2，typebox 由宿主提供。

必须先运行包含 `flashcard_study_read/write` 的新版 Host，并启用原生闪卡能力。只把扩展放进旧安装版不会凭空增加复习接口。模型可能只能看到 `piwin_toolbox`；这时先 search/describe，再调用发现的原生目标。真正缺少接口时明确降级为文本教学/原生 UI 手动复习，不安装影子服务器。

目录 PR 合并后，从桌面端「扩展市场」搜索 Study Space 安装并启用。未合并前不要把它当成已上架。不要直接复制文件到运行中的不可变 revision。新会话中 `/teacher` 才是教学入口。停用/卸载不会删除学习数据或原生卡片。

## 使用

- `/teacher ta`：直接解答当前疑问，不要求主题、弹窗或课程，也不写入课程文件。
- `/teacher learn Rust`：创建课程，诊断水平，按短阶段解释、练习、反馈、记录证据。
- `/teacher ta Rust`：显式创建带主题的助教课程，但不强制完整学习路径。
- `/teacher status`：查看角色、课程 ID、偏好、能力及不确定的制卡结果。
- `/teacher review <courseId>`：载入课程，使用原生 scheduled 到期复习；不创建自己的队列。
- `/teacher resume <courseId>`：读取实际保存的课程/证据；不是重新执行原生变更的许可。
- `/teacher off`：退出教学，清除自己的状态；保留数据及普通编码规则。

角色变更等待 idle。session/runtime 重建后默认 off，必须显式 resume；不从聊天历史或 appendEntry 偷偷恢复角色。只有主动教学时追加角色规则，不切换模型、预算、权限或全局工具集合。

## 制卡与复习确认

课程使用稳定 `courseId` 和 `study-space:<courseId>` deck，重命名主题不搬迁卡片。没有实际卡点、用户只想了解、或偏好 `cards=never` 时不制卡。不会因为用户说“懂了”就宣布掌握。

制卡前保存具体用户回答/反馈及精确的卡片意图，弹窗展示真实内容并征求同意；之后仍走 Host admission。首版仅支持原生卡片的 model/content/deck 字段，不静默忽略额外来源字段。课程文件保留卡点与原生 ID 的关联。

当前题先向用户抽问，模型评判后建议评分。原生 rate 和 claim 都要求扩展确认弹窗，即使 Host 是 bypass；没有交互 UI 时明确拒绝，不把一句模型生成的“已同意”当授权。claim 不会自动抢占其他端控制权。

工具身份由当前 Host product session 派生，模型不能填 principal/session/generation。每次调用仍经过 Run/generation admission。写入保留 revision/epoch/content/ReviewState CAS。幂等键在 Host 内按该身份隔离：查询 operation 时仍传模型最初使用的 key；undo 的 targetOperationId 使用原生快照提供的值。

未知提交结果先查原 key，不生成新 key 重试；冲突重新获取快照并重新询问。sequence/next/goto 不在此工具首版范围；sequence 写入在变更前拒绝。

## 数据和恢复

只使用 `${PIWIN_ROOT}/study-space`（默认 `~/.piwin/study-space`）。`preferences.json` 保存版本化偏好，每个 `<courseId>.json` 将课程、路径、证据、制卡意图/结果放在同一原子文档，避免多文件半提交。UUID、schemaVersion、revision CAS、后代符号链接检查和跨进程写锁防止误覆盖；它不是对恶意本地进程的 OS 沙箱。

部分批量成功只关联真实返回的卡片 ID，不用计数器伪造结果；丢失结果或写入冲突仍明确 pending/partial/unknown。resume 后先列出原生 deck 对账，不重放整批。列表预览只能提供候选 ID，不能证明答案完全相同；歧义保留给原生检查/用户后续处理，不假装已完成。

崩溃留下的 `.write-lock` 不自动夺取。先确认所有写进程已停止并备份数据，再人工移除遗留锁/临时文件；重新读取 revision 后才能继续。

## 验证范围

```sh
pnpm --dir packages/agent-host/standalone-extensions/study-space test
pnpm --dir packages/agent-host/standalone-extensions/study-space typecheck
pnpm --filter @piwin/host-runtime exec vitest run src/flashcard-study-tools.test.ts src/study-space.integration.test.ts
pnpm --filter @piwin/flashcards test
pnpm typecheck
pnpm test:architecture
```

`study-space.integration.test.ts` 使用真实 Pi SDK、真实 spawned RPC worker、同一扩展、正常 Toolbox/Host port、实际原生卡片/FSRS 数据，模型响应由本地 HTTP SSE fixture 脚本提供，不调用付费服务或模拟 Pi 引擎。覆盖练习证据→同意制卡→到期抽问→确认评分→undo→运行时替换 off→显式 resume。

这证明协议、钩子、持久状态链路，不证明真实模型教学质量或 Desktop 视觉体验。命令菜单、状态面板、确认弹窗和已打开原生卡片 UI 的 DOM/截图验收仍需用户批准安装及可运行的新版 Desktop；自动测试通过不替代这部分。
