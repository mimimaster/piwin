# 范围清单 · piwin Desktop 全部可见 UI 块（增量 0）

来源：2026-09-03 对 `apps/desktop/src` 的只读盘点（4 份 scout 报告合并去重），背景文档 `docs/prd.md`、`docs/product-status.md`、
`docs/design/deck-design-system.md`。每一行都要在重设计里得到视觉 + 交互定义；"增量"列对应 `README.md §4`。
路径省略前缀 `apps/desktop/src/`。

## A. 外壳与全局层（Shell）

| # | 块 | 实现 | 内容 / 状态 | 增量 |
|---|---|---|---|---|
| A1 | 标题带 Titleband | `workbench-context-bar.tsx`, `context-bar.tsx`, `styles/region-context-bar.css` | 32px 覆盖层（macOS 红绿灯留白 78px）：侧栏开关 `rail-chats-btn`、项目芯片、分支芯片、会话标题、运行状态、模型、搜索入口、检视器开关、窗口拖拽区。状态：idle / running / waiting / error | 0, 3 |
| A2 | 侧栏 Sidebar | `project-session-sidebar.tsx`, `workbench-sidebar.tsx`, `sidebar-tree-rows.ts`, `session-row-item.tsx`, `session-row-menu.tsx`, `styles/region-sidebar*.css` | 240px（200–420 可拖，双击复位）。顶部行：新建 Chat / 资料库 / 知识卡片 / 搜索会话…；分区 **项目**（文件夹分组，显示选项：最近更新 / A-Z、分组、显示归档；打开工作区）与 **对话**；行：标题、草稿点、归档图标、存储徽标（已转存 / 缺失离线包）、置顶、相对时间、活动指示（工作中 spinner / 后台三点 / 完成勾）；悬停：菜单/置顶/归档（归档行：恢复/永久删除）；右键：置顶、重命名、复制 ID、复制、分叉、继续到项目、恢复离线包、导出、归档、删除；页脚：设置。紧凑视口收成抽屉 | 0, 3 |
| A3 | 舞台多窗格 | `conversation-pane-workspace.tsx`, `conversation-pane-layout.ts`, `conversation-pane-separator.tsx`, `conversation-pane-header.tsx`, `conversation-pane-empty-state.tsx`, `conversation-pane-shortcuts.ts` | 二叉树分栏（行/列，最多 8 叶）；窗格头：序号、会话切换下拉、横/竖分栏、最大化（双击）、关闭；空窗格："在这里打开 Chat" + 新建 / 选择已有；快捷键 ⌘D、⌘⇧D、⌘[ ]、⌥⌘方向、⌘⇧↩、⌘⌥W | 0, 3 |
| A4 | 转录 Transcript | `workbench-conversation.tsx`, `chat-thread.tsx`, `chat-message-row.tsx`, `styles/region-transcript.css` | 虚拟化消息列，见 §B | 0, 1 |
| A5 | 作曲器 Composer | `composer-dock.tsx`, `composer-card.tsx`, `styles/region-composer.css` | 浮岛卡片，见 §C | 0, 2 |
| A6 | 检视器 Inspector | `right-panel.tsx`, `right-panel-sections.tsx`, `right-panel-home.tsx`, `styles/region-inspector.css` | 320px（240–720，左缘拖拽；折叠时卸载，PTY 例外）。页签：文件 / zsh / 变更(n) / 浏览器 + 按需 画布 / 文档预览 / 卡片 / 笔记 / 侧聊；头部：+ 菜单、最大化、关闭；空态 2×2 启动器 | 0, 4 |
| A7 | 全页子页舞台 | `workbench-subpage-stage.tsx`, `styles/region-studio-shell.css` | 覆盖聊天舞台：资料库 / 图片 / 视频 / 知识卡片（见 §G） | 6 |
| A8 | 设置覆盖层 | `settings/settings-shell.tsx`, `settings/section-registry.ts`, `styles/region-settings-shell.css` | 模态工作区，4 组 13 节（见 §F） | 5 |
| A9 | 宠物浮窗 | `pet-overlay-app.tsx`, `components/PetSprite.tsx`, `components/PetBubble.tsx`, `pet-overlay.css` | 透明伴随窗：精灵动画 + 思考气泡；sleeping / idle / thinking / celebrating / error | 6 |
| A10 | Live 条 | `live/LiveBar.tsx`, `live/LiveComposerButton.tsx`, `styles/region-live.css` | 舞台顶部浮动语音会话条：连接 / 通话中 / 重连预算 / 结束 | 2 |
| A11 | 横幅 / 吐司 | `host-reconnect-banner.tsx`, `main-error-banner.tsx`, `notification-queue.ts` | Host 重连横幅（重试计数、立即重连）；全局错误条（消息、堆栈折叠、重试/关闭）；Toast 栈 info / success / warning / error（可带动作） | 7 |
| A12 | 空舞台落地页 | `empty-stage-landing.tsx`, `ink-wash-empty-vignette.tsx` | "继续上次" ≤4 条最近会话 + 水墨小景 + 印章"砚"、"泼墨写意 · 深夜书案"；首轮后消失 | 3 |
| A13 | Host 连接墙 | `host-connect-wall.tsx` | 启动门："连接私有 Host"（端点 `ws://127.0.0.1:8787`、令牌）/ "使用本机 Mac"；连接中 / 失败 | 3 |
| A14 | 工作区选择器 | `host-workspace-picker.tsx`, `host-workspace-picker-nav.ts` | Finder 式多列目录：常用位置（桌面/文稿/下载/应用/主目录）、最近、搜索、面包屑；远程 Host 也用它 | 3 |
| A15 | 命令面板 | `command-palette.tsx` | ⌘K：搜索 + 分类动作（导航 / 工具 / 会话操作）；空结果 | 3 |
| A16 | 会话搜索 | `session-search-dialog.tsx` | ⌘O：名称 + 片段模糊搜索列表 | 3 |
| A17 | 快捷键表 | `desktop-shortcut-catalog.ts`, `settings/pages/shortcuts-page.tsx` | ⌘/：外壳 / 导航 / 作曲器 / 终端 分组、可搜索 | 5 |

## B. 转录（一轮的解剖 + 卡片目录）

### B1 一轮（turn）自上而下

1. 用户消息卡 `conversation-user-message.tsx`：Markdown 正文、附件架 `message-attachments.tsx`、分支切换芯片 `message-branch-switcher.tsx`；双击/铅笔进入就地编辑 `chat-message-edit-card.tsx`；介入/转向消息带 pending 横幅可取消。
2. 上下文装配胶囊 `assembly-summary-capsule.tsx`："正在准备上下文…" 闪烁 → token 数与提示组件列表。
3. 工作折叠 `turn-work-disclosure.tsx` / `turn-work-details.tsx`：头部 "Agent 正在思考 / 思考了 Xs" + `RadialBellow`(运行) 或脑图标(完成)；展开：思考块、`AgentLocator` + 技能活动芯片、权限等待横幅、工具组 `TurnToolGroup`、探索流胶囊 `explore-flow-capsule.tsx`。
4. 助手正文 `conversation-response-content.tsx`：头部 `conversation-message-header.tsx`（供应商/模型头像、模型短名、用量芯片——头像取生成时的 model 快照）；`MarkdownView` 流式光标；引用卡 `CitationCards.tsx`；知识卡片投影 `FlashcardResultProjection.tsx`；图片/视频生成进度；助手附件。
5. 文件变更条 `files-changed-bar.tsx` / `chat-turn-files-summary.tsx`：N 个文件、+A −D、查看变更。
6. 走查报告 `walkthrough-card.tsx` / `walkthrough-action.tsx`：生成 / 生成中 / 完成 / 失败；模式与模型 pill；Markdown 报告。
7. 错误 / 重试 `turn-error-card.tsx`。
8. 助手操作页脚 `assistant-response-actions.tsx` + `message-actions.tsx`：复制、分叉、重新生成、分叉数徽标 `branch-points-panel.tsx`。

### B2 卡片目录

| 卡片 | 实现 | 出现时机 | 内容 | 动作 |
|---|---|---|---|---|
| 工具调用 | `tool-call-card.tsx`, `styles/transcript-tool-card.css`, `transcript-tool-chain.css` | 工作折叠内 | 名称、状态 running/done/failed、时长、参数、输出 | 展开/折叠、复制 JSON、打开文件/差异、右键（重跑、回滚到此） |
| 权限请求 / 门 | `permission-request-card.tsx`, `gate-card.tsx`, `permission-bar.tsx` | 需批准的工具（bash/写文件） | 命令、目录、风险级、匹配规则来源、事实折叠 | 允许一次 / 允许(项目·会话) / 拒绝 |
| 计划卡 | `plan-card.tsx`, `PlanPanel.tsx` | 会话顶部或步骤执行 | 标题、进度 N/M、步骤清单与状态、依赖/并行组 | 中止、打开计划文档、步骤状态 |
| 计划执行门 | `plan-execution-gate.tsx` | 计划已生成待选执行方式 | 预览、步数、推荐模式 | 普通执行 / 子代理驱动 / 取消 |
| 差异卡 | `diff-card.tsx`, `diff-view.tsx`, `diff-line-numbers.ts` | 编辑/补丁结果 | 路径芯片、统一/并排差异、增删统计 | 打开、回滚、检视全差异 |
| 走查报告 | `walkthrough-card.tsx` | 完成后 | 见 B1.6 | 重生成、作为文档打开、复制 |
| 子代理活动 / 调用块 | `subagent-activity-card.tsx`, `subagent-invocation-block.tsx`, `styles/subagent-session-inspector.css` | 派生子会话 | 角色芯片、模型芯片、状态、摘要预览 | 检视子会话、应用工作树差异、追加输入 |
| 引用卡 | `CitationCards.tsx` | web_search 结果 | favicon、域名、标题、摘录 | 外部打开 |
| 图片 / 视频生成进度 | `image-generation-progress.tsx`, `video-generation-progress.tsx` | 媒体生成中 | 提示词预览、状态、渐进预览 | 取消 |
| 知识卡片投影 | `FlashcardResultProjection.tsx`, `FlashcardView.tsx`, `flashcards/*` | flashcard 工具结果 | 正反面翻转、标签、评分条 | 翻转、评分 |
| 压缩活动 | `compaction-activity.tsx` | 上下文压缩 | "正在压缩对话…"、token 缩减 | 中止、关闭 |
| 扩展 UI 提示 | `extension-ui-prompt.tsx` | 扩展请求输入 | 名称、标签、输入/选择/确认 | 提交 / 取消 |
| 认证提示表单 | `auth-prompt-form.tsx` | 供应商/MCP 需凭据 | 服务名、密钥输入、文档链接 | 打开浏览器 / 提交 / 取消 |
| 介入帧 | `agent-interruption-frame.tsx`, `styles/composer-interrupt.css` | 用户中断/转向 | 阶段徽标、转向文本 | 继续 / 关闭 |
| 动作跑马灯 | `action-marquee.tsx`, `styles/run-activity.css` | 运行中 | 活动操作滚动条 | 暂停 / 中止 |
| Goal 模式卡 | `goal/GoalDeliveryCard.tsx`, `GoalWaitCard.tsx`, `GoalBlockedCard.tsx`, `GoalTimeline.tsx`, `GoalStickyStrip.tsx` | Goal 模式 | 交付 / 等待 / 受阻 / 时间线 / 顶部粘性条 | 相应动作 |
| 历史刻度抽屉 | `history-ticks-drawer.tsx`, `styles/transcript-history-ticks.css` | 转录滚动刻度 | 消息检查点、工具调用、分支点时间轴 | 回滚、分叉 |
| 会话树弹层 | `conversation-tree-popover.tsx`, `branch-points-panel.tsx` | 标题带会话树按钮 | 分叉血缘树、当前节点 | 跳到分支 |

### B3 Markdown 与 Artifact

- Markdown：`MarkdownView.tsx`, `markdown-code-block.tsx`（语言徽标、行号、复制、右键 `code-block-context-menu.tsx`）、`MermaidBlock.tsx`、`markdown-math-view.tsx`、脚注、`path-chip.tsx`（可点路径；glob 不成芯片）、`branch-chip.tsx`、`CitationCards.tsx`、`collapsible-content-block.tsx`。
- Artifact 三态：内嵌预览 `artifact-inline-preview.tsx` + `ArtifactFrame.tsx`（标题、Inline 徽标、查看源码、在画布打开 `artifact-canvas-launcher.tsx`）；画布 `artifact-canvas-panel.tsx`（重载、外部打开、关闭、桌面/平板/手机宽度）；源码 `SourceCodeBlock`（Preview 切回）；拦截态 `.artifact-blocked`。

## C. 作曲器（Composer）

- 状态：`idle` / 草稿 / `streaming`（主键变 暂停；有草稿时变 排队发送）/ `pausing` `aborting`（禁用 spinner "正在暂停… / 正在停止…"）/ `paused`（继续运行）/ `queued-edit`（顶部横幅 `composer-queued-edit-banner.tsx`，主键 "保存修改"，Esc 取消）。
- 工具条：`+` 菜单 `composer-plus-menu.tsx`（附件、图片、技能、MCP 工具、知识库、侧聊）；模型 + 思考强度 `model-edit-popover.tsx` / `ThinkingEffortControl`（关/低/中/高/极高）；语音与 Live `live/LiveComposerButton.tsx`；Goal 模式芯片 `goal/GoalModeChip.tsx`；运行模式 `RunModeControl`（Auto / Ask All / Bypass）；编排方案 `OrchestrationSchemeControl.tsx`（关 / Ultra Code / …）；上下文用量环 `context-usage-ring.tsx` + `composer-context-controls.tsx`；主动作圆钮 `composer-run-actions.tsx`（发送 / 暂停 / 继续 / 重试）。
- 输入区：附件架 `composer-attachment-shelf.tsx`；上下文引用芯片 `context-ref-chip.tsx` + 上下文轨 `composer-context-rail.tsx`；`@` 菜单 `at/at-menu.tsx`（文件、文件夹、符号、打开的编辑器、git 差异）；`/` 菜单（技能/命令）；全屏编辑器 `ComposerModalEditor.tsx`；草稿持久化。
- 键盘：Enter 发送 / 运行中 Enter = 排队后续 / 编辑中 Enter = 保存；⌘Enter 运行中 = 转向介入（steer）；Shift+Enter 换行；Esc 关菜单或退出编辑；IME 组合期间抑制发送。
- 旁属：权限条 `permission-bar.tsx`、上下文窗口面板 `context-window-panel.tsx`、活动任务条 `active-jobs-strip.tsx`、上下文条 `context-bar.tsx`。

## D. 检视器页签

| 页签 | 实现 | 内容 / 动作 |
|---|---|---|
| 文件 | `file-tree-panel.tsx`, `file-tree-node-view.tsx`, `styles/inspector-files.css` | 树、搜索过滤、刷新、拖路径到作曲器；右键：加入聊天、询问、打开、在文件管理器显示、复制相对/绝对路径、更多（解释/审查/测试） |
| 终端 | `terminal-dock.tsx`, `styles/inspector-terminal.css` | ≤8 个 PTY 页签、xterm、CWD 下拉、新增/重启/关闭、注意点 |
| 变更 | `workbench-review-surface.tsx`, `changes-panel.tsx`, `change-file-review.tsx`, `change-file-header.tsx`, `styles/inspector-diff.css` | 文件列表（M/A/D/R/U/C，暂存/未暂存）、内联差异、返回、路径、+/-、复制路径、子代理候选卡采纳/手动合并 |
| 浏览器 | `browser-session-panel.tsx`, `browser-console-drawer.tsx`, `styles/browser-session.css` | 地址栏、重载、控制者（agent/user）、取元素、镜像视口、控制台/网络抽屉 |
| 画布 | `artifact-canvas-panel.tsx` | 见 B3 |
| 文档预览 | `DocPreviewPanel.tsx`, `MediaDocPreview.tsx`, `doc-comments.ts`, `styles/inspector-doc-shell.css`, `inspector-line-comments.css` | Markdown/文档预览 + 行评论；图片/视频/音频预览 |
| 笔记 | `NotesPanel.tsx`, `styles/region-notes.css` | 工作区记事本、Markdown 编辑、同步 |
| 卡片 | `FlashcardsPanel.tsx` | 会话内生成的知识卡片列表 |
| 侧聊 | `side-chat-panel.tsx` | 只读工具档案的轻量线程（≤200 条）、同步源会话上下文、一键交回主作曲器 |
| 启动器 | `right-panel-home.tsx` | 无活动页签时 2×2 网格 |

## E. 对话框 / 覆盖层 / 菜单

| 名称 | 实现 | 触发 | 内容 / 动作 |
|---|---|---|---|
| 新增模型 | `AddModelDialog.tsx` | 模型设置 "+ 新增" | 供应商、模型 ID、显示名、上限、思考强度、温度、密钥；保存 |
| 发现模型 | `DiscoverModelsDialog.tsx` | 模型工作台 | 远端模型可搜索列表、批量加入 |
| 供应商抽屉 | `provider-drawer.tsx`（`overlay-dismiss.ts` 防误关） | 供应商行 | Base URL、凭据、超时、模型覆盖；保存 / 删除 |
| MCP 服务器编辑器 | `McpServerEditorDialog.tsx`, `styles/settings-mcp.css` | MCP "+ 新增/编辑" | 名称、传输 stdio/sse、命令、参数、环境、cwd；保存 / 测试连接 |
| 分支切换确认 | `branch-switch-confirm-dialog.tsx` | 有未提交改动时切分支 | 修改文件列表；仍然切换 / 暂存后切换 / 取消 |
| 工作区路径 / 信任 / 重命名 / 继续到项目 | `app-dialogs.tsx` | 打开工作区、会话菜单 | 路径输入；信任并打开；标题重命名；目标项目选择 |
| 会话行菜单 | `session-actions-menu.ts`, `session-row-menu.tsx` | 行 `⋯` / 右键 | 见 A2 |
| 右键菜单目录（11 类） | `context-menu/catalog.ts`, `ContextMenuFromCatalog.tsx`, `presets.ts` | 文件树文件/文件夹、选区、路径芯片、用户/助手消息、代码块、差异行、工具卡、终端选区、错误 | 加入聊天、生成知识卡片、询问、复制为 @ref、解释、修复、审查、生成测试、另存、复制路径、引用到作曲器、分叉、侧聊、重跑工具、回滚到此 |
| 模型编辑弹层 | `model-edit-popover.tsx`, `model-edit-inline.tsx` | 模型徽标 | 温度、上限、思考预算、系统提示覆盖 |
| 媒体灯箱 | `MediaPreview.tsx`, `workspace-subpages/studio/media-lightbox.tsx`, `styles/region-media-lightbox.css` | 缩略图 | 缩放、复制原图/资产 ID、删除 |
| 浏览器控制台抽屉 | `browser-console-drawer.tsx` | 浏览器页签 | 日志/网络错误、过滤、清空 |
| 插件密钥对话框 | `plugin-marketplace-secret-dialog.tsx` | 安装缺密钥插件 | 密钥表单；保存并安装 |
| 命令面板 / 会话搜索 / 快捷键表 | 见 A15–A17 | | |
| 横幅与吐司 | 见 A11 | | |

## F. 设置（`settings/section-registry.ts`：4 组 13 节；旧页折叠为节内页签）

| 组 | 节 | 折叠进来的页面模块 | 实现 |
|---|---|---|---|
| 应用 | 通用 general | 外观（浅/深/水墨、字号、对话宽度）、快捷键、宠物、动画、语言 | `pages/general-page.tsx`, `appearance-page.tsx`, `shortcuts-page.tsx`, `pets-page.tsx`, `animations-page.tsx` |
| 应用 | 权限 permissions | 规则引擎 auto / ask-all / bypass、文件写入门、记住的同意 | `permissions-page.tsx`, `permission-rules-editor.tsx` |
| Agent | 模型 models | 供应商与模型、视觉、图片生成（`ImageGenerationSettings.tsx`）、模型工作台 `ModelWorkbench.tsx` | `models-page.tsx`, `vision-page.tsx`, `styles/region-settings-models.css`, `settings-byok*.css` |
| Agent | OAuth | 第三方登录/令牌 | `oauth-page.tsx`, `styles/region-settings-oauth.css` |
| Agent | 钩子 hooks | 生命周期钩子、定时触发 | `hooks-page.tsx`, `hooks-page-model.ts` |
| Agent | Agent | 子代理档案 `subagents-page.tsx`、编排方案编辑器 `orchestration-scheme-editor.tsx`、自动化 `automation-page.tsx` / `AutomationPanel.tsx`、Artifact 策略与游乐场 `artifact-page.tsx` / `artifact-playground-page.tsx` | `agent-page.tsx` |
| 集成 | 扩展 extensions | 技能 `skills-page.tsx` / `SkillsPanel.tsx`、工具 `tools-page.tsx`、MCP `McpPanel.tsx`、插件市场 `plugins-page.tsx` / `PluginsPanel.tsx` / `plugin-marketplace-card.tsx`、提示词 `prompts-page.tsx`、扩展面板 `ExtensionsPanel.tsx` | `extensions-page.tsx`, `styles/region-settings-plugins.css` |
| 集成 | Web | web_search / web_fetch 引擎与凭据、CLI 源 | `web-page.tsx`, `web-secret-editor.tsx`, `styles/settings-web-tools.css` |
| 集成 | 知识 knowledge | 嵌入 / 重排 / 解析器 页签、测试 | `knowledge-page.tsx`, `knowledge-*-tab.tsx`, `styles/region-settings-knowledge.css` |
| 系统 | 会话 session | 默认值、运行时 `session-runtime-page.tsx`、Host 目标 `host-target-settings.tsx`、移动访问 `mobile-access-settings.tsx`、Host 日志 `HostLogPanel.tsx` | `session-page.tsx` |
| 系统 | 冷存储 | 离线包、打包/解包、保留 | `session-cold-storage-page.tsx`, `cold-storage-draft.ts` |
| 系统 | 用量 | token / 成本 / 历史图表 | `usage-page.tsx`, `styles/usage-panel.css` |
| 系统 | 归档 | 搜索、恢复、永久删除 | `archive-page.tsx`, `archive-session-list.ts`, `styles/region-settings-archive.css` |

## G. 子页与知识

| 面 | 实现 | 内容 / 状态 |
|---|---|---|
| 资料库 Library / 媒体工作室 | `workspace-subpages/LibraryWorkspaceView.tsx`, `studio/media-library-workspace.tsx`, `library-media-card.tsx`, `library-file-card.tsx`, `library-inspector-drawer.tsx`, `studio-chrome.tsx`, `styles/region-library-*.css` | 网格、按类型过滤（图片/视频）、检视抽屉、空态、加载 |
| 图片 / 视频工作室 | 同上（`images` / `videos` 子页） | 生成结果画廊、生成进度 |
| 知识卡片工作台 | `workspace-subpages/FlashcardsWorkspaceView.tsx`, `flashcards/flashcard-gallery.tsx`, `tear-deck.tsx`, `produce-stage.tsx`, `workspace-dialogs.tsx`, `styles/region-flashcards-workspace.css` | 牌组列表、画廊、撕卡牌组、生产阶段、对话框 |
| 学习流程 | `workspace-subpages/flashcards/study/FlashcardStudyView.tsx` | 提问面 → 揭示 → 评分 1–4 → 回合完成（Leitner） |
| Doc Cards | `DocCardSequenceView.tsx`, `DocCardItem.tsx`, `DocCardsProgressRing.tsx`, `doccards-*.ts`, `styles/region-doccards.css`, `doccards-grid.css` | 从文档生成卡片序列、进度环、最近文件夹、文件清单 |
| 知识中心 | `KnowledgeCenterPanel.tsx`, `knowledge/KnowledgeUnindexedHero.tsx`, `KnowledgeReadyView.tsx`, `KnowledgeResultView.tsx`, `KnowledgeWikiView.tsx`, `KnowledgeProjectList.tsx`, `KnowledgeFileChecklist.tsx`, `styles/region-knowledge*.css` | 未索引英雄区 → 索引进度 → 就绪 / 结果 / Wiki 视图、项目列表、文件清单、导出 |

## H. 系统反馈矩阵（现状）

| 信号 | 哪里出现 | 实现 |
|---|---|---|
| Host 连接 | 启动门（连接墙）；掉线横幅；标题带状态 | `host-connect-wall.tsx`, `host-reconnect-banner.tsx`, `host-reconnect-gate.ts` |
| 运行状态 | 标题带、会话行活动指示、作曲器主键、工作折叠头、动作跑马灯、宠物状态 | `context-bar.tsx`, `session-row-item.tsx`, `composer-run-actions.tsx`, `turn-work-details.tsx`, `pet-overlay-*` |
| 后台任务 / 子代理 | 活动任务条、子代理卡、变更页签徽标、终端注意点 | `active-jobs-strip.tsx`, `subagent-activity-card.tsx`, `right-panel-sections.tsx` |
| 等待批准 | 门卡 / 权限条、工作折叠内权限等待横幅、会话行 | `gate-card.tsx`, `permission-bar.tsx`, `turn-work-details.tsx` |
| 错误 | 轮次错误卡、主错误横幅、吐司、Host 日志 | `turn-error-card.tsx`, `main-error-banner.tsx`, `notification-queue.ts`, `HostLogPanel.tsx` |
| 上下文用量 / 压缩 | 用量环、上下文窗口面板、压缩活动卡、消息头用量芯片、内存压力降级 | `context-usage-ring.tsx`, `context-window-panel.tsx`, `compaction-activity.tsx`, `styles/memory-degradation.css` |

## I. 未分类 / 疑似非产品 UI

- `docs/design/sci.txt`：浏览器 UserScript（claude.ai 响应改写），与设计无关，忽略。
- `docs/design-system/piwin-studio/`：独立的营销/作品集类设计系统（粉/青、Archivo + Space Grotesk），不是 Desktop 的设计系统，本次不采用。
- `nav-rail.tsx`：曾在 `5b58a59d` 引入的持久 46px 导航 rail，已在 `8324d403` 移除；`docs/design/deck-design-system.md` §"No navigation rail" 记录了理由。重设计尊重该决定。
- `live-spike/`：Live 语音的实验目录，非正式界面。