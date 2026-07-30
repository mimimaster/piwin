# Paper / Noir 主题实现计划（V7 落地）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把桌面端 UI 从 Daybreak 配色体系整体迁移到 V7 Paper（亮）/ V6 Noir（暗）设计体系，并实现原型中的计划卡、内联 diff 卡、审批门等 Agent UX 组件。

**Architecture:** 颜色/字体由 `appearance-tokens.ts` 运行时投影（替换两个内置 manifest 内容 + 扩展派生变量）；几何由 `styles/tokens.css` 调整；视觉样式按区域移植 `docs/proto-shell.css`（仓库内设计真相源）；交互组件复用 ui-kit `Collapse` 与现有数据流（plan/permission/diff 三条数据通道全部已存在，只差渲染）。

**Tech Stack:** React 19 + Tauri 2、普通全局 CSS + CSS 变量（无 tailwind/CSS Modules）、vitest。本计划**不引入新 npm 依赖**（Phase D 为可选升级，单独 spike 决策）。

## Global Constraints

- AGENTS.md 约束：`packages/ui-kit` 只能依赖 `@piwin/contracts` —— 新组件一律放 `apps/desktop/src/`，不进 ui-kit。
- 样式归属：每个 class 只在一个 region 文件定义；颜色一律取 CSS 变量，禁止硬编码 hex（manifest/projection 除外）。
- 几何变量只写 `styles/tokens.css`，禁止散落到组件 CSS。
- TS strict；禁止 `any`、禁止非空断言（同块内运行时检查除外）。
- 逻辑改动必须有 vitest 单测（AGENTS.md 3.7）；纯 UI 改动用 Playwright 截图对照原型手动验收。
- 验证命令：`pnpm typecheck`、`pnpm test`（触及逻辑的包）、`pnpm --filter @piwin/desktop dev` 手动冒烟。
- 设计真相源：`docs/ui-prototype-v7.html` + `docs/proto-shell.css`（视觉验收基准，截图对照以它为准）。
- 不破坏存量功能：主题切换、artifact 沙箱映射、Mantine 色阶派生、Tauri overlay 红绿灯区。

---

## 0. 三个关键问题的结论（设计决策记录）

### Q1: 计划下拉（plan card）怎么实现？有通用组件吗？

**有，且数据已经流到前端了，只差渲染。**

- 数据通道已存在：`packages/contracts/src/plan.ts` 定义了 `SessionPlan` / `PlanStep` / `PlanStepStatus('pending'|'active'|'done'|'skipped')`；IPC 有 `plan/updated` push 事件（`ipc.ts:436`）；桌面端 `use-host-bootstrap.ts:167` 已订阅并维护 `sessionPlan` state。**只是没有任何组件渲染它**（`PlanPanel.tsx` 是完成但未接线的孤儿组件，其 drawer 编辑形态与原型不符，不复用）。
- 折叠容器：ui-kit 已有 `collapse.tsx`（动画折叠、保留 DOM），零新依赖。chevron 旋转用 CSS `[data-state]` / class 切换即可（原型 `proto-shell.css:115-118` 的模式）。
- 结论：新建 `apps/desktop/src/plan-card.tsx`（≈80 行），消费 `sessionPlan`，样式 1:1 移植原型 `.plan-card`。见 Task 9。

### Q2: 文件吐出（diff）渲染有通用组件吗？

**有两个层次的答案：**

1. **达到原型的静态效果（当前目标）**：原型的 diff 体是"行号 + 绿/红底行 + 等宽字体"，**没有语法高亮**。仓库现有 `apps/desktop/src/diff-view.tsx`（241 行，自研 unified diff 解析 + accept/reject）已具备同等能力，抽取其核心行渲染成新的 `DiffCard` 即可 100% 达到原型效果，**零新依赖**。这是本计划的方案（Task 11）。
2. **超越原型（语法高亮 diff）**：通用组件有 `@git-diff-view/react@0.1.7`（MIT，GitHub 风格 UI，提供 `diff-view-pure.css` 纯 CSS 版可用我们的 token 覆写，lowlight 语法高亮）。缺点是 pre-1.0 单维护者。放入 Phase D 作为 spike（Task 15），验证通过再替换，组件接口已隔离，替换成本小。

数据来源：write/edit 工具的 `ToolPresentation.changedPaths`（contracts 已有）→ 前端 lazy 调现有 IPC `git/diff-file`（`packages/agent-host/src/commands/git-commands.ts:47`，changes-panel 已在用）拿 unified diff。**不需要改 contracts 和 host**。

### Q3: 自己实现能达到原型效果吗？

**能，逐组件验证过：**

| 原型组件 | 技术实质 | 现有基础 | 结论 |
|---|---|---|---|
| 计划卡折叠 | CSS grid-rows 动画 + chevron rotate | ui-kit Collapse + 仓库已有同模式（settings-resources.css:428） | ✅ 无风险 |
| 工具卡 | flex 行 + 折叠 body | tool-call-card.tsx 已是此结构，纯换皮 | ✅ 无风险 |
| diff 卡 | 等宽行 + 行底色 | diff-view.tsx 解析器现成 | ✅ 无风险 |
| 审批门 | 卡片 + 按钮组 | permission-request-card.tsx 内容现成，改内联挂载 | ✅ 无风险 |
| 流式光标 | CSS steps() 闪烁 | 一行 CSS | ✅ 无风险 |
| composer 聚焦环 | `:focus-within` + box-shadow | 纯 CSS | ✅ 无风险 |
| 全局质感 | CSS 变量 + 发丝线 + 字重层级 | 投影机制现成 | ✅ 无风险 |

原型没有任何超出常规 CSS/flex/grid 能力的效果。**唯一不能 1:1 的是 Tauri 真红绿灯**：原型左上是假圆点，真实 app 用 Tauri overlay 原生红绿灯，titleband 只需让出左侧区域（现有 `--titleband-height: 36px` 机制已处理）。

---

## 1. 设计 Token 规格（Paper / Noir 全量值）

### 1.1 Manifest 替换（id 不变，内容替换，version 升 6.0.0）

保留 `piwin-light` / `piwin-dark` 两个 id（用户设置存储不迁移），name 改为 `Paper` / `Noir`。

| manifest token | Paper (light) | Noir (dark) | 投影到 |
|---|---|---|---|
| bg | `#f7f7f8` | `#000000` | --canvas/--bg |
| panel | `#ffffff` | `#0f0f0f` | --panel/--card |
| panel2 | `#f0f0f2` | `#171717` | --surface-inset/--sunken |
| border | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.08)` | --border/--line |
| text | `#1a1a1e` | `#f5f5f5` | --text |
| muted | `#5c5c66` | `#a3a3a3` | --muted |
| accent | `#2f6bed` | `#f5f5f5` | --accent（Noir 的 accent 就是白） |
| accent2 | `#5b86f0` | `#ffffff` | --accent-2 |
| danger | `#d64541` | `#eb3946` | --state-danger |
| ok | `#179b62` | `#3ecf8e` | --state-ok |
| radius/font | 不变 | 不变 | — |

### 1.2 新增派生变量（applyAppearanceToDocument 扩展，按 mode 分派）

| 变量 | Paper | Noir | 用途 |
|---|---|---|---|
| `--sidebar` | `#f2f2f4` | `#000000` | 侧栏/信号栏底 |
| `--card` | `#ffffff` | `#0f0f0f` | 计划/工具/diff/审批/composer 卡面 |
| `--control` | `#ececee` | `#171717` | 搜索框、btn 底 |
| `--sunken` | `#f0f0f2` | `#050505` | diff 体、工具体、命令块 |
| `--user-bubble` | `#ececee` | `#171717` | 用户气泡 |
| `--term-bg` | `#16181d` | `#050505` | 终端（亮色模式也用深底） |
| `--term-text` | `#b0b6c0` | `#b3b3b3` | 终端文字 |
| `--hover` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.06)` | 行 hover |
| `--selected` | `rgba(0,0,0,0.06)` | `rgba(255,255,255,0.10)` | 选中行 |
| `--faint` | `#a0a0a8` | `#595959` | 第三级文字 |
| `--line-strong` | `rgba(0,0,0,0.14)` | `rgba(255,255,255,0.15)` | 强分隔线/composer 边 |
| `--accent-fg` | `#ffffff` | `#000000` | accent 实心按钮上的字（Noir 反转！） |
| `--accent-soft` | `color-mix accent 10%` | `color-mix accent 10%` | mode-pill、code inline 底 |
| `--accent-ring` | `color-mix accent 18%` | `color-mix accent 18%` | 聚焦环、selection |
| `--warn` | `#b25000` | `#f5b83d` | 审批门标题/主按钮 |
| `--warn-fg` | `#ffffff` | `#1d1300` | warn 按钮上的字 |
| `--warn-line` | `rgba(178,80,0,0.3)` | `rgba(245,184,61,0.3)` | 审批门边框 |
| `--add-bg` | `rgba(23,155,98,0.10)` | `rgba(62,207,142,0.12)` | diff 新增行底 |
| `--add-text` | `#0e7a4c` | `#6fdcab` | diff 新增行字 |
| `--del-bg` | `rgba(214,69,65,0.08)` | `rgba(235,57,70,0.12)` | diff 删除行底 |
| `--del-text` | `#c13a36` | `#f08a92` | diff 删除行字 |

兼容策略：`--wb-term-bg`/`--wb-dim`/`--wb-send-fg` 等存量 `--wb-*` 别名重指到新值，不删除（现有 CSS 在引用）。

### 1.3 几何/排版（styles/tokens.css）

| 变量 | 现值 | 新值 | 说明 |
|---|---|---|---|
| `--sidebar-width` | 260px | **240px** | 对齐原型 |
| `--right-panel-width` | 280px | **300px** | 信号栏 |
| `--chat-max` | min(100%,960px) | **min(100%,780px)** | 对话列宽 |
| `--chat-font-size` | 15px | **13.5px** | 原型字号 |
| `--code-font-size` | 13px | **12px** | 等宽字号 |
| statusbar 高度 | 26px | **24px** | region-status-bar.css |
| `--titleband-height` | 36px | 不变 | Tauri 红绿灯约束 |

新增全局：scrollbar 6px 细滚动条、`::selection` 用 `--accent-ring`、`prefers-reduced-motion` 兜底（移植 `proto-shell.css:221-224`）。

---

## 2. 文件结构

**新增：**

| 文件 | 职责 |
|---|---|
| `apps/desktop/src/plan-card.tsx` | 计划折叠卡（sessionPlan → step 列表），ui-kit Collapse |
| `apps/desktop/src/diff-card.tsx` | 内联 diff 卡（changedPath → lazy git/diff-file → 行渲染 + 接受/拒绝） |
| `apps/desktop/src/gate-card.tsx` | 审批门内联卡（包装 permission-request-card 事实表 + 决策按钮） |
| `apps/desktop/src/plan-card.test.ts` | step 状态映射纯函数测试 |
| `apps/desktop/src/diff-card.test.ts` | diff 行解析/统计测试 |

**修改：**

| 文件 | 改动 |
|---|---|
| `apps/desktop/src/appearance-tokens.ts` | 替换两个 manifest 内容；applyAppearanceToDocument 新增 §1.2 全部派生变量 |
| `apps/desktop/src/appearance-tokens.test.ts`（若无则新建） | 投影单测：两个 mode 各断言关键变量 |
| `apps/desktop/src/styles/tokens.css` | §1.3 几何/排版 |
| `apps/desktop/src/styles/region-titlebar.css` | 移植 proto-shell titleband 段 |
| `apps/desktop/src/styles/region-sidebar.css` | 移植 sidebar 段 |
| `apps/desktop/src/styles/region-status-bar.css` | 移植 statusbar 段 |
| `apps/desktop/src/styles/region-inspector.css` | 信号栏 tabs/file-row/term/outline |
| `apps/desktop/src/styles/region-transcript.css` | 消息行/think/计划/工具/diff/审批/caret 全部对话样式 |
| `apps/desktop/src/styles/region-composer.css` | composer 卡 + 聚焦环 + hint |
| `apps/desktop/src/chat-thread.tsx` | 挂载 PlanCard / GateCard；user 消息包 bubble |
| `apps/desktop/src/tool-call-card.tsx` | V7 化 head（icon+verb+mono path+ok-dot+elapsed+chev） |
| `apps/desktop/src/App.tsx` | sessionPlan/permissionPrompt 传入 ChatThread；移除权限 modal 挂载 |
| `apps/desktop/src/app-dialogs.tsx` | 删除 permission modal（被 GateCard 替代） |
| `apps/desktop/src/hooks/use-host-bootstrap.ts` | 透传已有 sessionPlan（已存在，确认导出即可） |

**不动：** contracts、agent-host、ui-kit、artifact 沙箱、xterm-surface、MarkdownView（Phase D 再议）。

---

## Phase A — 主题基础

### Task 1: Paper/Noir manifest + 投影扩展

**Files:**
- Modify: `apps/desktop/src/appearance-tokens.ts:9-72`（两个 manifest）与 `applyAppearanceToDocument`（新增派生变量）
- Test: `apps/desktop/src/appearance-tokens.test.ts`（新建）

**Interfaces:**
- Produces: CSS 变量 `--card/--control/--sunken/--user-bubble/--term-bg/--term-text/--hover/--selected/--faint/--line-strong/--accent-fg/--accent-soft/--accent-ring/--warn/--warn-fg/--warn-line/--add-bg/--add-text/--del-bg/--del-text`，供后续所有 Task 的 CSS 消费。

- [ ] **Step 1: 写失败的投影测试**

```ts
// apps/desktop/src/appearance-tokens.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import {
  applyAppearanceToDocument,
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_LIGHT,
} from './appearance-tokens';

describe('applyAppearanceToDocument Paper/Noir projection', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
  });

  it('projects Paper light derived ramp', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_LIGHT);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--canvas').trim()).toBe('#f7f7f8');
    expect(s.getPropertyValue('--card').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--sidebar').trim()).toBe('#f2f2f4');
    expect(s.getPropertyValue('--sunken').trim()).toBe('#f0f0f2');
    expect(s.getPropertyValue('--user-bubble').trim()).toBe('#ececee');
    expect(s.getPropertyValue('--faint').trim()).toBe('#a0a0a8');
    expect(s.getPropertyValue('--accent').trim()).toBe('#2f6bed');
    expect(s.getPropertyValue('--accent-fg').trim()).toBe('#ffffff');
    expect(s.getPropertyValue('--warn').trim()).toBe('#b25000');
    expect(s.getPropertyValue('--add-text').trim()).toBe('#0e7a4c');
    expect(s.getPropertyValue('--del-text').trim()).toBe('#c13a36');
    expect(s.getPropertyValue('--term-bg').trim()).toBe('#16181d');
  });

  it('projects Noir dark derived ramp with inverted accent', () => {
    applyAppearanceToDocument(PIWIN_APPEARANCE_DARK);
    const s = document.documentElement.style;
    expect(s.getPropertyValue('--canvas').trim()).toBe('#000000');
    expect(s.getPropertyValue('--card').trim()).toBe('#0f0f0f');
    expect(s.getPropertyValue('--sidebar').trim()).toBe('#000000');
    expect(s.getPropertyValue('--sunken').trim()).toBe('#050505');
    expect(s.getPropertyValue('--faint').trim()).toBe('#595959');
    expect(s.getPropertyValue('--accent').trim()).toBe('#f5f5f5');
    // Noir: accent 是白，accent 上的字必须是黑
    expect(s.getPropertyValue('--accent-fg').trim()).toBe('#000000');
    expect(s.getPropertyValue('--warn').trim()).toBe('#f5b83d');
    expect(s.getPropertyValue('--add-text').trim()).toBe('#6fdcab');
    expect(s.getPropertyValue('--del-text').trim()).toBe('#f08a92');
  });

  it('keeps builtin theme ids stable for stored settings', () => {
    expect(PIWIN_APPEARANCE_LIGHT.id).toBe('piwin-light');
    expect(PIWIN_APPEARANCE_DARK.id).toBe('piwin-dark');
    expect(PIWIN_APPEARANCE_LIGHT.name).toBe('Paper');
    expect(PIWIN_APPEARANCE_DARK.name).toBe('Noir');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm --filter @piwin/desktop test -- appearance-tokens`
Expected: FAIL（`--card` 等变量不存在 / 旧 Daybreak 值不匹配）

- [ ] **Step 3: 替换 manifest 内容**

`apps/desktop/src/appearance-tokens.ts` 中两个 manifest 的 tokens 块替换为 §1.1 表格的值：

```ts
export const PIWIN_APPEARANCE_DARK: ThemeManifest = {
  id: 'piwin-dark',
  name: 'Noir',
  version: '6.0.0',
  description: 'Noir pure monochrome field with inverted white accent for piwin shell + artifacts',
  mode: 'dark',
  tokens: {
    bg: '#000000',
    panel: '#0f0f0f',
    panel2: '#171717',
    border: 'rgba(255, 255, 255, 0.08)',
    text: '#f5f5f5',
    muted: '#a3a3a3',
    accent: '#f5f5f5',
    accent2: '#ffffff',
    danger: '#eb3946',
    ok: '#3ecf8e',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(15, 15, 15, 0.98)',
    text: '#f5f5f5',
    muted: '#a3a3a3',
    accent: '#f5f5f5',
    border: 'rgba(255, 255, 255, 0.10)',
    radius: '0.625rem',
    font: SHARED_FONT,
  },
};

export const PIWIN_APPEARANCE_LIGHT: ThemeManifest = {
  id: 'piwin-light',
  name: 'Paper',
  version: '6.0.0',
  description: 'Paper cool white field with restrained blue accent for piwin shell + artifacts',
  mode: 'light',
  tokens: {
    bg: '#f7f7f8',
    panel: '#ffffff',
    panel2: '#f0f0f2',
    border: 'rgba(0, 0, 0, 0.08)',
    text: '#1a1a1e',
    muted: '#5c5c66',
    accent: '#2f6bed',
    accent2: '#5b86f0',
    danger: '#d64541',
    ok: '#179b62',
    radius: '10px',
    font: SHARED_FONT,
  },
  artifact: {
    bg: 'transparent',
    surface: 'rgba(255, 255, 255, 0.98)',
    text: '#1a1a1e',
    muted: '#5c5c66',
    accent: '#2f6bed',
    border: 'rgba(0, 0, 0, 0.10)',
    radius: '0.625rem',
    font: SHARED_FONT,
  },
};
```

- [ ] **Step 4: 在 applyAppearanceToDocument 追加派生变量**

在函数末尾（return 之前）追加，全部按 `isLight` 分派；同时把存量 `--wb-*` 别名重指：

```ts
  // ── Paper/Noir derived ramp (§1.2 of docs/plans/2026-07-30-paper-noir-theme-implementation.md)
  root.style.setProperty('--card', isLight ? '#ffffff' : '#0f0f0f');
  root.style.setProperty('--control', isLight ? '#ececee' : '#171717');
  root.style.setProperty('--sunken', isLight ? '#f0f0f2' : '#050505');
  root.style.setProperty('--sidebar', isLight ? '#f2f2f4' : tokens.bg);
  root.style.setProperty('--user-bubble', isLight ? '#ececee' : '#171717');
  root.style.setProperty('--term-bg', isLight ? '#16181d' : '#050505');
  root.style.setProperty('--term-text', isLight ? '#b0b6c0' : '#b3b3b3');
  root.style.setProperty('--hover', isLight ? 'rgba(0, 0, 0, 0.04)' : 'rgba(255, 255, 255, 0.06)');
  root.style.setProperty('--selected', isLight ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.10)');
  root.style.setProperty('--faint', isLight ? '#a0a0a8' : '#595959');
  root.style.setProperty('--line-strong', isLight ? 'rgba(0, 0, 0, 0.14)' : 'rgba(255, 255, 255, 0.15)');
  root.style.setProperty('--accent-fg', isLight ? '#ffffff' : '#000000');
  root.style.setProperty('--accent-soft', `color-mix(in srgb, ${tokens.accent} 10%, transparent)`);
  root.style.setProperty('--accent-ring', `color-mix(in srgb, ${tokens.accent} 18%, transparent)`);
  root.style.setProperty('--warn', isLight ? '#b25000' : '#f5b83d');
  root.style.setProperty('--warn-fg', isLight ? '#ffffff' : '#1d1300');
  root.style.setProperty('--warn-line', isLight ? 'rgba(178, 80, 0, 0.3)' : 'rgba(245, 184, 61, 0.3)');
  root.style.setProperty('--add-bg', isLight ? 'rgba(23, 155, 98, 0.10)' : 'rgba(62, 207, 142, 0.12)');
  root.style.setProperty('--add-text', isLight ? '#0e7a4c' : '#6fdcab');
  root.style.setProperty('--del-bg', isLight ? 'rgba(214, 69, 65, 0.08)' : 'rgba(235, 57, 70, 0.12)');
  root.style.setProperty('--del-text', isLight ? '#c13a36' : '#f08a92');
  // legacy --wb-* aliases repointed at the new ramp (existing CSS still reads them)
  root.style.setProperty('--wb-term-bg', isLight ? '#16181d' : '#050505');
  root.style.setProperty('--wb-dim', isLight ? '#a0a0a8' : '#595959');
  root.style.setProperty('--wb-send-fg', isLight ? '#ffffff' : '#000000');
```

注意：函数前面已有 `--faint`（L191）和 `--line-strong`（L219 附近）的旧赋值，**删除旧赋值**以新为准；`--sidebar` 旧赋值（L140 `tokens.bg`）同样替换。

- [ ] **Step 5: 跑测试确认通过 + 全量回归**

Run: `pnpm --filter @piwin/desktop test && pnpm typecheck`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/desktop/src/appearance-tokens.ts apps/desktop/src/appearance-tokens.test.ts
git commit -m "feat(desktop): replace Daybreak with Paper/Noir appearance manifests"
```

### Task 2: 几何与全局排版

**Files:**
- Modify: `apps/desktop/src/styles/tokens.css`
- Modify: `apps/desktop/src/styles/base.css`（scrollbar/selection/reduced-motion 若不在此则放 tokens.css 末尾）

- [ ] **Step 1:** 按 §1.3 表格改 6 个变量值（240/300/780/13.5/12/24px 中 statusbar 高度若在 region-status-bar.css 硬编码则同步改）。
- [ ] **Step 2:** 追加全局规则（移植 `proto-shell.css:221-224`）：

```css
::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 3px; }
::selection { background: var(--accent-ring); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
}
```

- [ ] **Step 3:** `pnpm typecheck` + dev 冒烟：窗口缩放到 1200px/800px 宽各截一张图，确认三列比例 ≈ 原型。
- [ ] **Step 4: Commit** `style(desktop): Paper geometry + global scrollbar/selection tokens`

---

## Phase B — 壳区域

### Task 3: Titleband

**Files:** Modify `apps/desktop/src/styles/region-titlebar.css`（JSX 大概率不动，现有 `WorkspaceTitlebar` 有 crumb 和按钮；缺什么补什么）

- [ ] 移植 `proto-shell.css:66-84`（`.titleband/.tb-btn/.tb-crumb/.tb-right`），类名映射到现有 titlebar 类；左 padding 保留 Tauri 红绿灯让位（现有机制，勿动）。
- [ ] 验收：截图对照原型头部——12px crumb、faint 分隔符、26px 方按钮 hover 底。
- [ ] Commit `style(desktop): Paper titlebar`

### Task 4: Sidebar

**Files:** Modify `apps/desktop/src/styles/region-sidebar.css`；`ProjectSessionSidebar` JSX 按需微调（搜索 pill 的 ⌘K kbd、"新建 Agent" accent 实心按钮、sess 行 meta 的 live 点）

- [ ] 移植 `proto-shell.css:86-125`（sb-search/sb-new/sb-sec/proj-row/sess/active 指示条/sb-foot）。active 指示条 = `::before` 2px accent 竖条（原型 `:76`）。
- [ ] "新建 Agent"按钮用 `--accent` 底 + `--accent-fg` 字（Noir 下自动变白底黑字，这是反转设计的核心验收点）。
- [ ] 验收：Paper/Noir 各截一张侧栏图。
- [ ] Commit `style(desktop): Paper sidebar`

### Task 5: Statusbar

**Files:** Modify `apps/desktop/src/styles/region-status-bar.css`；`StatusBar` JSX 增加 run 相位文案（数据 `activeRunPhase/activeRunStartedAt/contextUsage` 已在 state）

- [ ] 高度 24px、10.5px 字号、`--faint` 色；左侧：live 点 + "agent 运行中 · 步骤 n/m"（相位文案从 `activeRunPhase` 映射）+ context tokens（`contextUsage`）+ 计时；右侧：RPC 状态 + 权限 mode。移植 `proto-shell.css:208-213`。
- [ ] 验收：跑一个 mock run（hostMock），截图。
- [ ] Commit `style(desktop): Paper statusbar`

### Task 6: 信号栏（right panel）

**Files:** Modify `apps/desktop/src/styles/region-inspector.css`；RightPanel tab 栏 JSX

- [ ] tabs 改为 V7 置顶页签样式（`proto-shell.css:185-194`：圆角顶、on 态 `--card` 底 + 下缘覆盖线）。现有 tabs 收敛为三个主 tab：更改 / 终端 / 大纲（其余 tab 保留在溢出菜单，不在本轮删除功能）。
- [ ] "更改"pane 文件行：`.file-row`（mono 11px + `.tag` 的 +add/−del，`:195-200`）。数据用现有 ChangesPanel 的 git summary。
- [ ] "大纲"pane：渲染 chat state 已有的 `outline: SessionOutlineNode[]` 为 `.outline-item` 列表（`:204-206`）。
- [ ] "终端"pane：复用现有 xterm surface，背景 var(--term-bg)。
- [ ] 验收：三个 tab 切换截图。
- [ ] Commit `style(desktop): Paper signal panel tabs`

---

## Phase C — 对话核心

### Task 7: 消息行

**Files:** Modify `apps/desktop/src/styles/region-transcript.css`；`chat-thread.tsx` 的 user 分支包一层 `.bubble`

- [ ] user：右对齐、max-width 72%、`--user-bubble` 底 + `--line` 边 + `12px 12px 4px 12px` 圆角（`proto-shell.css:104-105`）。
- [ ] assistant：无气泡平铺；meta 行 12px 名 + 10.5px faint 时间（`:101-103`）。
- [ ] inline code：`--accent-soft` 底 + accent 字（`:108`）。
- [ ] 验收：双主题截图对照。
- [ ] Commit `style(desktop): Paper message rows`

### Task 8: think 行 + 流式光标

**Files:** Modify `region-transcript.css`

- [ ] `.think`：三点脉冲 + faint 文案（`proto-shell.css:157-163`，含 nth-child animation-delay）。
- [ ] `.stream-caret`：7×14 accent 块 steps 闪烁（`:155-156`），挂到流式消息末尾（chat-thread 流式分支）。
- [ ] Commit `style(desktop): thinking row + stream caret`

### Task 9: PlanCard（计划下拉）★

**Files:**
- Create: `apps/desktop/src/plan-card.tsx`
- Create: `apps/desktop/src/plan-card.test.ts`
- Modify: `apps/desktop/src/chat-thread.tsx`（assistant 区顶部挂载）
- Modify: `apps/desktop/src/App.tsx`（`sessionPlan` 从 use-host-bootstrap 透传到 ChatThread）

**Interfaces:**
- Consumes: `SessionPlan`（`@piwin/contracts` plan.js）、ui-kit `Collapse`。
- Produces: `<PlanCard plan={SessionPlan} defaultOpen?: boolean />`。

- [ ] **Step 1: 状态映射纯函数 + 失败测试**

```ts
// apps/desktop/src/plan-card.test.ts
import { describe, expect, it } from 'vitest';
import { planStepVisual } from './plan-card';

describe('planStepVisual', () => {
  it('maps contract status to visual state', () => {
    expect(planStepVisual('done')).toBe('done');
    expect(planStepVisual('active')).toBe('run');
    expect(planStepVisual('pending')).toBe('pending');
    expect(planStepVisual('skipped')).toBe('skipped');
  });
});
```

- [ ] **Step 2: 实现 PlanCard**

```tsx
// apps/desktop/src/plan-card.tsx
import { useState } from 'react';
import type { PlanStepStatus, SessionPlan } from '@piwin/contracts';
import { Collapse } from '@piwin/ui-kit';

export type PlanStepVisual = 'done' | 'run' | 'pending' | 'skipped';

/** Maps contract step status to the V7 visual state machine (.step.done/.run/.skipped). */
export function planStepVisual(status: PlanStepStatus): PlanStepVisual {
  switch (status) {
    case 'done': return 'done';
    case 'active': return 'run';
    case 'skipped': return 'skipped';
    default: return 'pending';
  }
}

export function PlanCard({ plan, defaultOpen = true }: { plan: SessionPlan; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`plan-card${open ? '' : ' closed'}`} data-testid="plan-card">
      <button type="button" className="plan-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="plan-title">计划 · {plan.steps.length} 步（{plan.title}）</span>
        <svg className="chev ic" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <Collapse open={open}>
        <div className="plan-steps">
          {plan.steps.map((step) => {
            const visual = planStepVisual(step.status);
            return (
              <div key={step.id} className={`step ${visual === 'pending' ? '' : visual}`}>
                <span className="box">{visual === 'done' ? '✓' : ''}</span>
                {step.title}
              </div>
            );
          })}
        </div>
      </Collapse>
    </div>
  );
}
```

- [ ] **Step 3: CSS**（`region-transcript.css`，移植 `proto-shell.css:111-125`：卡片底 `--card`、head hover、chev 200ms 旋转、step box 三态 + skipped 补划线和 faint）

- [ ] **Step 4: 接线**：App.tsx 把 `sessionPlan` 传入 ChatThread；assistant 消息区顶部（TurnWorkDetails 之前）渲染 `{plan && <PlanCard plan={plan} />}`（plan 为 session 级，挂在对话流顶部一条即可，不按消息锚定）。

- [ ] **Step 5: 验证**：`pnpm --filter @piwin/desktop test -- plan-card` PASS；mock host 触发 `plan/set` → dev 截图对照原型。
- [ ] **Step 6: Commit** `feat(desktop): inline plan card wired to session plan state`

### Task 10: ToolCallCard V7 化

**Files:** Modify `apps/desktop/src/tool-call-card.tsx` + `region-transcript.css`

- [ ] head 行：kind 图标（lucide，`strokeWidth={1.7}`）+ 动词文案 + mono `--text` path + ok-dot（done）/ 错误红（error）+ mono elapsed + chev。现有数据结构不动，只重排。
- [ ] body：`--sunken` 底 + 顶发丝线（`proto-shell.css:129-130`）。
- [ ] 保留现有三种密度偏好与 output 截断逻辑。
- [ ] 验收：mock 一轮带 read/bash 工具的 run，截图。
- [ ] Commit `style(desktop): Paper tool call card`

### Task 11: DiffCard（文件吐出渲染）★

**Files:**
- Create: `apps/desktop/src/diff-card.tsx` + `apps/desktop/src/diff-card.test.ts`
- Modify: `apps/desktop/src/tool-call-card.tsx`（write/edit 类工具且 presentation.changedPaths 非空时 body 渲染 DiffCard）
- 复用: `apps/desktop/src/diff-view.tsx` 的 `parseUnifiedDiff`（L29）——导出它而不是复制。

**Interfaces:**
- Consumes: `parseUnifiedDiff(patch: string): ParsedDiffLine[]`（diff-view.tsx:29 已导出，`ParsedDiffLine = { kind: 'meta'|'hunk'|'context'|'add'|'del'|'blank'; text: string }`，add/del/context 的 text 已去掉前导符）；host IPC `git/diff-file`，调用与解包照抄 changes-panel.tsx:134-146（`request({ type: 'git/diff-file', projectPath, path, scope: 'combined' })` → `HostResponse.success` → `(response.data as { diff: GitFileDiff }).diff`，取 `.patch` 渲染；`GitFileDiff = { path; scope; isBinary; patch; truncated; additions?; deletions? }`，contracts/git.ts:67）。
- Produces: `<DiffCard projectPath={string} path={string} request={DiffCardRequest} onReview?={(path, ok) => void} />`；`diffLineStats(diff: string): { adds: number; dels: number }`。

- [ ] **Step 1: 统计纯函数失败测试**

```ts
// apps/desktop/src/diff-card.test.ts
import { describe, expect, it } from 'vitest';
import { diffLineStats } from './diff-card';

describe('diffLineStats', () => {
  it('counts add/del lines excluding file headers', () => {
    const diff = [
      '--- a/settings-shell.tsx',
      '+++ b/settings-shell.tsx',
      '@@ -41,2 +42,5 @@',
      ' export function SettingsShell() {',
      "-  const [page, setPage] = useState('general')",
      '+  return (',
      '+    <Routes base="/settings">',
    ].join('\n');
    expect(diffLineStats(diff)).toEqual({ adds: 2, dels: 1 });
  });
  it('handles empty diff', () => {
    expect(diffLineStats('')).toEqual({ adds: 0, dels: 0 });
  });
});
```

- [ ] **Step 2: 实现 DiffCard**（完整实现；视觉结构 1:1 对原型 `ui-prototype-v7.html:237-278`）

```tsx
// apps/desktop/src/diff-card.tsx
import { useEffect, useMemo, useState, type ReactElement } from 'react';
import type { GitFileDiff } from '@piwin/contracts';
import type { HostResponse } from '@piwin/contracts';
import { parseUnifiedDiff } from './diff-view';

/** 与 changes-panel.tsx:38 注入的 request 同一签名。 */
export type DiffCardRequest = (command: {
  type: 'git/diff-file';
  projectPath: string;
  path: string;
  scope?: 'worktree' | 'staged' | 'combined';
}) => Promise<HostResponse>;

export function diffLineStats(diff: string): { adds: number; dels: number } {
  let adds = 0;
  let dels = 0;
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) adds += 1;
    else if (line.startsWith('-')) dels += 1;
  }
  return { adds, dels };
}

type DiffState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; fileDiff: GitFileDiff };

export function DiffCard(props: {
  projectPath: string;
  path: string;
  request: DiffCardRequest;
  onReview?: (path: string, ok: boolean) => void;
}): ReactElement {
  const [state, setState] = useState<DiffState>({ kind: 'loading' });
  const [verdict, setVerdict] = useState<'accepted' | 'rejected' | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ kind: 'loading' });
    // 与 changes-panel.tsx:129-149 同一调用与响应解包模式
    void props
      .request({
        type: 'git/diff-file',
        projectPath: props.projectPath,
        path: props.path,
        scope: 'combined',
      })
      .then((response) => {
        if (cancelled) return;
        if (!response.success) {
          setState({ kind: 'error', message: response.error });
          return;
        }
        setState({ kind: 'ready', fileDiff: (response.data as { diff: GitFileDiff }).diff });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ kind: 'error', message: String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [props.projectPath, props.path]);

  const patch = state.kind === 'ready' ? state.fileDiff.patch : '';
  const lines = useMemo(() => parseUnifiedDiff(patch), [patch]);
  const stats = diffLineStats(patch);

  return (
    <div className={`diff-card${verdict === 'accepted' ? ' accepted' : ''}`} data-testid="diff-card">
      <div className="diff-head">
        <span className="file">{props.path}</span>
        <span className="stat num">
          {stats.adds > 0 && <span className="add">+{stats.adds}</span>}
          {stats.dels > 0 && <span className="del">−{stats.dels}</span>}
        </span>
        {verdict === null && state.kind === 'ready' ? (
          <div className="diff-actions">
            <button className="btn" onClick={() => { setVerdict('rejected'); props.onReview?.(props.path, false); }}>
              拒绝
            </button>
            <button className="btn primary" onClick={() => { setVerdict('accepted'); props.onReview?.(props.path, true); }}>
              接受
            </button>
          </div>
        ) : verdict !== null ? (
          <span className={`review-badge ${verdict}`}>{verdict === 'accepted' ? '已接受' : '已拒绝'}</span>
        ) : null}
      </div>
      {state.kind === 'loading' && <div className="tool-body"><span className="dim">// 加载 diff…</span></div>}
      {state.kind === 'error' && <div className="tool-body"><span className="dim">// {state.message}</span></div>}
      {state.kind === 'ready' && state.fileDiff.isBinary && (
        <div className="tool-body"><span className="dim">// 二进制文件，无文本 diff</span></div>
      )}
      {state.kind === 'ready' && !state.fileDiff.isBinary && (
        <div className="diff-body">
          {lines
            .filter((l) => l.kind !== 'meta' && l.kind !== 'hunk')
            .map((l, i) => (
              <div key={i} className={`ln ${l.kind === 'add' ? 'add' : l.kind === 'del' ? 'del' : 'ctx'}`}>
                <span className="g">{i + 1}</span>
                {l.text}
              </div>
            ))}
          {state.fileDiff.truncated && <div className="ln ctx"><span className="g" />// diff 过长已截断</div>}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: CSS**（`region-transcript.css`，移植 `proto-shell.css:131-147`：head/stat/btn/diff-body/.ln 三色 + `.accepted` 态描边 `--ok`；`.review-badge` 10.5px faint）
- [ ] **Step 4: 接线**：tool-call-card 的 write/edit 分支 body 改为 `<DiffCard projectPath={projectPath} path={changedPath} request={request} />`（多 path 逐个渲染；`projectPath`/`request` 沿 ChangesPanel 同款注入链从 App 透传——执行时先 grep `ChangesPanel` 在 App.tsx 的挂载点复制其 props 来源）；原 raw output 折叠到 DiffCard 之下的 details。
- [ ] **Step 5: 验证**：test PASS；mock run 写一个文件 → 截图对照原型 diff 卡。
- [ ] **Step 6: Commit** `feat(desktop): inline diff card for write/edit tool calls`

### Task 12: GateCard（审批门内联）★

**Files:**
- Create: `apps/desktop/src/gate-card.tsx`
- Modify: `apps/desktop/src/chat-thread.tsx`（`permissionPrompt` 非空时在流末尾渲染）
- Modify: `apps/desktop/src/App.tsx`（prompt + 现有 respond handler 传入 ChatThread）
- Modify: `apps/desktop/src/app-dialogs.tsx`（删除 permission modal 分支）

- [ ] **Step 1:** GateCard 结构 1:1 对原型（`ui-prototype-v7.html:279-300`）：`.gate`（`--warn-line` 边）→ gate-head（warn 色警告图标 + "需要审批 · {action}"）→ gate-cmd（`--sunken` mono 命令块）→ gate-actions（warn 实心"允许一次" / 描边"总是允许" / 描边"拒绝" + hint "权限: {mode}"）。事实表复用 `permission-request-card.tsx` 的 per-kind 渲染，嵌在 gate-cmd 区域。
- [ ] **Step 2:** 三个按钮复用 app-dialogs 现有 respond 逻辑（allow-once / allow-remember / deny），handler 从 App 透传。
- [ ] **Step 3: CSS** 移植 `proto-shell.css:148-154`。
- [ ] **Step 4: 验证**：mock 触发 `pnpm test` 类 ask 权限 → 截图；确认 modal 不再弹出、Esc/焦点行为不回归（gate 非模态，run 继续等待）。
- [ ] **Step 5: Commit** `feat(desktop): inline permission gate replaces modal prompt`

### Task 13: Composer

**Files:** Modify `region-composer.css`；`composer-dock.tsx` 加 hint 行

- [ ] 卡：`--card` 底 + `--line-strong` 边 + 12px 圆角；`:focus-within` → accent 边 + `0 0 0 3px --accent-ring`（`proto-shell.css:166-167`）。
- [ ] bar 按钮 26px、cbtn hover；model 芯片描边；send 28px accent 实心 + `:active scale(0.92)`（`:171-181`）。
- [ ] 卡下 hint 行："⏎ 发送 · ⇧⏎ 换行 · ⌘K 命令 · Esc 中断"（10.5px `--faint` 居中，`:182`）。
- [ ] 保留现有 plus 菜单 / slash 菜单 / thinking 控件 / context ring / 附件 chips 全部功能，仅换皮。
- [ ] Commit `style(desktop): Paper composer`

---

## Phase D — 质量升级（可选，逐个 spike 决策，不在本轮承诺范围）

### Task 14: Markdown 渲染升级（react-markdown + remark-gfm + shiki）

动机：现有自研 MarkdownView 不支持链接/表格/标题，代码块零高亮。升级可超越原型。
风险：shiki 全量 ~280KB gzip + WASM 异步初始化；需 fine-grained bundle + fallback 纯 code。
隔离：新 `MarkdownViewV2` 组件并存，feature flag 切换，mermaid/katex/artifact fence 分支原样保留。
**决策门：spike 分支上对照 10 条真实会话渲染，首屏可接受才合入。**

### Task 15: 语法高亮 diff（@git-diff-view/react spike）

动机：diff 卡从"原型级"升到"GitHub 级"。
方案：`diff-view-pure.css` + 我们的 token 覆写；包在 DiffCard 同一 props 接口后。
**决策门：spike 验证 Paper/Noir 双主题配色可 100% 用 CSS 变量覆盖（不允许出现硬编码色）；不通过则保持 Task 11 自研实现。**

### Task 16: Transcript 虚拟滚动评估

动机：长会话渲染成本。
方案：`@tanstack/react-virtual@3.14+`（end-anchor chat API）。
**决策门：先测量——200 条含 diff 卡消息的滚动帧率，低于 50fps 才做。**

---

## 风险

| # | 风险 | 缓解 |
|---|---|---|
| R1 | 存量 CSS 引用旧变量名（--wb-*、--surface-* 别名族）换主题后断裂 | Task 1 保留并重指全部别名；Task 2 后全量 `pnpm test` + 双主题截图巡检设置页 |
| R2 | Noir 的 accent=白导致 Mantine 派生色阶全灰 | buildMantineTheme 的 accent 输入对 Noir 改用 `--state-ok` 之外的中性蓝 `#2f6bed` 兜底？——**执行时先截图看效果，若 Mantine 组件（Switch/Slider/SegmentedControl）发灰再决定**，不预先改 |
| R3 | DiffCard 的"拒绝"只是 UI 标记，不真实 revert | 原型语义即 reviewed 标记；真实 revert（git apply -R）单独立项，不在本计划 |
| R4 | 权限 modal 删除后 CLI/其他入口仍依赖 | modal 只在 desktop app-dialogs；CLI 走自己的权限 UI。执行时 grep `permission-dialog` 确认无其他引用再删 |
| R5 | chat-max 960→780 让宽屏大片留白 | 原型即此设计（Linear/Claude 同构）；用户反馈过宽再调 |
| R6 | PlanCard 挂在流顶部与原型"流内锚定"有差异 | 原型是静态 mock；session 级 plan 挂顶部是诚实映射。后续 host 若按 run 发 plan 再改锚定 |

## 验收总清单（全部 Task 完成后）

- [ ] `pnpm typecheck` 绿
- [ ] `pnpm test` 绿（desktop 包全量）
- [ ] `docs/ui-prototype-v7.html` 与 dev app 同尺寸窗口并排截图：titleband / 侧栏 / 对话列 / 信号栏 / statusbar 五区域肉眼无差异（Tauri 红绿灯除外）
- [ ] 切到 Noir：accent 反转为白底黑字按钮、发丝线可见、diff 行色可读
- [ ] mock run 全流程：计划卡出现并可折叠 → 工具卡耗时/状态正确 → write 工具出 diff 卡 → ask 权限出内联门 → 流式光标闪烁 → 完成后 statusbar 归位
- [ ] 主题切换无闪烁（applyAppearanceToDocument 仍在 layout effect 阶段执行）
