# Agent Activity Presentation & Motion Design

> 状态：V1 设计基线
>
> 日期：2026-08-08
>
> 范围：Desktop 对话区域中的 Agent 调用链、行为文字、状态容器与动效映射。

可直接打开查看动效渲染表：[agent-activity-motion-matrix.html](./agent-activity-motion-matrix.html)

## 1. 设计目标

每一种 Agent 行为拥有稳定的行为 ID，并一一对应以下展示定义：

```text
behaviorId
  → 中文文案 / English 文案
  → UI 容器
  → 图标
  → 进行中动效
  → 完成状态
  → 失败状态
  → 是否可展开
  → 是否保留在历史记录
```

后续修改某一种行为时，只修改对应行为定义，不改变其他行为的展示逻辑。

## 2. UI 容器

| 容器 | 用途 | 生命周期 |
| --- | --- | --- |
| `locator` | 全局 Agent 定位器，只允许同时存在一个 | 临时显示，出现具体行为后隐藏或降级 |
| `timeline-row` | Search、Read、Edit、Shell、MCP 等普通行为 | 保留在调用链中 |
| `group` | Plan、Subagent、Explore、Thinking 等可展开分组 | 保留在调用链中 |
| `context-chip` | Skill、模型、上下文等资源信息 | 附着在当前 turn 或上下文区域 |
| `gate` | 权限确认、等待用户回答 | 阻塞期间显示 |
| `result` | 完成、失败、停止等终态 | 静态保留 |

## 3. 动效角色

动效不直接代表某个工具，而是代表行为的视觉角色。

| 动效 ID | 组件 | 角色 |
| --- | --- | --- |
| `radial-bellow` | `RadialBellow` | 全局 Agent 定位器，默认首选 |
| `asterisk-breath` | `AsteriskBreath` | 思考、计划，接近 Claude 风格的星芒定位 |
| `breath-dot` | `BreathDot` | 轻量工具进行中状态 |
| `pulse-block` | `PulseBlock` | 并行任务、子代理批次 |
| `solid-bars` | `SolidBars` | 进程、持续输出 |
| `breath-matrix` | `BreathMatrix` | Skill 加载、上下文整理、批量处理 |
| `cascade-ripple` | `CascadeRipple` | Shell、流水线、连续执行 |
| `text-shimmer` | 现有 `wb-shimmer` | Search、Explore、Web 等文字行为 |
| `diff-in` | 现有编辑动效 | 文件修改完成时的一次性反馈 |
| `artifact-sheen` | 现有 Artifact 动效 | Artifact、图片、视频生成 |
| `gate-pulse` | 边缘/状态脉冲 | 权限确认、等待回答等需要用户注意的阻塞状态 |
| `none` | 无动画 | 完成、失败、停止等明确终态 |

无限循环动效只用于 `running` 状态。`complete`、`failed`、`stopped` 必须切换为静态结果。

## 4. 行为注册表

### 4.1 Agent 运行生命周期

| ID | 中文 | English | 容器 | 进行中动效 | 终态 |
| --- | --- | --- | --- | --- | --- |
| `run.prepare` | 准备上下文… | Preparing context… | `locator` | `radial-bellow` | 隐藏 |
| `run.connect` | 连接模型… | Connecting to model… | `locator` | `radial-bellow` | 隐藏 |
| `run.wait-token` | 正在思考… | Thinking… | `locator` | `radial-bellow` | 隐藏 |
| `run.running` | 正在处理… | Working… | `locator` | `radial-bellow` | 隐藏 |
| `run.stop` | 正在停止… | Stopping… | `timeline-row` | `none` | 静态停止 |
| `run.complete` | 已完成 | Complete | `result` | `none` | 静态勾 |
| `run.fail` | 执行失败 | Failed | `result` | `none` | 静态错误 |
| `run.compacting` | 正在整理上下文… | Compacting context… | `timeline-row` | `breath-matrix` | 静态完成 |

`radial-bellow` 只作为全局 Agent 定位器，不放入每个工具行。

### 4.2 思考与编排

| ID | 中文 | English | 容器 | 动效 | 交互 |
| --- | --- | --- | --- | --- | --- |
| `thinking` | 思考中 | Thinking | `group` | `asterisk-breath` | 可展开思考内容 |
| `plan` | 制定计划中 | Planning | `group` | `asterisk-breath` | 展开 Plan 卡片 |
| `subagent.batch.prepare` | 准备子代理批次… | Preparing subagent batch… | `group` | `pulse-block` | 批次启动 |
| `subagent.batch.running` | 委派给 `{name}` · `{count}` 个子 Agent › | Delegating to `{name}` · `{count}` children › | `group` | `pulse-block`（并行） | 打开 Working Dock |
| `subagent.batch.complete` | 子代理批次已完成 | Subagent batch complete | `result` | `none` | 聚合完成 |
| `subagent.batch.fail` | 子代理批次失败 | Subagent batch failed | `result` | `none` | 聚合失败 |
| `subagent.batch.cancelled` | 子代理批次已取消 | Subagent batch cancelled | `result` | `none` | 聚合取消 |
| `subagent.task.queued` | `{name}` · 排队中 | `{name}` · Queued | `timeline-row` | `none` | 低透明度 |
| `subagent.task.running` | `{name}` · 工作中 | `{name}` · Working | `timeline-row` | `breath-dot` | 打开子会话 |
| `subagent.task.complete` | `{name}` · 已完成 | `{name}` · Completed | `result` | `none` | 静态完成 |
| `subagent.task.fail` | `{name}` · 失败 | `{name}` · Failed | `result` | `none` | 红色错误 |
| `subagent.task.cancelled` | `{name}` · 已取消 | `{name}` · Cancelled | `result` | `none` | 黄色静态 |
| `subagent.inspector.live` | 子代理输出中… | Subagent output streaming… | `inspector` | `text-shimmer` | 子会话 transcript |

单个子代理使用 `breath-dot`；多个并行子代理的父级批次使用 `pulse-block`。父级行只显示聚合状态，子会话完整内容在只读 Inspector 中查看。

### 4.3 代码工作行为

| ID | 中文 | English | 容器 | 进行中 | 完成 |
| --- | --- | --- | --- | --- | --- |
| `explore` | 正在探索 `{path}`… | Exploring `{path}`… | `group` | `text-shimmer` | `Explored {path}, {count} searches` |
| `search` | 正在搜索 `{query}`… | Searching `{query}`… | `timeline-row` | `text-shimmer` | `Searched {query}` |
| `read` | 正在读取 `{path}`… | Reading `{path}`… | `timeline-row` | `breath-dot` | `Read {path}` |
| `edit` | 正在修改 `{path}`… | Editing `{path}`… | `timeline-row` | `diff-in` | `Edited {path}` + 一次性 Diff 反馈 |
| `shell` | 正在运行 `{command}`… | Running `{command}`… | `timeline-row` | `cascade-ripple` | `Ran {command}` |
| `test` | 正在运行测试… | Running tests… | `timeline-row` | `solid-bars` | 测试结果 / 退出码 |
| `build` | 正在构建… | Building… | `timeline-row` | `cascade-ripple` | 构建结果 / 退出码 |
| `process` | 进程运行中… | Process running… | `timeline-row` | `solid-bars` | 退出码 / 终止状态 |
| `git` | 正在执行 Git… | Running Git… | `timeline-row` | `breath-dot` | Git 动作结果 |
| `tool.other` | 正在执行工具… | Running tool… | `timeline-row` | `breath-dot` | 原始工具详情，可展开 |

Explore 是 Search 的分组容器，不应重复显示大量图标。分组标题保持接近 Cursor 风格的单行文字：

```text
Exploring transcript-recorder.ts, 2 searches
```

### 4.4 外部能力

| ID | 中文 | English | 容器 | 动效 | 展开内容 |
| --- | --- | --- | --- | --- | --- |
| `mcp.server.connect` | 正在连接 MCP 服务器… | Connecting to MCP server… | `context-chip` | `breath-dot` | 服务器健康状态 |
| `mcp.server.status` | MCP 服务器状态 | MCP server status | `context-chip` | `none` | 运行中 / 已停止 / 错误 |
| `mcp.server.stop` | MCP 服务器已停止 | MCP server stopped | `result` | `none` | 静态停止 |
| `mcp.discovery` | 正在发现 MCP 工具… | Discovering MCP tools… | `timeline-row` | `breath-matrix` | search、describe、工具列表 |
| `mcp.call` | 调用 `{server}/{tool}` · `{summary}` › | Calling `{server}/{tool}` · `{summary}` › | `timeline-row` | `breath-dot` | Server、Tool、Input、Output |
| `mcp.call.done` | 已调用 `{server}/{tool}` | Called `{server}/{tool}` | `result` | `none` | 静态结果 |
| `mcp.call.error` | MCP 调用失败 · `{reason}` | MCP call failed · `{reason}` | `result` | `none` | 红色错误 |
| `web.search` | 正在搜索网页… | Searching the web… | `timeline-row` | `text-shimmer` | 查询、结果数量 |
| `web.fetch` | 正在读取网页… | Fetching page… | `timeline-row` | `breath-dot` | URL、摘要 |
| `browser` | 正在打开页面… | Opening page… | `timeline-row` | `breath-dot` | 页面标题、URL、操作 |

MCP 失败时使用静态错误状态：

```text
MCP 调用失败：{reason}
MCP call failed: {reason}
```

MCP 输入输出默认折叠，避免在行标题中直接倾倒原始 JSON。

MCP 不使用权限 Gate 动效。`mcp_gateway` 的 `search / describe / call / status` 由 Host 先归一化为 MCP 展示语义，Desktop 只消费 `ToolPresentation`，不解析 Pi 原始事件或 JSON。

### 4.5 Skill 与上下文资源

| ID | 中文 | English | 容器 | 动效 | 终态 |
| --- | --- | --- | --- | --- | --- |
| `skill.load` | 加载技能：`{name}`… | Loading skill: `{name}`… | `context-chip` | `breath-matrix` | 已加载 |
| `skill.use` | 使用技能：`{name}` | Using skill: `{name}` | `context-chip` | 静态来源胶囊 | 保留标签 |
| `skill.fail` | 技能加载失败：`{name}` | Skill failed to load: `{name}` | `result` | `none` | 静态错误 |
| `extension.load` | 加载扩展：`{name}`… | Loading extension: `{name}`… | `context-chip` | `breath-matrix` | 已加载 |

Skill 是上下文能力，不应伪装成普通 Tool。Skill 安装、启用、禁用属于设置页操作，不进入对话调用链。

### 4.6 生成与 Artifact

| ID | 中文 | English | 容器 | 动效 |
| --- | --- | --- | --- | --- |
| `artifact` | 正在生成界面… | Rendering artifact… | `timeline-row` | `artifact-sheen` |
| `image` | 正在生成图片… | Generating image… | `timeline-row` | `artifact-sheen` |
| `video` | 正在生成视频… | Generating video… | `timeline-row` | `artifact-sheen` |

Artifact 生成分为两个连续阶段：模型尚未输出可识别内容时，由全局
`RunActivitySlot` 表示等待首字；一旦识别到 SVG/HTML 围栏、但内容还不足以
安全渲染，就在原位置显示 `ArtifactFrame` 的 sheen preparing shell。首个安全
快照出现后，shell 原位切换为预览 iframe。Preparing 阶段不得提前挂载空 iframe，
并且在 `prefers-reduced-motion` 下停用循环动效、保留状态文案。

### 4.7 人机交互阻塞

| ID | 中文 | English | 容器 | 动效 |
| --- | --- | --- | --- | --- |
| `permission` | 等待你的确认 | Waiting for your approval | `gate` | `gate-pulse`，危险请求使用警示色 |
| `ask` | 等待你的回答 | Waiting for your answer | `gate` | `gate-pulse`，问题请求使用强调色 |

权限和提问状态不使用辐射风箱，改用边缘/状态脉冲，避免用户误以为 Agent 仍在后台运行。

## 5. 推荐显示顺序

```text
思考中…                         [Radial Bellow]

加载技能：code-review              [Breath Matrix]
正在制定计划…                    [Asterisk Breath]

委派给 Explorer                  [Pulse Block]
  Exploring transcript-recorder.ts, 2 searches

调用 MCP · github/search           [Breath Dot]
正在修改 src/parser.ts             [Breath Dot]
已修改 src/parser.ts               [Static Complete]
```

规则：

1. 同一时刻最多一个全局 `locator`。
2. 具体工具出现后，全局 `locator` 隐藏或降级为文字。
3. MCP 是外部工具行，Skill 是上下文标签，两者不共用同一种 UI。
4. Group 可以包含 Timeline Row，但 Timeline Row 不反向包含 Group。
5. 进行中允许循环动效，完成、失败、停止只使用一次性或静态反馈。
6. 所有动效遵守 `prefers-reduced-motion`，关闭动画后保留文字和状态颜色。

## 6. 当前代码边界

- MCP 已在 Host 侧 `ToolPresentation` 中拥有独立的 `mcp` 类型；直接工具和 `mcp_gateway` 的 `search / describe / call / status` 分别映射到 `mcp.call`、`mcp.discovery`、`mcp.server.status`。
- Subagent 的父级批次、子任务和 Inspector 使用独立行为 ID；父级只展示聚合，子会话内部继续复用普通工具行为。
- Skill 当前是资源加载与注入，不是普通 `tool-call`。V1 只对用户明确选择的 `/skill` 提交显示 `skill.load` / `skill.use` 芯片；安装、启用、禁用仍停留在设置页。未来若 Host 提供归一化资源活动事件，再扩展到自动注入的 Skill。
- 全局定位器的展示入口是 `RunActivitySlot` 与等待模型的 `TurnWorkDetails`。
- `TurnWorkDetails` 以 transcript turn 内的 `runId` 为展示所有权边界：同一运行即使
  因工具调用或 provider 重试产生多条 Assistant 生命周期消息，也只显示一份聚合的
  思考、工具与耗时；纯生命周期空行不单独占据 transcript 空间。
- 现有动效组件位于 `@piwin/ui-kit`，行为映射应与动效实现分离。

## 7. V1 已落地的代码入口

- `apps/desktop/src/behavior-activity.ts`：行为 ID 注册表、工具/运行状态归一化、文案与文字动效映射。
- `apps/desktop/src/agent-locator.tsx`：唯一轻量全局 Locator、Skill 上下文芯片；默认使用 `RadialBellow`。
- `apps/desktop/src/RunActivitySlot.tsx`、`turn-work-details.tsx`：接入运行定位器与 Skill 芯片，旧 `RunActivitySplash` 保持隐藏。
- `apps/desktop/src/transcript-turns.ts`、`chat-thread.tsx`：按 `runId` 聚合并只渲染一次 Turn Work，隐藏已被聚合的生命周期空行。
- `apps/desktop/src/ArtifactFrame.tsx`、`MarkdownView.tsx`：识别到未完整 SVG/HTML 围栏后显示 preparing sheen，首个安全快照到达后原位切换预览。
- `apps/desktop/src/tool-call-card.tsx`、`turn-tool-group.tsx`：MCP、Web、Search、Explore、Read、Edit、Shell、Git 等 Timeline 行绑定行为 ID、双语文字与 CSS 动效。
- `apps/desktop/src/settings/pages/animations-page.tsx`：定位器动效可选项，沿用桌面偏好持久化。
- `apps/desktop/src/styles/behavior-activity.css`：文字 shimmer、工具图标微动效、Gate/Artifact/Subagent/Skill 绑定，并遵守 reduced motion；当前文字 shimmer 为 3s，定位图案按文字 `em` 在 18–24px 间缩放。
