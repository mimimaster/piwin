# piwin × Cursor Window 复刻实现计划

> 目标：将 piwin 的视觉体验和交互质量提升到 Cursor 3.0 Agents Window 水准。
> 原则：**减法优先**——收敛可见控件、放大留白、让界面"安静"。
> 约束：保持 Copper Workbench 暖色主题（#090807 canvas / #d89a4a accent），不照搬 Cursor 冷灰色调。

---

## Phase 1: Composer 重构（视觉收益最大）

**目标**：把 Composer 从"工具面板"变成"一个干净的输入卡片"。

### 1.1 结构变更 — `composer-dock.tsx`

当前结构（问题）：
```
footer.composer-dock
  div.composer-path-header     ← 删除（路径已在 WorkspaceContextHeader 显示）
  div.composer-card
    div.attachment-chip-row
    div.composer-input-wrap
      SlashMenu
      textarea (rows=3/4 固定)
    div.composer-toolbar
      left: [+btn] [mode-chip] [compact-btn]
      right: [ContextRing] [ThinkingEffort] [Steer] [FollowUp] [Stop/Send]
```

目标结构（Cursor 风格）：
```
footer.composer-dock
  div.composer-card-v2
    div.composer-v2-attachments     ← 仅有附件时显示
    div.composer-v2-input-area
      SlashMenu
      textarea (rows=1, auto-expand)
    div.composer-v2-toolbar
      left:  [+btn] [model-pill ▾] [mode-chip?]
      right: [context-ring] [compact] [Send ⬤ / Stop ■]
```

### 1.2 具体改动清单

| 文件 | 改动 | 说明 |
|------|------|------|
| `composer-dock.tsx` | 删除 `composer-path-header` 渲染 | 路径信息已在 WorkspaceContextHeader |
| `composer-dock.tsx` | textarea `rows={1}` + `autoResize()` | 单行起始，JS 控制 scrollHeight 到 max 200px |
| `composer-dock.tsx` | 模型选择器从 ThinkingEffortControl 内拆出为独立 `model-pill` | 紧凑 pill: `[model-name ▾]`，点击打开 PlusMenu 的 models 子菜单 |
| `composer-dock.tsx` | ThinkingEffortControl 移入 `+` 菜单或 model-pill popover | 不再常驻工具栏 |
| `composer-dock.tsx` | 删除 Steer/FollowUp 按钮 | Steer 改为 Enter 发送时自动判断（streaming 时 Enter = steer） |
| `composer-dock.tsx` | Send 按钮改为 32px accent 圆角方块 | hover: scale(1.04) + glow |
| `composer-dock.tsx` | Stop 按钮改为 32px danger 边框方块 | 仅 streaming 时替换 Send |
| `styles/shell-extensions.css` | 新增 `.composer-card-v2` 全套样式 | 见下方 CSS 规格 |

### 1.3 CSS 规格（`.composer-card-v2`）

```css
.composer-card-v2 {
  width: min(100%, 760px);
  margin: 0 auto;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
  box-shadow: 0 0 0 1px rgba(255,236,210,0.03),
              0 8px 32px rgba(0,0,0,0.35),
              0 2px 8px rgba(0,0,0,0.2);
}
.composer-card-v2:focus-within {
  border-color: color-mix(in srgb, var(--accent) 50%, var(--line));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 10%, transparent), ...;
}
.composer-v2-textarea {
  min-height: 24px; max-height: 200px;
  font-size: 14.5px; line-height: 1.6;
  resize: none; border: none; outline: none;
}
.composer-v2-toolbar { height: 40px; padding: 6px 10px 10px; }
.composer-v2-send-btn { width: 32px; height: 32px; border-radius: 10px; background: var(--accent); }
.composer-v2-model-pill { height: 26px; border-radius: 7px; font-size: 11.5px; }
```

### 1.4 验收标准

- [ ] Composer 卡片无路径头、无 stepper、无多余 dropdown
- [ ] Textarea 单行起始，输入后自动增高
- [ ] 工具栏仅 5 个可见元素：`+` / model-pill / context-ring / compact / send
- [ ] Focus 时卡片有 accent 光晕
- [ ] Streaming 时 send 变为 stop，无额外按钮
- [ ] 空状态（centered）卡片更宽、更大圆角、更深阴影

---

## Phase 2: 对话流降噪

**目标**：消息流从"信息轰炸"变成"安静阅读"。

### 2.1 消息间距 — `transcript.css`

```css
/* 当前 */
.chat-thread { gap: 18px; }

/* 目标 */
.chat-thread { gap: 28px; }
.bubble { padding: 0; }  /* 去掉气泡背景，纯文本流 */
.bubble.role-assistant { border: none; background: none; }
```

### 2.2 工具调用默认折叠 — `turn-work-details.tsx`

当前：`resolveWorkDetailsDefaultOpen()` 在 `workDetailsExpanded === 'auto'` 时，活跃 run 展开、完成后折叠。

改动：
- 默认状态改为**始终折叠**（仅显示一行摘要：`✓ 3 tools · 2.1s`）
- 点击摘要行展开详情
- 活跃 streaming 时自动展开，完成后 300ms 动画折叠

### 2.3 思考过程折叠 — `turn-work-details.tsx`

- Thinking block 默认折叠为 `💭 Thinking...` 一行
- 点击展开完整思考链
- 使用 `<details>` 或 JS 控制，带 200ms height 过渡

### 2.4 用户消息样式

```css
/* 当前：有背景气泡 */
.bubble.role-user { background: var(--panel-2); border-radius: 12px; padding: 12px 16px; }

/* 目标：无背景，纯文本，左对齐 */
.bubble.role-user { background: none; padding: 0; }
.bubble.role-user .bubble-text { color: var(--text); font-size: 14.5px; }
```

### 2.5 Assistant 消息样式

```css
/* 去掉 "piwin" 角色标签的视觉权重 */
.bubble-header .bubble-role { font-size: 11px; color: var(--faint); font-weight: 500; }
/* streaming dot 改为更微妙的脉冲 */
.stream-dot { width: 5px; height: 5px; background: var(--accent); }
```

### 2.6 验收标准

- [ ] 消息间距 28px+
- [ ] 工具调用默认折叠为一行摘要
- [ ] 思考过程默认折叠
- [ ] 用户消息无背景气泡
- [ ] 整体视觉噪音降低 60%

---

## Phase 3: 左侧栏重构

**目标**：从"项目+会话混合列表"变成"Agent 优先的会话列表"。

### 3.1 信息层级调整 — `project-session-sidebar.tsx`

当前层级：
```
Brand
General chat
Projects (列表)
+ 新会话
搜索框
Sessions (列表)
Host status footer
```

目标层级（Cursor 风格）：
```
Brand (紧凑)
+ New Agent (全宽 accent 按钮，最顶部)
搜索框
Sessions (列表，带状态点)
─── 折叠分割线 ───
Projects (折叠区域，默认收起)
Settings gear (底部)
```

### 3.2 会话列表项增强

```tsx
// 每个 session 行增加运行状态指示
<ListRow className="session-row">
  <span className="session-status-dot" data-status={isRunning ? 'running' : 'idle'} />
  <span className="session-name">{session.name}</span>
  <span className="session-preview muted">{session.lastPreview}</span>
</ListRow>
```

### 3.3 折叠为 Icon Rail

- 新增 `sidebarCollapsed` 状态（存入 DesktopPreferences）
- 折叠时宽度 56px，只显示 icon：Brand / + / Search / Settings
- 展开按钮在 titlebar 或 rail 底部

### 3.4 CSS 改动

```css
.sidebar { padding: 12px; gap: 8px; }
.sidebar-new-agent {
  width: 100%; height: 36px;
  background: var(--accent); color: #1a140e;
  border-radius: 9px; font-weight: 650;
}
.session-row { height: 38px; border-radius: 8px; padding: 0 10px; }
.session-status-dot { width: 6px; height: 6px; border-radius: 50%; }
.session-status-dot[data-status='running'] { background: var(--accent); animation: pulse; }
```

### 3.5 验收标准

- [ ] "New Agent" 按钮在最顶部，全宽 accent 色
- [ ] Sessions 列表在 Projects 之前
- [ ] 每个 session 有运行状态点
- [ ] 支持折叠为 56px icon rail
- [ ] Projects 默认折叠

---

## Phase 4: 圆角 / 阴影 / 间距系统升级

**目标**：全局视觉质感从"开发者工具"提升到"消费级产品"。

### 4.1 Token 调整 — `tokens.css`

```css
:root {
  /* 圆角升级 */
  --radius: 14px;      /* 12 → 14 */
  --radius-sm: 10px;   /* 10 保持 */
  --radius-lg: 18px;   /* 新增：大卡片 */

  /* 阴影系统（多层） */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.3);
  --shadow-md: 0 4px 16px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.2);
  --shadow-lg: 0 8px 32px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.25);
  --shadow-glow: 0 0 0 3px color-mix(in srgb, var(--accent) 12%, transparent);

  /* 间距系统 */
  --space-xs: 4px;
  --space-sm: 8px;
  --space-md: 16px;
  --space-lg: 24px;
  --space-xl: 32px;
}
```

### 4.2 全局卡片升级

所有 `.composer-card`, `.right-panel`, `.sidebar`, `.diff-view` 等卡片类组件：
- border-radius: 14px
- box-shadow: var(--shadow-md)
- border: 1px solid var(--line-soft)

### 4.3 Focus 态统一

```css
:focus-within, .focused {
  border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
  box-shadow: var(--shadow-glow);
}
```

### 4.4 验收标准

- [ ] 所有卡片圆角 14px+
- [ ] 多层阴影营造深度
- [ ] Focus 态有 accent 光晕
- [ ] 间距使用 token 而非硬编码

---

## Phase 5: 动画系统

**目标**：所有状态切换有平滑过渡，不再"跳变"。

### 5.1 面板展开/收起

```css
.sidebar, .right-panel {
  transition: width 200ms cubic-bezier(0.4, 0, 0.2, 1),
              opacity 150ms ease;
}
```

### 5.2 Composer Focus

```css
.composer-card-v2 {
  transition: border-color 150ms ease, box-shadow 150ms ease;
}
```

### 5.3 消息入场

```css
.bubble {
  animation: message-in 200ms ease-out;
}
@keyframes message-in {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### 5.4 工具调用折叠/展开

```css
.turn-work-details-body {
  transition: max-height 200ms ease, opacity 150ms ease;
  overflow: hidden;
}
```

### 5.5 验收标准

- [ ] 面板展开/收起 200ms 平滑
- [ ] Composer focus 150ms 光晕过渡
- [ ] 新消息 fade-in + translateY
- [ ] 折叠/展开有 height 过渡

---

## Phase 6: Status Bar 极简化

**目标**：底部状态栏"存在但不打扰"。

### 6.1 改动 — `status-bar.tsx` + CSS

```css
.status-bar {
  height: 22px;           /* 26 → 22 */
  font-size: 10.5px;      /* 11 → 10.5 */
  color: var(--faint);    /* muted → faint */
  border-top-color: color-mix(in srgb, var(--line-soft) 50%, transparent);
}
```

### 6.2 内容精简

保留：Agent 状态 | 分支 | Context% | 模型名
移除：Skills 计数、MCP 计数（这些收入 Settings 或 `+` 菜单）

### 6.3 验收标准

- [ ] 高度 22px
- [ ] 颜色 faint 级别
- [ ] 仅 4 项信息
- [ ] 不抢视觉注意力

---

## Phase 7: Right Panel 微调

**目标**：右侧面板已经基本对齐，做细节打磨。

### 7.1 Tab 导航改为顶部水平

当前：垂直 section list（Cursor 风格）
可选改为：顶部水平 tab bar（更紧凑）

### 7.2 文件树增加图标

- 文件夹: 📁 (SVG)
- 文件类型图标: .ts / .tsx / .css / .json 等

### 7.3 Terminal 增加 resize handle

- 底部拖拽条，可调整 terminal 高度

### 7.4 验收标准

- [ ] Tab 导航清晰
- [ ] 文件树有类型图标
- [ ] Terminal 可拖拽调整高度

---

## 执行顺序和依赖关系

```
Phase 1 (Composer) ─── 无依赖，立即开始
    │
    ├── Phase 2 (对话流) ─── 可与 Phase 1 并行
    │
    ├── Phase 4 (Token/圆角) ─── Phase 1 完成后开始（避免冲突）
    │       │
    │       └── Phase 5 (动画) ─── Phase 4 完成后
    │
    ├── Phase 3 (左侧栏) ─── 独立，可与 Phase 2 并行
    │
    ├── Phase 6 (Status Bar) ─── 独立，随时可做
    │
    └── Phase 7 (Right Panel) ─── 最后打磨
```

**建议执行顺序**：1 → 2 → 4 → 5 → 3 → 6 → 7

---

## 涉及文件清单

| 文件 | Phase | 改动类型 |
|------|-------|---------|
| `composer-dock.tsx` | 1 | 重写渲染结构 |
| `styles/shell-extensions.css` | 1 | 新增 composer-v2 样式 |
| `styles/transcript.css` | 2 | 消息间距、气泡样式 |
| `turn-work-details.tsx` | 2 | 默认折叠逻辑 |
| `chat-thread.tsx` | 2 | 用户消息样式 |
| `project-session-sidebar.tsx` | 3 | 层级重排、状态点 |
| `styles/shell.css` | 3, 4 | sidebar 样式、token |
| `styles/tokens.css` | 4 | 圆角/阴影/间距 token |
| `status-bar.tsx` | 6 | 内容精简 |
| `right-panel.tsx` | 7 | Tab 导航微调 |
| `App.tsx` | 1, 3 | 集成新组件、状态 |
| `ui-preferences.ts` | 3 | 新增 sidebarCollapsed |

---

## 风险和注意事项

1. **不要破坏现有功能**：所有改动保持 props 接口兼容，新增可选 props
2. **CSS 优先级**：新样式用 `.composer-card-v2` 等新类名，不覆盖旧类（渐进迁移）
3. **TypeScript 严格模式**：项目开启 `exactOptionalPropertyTypes`，可选 props 必须 `| undefined`
4. **测试**：每个 Phase 完成后跑 `pnpm --filter @piwin/desktop typecheck`
5. **主题兼容**：所有颜色使用 CSS 变量，确保 light theme 也正常

---

## 一句话总结

> **Phase 1 做完，视觉感受就能提升 50%。**
> 核心就一件事：把 Composer 变成一个干净的浮动卡片，其他全部藏起来。
