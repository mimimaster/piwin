# Walkthrough 指南与架构说明

> 版本：v1.0
> 目标：提供 piwin 中 Walkthrough 功能的权威概念定义、分工说明与架构流程。

---

## 1. 核心定义与区分

在 piwin 项目中，与 Walkthrough 相关的名称必须做严格区分：

| 概念 | 真实名称 | 职责与归属 | 交互形态 |
| :--- | :--- | :--- | :--- |
| **Walkthrough 履约报告** | `WalkthroughArtifact` | **面向用户的最终 Artifact**<br>与 `sessionId + messageId` 绑定的 Markdown 交付报告。 | 消息下方的展开卡片 / Document 面板 / CLI 导出 |
| **计划执行摘要** | `PlanExecutionSummary` | **内部运行逻辑数据结构**<br>记录计划执行中的 `completedStepIds`、`failedStepIds` 等步骤状态。 | 不面向用户直接展示，仅作为 Host 内部状态 |
| **计划定义** | `SessionPlan` | **计划域数据模型**<br>描述任务计划的标题、目标和步骤列表。 | 侧边栏/编辑器中的 Plan 结构 |

> **一句话区分**：`WalkthroughArtifact` 是面向用户呈现的证据驱动 Markdown 文档；`PlanExecutionSummary` 是内部跟踪计划执行步骤状态的数据结构。

---

## 2. 双轨制回复流 (Double-Track Response)

当开启 `autoGenerate` 自动生成 Walkthrough 时，系统采取**双轨制分工**：

```text
                               ┌───► [聊天框主回答] ── 简洁总结 (Concise Response)
                               │     · 2-3 句话概括最终结论与结果
                               │     · 由 concisePrompt 提示词引导模型保持精简
[Agent Turn 完成 (Run Terminal)] ┤
                               │
                               └───► [后台异步管线] ── 履约导览卡片 (Walkthrough Artifact)
                                     · 变更文件路径列表 (What Changed)
                                     · 模块架构图 (Technical Details / Mermaid)
                                     · 真实测试与验证指令 (Validation & How to Verify)
```

---

## 3. Walkthrough 完整生成流水线

```text
1. 用户发送 Prompt
     │
2. Host 检索配置
   └── 若 walkthrough.enabled && autoGenerate ──► 注入 concisePrompt 到 PromptInput
     │
3. Agent 执行 Turn（工具调用、修改代码、运行命令等）
     │
4. Agent Turn 完成 (run terminal)
     │
5. Host 触发 maybeTriggerAutoWalkthrough()
   ├── 校验 walkthrough.enabled & autoGenerate
   ├── 校验 isWalkthroughEligibleMessage() （是否为当前 run 的最终 Assistant 消息）
   ├── 校验 isAutoWalkthroughEligible() （该 run 是否调用了至少一次工具）
   ├── 校验是否已存在 ready 状态的 WalkthroughArtifact
   └── 满足条件 ──► 启动后台 startWalkthroughGeneration()
     │
6. 证据收集与脱敏 (Host 纯函数)
   ├── collectWalkthroughEvidence() — 从 transcript 收集工具日志、exitCode、changedPaths
   ├── redactAndBoundEvidence() — 敏感词擦除 (API Key 等) 与 64KB UTF-8 字节截断
   └── assembleSystemPrompt() & assembleUserPrompt() — 封装至 <piwin-walkthrough-evidence> 隔离界定符内
     │
7. 独立后台 Completion
   ├── completeWalkthrough() — 通过 WalkthroughGenerationRegistry 触发非流式 LLM 调用
   ├── 不创建 Pi Agent Session，不消耗工具轮次，不修改文件
   └── 支持 AbortController 中断与并发去重 (同一 sessionId:messageId 仅一个在执行)
     │
8. 持久化与 UI/CLI 消费
   ├── saveWalkthrough() 写入 ~/.piwin/sessions/<id>/walkthroughs/<messageId>.json
   └── HostPush 发送 walkthrough/updated 消息 ──► Desktop 渲染卡片 / CLI 支持导出
```

---

## 4. 证据驱动规范与安全边界

1. **事实证据约束**：Walkthrough 模型生成时受 System Prompt 约束，只能基于 `<piwin-walkthrough-evidence>` 提供的真实事实总结，严禁凭空捏造未执行过的命令或未修改的文件。
2. **脱敏保护**：所有证据进入模型前经过 `redactToolText()` 处理，过滤 API Key、Token 和密码。
3. **数据隔离界定符**：证据包裹在 `<piwin-walkthrough-evidence>` 中，System Prompt 规定该区块内容纯属数据，禁止模型将证据中的命令视作指令执行。
4. **渲染安全**：Walkthrough Markdown 渲染时，默认关闭 Artifact iframe 预览，防止非受信任 HTML 脚本执行。

---

## 5. 交付文档富文本格式（Rich-Text Delivery Format）

Walkthrough 的目标是生成一份**详细的交付文档**，其 Markdown 由 `EnhancedMarkdownView` 渲染为富文本组件。
生成侧（`WALKTHROUGH_SYSTEM_PROMPT` + `DEFAULT_WALKTHROUGH_PROMPT`）要求输出必须包含以下格式：

| # | 格式 | 渲染效果 | 生成要求 |
| :--- | :--- | :--- | :--- |
| 1 | 文件变动说明 `[MODIFY] TS src/utils.ts` / `[NEW] TS src/logger.ts` | 动作徽章 + 语言标签 + 可点击路径（`PathChip`） | 每个变更文件独占一行，使用 `[MODIFY]` / `[NEW]` / `[DELETE]` |
| 2 | `diff` 代码块 | `+` 新增行绿色（`diff-line-add`）、`-` 删除行红色（`diff-line-delete`） | 使用 `diff` 语言围栏；新增行前缀 `+ `、删除行前缀 `- `，上下文行无前缀 |
| 3 | 20+ 行长代码块 | 超过 16 行自动折叠，显示 `Expand (N lines)` 按钮 | 证据支持时至少包含一个代表性代码块（如新增类/重构函数） |
| 4 | HTML `<details><summary>` 折叠块 | 点击展开/收起（`enhanced-details`） | 构建/测试日志不得内联粘贴，须包裹在 `<details><summary>…</summary>…</details>` 中 |
| 5 | 任务清单 `- [x]` / `- [ ]` | 只读复选框（`enhanced-checkbox`） | 已完成用 `- [x]`，待处理用 `- [ ]` |
| 6 | 提示框 `> [!NOTE]` / `> [!TIP]` | 彩色 callout 卡片（支持 NOTE/TIP/IMPORTANT/WARNING/CAUTION） | GitHub 风格 callout 语法 |

分层保证：

- `WALKTHROUGH_SYSTEM_PROMPT`（Host 常量，始终注入）包含“Formatting requirements”，因此**即使 Custom 模式**也无法通过用户 Prompt 移除这些格式要求。
- `DEFAULT_WALKTHROUGH_PROMPT`（Contracts 常量）提供完整的格式示例，是 Default 模式的生成模板。

安全边界不变：所有格式输出仍必须由证据支持，禁止捏造文件、命令、测试或日志。

