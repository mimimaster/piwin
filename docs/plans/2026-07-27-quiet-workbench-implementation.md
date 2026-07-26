# Quiet Workbench 1:1 Implementation Spec

| Field | Value |
|---|---|
| Status | **Spec ready · not implemented** |
| Date | 2026-07-27 |
| Source of truth | `docs/design/quiet-workbench-proposal.html` **v2.3** |
| Product | piwin desktop shell only |
| Goal | 按原型**标准与规则**尽量 **1:1** 还原「静默工作台」视觉与交互 |
| Related | `docs/design/desktop-foundations.md`, `docs/plans/2026-07-26-shell-redesign-execution-plan.md` (R1–R5 已落地结构), `docs/adr/0016-general-workspace-sessions.md` |
| Constraints | `AGENTS.md` 边界；**host / chat reducer / 持久化 / 传输逻辑零改动**；`data-layout` 权威不变；新 CSS 禁用 `!important`；安全边界不变 |

---

## 0. Purpose

2026-07-26 shell redesign 已把结构收敛为：

- 四横带：titleband → context bar → stage(composer) → status bar
- 三列：sidebar · stage · right panel
- 区域 CSS + appearance token 单源

但**视觉语言仍偏「分框 IDE」**：分区硬边、boxed 图标按钮、助手气泡、右栏 tab 列表、面板开关在 context bar、对话区右缘刻度等，与 v2.3 原型「一体色场 + 静默」不一致。

本文件是 **实现规格 + 执行切片**，不是再写一份愿景。实现时以原型 HTML 的 mock CSS/交互脚本为像素与行为基准；文档中的 token/尺寸是从 mock **按比例升到产品密度**后的目标值。

### 0.1 阅读顺序

1. 打开原型：`docs/design/quiet-workbench-proposal.html`（含可交互主壳、右栏钻入、对话流 demo）。
2. 通读本文 §1–§6（硬规则与 1:1 规格）。
3. 按 §8 工作包 W1→W4 实施；每包结束跑 §9 验收。

### 0.2 与 R1–R5 的关系

| 已有（保留） | 本轮要改 |
|---|---|
| `WorkspaceShell` 槽位结构 | 色场统一、去掉硬边界 |
| `data-layout` desktop/compact | 不改阈值与权威 |
| 右栏 outward expand + resize | 触发点移到 titleband；目录→钻入信息架构 |
| `ContextBar` 会话/运行态 | **移除** inspector 开关 |
| `TurnWorkDetails` / run presentation | 流式置灰 + 完成折叠 UI |
| ui-kit `IconButton`/`Button` | ghost 默认态；图标库统一 |
| Settings 路由 | 本轮不重做（仅被 ghost/token 连带影响） |

---

## 1. Non-negotiable product rules (from prototype)

以下四条是**所有改动的验收门禁**。违反任一条 = 未完成。

### P1 · 无框优先

- 图标按钮默认：**透明、无边框、无底色**。
- 悬停：浮现 **6–8%** 白/黑半透明色块（dark: `rgba(255,255,255,0.055–0.08)`）。
- **边框只留给**：composer 输入卡、菜单/对话框/弹出层。
- 现状 boxed `.icon-btn` / 带边框 `ActionIcon` 默认态 **全部退役**（可保留 class 名作兼容别名，但视觉必须 ghost）。

### P2 · 内容即界面

- 助手消息：**去气泡**，文档流 + 角色行（agent 图标 + `piwin`）。
- 用户消息：可保留 soft accent 气泡（原型 `.mk-user`）。
- 面板分区：靠 **同一色场 + 极弱发丝线**（或透明分隔），禁止「盒子里的盒子」。
- 左/中/右/顶栏：**同一 graphite 底**，透明度一致，无明显竖线/横线硬边界。

### P3 · 动效即状态

- 动画只出现在状态变化：思考 shimmer、面板滑入、新消息进场、运行脉冲。
- 时长收敛三档 + 一条主缓动（§5）。
- 全局尊重 `prefers-reduced-motion: reduce`：进场/滑动关闭，保留状态色变化。

### P4 · 一套图标语言

- viewBox **24×24**，stroke **1.6**，`stroke-linecap/linejoin: round`，外角 **rx≈2**。
- 尺寸 token：`--icon-size-sm: 16px`、`--icon-size-md: 20px`（产品密度；mock 内为缩小示意）。
- 禁止：文字字符图标（× ★ ⚙ ▸）、emoji 作功能图标、多描边宽度混排。
- 完成勾选可用 SVG check 或统一 stroke 的 `✓` 语义色，**不得**再混用不一致的字符图标系统。

### 额外硬约束（原型 lede + note）

1. **工作面板开关在 titleband 右上角**，不在 context bar。
2. **工作面板可整栏收起**；收起后目录不渲染/不可见，对话吃满宽度。
3. **消息贴顶**，不垂直居中空会话以外的历史流。
4. **对话区右缘不做消息刻度/导航轨**（`transcript-mini-nav` 隐藏或移除；大纲类能力另议）。
5. **面板按钮 ≠ 停止生成**（停止仍在 context bar 运行簇 / composer stop）。
6. **`data-layout` 权威不变**；compact 断点与 overlay 语义保持 `shell-layout.ts`。
7. 目录态终端有新输出：**行尾呼吸点 + 状态栏脉冲**，**绝不自动弹开**右栏。
8. 右栏展开态记忆：重开回到上次视图（home 或某 drill 视图）。

### 明确延后（原型 callout）

- 方案 B「指挥舱」：图标导航轨、单命令带、底部终端坞 —— **本轮不做**。

---

## 2. Visual tokens (1:1 from mock → product)

### 2.1 Mock 色板（产品 dark 默认，权威值）

原型 `.mk` 承诺 dark 为 product default：

| Token (product) | Mock value | 用途 |
|---|---|---|
| `--wb-field` | `#12141a` | 一体色场：canvas / sidebar / titleband / panel 同色 |
| `--wb-text` | `#dde0e5` | 主文字 |
| `--wb-muted` | `#8d94a0` | 次级文字 / 图标默认 |
| `--wb-dim` | `#5f6672` | 三级 / 分组标签 / 角色行 |
| `--wb-line` | `rgba(255,255,255,0.04)` | 发丝线（几乎不可见；可作 transparent 等价） |
| `--wb-accent` | `#5b9dff` | 系统蓝（动作、选中、agent 图标） |
| `--wb-accent-soft` | `rgba(91,157,255,0.14)` | 选中会话、用户气泡、面板按钮 pressed |
| `--wb-good` | `#43c384` | 成功 / 运行绿点 / +行统计 |
| `--wb-danger` | `#e5665c` | −行统计 / 错误点 |
| `--wb-hover` | `rgba(255,255,255,0.055)` | 行/按钮 hover |
| `--wb-send-fg` | `#0b1320` | 实心 accent 按钮上的深色字/图标 |
| `--wb-term-bg` | `#0c0d10` | 终端内嵌面（允许比 field 更深一档） |
| `--wb-search-bg` | `rgba(255,255,255,0.035)` | 侧栏搜索条弱底 |

**实现要求**：在 `appearance-tokens.ts` 的 dark manifest 与派生变量中 **对齐上述数值**（可映射到现有 `--canvas`/`--text`/… 语义名，但 **计算后色值必须与表一致**）。Light 模式做对称推导（原型文档页 light 存在；产品 mock 以 dark 为准，light 不得破坏一体色场原则）。

当前 `PIWIN_APPEARANCE_DARK`（`#18181a` / 分色 sidebar）**必须迁移**到一体色场，否则无法 1:1。

### 2.2 几何 token（mock → 产品）

Mock 为示意缩小（`font-size: 10px`）。产品沿用现有桌面密度，但 **比例关系** 1:1：

| 区域 | Mock | 产品目标 | 备注 |
|---|---|---|---|
| Titleband | 30px | 保持 `--titleband-height`（现 ~36–40） | 内容：左 sidebar 切换 + 历史；右 more + **panel toggle** |
| Context bar | 28px | 保持现有 ~42px 或压到 36–40 | **仅** title / scope / run；无 panel 钮 |
| Status bar | 22px | 保持 ~26px | 就绪点 · branch · ctx · skills |
| Sidebar width | 168 | 保持 ~236–260 | 一体色，无右边硬线 |
| Right panel | 186 | 保持 resizable 默认 ~290–320 | 收起 width→0 |
| Composer 圆角 | 12px | 12px | 悬浮卡 + 弱阴影 |
| 会话行圆角 | 7px | 7–8px | |
| 图标按钮 hit | 20 | 28–32（可点）/ 视觉 icon 16–20 | ghost |

### 2.3 动效 token

写入 CSS 变量（`tokens.css` 或 appearance 几何侧）：

| Token | Value | 用途 |
|---|---|---|
| `--motion-quick` | `120ms` | hover、pressed、图标着色 |
| `--motion-standard` | `200ms` | 菜单、弹层、折叠 |
| `--motion-large` | `260ms` | 右栏整栏滑入/滑出、抽屉 |
| `--motion-think-collapse` | `350ms` | 思考过程收起为摘要（原型 flow） |
| `--motion-ease` | `cubic-bezier(0.22, 1, 0.36, 1)` | 唯一主缓动 |
| shimmer / pulse period | `1.6s` | 思考高亮、运行点 |

`prefers-reduced-motion: reduce`：动画/过渡降到 ≈0；shimmer/pulse 关闭。

### 2.4 字体

- UI：`-apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", …`（原型 mock 不用 Outfit 装饰字体）。
- Mono：`ui-monospace, "SF Mono", Menlo, Consolas, monospace`。
- 产品可继续用 Outfit **仅当**不破坏静默感；**1:1 优先系统字体栈**（与原型 mock 一致）。若保留 Outfit，需在 W4 视觉验收中确认无「营销感」过重，否则回退系统栈。

---

## 3. Shell layout anatomy (1:1)

### 3.1 结构图

```text
┌─ titleband ──────────────────────────────────────────────┐
│ [sidebar] [◀][▶]          (drag)          [⋯] [panel]   │
├─ body ───────────────────────────────────────────────────┤
│ ┌ sidebar ──┐ ┌ main ──────────────────┐ ┌ right* ─────┐ │
│ │ project   │ │ context: title scope run│ │ directory   │ │
│ │ ⌘K search │ │ stage: chat (top-align) │ │ or drill    │ │
│ │ groups    │ │ composer (floating)     │ │             │ │
│ │ sessions  │ │ status                  │ │             │ │
│ │ [+ 新会话]│ │                         │ │             │ │
│ └───────────┘ └─────────────────────────┘ └─────────────┘ │
└──────────────────────────────────────────────────────────┘
* right 仅 data-right=expanded 时占宽；collapsed 时 width=0，对话吃满。
```

### 3.2 Titleband（`workspace-titlebar.tsx`）

**左（与原型一致）**

1. Sidebar toggle（panel-left 图标：竖分割矩形）
2. Back / Forward chevrons

**中**：`data-tauri-drag-region` 空白拖拽区

**右（关键变更）**

1. More（⋯）菜单：现有 skills/mcp/theme/settings 等收敛进此
2. **Work panel toggle**（panel-right 图标：竖分割靠右）
   - `aria-pressed` 反映展开态
   - pressed：`--wb-accent-soft` 底 + accent 色图标
   - `title`：`展开 / 收起右侧工作面板`
   - **禁止**与 stop 共用控件

**移出 titleband 的杂项**：执行模式原生 `<select>` 等 boxed 控件 → more 菜单或 settings（保持能力，去掉顶栏方框）。

### 3.3 Context bar（`context-bar.tsx`）

**保留**

- 会话标题（truncate）
- scope pill（无描边色块：`project · name`）
- 运行簇：绿点 pulse + `运行中 · 12s` + stop/retry（逻辑沿用 `run-status`）

**删除**

- Inspector / 右栏 toggle（迁 titleband）
- 任何第二套状态条

testid：保留 `workspace-context-header`、`run-status-strip`、`run-status-stop` 等；panel toggle 的 testid 迁到 titleband（同 commit 改 Playwright）。

### 3.4 Sidebar（`project-session-sidebar.tsx` + region CSS）

结构顺序（原型）：

1. Project row：folder 图标 + 名 + chevron
2. Search：弱底 + `搜索或命令` + `⌘K` kbd 胶囊
3. Group labels：`已置顶` / `今天` / `昨天`（uppercase tracking、dim）
4. Session rows：
   - default muted
   - hover: `--wb-hover`
   - active: `--wb-accent-soft` + 略粗字重
   - running: 4px 绿点
   - pinned: pin 图标
5. 底部主按钮：实心 accent「新会话」（`+` 图标）

无右边框硬线；背景 = `--wb-field`。

### 3.5 Stage / chat

- `justify-content: flex-start`（贴顶）
- 用户：右对齐 soft accent 气泡，`border-radius: 12px 12px 3px 12px`，max-width ~70%
- 助手：左文档流，max-width ~88%
  - 角色行：agent 星形图标（accent）+ `piwin`（dim 小字）
  - 正文无边框无底
- **移除/隐藏** `transcript-mini-nav`（右缘刻度）
- 滚动条：暗色壳内避免浅色轨道（可 thin + 低对比 thumb，或自动隐藏）

### 3.6 Composer（`composer-dock.tsx`）

原型形态：

- 外边距悬浮：`margin` 左右约 18 密度等价，底 14
- 卡：同色场底 + 1px `--wb-line` + `border-radius: 12` + 阴影 `0 6px 20px rgba(0,0,0,0.35)`（dark）
- 上行：placeholder「回复 piwin…」
- 底行 controls：
  1. ghost `+`（plus menu）
  2. 无框文本 chip：model（如 `fable-5`）
  3. 无框文本 chip：mode（如 `agent`）
  4. 右对齐圆形 send（实心 accent，图标深色）/ 运行中变 stop 方块图标

映射现有：`composer-plus-menu`、`ThinkingEffortControl`（model·effort 可合并为一个 frameless chip，mode 单独）、`context-usage-ring` 可保留在底行或 status（原型主图 ring 在 status `ctx 41%`——**优先 status 数字，composer 内 ring 可弱化/移除以免重复**）。

### 3.7 Status bar（`status-bar.tsx`）

左：绿点 + `就绪` + branch mono  
右：`ctx N%` · `skills N`  
无顶部分割硬线（或 transparent）。

### 3.8 Right work panel

#### 3.8.1 外层：整栏有无

- 状态：`data-right="expanded" | "collapsed"`（可与现有 `overlay === 'inspector'` 同步；DOM 上建议同时写 `data-right` 便于 CSS）。
- 展开：列宽 = 当前 resize 宽度；`transition: width 260ms var(--motion-ease), opacity 200ms`
- 收起：`width: 0; opacity: 0; pointer-events: none`；**内容卸载或保留挂载但不可见**——原型用 keep-mounted + width 0；产品为保 PTY 状态可 keep-mount，但 collapsed 时不可抢焦点。
- outward window expand 逻辑 **保留**（Tauri）；仅改触发入口与视觉。

#### 3.8.2 内层：目录 home

无传统 tab strip。目录行（顺序与原型一致）：

| Row | 图标 | 计数规则 | 钻入 |
|---|---|---|---|
| Changes | branch | `+N` good / `−N` danger | 进入 changes 详情 |
| 终端 | terminal | **仅有运行中进程时**显示数量；有进程才显示行尾 `›` | 点行/箭头进入终端会话 |
| Files | folder | 无进程则无数字无箭头 | 文件树 |
| Notes | note | 可选 | notes |
| Cards | cards | `N due` | cards |
| Activity | activity | 可选 | activity |

规则（原型 rp-notes，硬）：

- **有进程才给数量和 ›**；无进程只显示标签。
- 点有箭头的行 → 整面板接管详情（240–260ms 滑入）。
- 详情头：返回箭头 + 会话 chips（多终端切换 / `+`）+ 可选 pop-out。
- 目录态新输出：呼吸点加速，**不自动展开**。
- 记忆 last view。

#### 3.8.3 与现状 diff

| 现状 | 目标 |
|---|---|
| 右栏 header「工作区 + 当前 tab 名」+ section list 同时可见 | home 仅目录；drill 后 header 变返回+chips |
| emoji/混杂图标 + 边框行 | ghost 行 + 统一 24 图标 |
| toggle 在 context bar | toggle 在 titleband 右上 |
| 常显 tab 内容区 | 先目录再钻入 |

---

## 4. Conversation flow (1:1)

对应原型 §03 + `#flow-demo` 脚本。实现落在 `turn-work-details.tsx` / `run-presentation.ts` / transcript CSS；**不改 reducer 事件语义**，只改呈现。

### 4.1 阶段机（UI）

```text
waiting (发出→首 token)
  → streaming process (thinking lines + tools)
    → answer started (auto-collapse process)
      → complete (summary chip stays; body final)
```

### 4.2 规则表

| 阶段 | 视觉 | 行为 |
|---|---|---|
| 等待首 token | shimmer 状态行，如「正在连接模型…」 | **永不静止**空白 |
| 思考流式 | 12px 置灰；当前行走 shimmer 高亮；左 1.5px 细线缩进 | 逐行/逐字流式（已有 stream 则贴合现有 chunk） |
| 工具调用 | 细线缩进行：`ToolName` + mono 摘要 + 完成 `✓`(good) | 逐条 fade-in（~250ms） |
| 回答开始 | 过程区 350ms 收起 | 摘要：`已思考 N 秒 · M 次工具调用` |
| 摘要行 | chip：弱底、可点、chevron | 点击展开完整过程；`aria-expanded` |
| 偏好 | 用户手动折叠/展开 | 写入现有 `workDetailsExpanded` 偏好（auto/always/never 对齐：auto=完成折叠） |
| 新消息进场 | 仅**新**消息 `msg-in`（8px 上移+fade，~320ms） | 历史挂载不重放 |

### 4.3 助手文档流

- 去掉 `.bubble.role-assistant` 的边框/底色/卡片阴影。
- 保留 `data-testid="message-bubble"`（或同 commit 迁移测试到 `message-row`）以免 e2e 碎一地——**优先保留 testid，改 class 语义**。
- 用户侧保持气泡。

### 4.4 工具行 vs 旧工具卡

- 默认密度：细线缩进行（原型）。
- 展开详情（输出预览）可用 disclosure，避免默认大方框卡。
- `toolCallDensity` 偏好可映射 compact=行 / comfortable=可展开块，但 **comfortable 仍禁止重边框卡片**。

---

## 5. Component reconstruction (六组对照)

原型 §04 六组，全部为硬目标：

### 5.1 图标按钮 → Ghost

| 属性 | 旧 | 新 |
|---|---|---|
| border | 1px solid | none |
| background | 弱实底 | transparent |
| hover | 更亮底 | `var(--wb-hover)` |
| radius | 6 | 7 |
| icon | 混杂 | 24/1.6 |

ui-kit：`IconButton` 默认 `variant` 视觉改为 ghost（可继续包 Mantine，但 class 覆盖成无框）；desktop `.icon-btn` 同步或删除。

### 5.2 徽章 / 计数

- 去描边胶囊。
- 无边框色块字：scope 用 accent-soft；success 计数用 good 透明底。

### 5.3 模型 / 模式选择

- 去掉 native select / 描边盒。
- frameless text + chevron；hover 弱底。
- 弹出层用现有 Popover/Menu（Radix 方向与原型「Mantine 退役」一致——**本轮至少视觉 frameless**；完整 Mantine 移除可列 W4 可选，不阻塞 1:1 壳层）。

### 5.4 助手消息

见 §4.3。

### 5.5 工具调用

见 §4.4。

### 5.6 右面板条目行

见 §3.8.2。

---

## 6. Icon system (首批 16)

全部重绘进 `shell-icons.tsx`（或 `packages/ui-kit` 图标模块），路径以原型 SVG 为准：

| Name | 用途 |
|---|---|
| chat | 会话 |
| plus | 新建 / composer + |
| search | ⌘K / 搜索 |
| folder | project / Files |
| branch | Changes |
| terminal | 终端 |
| settings | sliders（**非齿轮**） |
| note | Notes |
| cards | Cards |
| close | 关闭（替换 ×） |
| chevron | 展开/菜单 |
| more | ⋯ |
| send | 发送 |
| stop | 停止（圆角方块 fill） |
| agent | 助手角色 |
| pin | 置顶会话 |

另需原型用到但未进 16 样张的：

- panel-left / panel-right（侧栏与工作面板）
- activity（波形）
- external-link / pop-out

规格：`stroke-width: 1.6`；fill 仅 more 点与 stop 方块；settings 双圈 knock-out 用 surface 色。

---

## 7. Gap analysis（现状 → 目标）

| ID | 现状 | 目标 | 主文件 |
|---|---|---|---|
| QW-01 | dark 多表面分色（canvas/sidebar/panel） | 一体 `--wb-field` | `appearance-tokens.ts`, region CSS |
| QW-02 | 面板硬边 `border` 可见 | 透明/0.04 发丝 | region-sidebar/context/inspector/titlebar |
| QW-03 | panel toggle 在 `ContextBar` | `WorkspaceTitlebar` 右上 | `context-bar.tsx`, `workspace-titlebar.tsx`, `App.tsx` |
| QW-04 | 右栏 tab 列表+内容同屏 | 目录 → 钻入 | `right-panel.tsx` |
| QW-05 | 进程行总是可进 | 无进程无计数无箭头 | `right-panel.tsx`, process hooks |
| QW-06 | 助手 `.bubble` 卡片 | 文档流 | `chat-thread.tsx`, `region-transcript.css` |
| QW-07 | 工具卡偏盒式 | 细线行 | tool card 组件 / CSS |
| QW-08 | thinking 折叠不完全符合摘要文案/shimmer | §4 状态机 | `turn-work-details.tsx` |
| QW-09 | `transcript-mini-nav` 右缘刻度 | 移除/隐藏 | `transcript-viewport.tsx` 等 |
| QW-10 | boxed icon buttons | ghost | ui-kit + `ui-foundations.css` |
| QW-11 | 图标 16 网格/多 stroke/字符 | 24/1.6 统一 | `shell-icons.tsx` |
| QW-12 | 动效 token 分散 | §2.3 变量 + 四场景 | `tokens.css`, region CSS |
| QW-13 | composer 控件密度/样式 | 悬浮卡 + 4 控件簇 | `composer-dock.tsx`, `region-composer.css` |
| QW-14 | 空会话垂直居中可保留；**有消息时不得居中** | 贴顶 | chat column CSS |
| QW-15 | titleband 仍有 boxed select | 迁出 | `workspace-titlebar.tsx` |

**明确不改**

- `@piwin/agent-host`、chat reducer、session 持久化、权限/trust 流程语义
- `shell-layout.ts` 断点与 overlay 枚举语义（可加 `data-right` 镜像，不改权威）
- CLI

---

## 8. Work packages

按原型 §07 落地，细化为可提交切片。每包独立可运行、可验收。

### W1 · 基座（图标 + 动效 token + ghost 按钮）

**目标**：所有 chrome 控件具备静默视觉语言，不改布局信息架构。

Tasks:

1. 写入 motion / icon-size token（`styles/tokens.css`）。
2. 重绘 §6 图标；替换 `shell-icons` 与字符/emoji 图标点。
3. ui-kit `IconButton` + desktop `.icon-btn` → ghost hover 规范。
4. `StatusBadge`/scope pill → 无描边色块。
5. reduced-motion 全局规则（region base）。

Tests:

- 图标导出 snapshot 或静态 path 单测（可选轻量）。
- 现有 ui-kit / icon 相关测试更新。
- grep 门禁：desktop 功能 UI 无 `⚙`/`★`/裸 `×` 作为图标（关闭按钮必须 SVG）。

Exit: 顶栏/侧栏/composer 图标按钮视觉已 ghost；图标粗细一致。

### W2 · 布局（一体色场 + 右栏整栏 + 目录钻入 + composer 悬浮）

**目标**：主壳与原型「最终形态」mock 结构 1:1。

Tasks:

1. **Token**：dark 一体色场对齐 §2.1；sidebar/panel/titleband 同色；分隔线 → `--wb-line` 或 transparent。
2. **Titleband**：右上 panel toggle；`aria-pressed`；迁出 context bar 开关；more 收敛杂项。
3. **Context bar**：仅 title/scope/run。
4. **Right panel IA**：
   - home 目录行 + 计数/箭头规则
   - drill view + back + chips
   - last-view memory（sessionStorage 或 shell layout state）
   - 不自动弹开
5. **Composer**：悬浮卡样式；frameless model/mode；圆形 send。
6. **Chat 贴顶**；隐藏 mini-nav。
7. **Status bar**：弱化顶线。
8. Playwright：toggle 位置与 inspector 开合；testid 迁移同 commit。

Tests:

- `shell-layout` 单测仍绿。
- 右栏：无进程终端行无 chevron（unit）。
- Playwright shell/inspector 更新。

Exit: 对照原型主图与两态 mock，结构与触发点一致；截图可并排比对。

### W3 · 对话流（去气泡 + thinking 折叠 + 工具行 + 等待态）

**目标**：§03 规则 1:1。

Tasks:

1. 助手去气泡 + 角色行（agent 图标）。
2. thinking shimmer + 工具行样式。
3. 回答开始自动折叠摘要 chip；展开回看；偏好衔接。
4. 等待态 shimmer 行（映射 `connecting-model` / `waiting-first-token`）。
5. 新消息进场动画（仅增量）。

Tests:

- `turn-work-details` / chat-thread 单测覆盖折叠文案与 auto 行为。
- 流式 fixture：工具行出现与 ✓。

Exit: 对照 flow-demo 四条规则人工走查通过。

### W4 · 收尾

Tasks:

1. reduced-motion 全壳走查。
2. 8 张 darwin 视觉基线一次性重生成。
3. testid 全量核对；文档链接（本文件 + 原型）写入 `docs/design/desktop-foundations.md` 短引用。
4. `!important` 清点：本轮新增必须为 0。
5. 可选：Mantine 浮层→Radix 加速（非 1:1 阻塞项，单列）。

Exit: `pnpm typecheck`、touched tests、Playwright 全绿；手动 smoke 清单勾完。

---

## 9. Acceptance / QA

### 9.1 并排视觉清单（必须开原型）

在 1400×900 左右窗口，dark 主题：

- [ ] 左/中/右/顶 **看不出明显分割盒**
- [ ] 收起右栏：对话变宽，无残留右轨
- [ ] 展开右栏：先见目录，不见强 tab 条
- [ ] 终端无进程：无数字无箭头；有进程：有数字+箭头
- [ ] 点终端钻入：整栏终端 + 返回；不丢进程
- [ ] titleband 右上 panel 钮 pressed 态与原型一致
- [ ] context bar **无** panel 钮；有运行态与 stop
- [ ] 助手无气泡；用户有 soft 气泡
- [ ] 思考完成摘要文案格式正确
- [ ] composer 悬浮、控件无框
- [ ] 无右缘消息刻度
- [ ] 图标同排粗细一致
- [ ] reduced-motion 开时无滑动/shimmer

### 9.2 行为清单

- [ ] 面板钮不停止生成
- [ ] 目录态终端输出不自动打开右栏
- [ ] 重开右栏恢复 last view
- [ ] compact `data-layout` 下右栏仍为 overlay 语义
- [ ] ⌘K / 新会话 / 侧栏切换仍可用

### 9.3 命令

```bash
pnpm typecheck
pnpm test --filter @piwin/ui-kit --filter desktop   # 按仓库实际 filter 调整
# Playwright shell 套件（与现有 CI 一致）
```

---

## 10. File ownership map

| 区域 | 文件 |
|---|---|
| Tokens | `apps/desktop/src/appearance-tokens.ts`, `styles/tokens.css` |
| Titleband | `workspace-titlebar.tsx`, `styles/region-titlebar.css` |
| Context | `context-bar.tsx`, `styles/region-context-bar.css` |
| Sidebar | `project-session-sidebar.tsx`, `styles/region-sidebar.css` |
| Composer | `composer-dock.tsx`, `ThinkingEffortControl.tsx`, `styles/region-composer.css` |
| Transcript | `chat-thread.tsx`, `turn-work-details.tsx`, `styles/region-transcript.css` |
| Right panel | `right-panel.tsx`, `styles/region-inspector.css`（或现有 inspector 区域文件） |
| Status | `status-bar.tsx`, `styles/region-status-bar.css` |
| Icons | `shell-icons.tsx` |
| Layout state | `shell-layout.ts`, `hooks/use-shell-layout.ts`, `App.tsx` 接线 |
| Ghost primitives | `packages/ui-kit/src/icon-button.tsx`, `button.tsx`, desktop `ui-foundations.css` |
| Mini-nav | `transcript-mini-nav.tsx` / viewport 引用处 |

依赖方向：apps/desktop → ui-kit → contracts；**禁止** UI import Pi。

---

## 11. Implementation notes for agents

1. **先 W1 再 W2**：没有 ghost/图标就改布局，会在错误控件上堆 CSS。
2. **对照原型改 CSS 时打开 HTML**，不要凭记忆估色；用取色/复制 mock 变量。
3. Mock 字号是 10px 缩略；**不要**把产品字号改成 10px。
4. 改 testid 必须同 commit 改测试。
5. 不要顺手重构 host/session。
6. 每包结束做一次与原型主图的截图 diff（人工即可）。
7. 若发现原型与 `desktop-foundations.md` 冲突：**以 quiet-workbench v2.3 原型为准**，并回写 foundations 一句说明。

---

## 12. Definition of done

1. §9.1 / §9.2 清单全部勾选。
2. typecheck + 相关 unit + Playwright 绿。
3. 无新增 `!important`。
4. 无 host/reducer 行为 diff（可用 git diff 限定 packages 路径自证）。
5. 本文 Status 更新为 Implemented + 日期；必要时补 ADR（仅当布局权威或右栏状态持久化协议变化时）。

---

## Appendix A · 原型章节索引

| 原型 section | 内容 | 本文 |
|---|---|---|
| 01 设计原则 | P1–P4 | §1 |
| 02 最终布局 | 一体色场、右栏收起、目录钻入 | §3 |
| 03 对话流 | 置灰流式、完成折叠 | §4 |
| 04 组件重构 | 六组前后对照 | §5 |
| 05 图标系统 | 16 样张 | §6 |
| 06 动效语言 | 四场景 + token 表 | §2.3, §8 W1 |
| 07 落地 | W1–W4 + 护栏 | §8, §1 护栏 |

## Appendix B · 关键交互伪代码（右栏）

```text
// outer
onTitlebandPanelToggle:
  if expanded → collapse (data-right=collapsed, overlay=none)
  else → expand (overlay=inspector, data-right=expanded, restore lastView)

// home row
render TerminalRow:
  if processCount > 0:
    show count, show chevron, clickable → go(term)
  else:
    show label only

// drill
go(view):
  animate 260ms ease
  header = back + chips(view)
  remember lastView = view

onTerminalOutput while view==home && collapsed:
  pulse row + status bar
  do NOT expand
```

## Appendix C · 摘要 chip 文案

- 中文：`已思考 {n} 秒 · {m} 次工具调用`
- 英文：`Thought for {n}s · {m} tool calls`
- 流式中未完成：`思考中` / `Thinking`

（与原型 flow-demo 一致；秒数与次数来自现有 run 计时与 tool 记录，不得写死。）
