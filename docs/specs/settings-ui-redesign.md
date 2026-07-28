# Piwin 设置页 UI 重构 Spec

> 版本：v1.0  
> 状态：待审批  
> 目标版本：@piwin/desktop next  

---

## 1. 背景与目标

### 1.1 背景

Piwin Desktop 的设置页目前存在以下问题：

- 多个页面使用手写的 `<span role="switch">` 作为开关，点击时伴随布局抖动。
- 页面布局松散、内联样式多、组件风格不统一。
- 部分导航项为占位页（规则、Subagent），功能单薄却占独立入口。
- 展示型/高级配置默认展开，视觉重心分散。
- 模型页存在交互 bug（添加请求头后视图跳走）和语义不清的图标（连接区的垃圾桶）。

### 1.2 目标

1. **统一使用 Mantine 组件**：能用 Mantine 的尽量替换手写组件，复用成熟的无障碍和动效能力。
2. **保持 Piwin 品牌视觉**：继续使用暖珊瑚色 `--accent`、`--surface-raised`、圆角 token 等自定义主题。
3. **减少侧边栏导航项**：合并占位/弱功能页面。
4. **消除抖动**：所有开关使用真实 `Switch`，折叠区域使用 `Collapse`。
5. **表单/搜索单行化**：安装、搜索、筛选等操作在同一行完成。
6. **修复 bug**：模型页请求头添加不跳走、连接区图标语义清晰。

---

## 2. 设计原则

| 原则 | 说明 |
|------|------|
| Mantine 优先 | 新增/重构的交互组件优先使用 `@mantine/core` 的 `Switch`、`Collapse`、`Slider`、`TextInput`、`Button`、`ActionIcon`、`Group`、`Stack`、`Card`、`Select` 等。 |
| 设计 token 优先 | 颜色、圆角、间距使用项目已有 CSS 变量，不使用硬编码值。 |
| 单行表单 | 搜索/安装/筛选类操作尽量 `Group` 一行完成，减少垂直堆叠。 |
| 默认折叠 | 展示型和高级配置默认折叠，用户需要时再展开。 |
| 减少导航 | 侧边栏导航项控制在 12 项以内，占位页合并。 |

---

## 3. 技术前提

- 项目已安装 `@mantine/core` 9.4.2，并通过 `PiwinUiProvider` 接入主题。
- `ui-kit` 已封装 `Button`、`IconButton`、`Dialog`、`Tabs`、`Field` 等，但缺少 `Switch`、`Collapse`、`Slider`、`Card`、`Modal` 等。重构后所有弹窗统一改用 Mantine `Modal`。
- 当前 `ui-kit` 对 Mantine 的包装策略：保持统一默认 props 和 CSS class，业务代码只 `import { X } from '@piwin/ui-kit'`。

---

## 4. ui-kit 组件扩展清单

在 `packages/ui-kit` 中新增/扩展以下组件，供 desktop 统一使用：

| 组件 | 来源 | 说明 | 文件 |
|------|------|------|------|
| `Switch` | `@mantine/core/Switch` | 封装后导出，应用 `.piwin-switch` class | `packages/ui-kit/src/switch.tsx` |
| `Collapse` | `@mantine/core/Collapse` | 封装后导出 | `packages/ui-kit/src/collapse.tsx` |
| `Modal` | `@mantine/core/Modal` | 弹窗统一改用 Mantine Modal | `packages/ui-kit/src/modal.tsx` |
| `Slider` | `@mantine/core/Slider` | 包装工具调用密度滑块 | `packages/ui-kit/src/slider.tsx` |
| `TextInput` | `@mantine/core/TextInput` | 可选包装，统一 `.mantine-TextInput-input` 覆盖样式 | 不新增文件，直接使用 |
| `ActionIcon` | `@mantine/core/ActionIcon` | 已可用，通过 `IconButton` 补足 | 现有 |
| `Group` / `Stack` | `@mantine/core` | 布局组件，不新增 ui-kit 文件，业务直接使用 | - |
| `Card` / `Paper` | `@mantine/core` | 列表项容器，业务直接使用并通过 CSS 覆盖 | - |

### 4.1 样式覆盖要求

在 `packages/ui-kit/src/primitives.css` 中新增 Mantine 组件样式覆盖，使其匹配 Piwin token：

```css
.mantine-Switch-track {
  background: var(--faint);
}
.mantine-Switch-track[data-checked] {
  background: var(--accent);
}
.mantine-Switch-thumb {
  background: #fff;
  border: none;
}
```

类似地覆盖 `mantine-Collapse`、`mantine-Slider`、`mantine-Card` 等必要样式。

---

## 5. 页面级重构方案

### 5.1 通用页（General）

**涉及文件**：
- `apps/desktop/src/settings/pages/general-page.tsx`
- `apps/desktop/src/RememberedPermissionsSection.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **在线模式切换**
   - 手写 span toggle → `Switch from '@piwin/ui-kit'`
   - 保留 `FieldRow` 布局

2. **已记住的工具权限**
   - 决策：保留。
   - 使用 Mantine `Collapse` 包裹，标题为“已记住的工具权限”，默认 `opened={false}`。
   - 空状态时显示小字提示，不再大区域居中。

3. **Host 能力矩阵**
   - 使用 Mantine `Collapse` 折叠，默认 `opened={false}`。
   - 标题行显示：`Host 能力（高级）  当前模式 sdk  ▶`
   - 展开后保留现有 `capability-matrix-list` grid。

**验收标准**：
- [ ] 通用页打开时 Host 能力矩阵和记住权限默认折叠。
- [ ] 在线模式使用 Mantine Switch。
- [ ] typecheck / test 通过。

---

### 5.2 外观页（Appearance）

**涉及文件**：
- `apps/desktop/src/settings/pages/appearance-page.tsx`
- `apps/desktop/src/ThemePanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **排版与密度**
   - 所有分段控件和滑块使用 Mantine `SegmentedControl` 和 `Slider`。
   - 代码自动换行使用 Mantine `Switch`。

2. **安装本地主题**
   - 改为单行内联表单：
     `[来源 ▼]  [ /path/to/my/theme            ]  [安装]  [↻ 刷新]`
   - 使用 Mantine `Group`、`Select`、`TextInput`、`Button`、`ActionIcon`。
   - 刷新按钮使用 `ActionIcon`，降低视觉重量。
   - 主题列表使用 `Card` 容器，与扩展/MCP 风格一致。

**验收标准**：
- [ ] 本地主题安装为单行布局。
- [ ] 工具调用密度使用 Mantine Slider。
- [ ] typecheck / test 通过。

---

### 5.3 模型页（Models）

**涉及文件**：
- `apps/desktop/src/settings/pages/models-page.tsx`
- `apps/desktop/src/ProviderSettings.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **提供商选择**
   - 当前手写的 `segmented-control` 替换为 Mantine `SegmentedControl` 或保留自定义但用 Mantine Button group。

2. **连接区垃圾桶图标**
   - 移除“连接”标题栏右侧的垃圾桶 `IconButton`。
   - 在提供商卡片标题或提供商 tab 的 `⋯` 菜单中提供“删除配置”。
   - 或改为文字按钮“断开连接”/“删除”，使用 Mantine `Button`/`Menu`。

3. **API 密钥 / 地址 / 请求头**
   - 输入框统一使用 Mantine `TextInput` 或 `PasswordInput`。
   - 请求头行使用 Mantine `Group` + `TextInput` + `ActionIcon`。

4. **添加请求头 bug**
   - 修复点击“+ 添加请求头”后视图跳走的问题。
   - 若根因是 Mantine Button 在 form 内触发提交，显式设置 `type="button"`。
   - 若根因是列表新增后布局抖动导致滚动偏移，使用 `Collapse` 平滑展开新行。
   - 新增行自动聚焦第一个输入框。

5. **模型目录**
   - 模型卡片使用 Mantine `Card`。
   - 运行时限制编辑区使用 Mantine `Collapse`。

**验收标准**：
- [ ] 连接区无垃圾桶图标，删除操作语义清晰。
- [ ] 添加/删除请求头不导致视图跳走或滚动。
- [ ] 输入框统一使用 Mantine 组件。
- [ ] typecheck / test 通过。

---

### 5.4 规则页 → 合并到 Skills 页

**涉及文件**：
- `apps/desktop/src/settings/section-registry.ts`
- `apps/desktop/src/settings/pages/index.ts`
- `apps/desktop/src/settings/pages/rules-page.tsx`
- `apps/desktop/src/settings/pages/skills-page.tsx`
- `apps/desktop/src/SkillsPanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`
- `apps/desktop/src/desktop-locale.ts`

**改动**：

1. **导航调整**
   - `section-registry.ts` 中移除 `rules` 条目。
   - `pages/index.ts` 中移除 `RulesPage` 注册。

2. **Skills 页增加项目规则区域**
   - 在 `SkillsPanel` 底部新增“项目规则 (AGENTS.md)”折叠区。
   - 使用 Mantine `Collapse`。
   - 内容保持 placeholder：说明可在项目根目录创建 `AGENTS.md`。

3. **Locale 更新**
   - 删除 `settings.nav.rules` 独立文案。
   - 在 `skills` 文案下新增 `rulesSectionTitle` / `rulesSectionDescription`。

**验收标准**：
- [ ] 侧边栏不再显示“规则”。
- [ ] Skills 页可展开/收起项目规则区。
- [ ] typecheck / test 通过。

---

### 5.5 子代理页 → 合并到自动化页

**涉及文件**：
- `apps/desktop/src/settings/section-registry.ts`
- `apps/desktop/src/settings/pages/index.ts`
- `apps/desktop/src/settings/pages/agents-page.tsx`
- `apps/desktop/src/settings/pages/automation-page.tsx`
- `apps/desktop/src/SubAgentPanel.tsx`
- `apps/desktop/src/AutomationPanel.tsx`
- `apps/desktop/src/settings/settings-context.tsx`
- `apps/desktop/src/desktop-locale.ts`

**改动**：

1. **导航调整**
   - `section-registry.ts` 中移除 `agents` 条目。
   - `pages/index.ts` 中移除 `AgentsPage` 注册。

2. **Automation 页增加子代理区**
   - 使用 Mantine `Tabs` 或 `Collapse` 组织：
     - Tab/区 1：定时任务 (Cron)
     - Tab/区 2：事件钩子 (Hooks)
     - Tab/区 3：子代理
   - 保留 `SubAgentPanel` 表单，但样式与自动化统一。

3. **Context 调整**
   - 确认 `requestSubAgent` 是否继续由 settings context 提供，或迁移给 AutomationPage。

4. **Locale 更新**
   - 删除 `settings.nav.agents` 独立文案。
   - 在 `automation` 文案下新增 `subAgentsTitle` / `subAgentsDescription`。

**验收标准**：
- [ ] 侧边栏不再显示“子代理”。
- [ ] 自动化页包含 Cron、Hooks、子代理三块内容。
- [ ] 子代理创建表单功能正常。
- [ ] typecheck / test 通过。

---

### 5.6 Skills 页

**涉及文件**：
- `apps/desktop/src/SkillsPanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **技能列表**
   - 每项使用 Mantine `Card` 或保留 `.ext-list-item` 但统一为 `Switch` + `Text` + `Badge`。
   - 手写 span toggle 全部替换为 `Switch`。

2. **外部路径映射**
   - 映射按钮使用 Mantine `Button.Group` 或 `Group`。
   - 点击后不引起布局抖动，使用 `Collapse` 展开/收起映射结果。

3. **手动安装**
   - 折叠为“手动安装”区域。
   - 展开后单行：`[来源 ▼] [路径...] [安装]`，使用 Mantine `Select`、`TextInput`、`Button`。

4. **抖动修复**
   - 切换状态不触发条件渲染，所有隐藏内容使用 `display: none` 或 `Collapse`。

**验收标准**：
- [ ] Skills 列表使用 Mantine Switch，点击无抖动。
- [ ] 手动安装为单行表单。
- [ ] typecheck / test 通过。

---

### 5.7 扩展页（Extensions）

**涉及文件**：
- `apps/desktop/src/ExtensionsPanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **搜索 + 刷新**
   - 同一行：`[搜索输入                    ] [刷新]`
   - 使用 Mantine `TextInput` + `ActionIcon`。

2. **扩展列表**
   - 每项使用 Mantine `Card`。
   - 左侧：名称 + `Badge`（source）+ 描述。
   - 右侧：`Switch`。
   - 与 MCP / Skills 视觉一致。

3. **手动安装**
   - 折叠为“手动安装”区域。
   - 展开后单行：`[来源 ▼] [路径...] [安装]`。

4. **移除冗余**
   - 删除堆叠按钮、重复标题、不必要分隔。
   - 加载/空状态统一为 `.mcp-loading-state` / `.mcp-empty-inline` 或通用类。

**验收标准**：
- [ ] 扩展页风格与 MCP / Skills 一致。
- [ ] 搜索、刷新、安装、开关无抖动。
- [ ] typecheck / test 通过。

---

### 5.8 MCP 页

**涉及文件**：
- `apps/desktop/src/McpPanel.tsx`
- `apps/desktop/src/McpServerEditorDialog.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **服务器列表**
   - 每项使用 Mantine `Card`。
   - 左侧：状态 dot + 名称（禁用显示 muted badge）。
   - 右侧：`Switch` + `Menu`（编辑/重新加载/删除）。
   - 移除彩色头像和状态 pill。

2. **开关**
   - 替换为 Mantine `Switch`。

3. **编辑弹窗**
   - 继续使用现有 `Dialog` 或迁移到 Mantine `Modal`。
   - 表单使用 Mantine `TextInput`、`Textarea`、`Tabs`、`Group`、`Button`。
   - 移除内联样式。

4. **市场**
   - 搜索 + 刷新同一行。
   - 卡片使用 Mantine `Card`。

**验收标准**：
- [ ] MCP 服务器列表视觉统一、无抖动。
- [ ] 编辑弹窗使用 Mantine 表单组件。
- [ ] typecheck / test 通过。

---

### 5.9 记忆页（Memory）

**涉及文件**：
- `apps/desktop/src/MemoryPanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **启用/注入概览**
   - 手写 toggle → Mantine `Switch`。
   - 折叠内容使用 Mantine `Collapse`。

2. **搜索/记录列表**
   - 搜索行：`[搜索输入    ] [搜索] [重置]`，使用 Mantine `TextInput` + `Button`。
   - 记录列表使用 Mantine `Card` 或统一 list 样式。

3. **抖动修复**
   - 启用/禁用时不条件渲染，使用 `Collapse` 控制显示。

**验收标准**：
- [ ] Memory 切换无抖动。
- [ ] 记录列表风格统一。
- [ ] typecheck / test 通过。

---

### 5.10 自动化页（Automation）

**涉及文件**：
- `apps/desktop/src/AutomationPanel.tsx`
- `apps/desktop/src/styles/settings-resources.css`

**改动**：

1. **启用自动化**
   - 手写 toggle → Mantine `Switch`。
   - Cron 列表和 Hooks 列表使用 `Collapse` 包裹。

2. **定时任务 / 事件钩子**
   - 列表使用 Mantine `Card`。
   - 操作按钮使用 Mantine `Button` / `ActionIcon`。

3. **合并子代理**
   - 见 5.5。

**验收标准**：
- [ ] Automation 启用切换无抖动。
- [ ] Cron / Hooks / 子代理三区结构清晰。
- [ ] typecheck / test 通过。

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
| 规则 (rules) | **移除**，合并到 Skills |
| Skills (skills) | 保留（新增项目规则区） |
| Web 工具 (web) | 保留 |
| 工具 (tools) | 保留 |
| 扩展 (extensions) | 保留 |
| 提示词模板 (prompts) | 保留 |
| 自动化 (automation) | 保留（新增子代理区） |
| 子代理 (agents) | **移除**，合并到 Automation |
| 伙伴 (pets) | 保留 |

### 6.2 文件变更

- `section-registry.ts`：移除 `rules`、`agents` 条目。
- `pages/index.ts`：移除 `RulesPage`、`AgentsPage` 注册。
- `settings-shell.tsx`：无需改动，导航由 registry 驱动。

---

## 7. 样式与 token 规范

### 7.1 必须使用 token

所有新增/重构 CSS 禁止使用硬编码值：

| 属性 | Token |
|------|-------|
| 颜色 | `--text`、`--muted`、`--faint`、`--accent`、`--ok`、`--danger`、`--surface-raised`、`--surface-inset`、`--line-soft`、`--border` |
| 圆角 | `--radius-sm`、`--radius`、`--radius-surface`、`--radius-control`、`--radius-overlay` |
| 间距 | `--space-1` ~ `--space-8` |
| 动效 | `--motion-quick`、`--motion-standard`、`--motion-ease` |

### 7.2 Mantine 组件覆盖示例

```css
/* Switch */
.mantine-Switch-track {
  background: var(--faint);
}
.mantine-Switch-track[data-checked] {
  background: var(--accent);
}
.mantine-Switch-thumb {
  background: #fff;
  border: none;
}

/* Card */
.mantine-Card-root {
  background: var(--surface-raised);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-surface);
}

/* Slider */
.mantine-Slider-track {
  background: var(--surface-inset);
}
.mantine-Slider-bar {
  background: var(--accent);
}
```

### 7.3 卡片行通用样式

统一 `.settings-list-card` / `.settings-list-row`：

```css
.settings-list-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  background: var(--surface-raised);
  border: 1px solid var(--line-soft);
  border-radius: var(--radius-surface);
  transition: border-color var(--motion-quick) ease;
}
.settings-list-card:hover {
  border-color: var(--line-strong);
}
```

---

## 8. 实施阶段

### Phase 1：ui-kit 基础设施（1-2 天）

1. 在 `packages/ui-kit` 新增 `Switch`、`Collapse`、`Slider` 包装组件。
2. 在 `packages/ui-kit/src/primitives.css` 添加 Mantine 组件覆盖样式。
3. 在 `packages/ui-kit/src/index.ts` 导出新增组件。
4. 运行 `pnpm --filter @piwin/ui-kit typecheck && test`。

### Phase 2：替换所有手写 Switch（1 天）

1. 找出所有手写 toggle：
   - `McpPanel.tsx`
   - `SkillsPanel.tsx`
   - `AutomationPanel.tsx`
   - `MemoryPanel.tsx`
   - `general-page.tsx`
   - `session-page.tsx`
   - `appearance-page.tsx`
   - `ExtensionsPanel.tsx`
2. 全部替换为 `Switch from '@piwin/ui-kit'`。
3. 修复被切换内容的抖动（用 `Collapse` 或 CSS 显示切换）。

### Phase 3：Bug 修复（0.5 天）

1. 模型页添加请求头不跳走。
2. 模型页连接区垃圾桶图标移除/迁移。

### Phase 4：页面合并（1 天）

1. 规则 → Skills。
2. 子代理 → Automation。
3. 更新 `section-registry`、`pages/index`、locale。

### Phase 5：页面重排与 Mantine 化（2-3 天）

1. 通用页：Host 能力折叠、权限折叠。
2. 外观页：本地主题单行化、Slider 替换。
3. 扩展页：搜索/列表/手动安装重排。
4. Skills 页：列表、映射、手动安装重排。
5. MCP 页：列表与弹窗 Mantine 化。
6. Memory 页：搜索与列表重排。

### Phase 6：回归与视觉验收（0.5-1 天）

1. 全量 `typecheck`。
2. 全量 `test`。
3. 手动截图检查每页风格一致性。

---

## 9. 验收标准

### 9.1 全局标准

- [ ] `pnpm typecheck` 0 错误。
- [ ] `pnpm --filter @piwin/desktop test` 全部通过。
- [ ] 全项目搜索手写 `role="switch"`、`mcp-toggle` 无残留（ui-kit 内部除外）。
- [ ] 全项目搜索硬编码 `border-radius`（除 50% 和特殊值）原则上全部替换为 token。
- [ ] 设置页左侧导航项 ≤ 12 项。

### 9.2 页面标准

- [ ] **General**：Host 能力矩阵、记住权限默认折叠；在线模式用 Mantine Switch。
- [ ] **Appearance**：本地主题安装单行；工具密度用 Mantine Slider。
- [ ] **Models**：添加请求头不跳走；连接区无垃圾桶图标；输入框用 Mantine。
- [ ] **Skills**：规则合并为项目规则折叠区；技能列表用 Mantine Switch。
- [ ] **Automation**：子代理合并为第三区；Cron/Hooks 列表用 Mantine Card + Switch。
- [ ] **Extensions**：搜索刷新同一行；扩展卡片用 Mantine Card + Switch；手动安装单行。
- [ ] **MCP**：服务器列表无彩色头像、无状态 pill，仅保留状态 dot；编辑弹窗用 Mantine 表单。
- [ ] **Memory**：启用/注入用 Mantine Switch；搜索列表用 Mantine 组件。

### 9.3 体验标准

- [ ] 所有开关点击无可见抖动。
- [ ] 所有折叠/展开动画平滑。
- [ ] 表单输入框获得一致的聚焦高亮（`--accent` 边框）。
- [ ] 卡片 hover 状态一致（边框变亮或背景微变）。

---

## 10. 待决策事项

| 事项 | 当前建议 | 需要确认 |
|------|---------|---------|
| 已记住的工具权限 | 保留并折叠到通用页底部 | 是否直接删除？ |
| 子代理合并目标 | 合并到“自动化”页 | 是否改到“模型”或保留？ |
| 主题弹窗 | 继续用现有 Dialog 包装，内部表单用 Mantine | 是否改用 Mantine Modal？ |

---

## 11. 风险与回退

| 风险 | 缓解 |
|------|------|
| Mantine 版本后续升级导致样式选择器失效 | 所有覆盖集中在 `primitives.css`，升级时统一更新；新增覆盖尽量使用 Mantine 提供的 props 和 CSS 变量。 |
| 覆盖范围过大导致维护负担 | 只覆盖必要 token（颜色、圆角、间距），不动 Mantine 布局逻辑。 |
| 页面合并后用户找不到原功能 | 合并后在原位置给出提示文案；测试覆盖跳转。 |
| 测试 snapshot 大量变更 | 重构阶段预期测试和 snapshot 会更新，需在 PR 中说明。 |

---

## 12. 附录：建议替换清单

| 当前手写 | 替换为 | 说明 |
|----------|--------|------|
| `<span role="switch">` + `.mcp-toggle` | `Switch` | 消除抖动 |
| `{enabled && (...)}` 条件渲染 | `Collapse` | 平滑展开收起 |
| 手滑 segmented-control | `SegmentedControl` | 更稳定 |
| 原生 `<input type="range">` | `Slider` | 样式统一 |
| 手写 `<input>` | `TextInput` | 一致的 focus 和 label |
| 手写列表项 | `Card` 或 `List` | 统一卡片风格 |
| 内联 `style={{...}}` | Mantine `Group` / `Stack` + CSS class | 减少硬编码 |
| 手写 `⋮` menu | `Menu` | 已可用 |
| 空状态大区块 | `EmptyState` 或 `Card` 内小字 | 减少视觉噪音 |
