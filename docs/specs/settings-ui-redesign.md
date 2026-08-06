# Piwin 设置页 UI 重构 Spec

> 版本：v1.1  
> 状态：分阶段实施中
> 目标版本：@piwin/desktop next  
> 变更摘要（相对 v1.0）：锁定 Mantine 消费边界；收窄 Modal 范围；补齐导航合并文件与 deep-link redirect；补全 Switch 清单；统一 Tabs/Menu/Badge 策略；修正 token 示例与 Phase 顺序。

> 2026-08-06 已落地首批视觉壳层：设置页采用全窗口双栏导航；主区域使用唯一分类标题；页内分组改为扁平布局，移除重复页标题与大面积 section 卡片。

---

## 1. 背景与目标

### 1.1 背景

Piwin Desktop 的设置页目前存在以下问题：

- 多个页面使用手写的 `<span role="switch">` 作为开关，点击时伴随布局抖动。
- 页面布局松散、内联样式多、组件风格不统一。
- 部分导航项为占位页（规则、Subagent），功能单薄却占独立入口。
- 展示型/高级配置默认展开，视觉重心分散。
- 模型页存在交互 bug（添加请求头后视图跳走）和语义不清的图标（连接区的垃圾桶 = 删除整个提供商）。

### 1.2 目标

1. **通过 ui-kit 统一交互组件**：设置页业务代码只从 `@piwin/ui-kit` 取交互组件；Mantine 实现细节留在 ui-kit。
2. **保持 Piwin 品牌视觉**：继续使用暖珊瑚色 `--accent`、`--surface-raised`、圆角 token 等自定义主题。
3. **减少侧边栏导航项**：合并占位/弱功能页面，硬上限 ≤ 12。
4. **消除抖动**：所有开关使用 ui-kit `Switch`，折叠区域使用 ui-kit `Collapse`。
5. **表单/搜索单行化**：安装、搜索、筛选等操作在同一行完成（窄栏允许 wrap）。
6. **修复 bug**：模型页请求头添加不跳走、连接区删除操作语义清晰。

### 1.3 非目标（本 spec 明确不做）

- 不迁移设置页以外的全局弹窗（`app-dialogs.tsx`、`command-palette.tsx` 等）——见 §4.2。
- 不实现完整的 AGENTS.md 编辑器（规则区仍为 placeholder + 引导）。
- 不改 CLI / host 配置语义；仅 Desktop 设置 UI。
- 不引入 Electron 或其它壳层变更。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| ui-kit 优先 | 业务只 `import { … } from '@piwin/ui-kit'`。禁止 `apps/desktop` 直接 `import … from '@mantine/core'`。 |
| 已有原语复用 | Tabs → ui-kit `Tabs`（Radix）；菜单 → ui-kit `DropdownMenu`；徽标 → ui-kit `StatusBadge`；表单标签 → ui-kit `Field`。禁止同页混用 Mantine Tabs 与 ui-kit Tabs。 |
| 设计 token 优先 | 颜色、圆角、间距使用项目已有 CSS 变量，禁止硬编码色值/裸 px（50% 圆角等特殊值除外）。 |
| 单行表单 | 搜索/安装/筛选类操作尽量一行完成；窄内容区允许 `flex-wrap`，不得溢出裁切。 |
| 默认折叠 | 展示型和高级配置默认折叠，用户需要时再展开。 |
| 减少导航 | 侧边栏导航项硬上限 ≤ 12；合并后正好 12，新增入口需先合并或另开 ADR。 |

---

## 3. 技术前提与消费边界

### 3.1 现状

- `@mantine/core` / `@mantine/hooks` 仅作为 `packages/ui-kit` 的依赖（`^9.4.2`），经 `PiwinUiProvider` 接入主题。
- `apps/desktop` **不**依赖 `@mantine/core`；全仓 desktop 源码当前无 `@mantine/*` 直接引用。
- ui-kit 已封装：`Button`、`IconButton`、`Dialog`（Radix）、`ConfirmDialog`、`Tabs`（Radix）、`Field`、`DropdownMenu`、`StatusBadge`、`EmptyState`、`ListRow` 等。
- 缺少：`Switch`、`Collapse`、`Slider`、settings 编辑类 `Modal`。
- `PiwinUiProvider` 已预置 Mantine `Modal` 的 `defaultProps`（`radius: 'md'`, `centered: true`）。
- MCP UI 挂在 section id **`tools`**（`tools-page.tsx` → `McpPanel`），App 入口 `onOpenMcp → openSettings('tools')`。

### 3.2 Mantine 消费边界（强制）

| 层级 | 允许 |
|------|------|
| `packages/ui-kit` | 唯一可 `import` `@mantine/core` / `@mantine/hooks` 的包 |
| `apps/desktop` | **仅** `import { … } from '@piwin/ui-kit'`（及 `@piwin/*` 其它包） |
| CSS | 在 `packages/ui-kit/src/primitives.css` 用 Mantine 公开静态 class + Piwin token 做桥接覆盖 |

**禁止**：desktop 为图省事直接依赖 Mantine 布局原语（`Group`/`Stack`/`Card`/`Select` 等）。若需要布局原语：

1. **优先**：用现有 CSS class + `div`/`Field`/`ListRow`/`Surface`；或
2. **必要时**：在 ui-kit 增加薄封装再导出（例如 `Card`、`TextInput`、`SegmentedControl`、`Stack`/`Group`）。本 spec Phase 1 至少补齐下表「必做」项；布局原语可按页面需要增量补，但路径必须是 ui-kit 导出。

### 3.3 组件选型对照

| 需求 | 使用 | 不使用 |
|------|------|--------|
| 开关 | ui-kit `Switch`（新） | 手写 `role="switch"`、`.mcp-toggle` |
| 折叠 | ui-kit `Collapse`（新） | `{cond && …}` 导致布局跳变 |
| 滑块 | ui-kit `Slider`（新） | 原生 `<input type="range">` |
| 设置内编辑/添加弹窗 | ui-kit `Modal`（新，Mantine） | 继续堆 Radix `Dialog`（仅 settings 内迁移） |
| 危险确认 | 继续 ui-kit `ConfirmDialog`（本 spec **不**迁底座） | 另起 Mantine confirm |
| 分段控件 | ui-kit `SegmentedControl`（新，若外观/模型需要） | 手写 `.segmented-control`（可逐步替换） |
| 文本输入 | ui-kit `TextInput`/`PasswordInput`（新）+ 现有 `Field` 做 label | 裸 `<input style=…>` |
| 标签页 | **现有** ui-kit `Tabs` | Mantine `Tabs`（禁止双栈） |
| ⋮ 菜单 | **现有** ui-kit `DropdownMenu` | Mantine `Menu` |
| 状态/来源徽标 | **现有** ui-kit `StatusBadge` | Mantine `Badge`（除非 ui-kit 另包） |
| 空状态 | **现有** ui-kit `EmptyState` | 大区块居中占位 |
| 列表行容器 | ui-kit `Card`（新，可选）或 `.settings-list-card` | 彩色头像 + 杂乱 pill |

---

## 4. ui-kit 组件扩展清单

### 4.1 新增 / 扩展

| 组件 | 来源 | 说明 | 文件 | Phase |
|------|------|------|------|-------|
| `Switch` | `@mantine/core` Switch | 封装导出；`.piwin-switch`；支持 `label` / `aria-label` | `packages/ui-kit/src/switch.tsx` | 1 |
| `Collapse` | `@mantine/core` Collapse | 封装导出；控制展开动画 | `packages/ui-kit/src/collapse.tsx` | 1 |
| `Slider` | `@mantine/core` Slider | 包装工具调用密度等 | `packages/ui-kit/src/slider.tsx` | 1 |
| `Modal` | `@mantine/core` Modal | **仅** settings 编辑/添加类弹窗迁移用；API 尽量贴近现有 `Dialog` 的 `open` / `onOpenChange` / title | `packages/ui-kit/src/modal.tsx` | 1 |
| `TextInput` / `PasswordInput` | `@mantine/core` | 薄封装 + token 样式；与 `Field` 可组合 | `packages/ui-kit/src/text-input.tsx` 等 | 1 或随页面 |
| `SegmentedControl` | `@mantine/core` | 外观/模型提供商选择需要时 | `packages/ui-kit/src/segmented-control.tsx` | 随页面 |
| `Card` | `@mantine/core` 或纯 CSS | 列表项容器；若纯 CSS 能满足可不包 Mantine | `packages/ui-kit/src/card.tsx` 或仅 CSS | 随页面 |
| `Group` / `Stack` | 可选 | 仅当多页重复需要时再封装；否则用 CSS flex class | — | 按需 |

导出全部经 `packages/ui-kit/src/index.ts`。

### 4.2 Modal / Dialog 范围（收窄）

| 范围 | 决策 |
|------|------|
| **本 spec 迁移 → Modal** | 设置相关编辑/添加弹窗：`ProviderKeyManagerDialog`、`DiscoverModelsDialog`、`AddModelDialog`、`McpServerEditorDialog`、`ProviderSettings` 内添加提供商 Dialog |
| **本 spec 不迁** | `ConfirmDialog`（继续 Radix Dialog 底座）、`command-palette.tsx`、`app-dialogs.tsx`、全局非 settings 弹窗 |
| **过渡期** | settings 内可短暂存在 Modal + ConfirmDialog（Radix）双栈；**禁止** settings 内同一交互路径混用两套编辑弹窗 |
| **后续** | 全局 Dialog → Modal 另开 spec，不在本里程碑验收 |

`ConfirmDialog` 仍用于删除提供商、删除 MCP 服务器等危险确认。

### 4.3 样式覆盖要求

在 `packages/ui-kit/src/primitives.css` 延续现有模式：用 Mantine **公开静态 class** + CSS 变量桥接（参考已有 `.mantine-Button-root` / `.mantine-Input-input` 写法），**禁止**依赖生成 hash class。

```css
/* Switch — 颜色全部走 token；拇指用对比色 token，禁止 #fff */
.mantine-Switch-track {
  background: var(--faint);
}
.mantine-Switch-track[data-checked] {
  background: var(--accent);
}
.mantine-Switch-thumb {
  background: var(--surface-raised);
  border: none;
}

/* Slider */
.mantine-Slider-track {
  background: var(--surface-inset);
}
.mantine-Slider-bar {
  background: var(--accent);
}

/* Modal（若需要与 panel 对齐） */
.mantine-Modal-content {
  background: var(--panel);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-overlay);
}
```

类似地覆盖 `mantine-Card` / `mantine-Input` 等必要项。Mantine major 升级时集中改此文件。

---

## 5. 页面级重构方案

> 凡写「Mantine X」处，实现上均为 **ui-kit 导出的 X**（见 §3.2），下文简称组件名。

### 5.1 通用页（General）

**涉及文件**：

- `apps/desktop/src/settings/pages/general-page.tsx`
- `apps/desktop/src/RememberedPermissionsSection.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **在线模式切换**
   - 手写 span toggle → `Switch`
   - 保留 `FieldRow` 布局

2. **已记住的工具权限**
   - 决策：保留。
   - 使用 `Collapse` 包裹，标题为「已记住的工具权限」，默认 `opened={false}`。
   - 空状态用 `EmptyState` 或小字提示，不再大区域居中。

3. **Host 能力矩阵**
   - 使用 `Collapse`，默认 `opened={false}`。
   - 标题行：`Host 能力（高级）  当前模式 sdk  ▶`
   - 展开后保留现有 `capability-matrix-list` grid。

**验收**：打开时 Host 能力与记住权限默认折叠；在线模式用 `Switch`；typecheck / test 通过。

---

### 5.2 外观页（Appearance）

**涉及文件**：

- `apps/desktop/src/settings/pages/appearance-page.tsx`
- `apps/desktop/src/ThemePanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **排版与密度**
   - 分段控件 → `SegmentedControl`（ui-kit）；密度 → `Slider`；代码自动换行 → `Switch`。

2. **安装本地主题**
   - 单行内联（窄栏 wrap）：
     `[来源 ▼]  [ /path/to/my/theme ]  [安装]  [↻ 刷新]`
   - `Select`/`TextInput`/`Button`/`IconButton` 均从 ui-kit。
   - 刷新用 `IconButton`，降低视觉重量。
   - 主题列表使用统一列表卡片样式（与扩展/MCP 一致）。

**验收**：本地主题安装单行（或窄栏可 wrap）；工具密度用 `Slider`。

---

### 5.3 模型页（Models）

**涉及文件**：

- `apps/desktop/src/settings/pages/models-page.tsx`
- `apps/desktop/src/ProviderSettings.tsx`
- `apps/desktop/src/ProviderKeyManagerDialog.tsx`
- `apps/desktop/src/DiscoverModelsDialog.tsx`
- `apps/desktop/src/AddModelDialog.tsx`
- `apps/desktop/src/styles/settings-resources.css`（及 models 相关 region CSS）

**改动**：

1. **提供商选择**
   - 手写 `segmented-control` → ui-kit `SegmentedControl`，或 `Button` group；二选一保持一致即可。

2. **连接区「垃圾桶」**
   - 现状：标题栏 `IconButton` 调用 `handleDelete()`，删除的是 **整个提供商配置**，不是「断开连接」。
   - 移除标题栏垃圾桶图标。
   - 在提供商选择区 `DropdownMenu`（`⋯`）中提供明确文案：**「删除提供商」** / **「Delete provider」**（中英 locale）。
   - 仍走现有 `ConfirmDialog` 确认流。

3. **API 密钥 / 地址 / 请求头**
   - 输入统一 `TextInput` / `PasswordInput` + `Field`（或 `FieldRow`）。
   - 请求头行：flex 行 + `TextInput` + `IconButton`。

4. **设置内模型弹窗 → Modal**
   - `ProviderKeyManagerDialog`、`DiscoverModelsDialog`、`AddModelDialog`、添加提供商 Dialog → ui-kit `Modal`。
   - 弹窗内表单用 ui-kit 输入与 `Button`。

5. **添加请求头 bug（先根因，再修复）**
   - **不要**在未复现前锁死根因。已知更可疑点：
     - `headerRows.length > 0` 条件渲染导致列表从空到非空的布局跳变；
     - auto-save 后 `selectedProvider` effect 重置 `draft` 的竞态；
     - 滚动容器高度变化导致的 scroll jump。
   - ui-kit `Button` 默认已是 `type="button"`，form submit 可能性较低，仅作排查项。
   - 修复后：新增行自动聚焦第一个输入框；添加/删除请求头无视图跳走、无异常滚动。
   - PR notes 写明实际根因。

6. **模型目录**
   - 卡片统一列表样式；运行时限制编辑区用 `Collapse`。

**验收**：无标题栏垃圾桶；删除文案为「删除提供商」；请求头操作稳定；输入与弹窗按上表迁移。

---

### 5.4 规则页 → 合并到 Skills 页

**产品 rationale**：`rules` 页目前仅为 AGENTS.md placeholder，独立导航权重过高。Skills 同属「扩展 agent 能力/项目侧配置」心智，作为 **临时挂靠** 以减导航。完整规则编辑器若后续落地，可再评估迁到 General/Session 或恢复独立入口（需 ADR）。

**涉及文件**（导航相关见 §6.2 完整清单）：

- `apps/desktop/src/settings/pages/rules-page.tsx` → **删除**（或暂留 re-export 一版后删，不得残留注册）
- `apps/desktop/src/settings/pages/skills-page.tsx`
- `apps/desktop/src/SkillsPanel.tsx`
- `apps/desktop/src/desktop-locale.ts`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. 导航移除 `rules`（§6）。
2. `SkillsPanel` 底部新增「项目规则 (AGENTS.md)」折叠区（`Collapse`，默认收起）。
3. 内容保持 placeholder：说明在项目根创建/编辑 `AGENTS.md`。
4. Locale：删除 `settings.nav.rules`；在 skills 文案下增加 `rulesSectionTitle` / `rulesSectionDescription`。

**验收**：侧栏无「规则」；Skills 可展开项目规则；`openSettings('rules')` / 历史栈 redirect 到 `skills`（§6.3）。

---

### 5.5 Subagent 页 → 合并到 Automation 页

**产品 rationale**：`agents` 页为 beta 且与 Cron/Hooks 同属 system 自动化/代理编排入口。合并后用 **Tabs** 保 discoverability。Subagent 不是「定时任务」，但共享「后台/代理行为」设置空间；若后续产品线变重，可拆回独立 section（需 ADR）。

**涉及文件**：

- `apps/desktop/src/settings/pages/agents-page.tsx` → **删除**
- `apps/desktop/src/settings/pages/automation-page.tsx`
- `apps/desktop/src/SubAgentPanel.tsx`
- `apps/desktop/src/AutomationPanel.tsx`
- `apps/desktop/src/settings/settings-context.tsx`
- `apps/desktop/src/desktop-locale.ts`

**改动**：

1. 导航移除 `agents`（§6）。
2. Automation 页用 **ui-kit `Tabs`**（禁止 Mantine Tabs）组织：
   - Tab 1：定时任务 (Cron)
   - Tab 2：事件钩子 (Hooks)
   - Tab 3：Subagent
3. **Context API 明确保留**（不迁走、不改名）：
   - `requestSubAgent`
   - `activeSessionId`
   - `onOpenSubagentSession`
   - Automation / SubAgent 面板继续经 `useSettings()` 读取。
4. 保留 `SubAgentPanel` 表单能力；样式与 Automation 统一。
5. Locale：删除 `settings.nav.agents`；automation 下增加 `subAgentsTitle` / `subAgentsDescription`。
6. 显示名统一为 **Subagent**（中文可「Subagent」或既有「子代理」文案，与 locale 一致即可）。

**验收**：侧栏无独立 Subagent；Automation 三 Tab 可用；创建/列表 Subagent 功能正常；`openSettings('agents')` redirect 到 `automation`（可选 query/hash 打开 Subagent Tab）。

---

### 5.6 Skills 页

**涉及文件**：`SkillsPanel.tsx`、相关 CSS。

**改动**：

1. 列表项：统一卡片行 + `Switch` + 文案 + `StatusBadge`（来源）。
2. 外部路径映射：按钮组 + `Collapse` 展示结果，无布局抖动。
3. 手动安装：折叠区；展开后单行（可 wrap）`[来源] [路径] [安装]`。
4. 隐藏内容用 `Collapse` 或 CSS，避免 `{enabled && …}` 抽掉 DOM 导致抖动。

**验收**：Switch 无抖动；手动安装单行/可 wrap。

---

### 5.7 扩展页（Extensions）

**涉及文件**：`ExtensionsPanel.tsx`、相关 CSS。

**改动**：

1. 搜索 + 刷新同一行：`TextInput` + `IconButton`。
2. 列表：统一卡片；左名称/`StatusBadge`/描述，右 `Switch`。
3. 手动安装：同 Skills 模式。
4. 删除堆叠按钮、重复标题、多余分隔；加载/空状态统一 class 或 `EmptyState`/`Spinner`。

**验收**：与 Skills / MCP（tools）视觉一致；搜索/刷新/安装/开关无抖动。

---

### 5.8 工具 / MCP 页（section id: `tools`）

> 侧栏文案为「工具」；实现为 `ToolsPage` → `McpPanel`。下文「MCP」均指该 section。

**涉及文件**：

- `apps/desktop/src/settings/pages/tools-page.tsx`
- `apps/desktop/src/McpPanel.tsx`
- `apps/desktop/src/McpServerEditorDialog.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. 服务器列表：统一卡片；左状态 dot + 名称（禁用 muted/`StatusBadge`）；右 `Switch` + `DropdownMenu`（编辑/重新加载/删除）。
2. 移除彩色头像和状态 pill。
3. 开关 → `Switch`。
4. `McpServerEditorDialog`：`Dialog` → ui-kit `Modal`；表单用 ui-kit 输入；**页内分区 Tabs 继续用 ui-kit `Tabs`**。
5. 市场：搜索 + 刷新同行；卡片统一。

**验收**：列表视觉统一、无抖动；编辑弹窗为 Modal；删除仍走 `ConfirmDialog`。

---

### 5.9 记忆页（Memory）

**涉及文件**：`MemoryPanel.tsx`、相关 CSS。

**改动**：

1. 启用/注入概览 → `Switch`；关联内容 `Collapse`。
2. 搜索行：`[搜索] [搜索按钮] [重置]`；列表统一卡片。
3. 启用切换不条件卸载主内容。

**验收**：切换无抖动；列表风格统一。

---

### 5.10 自动化页（Automation）

**涉及文件**：`AutomationPanel.tsx`、`automation-page.tsx`、相关 CSS。

**改动**：

1. 启用自动化 → `Switch`；Cron/Hooks 列表区按需 `Collapse`。
2. 列表统一卡片；操作 `Button` / `IconButton`。
3. 合并 Subagent：见 §5.5。

**验收**：启用切换无抖动；三 Tab 结构清晰。

---

### 5.11 会话页（Session）— 范围收窄

**涉及文件**：`session-page.tsx`。

**本 spec 仅要求**：手写 toggle → `Switch`；若有条件渲染导致抖动则改 `Collapse`。  
不做大改版布局（非目标）。

---

### 5.12 提示词页（Prompts）— 补入 Switch 清单

**涉及文件**：`PromptsPanel.tsx`。

**本 spec 要求**：

- 手写 `role="switch"` → ui-kit `Switch`（**必须**，否则全局验收失败）。
- 可选：列表卡片与其它页对齐（非阻塞，可放 Phase 5 顺手做）。

---

### 5.13 未改版页面

| Section | 本 spec |
|---------|---------|
| `web` | 不强制视觉重构；无手写 switch 则不动 |
| `pets` | 同上 |
| `session` | 仅 Switch（§5.11） |
| `prompts` | 至少 Switch（§5.12） |

---

## 6. 导航结构调整

### 6.1 侧边栏变更

| 当前 | 新状态 |
|------|--------|
| 通用 (general) | 保留 |
| 外观 (appearance) | 保留 |
| 模型 (models) | 保留 |
| 会话 (session) | 保留 |
| 记忆 (memory) | 保留 |
| 规则 (rules) | **移除** → Skills 内折叠区 |
| Skills (skills) | 保留（+ 项目规则） |
| Web 工具 (web) | 保留 |
| 工具 (tools) | 保留（MCP = 本页） |
| 扩展 (extensions) | 保留 |
| 提示词模板 (prompts) | 保留 |
| 自动化 (automation) | 保留（+ Subagent Tab） |
| Subagent (agents) | **移除** → Automation Tab |
| 伙伴 (pets) | 保留 |

合并后 **12** 项（= 硬上限）。

### 6.2 文件变更清单（完整）

| 文件 | 变更 |
|------|------|
| `settings/section-registry.ts` | 从 `SettingsSectionId` / `SETTINGS_SECTIONS` 移除 `rules`、`agents` |
| `settings/pages/index.ts` | 取消 `RulesPage` / `AgentsPage` 注册 |
| `settings/pages/rules-page.tsx` | 删除 |
| `settings/pages/agents-page.tsx` | 删除 |
| `settings/settings-shell.tsx` | 更新 `SECTION_ICONS`（去掉 rules/agents 键）——**必须改** |
| `shell-navigation.ts` | `ShellSettingsSection` 去掉 `rules`/`agents`；见 redirect |
| `hooks/use-shell-layout.ts` 及 `App.tsx` 相关类型 | 随 `ShellSettingsSection` 更新 |
| `desktop-locale.ts` | nav 文案与类型；skills/automation 子文案 |
| `settings/section-registry.test.ts` | 枚举 id 列表更新 |
| `settings/settings-shell.test.tsx` | 默认 section 不再用 `'rules'`；去掉 `settings-rules-empty` 断言或改测 Skills 规则区 |
| 其它 e2e / 引用 `rules`/`agents` section 的测试 | 同步 |

### 6.3 Deep link / 历史栈兼容

提供集中映射（建议放在 `section-registry.ts` 或 `shell-navigation.ts` 旁）：

```ts
/** Legacy section ids that no longer exist as nav entries. */
const SETTINGS_SECTION_REDIRECTS: Record<string, SettingsSectionId> = {
  rules: 'skills',
  agents: 'automation',
};
```

行为要求：

1. 任何 `openSettings` / `setSettingsSection` / 恢复 shell 栈时，若 section 为 legacy id，**静默 redirect** 到上表目标。
2. `isSettingsSectionId` **不**再接受 `rules`/`agents` 为合法 id；redirect 发生在校验前的规范化步骤。
3. 可选：redirect 到 `automation` 时默认选中 Subagent Tab（若实现成本低）。
4. 单元测试覆盖：legacy id → 目标 id；合法 id 不变。

---

## 7. 样式与 token 规范

### 7.1 必须使用 token

新增/重构 CSS **禁止**硬编码色值与随意裸 px：

| 属性 | Token |
|------|-------|
| 颜色 | `--text`、`--muted`、`--faint`、`--accent`、`--ok`、`--danger`、`--surface-raised`、`--surface-inset`、`--line-soft`、`--line-strong`、`--border`、`--panel`、`--content-on-accent` 等 |
| 圆角 | `--radius-sm`、`--radius`、`--radius-surface`、`--radius-control`、`--radius-overlay` |
| 间距 | `--space-1` ~ `--space-8` |
| 动效 | `--motion-quick`、`--motion-standard`、`--motion-ease` |

特例：圆形指示点可用 `border-radius: 50%`。

### 7.2 列表卡片通用样式

```css
.settings-list-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-3);
  background: var(--surface-raised);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-surface);
  transition: border-color var(--motion-quick) var(--motion-ease);
}
.settings-list-card:hover {
  border-color: var(--line-strong);
}
```

### 7.3 窄栏表单

单行工具条使用 flex + `flex-wrap: wrap` + `gap: var(--space-2)`；最小输入宽度避免压扁到不可用。

### 7.4 无障碍（最低要求）

- 每个 `Switch` 有可见 label 或 `aria-label`。
- `Collapse` 标题为可聚焦按钮，`aria-expanded` 正确。
- `Modal` 焦点陷阱与 Esc 关闭与现有 Dialog 行为一致。
- `IconButton` 必有 `label`（已有约定，不弱化）。

---

## 8. 实施阶段

### Phase 1：ui-kit 基础设施（1–2 天）

1. 新增 `Switch`、`Collapse`、`Slider`、`Modal`（settings 编辑弹窗用）。
2. 按需新增 `TextInput`/`PasswordInput`/`SegmentedControl`/`Card`（可与首个消费页同 PR）。
3. `primitives.css` 覆盖 + token 桥接（无硬编码 `#fff`）。
4. `index.ts` 导出。
5. `pnpm --filter @piwin/ui-kit typecheck && test`。

### Phase 2：替换全部手写 Switch + 消抖（1 天）

完整清单（与 §9.1 验收对齐，**不得遗漏**）：

| 文件 |
|------|
| `McpPanel.tsx` |
| `SkillsPanel.tsx` |
| `AutomationPanel.tsx` |
| `MemoryPanel.tsx` |
| `ExtensionsPanel.tsx` |
| `PromptsPanel.tsx` |
| `settings/pages/general-page.tsx` |
| `settings/pages/session-page.tsx` |
| `settings/pages/appearance-page.tsx` |

全部改为 `Switch from '@piwin/ui-kit'`；关联内容用 `Collapse`/CSS 避免抖动。  
完成后全仓搜索 `role="switch"` / `mcp-toggle` 应为 0（测试 fixture 除外，若有则注明）。

### Phase 3：模型页 bug + 删除语义（0.5–1 天）

1. Repro 添加请求头跳走 → 修根因 → 写 PR notes。
2. 移除连接区垃圾桶；`DropdownMenu`「删除提供商」+ `ConfirmDialog`。

### Phase 4：导航合并 + redirect（1 天）

1. 规则 → Skills 折叠区；Subagent → Automation Tab。
2. §6.2 全部文件；§6.3 redirect + 测试。
3. 删除 `rules-page.tsx` / `agents-page.tsx`。

### Phase 5：页面重排与设置内 Modal 化（2–3 天）

1. General：折叠区。
2. Appearance：单行安装、Slider/SegmentedControl。
3. Extensions / Skills：列表与手动安装。
4. Tools（MCP）：列表 + `McpServerEditorDialog` → Modal。
5. Models：输入统一 + 相关 Dialog → Modal。
6. Memory / Automation：列表与 Tabs 打磨。
7. Prompts：若 Phase 2 只换了 Switch，本阶段可顺手统一卡片（可选）。

### Phase 6：回归与视觉验收（0.5–1 天）

1. `pnpm typecheck`
2. `pnpm --filter @piwin/desktop test`（及 ui-kit test）
3. 若有 Playwright 覆盖 settings，更新选择器/用例
4. 手动过一遍 12 个 section + 折叠/开关/窄栏 wrap
5. 抽查键盘：Switch、Collapse、Modal 焦点

---

## 9. 验收标准

### 9.1 全局

- [ ] `pnpm typecheck` 0 错误。
- [ ] `pnpm --filter @piwin/ui-kit test` 与 `pnpm --filter @piwin/desktop test` 通过。
- [ ] `apps/desktop` 无 `@mantine/core` / `@mantine/hooks` 直接 import。
- [ ] 全项目（desktop）搜索手写 `role="switch"`、`mcp-toggle` 无残留（测试除外需注释原因）。
- [ ] 本 spec 新增 CSS 无硬编码色值；间距/圆角走 token。
- [ ] 设置侧栏导航项 **= 12**（≤ 12 硬上限）。
- [ ] legacy `rules` / `agents` redirect 有单测。

### 9.2 页面

- [ ] **General**：Host 能力、记住权限默认折叠；在线模式 `Switch`。
- [ ] **Appearance**：本地主题单行/可 wrap；工具密度 `Slider`。
- [ ] **Models**：请求头不跳走；无标题栏垃圾桶；删除文案为「删除提供商」；设置内编辑弹窗为 `Modal`。
- [ ] **Skills**：项目规则折叠区；列表 `Switch`。
- [ ] **Automation**：Cron / Hooks / Subagent 三 Tab（ui-kit Tabs）；Subagent 功能正常。
- [ ] **Extensions**：搜索刷新同行；卡片 + `Switch`；手动安装。
- [ ] **Tools（MCP）**：无彩色头像/状态 pill；编辑弹窗 `Modal`；删除走 `ConfirmDialog`。
- [ ] **Memory**：启用/注入 `Switch`；搜索列表统一。
- [ ] **Session / Prompts**：手写 switch 已替换。

### 9.3 体验 / a11y

- [ ] 开关点击无可见抖动。
- [ ] 折叠/展开动画平滑。
- [ ] 输入聚焦高亮与 Piwin token 一致（`--accent` 边框类）。
- [ ] 卡片 hover 一致。
- [ ] Switch / IconButton / Modal 满足 §7.4。

---

## 10. 决策确认

| 事项 | 决策 |
|------|------|
| Mantine 消费边界 | **仅 ui-kit** import Mantine；desktop 只消费 `@piwin/ui-kit` |
| Tabs / Menu / Badge | **继续 ui-kit**（Radix Tabs、DropdownMenu、StatusBadge）；禁止 settings 内 Mantine 双栈 |
| 已记住的工具权限 | **保留**，折叠到通用页 |
| 规则合并 | 挂到 **Skills** 折叠区（临时 IA；完整编辑器另议） |
| Subagent 合并 | 显示名 **Subagent**，并入 **Automation** 第三 Tab；**保留** context 上的 `requestSubAgent` 等 API |
| 设置内编辑弹窗 | → ui-kit **Modal**（Mantine） |
| Confirm / 全局弹窗 | **不迁**；仍用 `ConfirmDialog` / 现有 Dialog |
| 连接区垃圾桶 | 移除；改为菜单项 **「删除提供商」** |
| 导航上限 | **≤ 12**（合并后 = 12） |
| legacy section | `rules`→`skills`，`agents`→`automation` |

---

## 11. 风险与回退

| 风险 | 缓解 |
|------|------|
| Mantine 升级导致 class 失效 | 覆盖集中在 `primitives.css`；只用公开静态 class + CSS 变量；major 升级单 PR 修 |
| 覆盖过多难维护 | 只桥颜色/圆角/间距；不改 Mantine 布局算法 |
| 用户找不到规则 / Subagent | redirect + Skills/Automation 内标题文案；单测 legacy id |
| settings 内 Modal 与 ConfirmDialog 双栈 | 接受短期；交互路径不混用；全局统一另开 spec |
| 模型请求头 bug 根因误判 | Phase 3 强制 repro + 写清根因再合 |
| 测试与 snapshot 大变 | 预期更新；PR 说明；shell/registry 测试必改 |
| 窄栏单行表单溢出 | `flex-wrap` + 最小宽度；手动验收窄窗 |
| 误在 desktop 引入 Mantine | CI/review 检查 import；§9.1 硬验收 |

**回退**：按 Phase 分 PR；Phase 4 导航合并可独立回滚（恢复 section + 页面文件）；ui-kit 新组件可先合并但 desktop 未引用时无行为变化。

---

## 12. 附录：建议替换清单

| 当前 | 替换为（均经 ui-kit） | 说明 |
|------|----------------------|------|
| `<span role="switch">` + `.mcp-toggle` | `Switch` | 消抖 + a11y |
| `{enabled && (…)}` 抽掉大块 DOM | `Collapse` 或 CSS | 平滑显隐 |
| 手写 segmented-control | `SegmentedControl` | 可选逐步替换 |
| 原生 `<input type="range">` | `Slider` | 样式统一 |
| 手写 `<input style=…>` | `TextInput` + `Field` | focus / label |
| 手写列表项 + 彩头像 | `.settings-list-card` / `Card` + `StatusBadge` | 统一 |
| 内联 `style={{…}}` | CSS class + token | 减硬编码 |
| 手写 `⋮` | `DropdownMenu` | 已有 |
| 设置内 Radix `Dialog`（编辑/添加） | `Modal` | 见 §4.2 |
| 空状态大区块 | `EmptyState` 或卡片内小字 | 减噪音 |

---

## 13. 修订历史

| 版本 | 说明 |
|------|------|
| v1.0 | 初稿 |
| v1.1 | 评审修订：import 边界、Modal 范围、导航文件与 redirect、Prompts/Session 清单、Tabs/Menu 策略、token 示例、Phase 顺序、产品 rationale、a11y/窄栏 |
|
