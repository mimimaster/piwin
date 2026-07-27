# Cursor 3.0 Agents Window 设计拆解 vs piwin 现状

## 一、Cursor 3.0 核心设计哲学

Cursor 3.0 的根本转变：**从"编辑器 + AI 插件"变成"Agent 优先的工作区"**。

整个窗口围绕"对话/Agent 交互"设计，代码编辑退居二线。这意味着：
- 视觉重心 = Composer 输入框 + 对话流
- 一切高级功能收敛到 popover / 右键 / 快捷键
- 界面"安静"——没有运行中的任务时，界面几乎不打扰你

---

## 二、整体布局结构

```
┌─────────────────────────────────────────────────────────────────┐
│  Title Bar (macOS traffic lights + 极简全局导航)                    │
├────────┬──────────────────────────────────────┬─────────────────┤
│        │                                      │                 │
│  Left  │         Center (Chat/Agent)          │   Right Panel   │
│  Rail  │                                      │   (可选展开)     │
│  56px  │   ┌────────────────────────────┐     │                 │
│        │   │  Conversation Thread       │     │  Files          │
│  Agent │   │  (消息流 + 工具卡片)        │     │  Terminal       │
│  List  │   │                            │     │  Changes        │
│        │   │                            │     │                 │
│  + New │   └────────────────────────────┘     │                 │
│        │                                      │                 │
│        │   ┌────────────────────────────┐     │                 │
│        │   │  ★ COMPOSER (核心)         │     │                 │
│        │   └────────────────────────────┘     │                 │
├────────┴──────────────────────────────────────┴─────────────────┤
│  Status Bar (极薄, 22px, 信息密度高但视觉安静)                      │
└─────────────────────────────────────────────────────────────────┘
```

### 关键尺寸
- Left Rail: 56px (icon-only) 或 240px (展开)
- Center: flex, max-width 无限制（对话流居中，max 720px）
- Right Panel: 320px, 默认收起
- Title Bar: 38px (macOS overlay)
- Status Bar: 22px

---

## 三、Composer 设计（核心差异点）

### Cursor 的 Composer 长什么样：

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│  Ask anything, @ to add context...                      │
│                                                         │
│                                                         │
├─────────────────────────────────────────────────────────┤
│ [+] [Model: claude-4 ▾] [Agent ▾]    [🎯] [⬤ Send]   │
└─────────────────────────────────────────────────────────┘
```

### 设计要点：

1. **单卡片浮动**
   - 圆角 14-16px
   - 1px border (rgba white 8-10%)
   - 多层阴影营造"浮起"感
   - Focus 时 border 变 accent + 外发光 (box-shadow 3px accent 10%)

2. **Textarea 区域**
   - 占据卡片 70% 面积
   - 单行起始，自动增高到 ~180px
   - 字号 14-15px, 行高 1.6
   - Placeholder 极淡 (opacity 0.35)
   - 无内边框、无分割线

3. **底部工具栏（关键！）**
   - 高度仅 36-40px
   - 左侧：`+` 按钮 → 模型选择 pill → 模式选择 pill
   - 右侧：context 指示 → 发送按钮
   - **没有** stepper、没有路径头、没有多余按钮
   - 所有高级选项（thinking effort, skills, MCP）藏在 `+` 菜单或模型 pill 的 popover 里

4. **模型选择器**
   - 紧凑 pill: `[claude-4 ▾]`
   - 点击展开 popover 列表
   - 不占视觉空间

5. **发送按钮**
   - 圆形或圆角方形, 28-32px
   - Accent 色填充
   - Hover: 微放大 + 光晕
   - Disabled: opacity 0.3

6. **Streaming 状态**
   - 发送按钮变为 Stop (方形 icon)
   - 卡片 border 微微变色提示"正在运行"
   - 不出现额外按钮（Steer 等通过快捷键或右键）

---

## 四、左侧栏设计

### Cursor 3.0 的左侧栏：

- **默认是 Agent 列表**（不是文件树！）
- 每个 Agent 会话 = 一行：名称 + 状态点 + 最后消息预览
- 顶部: `+ New Agent` 按钮（全宽，accent 色）
- 底部: Settings gear icon
- 可折叠为 56px icon rail
- 搜索框在顶部，极简

### piwin 当前问题：
- 左侧栏是"项目 + 会话"混合，信息层级不清
- 会话列表项太密，缺少呼吸感
- 没有 Agent 运行状态的视觉指示

---

## 五、对话流（Center）设计

### Cursor 的消息流：

- 消息间距大（24-32px）
- 用户消息：右对齐或无背景纯文本
- Agent 消息：左对齐，无气泡，直接 Markdown 渲染
- 工具调用：折叠卡片，只显示工具名 + 状态，点击展开
- Diff：内联渲染，带 Accept/Reject 按钮
- 思考过程：折叠的灰色区块，不占主视觉

### piwin 当前问题：
- 消息密度太高
- 工具调用卡片视觉权重太大
- 缺少"安静"感

---

## 六、右侧面板设计

### Cursor 的右侧面板：

- 默认完全收起（不占空间）
- 展开时是第三列，不压缩中间区域（outward expand）
- Tab 导航在顶部：Files | Terminal | Changes
- 文件树极简，只有图标+文件名
- Terminal 是真正的终端（xterm）
- Changes 是 VS Code SCM 风格

### piwin 现状：
- 已经实现了 outward expand ✓
- Tab 导航已有 ✓
- 基本对齐，问题不大

---

## 七、Status Bar 设计

### Cursor 的 Status Bar：

- 极薄 (20-22px)
- 信息密度高但视觉安静
- 左侧：Agent 状态 + 分支名
- 右侧：模型名 + context% + 错误/警告计数
- 颜色极淡 (muted/faint)，不抢注意力
- 可点击项有 hover 态

### piwin 现状：
- 已实现 StatusBar ✓
- 需要调整视觉权重（更淡、更薄）

---

## 八、视觉风格对比

| 维度 | Cursor 3.0 | piwin 当前 |
|------|-----------|-----------|
| 背景色 | #1e1e2e (冷灰紫) | #090807 (暖黑) ✓ 有特色 |
| 边框 | rgba(255,255,255,0.06-0.10) | rgba(255,236,210,0.07-0.16) ✓ |
| 圆角 | 12-16px (大圆角) | 10-12px (偏小) |
| 阴影 | 多层软阴影 | 单层或无 |
| 字号 | 13-14px 正文 | 13px ✓ |
| 间距 | 宽松 (16-24px gap) | 偏紧 (8-12px) |
| 动画 | 150-200ms ease | 120ms (偏快) |
| 信息密度 | 低（留白多） | 高（控件密） |
| 视觉层级 | 3层（主/次/隐藏） | 5+层（太多东西同时可见）|

---

## 九、piwin 与 Cursor 的核心差距（优先级排序）

### P0 — 必须改

1. **Composer 视觉重构**
   - 去掉路径头、stepper、多余 dropdown
   - 单卡片 + 自动增高 textarea + 极简底部工具栏
   - 模型选择器变为紧凑 pill
   - 发送按钮变为 accent 圆形
   - 所有高级选项收入 popover

2. **信息层级收敛**
   - 同时可见的控件减少 60%
   - Thinking effort、Skills、MCP 等收入 `+` 菜单
   - 运行时才显示 Steer/Stop，平时隐藏

3. **间距和呼吸感**
   - 消息间距加大到 24px+
   - Composer 内 padding 加大
   - 工具栏元素间距加大

### P1 — 应该改

4. **左侧栏重构**
   - 默认显示 Agent/Session 列表（不是项目树）
   - 会话项增加状态指示（running dot）
   - 折叠为 icon rail 的选项

5. **对话流降噪**
   - 工具调用默认折叠，只显示一行摘要
   - 思考过程默认折叠
   - Diff 内联渲染 + Accept/Reject

6. **圆角和阴影升级**
   - 卡片圆角从 10px → 14-16px
   - 添加多层阴影（ambient + direct）
   - Focus 态加外发光

### P2 — 锦上添花

7. **动画系统**
   - 面板展开/收起: 200ms cubic-bezier(0.4, 0, 0.2, 1)
   - Composer focus: 150ms border + shadow transition
   - 消息出现: fade-in + translateY(4px)

8. **Status Bar 极简化**
   - 高度 22px
   - 颜色降到 faint 级别
   - 只保留：Agent状态 | 分支 | 模型 | Context%

---

## 十、复刻路线图建议

### Phase 1: Composer 重构（最大视觉收益）
- 重写 composer-dock.tsx 的渲染结构
- 新 CSS: 单卡片、自动增高、极简工具栏
- 模型选择器 pill + popover
- 发送按钮 accent 圆形
- 去掉路径头、stepper

### Phase 2: 对话流降噪
- 工具调用卡片默认折叠
- 消息间距加大
- Diff 内联 + Accept/Reject

### Phase 3: 左侧栏 + 间距系统
- 左侧栏默认 Agent 列表
- 全局间距 token 调整
- 圆角/阴影升级

### Phase 4: 动画 + 微交互
- 面板过渡动画
- Focus 态光晕
- 消息入场动画

---

## 十一、一句话总结

> Cursor 的设计核心不是"好看"，是**安静**。
> 它把 90% 的功能藏起来，只留一个干净的输入框和一段对话流。
> piwin 当前的问题是"把所有功能都摆在台面上"——stepper、路径头、多个 dropdown、
> 多个按钮同时可见——视觉噪音太大。
>
> **复刻 Cursor 的第一步不是加功能，是减功能（视觉上）。**
