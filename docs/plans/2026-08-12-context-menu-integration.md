# Plan — Context Menu Surfaces 集成到 main（2026-08-12）

## Goal

把 `feat/context-menu-surfaces`（P0 已提交 + P1 未提交）以安全、可验证的方式集成到当前 `main`
（e15a606，领先 origin 25 个提交）。评审发现的问题（安全/功能未闭环/冲突）在本计划内修复，
不在集成分支上复制旧缺陷。

## 评审结论摘要（docs 见会话记录）

- 12 个 merge 冲突文件（真实演练）。
- **阻断**：`resolve-prompt-context-refs.ts` 不校验 registered/trusted project root，可读任意目录。
- **阻断**：`project/write-file` 无 registered-root 校验、无 symlink 防护、Host 侧无 permission gate，
  实测可写未注册目录 + 符号链接逃逸。
- 功能未闭环：Side Chat 菜单未把 refs 传给 host；Apply P1b 生产入口不可达（Markdown code-block
  无 relativePath、selection 菜单无 apply 项）。
- `apps/desktop/e2e/debug-boot.spec.ts` 为调试脚本，不得合入。
- 19 个文件 prettier 不合规。

## Steps

1. **保存工作**：把 worktree 未提交 P1 commit 到 `feat/context-menu-surfaces`（不丢工作）。
2. **集成分支**：基于 `main` 新建 `merge/context-menu-surfaces`；`git merge` 分支并逐个解决 12 个冲突。
3. **摘除 `project/write-file`**：
   - contracts：移除 `project/write-file` 命令类型 + `ProjectWriteFileData`。
   - host-runtime：`project-commands.ts` 恢复 main 安全版本（registered-root + realpath），
     删除 `writeProjectFile` 与 CM-14 测试。
   - desktop：删除 `applyDraft` + ConfirmDialog + `project/write-file` 调用；`applyToFile` 降级
     为 P1a（copy + preview + notice，不静默写）。
4. **Side Chat refs 透传**：`host-client.sideChatOpen` options 增加 `refs`；App dispatcher 传入
   refs；确认 host-runtime `side-chat-commands` 消费 refs（contracts 已有字段则补齐 host 侧）。
5. **Host resolver 安全修复**：`resolve-prompt-context-refs.ts` 增加 registered project root 校验
   （与 main `requireRegisteredProjectRoot` 同语义），拒绝未登记根目录。
6. **清理**：删除 `apps/desktop/e2e/debug-boot.spec.ts`。
7. **质量**：prettier --write；spec/todo-deferred/product-status 状态诚实化
   （P0+P1 shipped；CM-14 降级 P1a；write-file 移除说明）。
8. **验证**：`pnpm typecheck`、`pnpm test:architecture`、受影响包单测、context-menu e2e
   （隔离端口）、新增 1 条 P1 e2e（message 菜单）或说明 mock 限制。

## Acceptance criteria

- `pnpm typecheck` 全绿。
- 受影响包单测全绿（contracts/session/host-runtime/cli/desktop/ui-kit）。
- 安全回归：未注册目录读/写均被拒；symlink 逃逸被拒（新增/现有测试覆盖）。
- context-menu e2e 绿（隔离端口）。
- 无 `project/write-file`、无 `debug-boot.spec.ts` 残留。
- 文档状态与代码一致。

## Stop conditions

- 任何一步验证失败且无法在本计划内修复 → 停止并报告，不强行合入。
