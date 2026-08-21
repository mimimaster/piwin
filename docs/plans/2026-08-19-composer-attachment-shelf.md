# Composer 分流区实施计划（2026-08-19）

> 范围：Desktop Composer 上方分流区。数据管道（粘贴/拖放/暂存/发送）不动。
> 关联：`docs/specs/composer-attachment-shelf-prd.md`、ADR 0041、ADR 0045

## 1. 现有功能盘点（已有，不要重做）

Composer **已经是三段式**：附件行 → textarea → toolbar。缺的是明确分界线和统一封装。

| 能力 | 状态 | 代码 |
|---|---|---|
| 粘贴分流（图 / 文件 / 文本） | 已有 | `hooks/use-composer-media.ts` |
| 拖放（桌面文件 + 工作区树） | 已有 | 同上 + `workspace-path-drag` |
| `+` 菜单挂图片/文件 | 已有 | `composer-plus-menu.tsx` |
| `@` 提及同时生成 File/Folder 卡 | 已有 | `composer-dock.tsx` `applyAtItem` |
| 右键选区 / 文件树 → 胶囊 | 已有 | `context-menu/map-to-ref.ts` → `use-composer-context-refs.ts` |
| 选中文字 `selection` 引用 | 合同已有 | `PromptContextRef.kind = 'selection'` |
| 文档批注卡 | 已有 | `App.tsx` `docCommentsAttachment`，JSX 内联在 dock |
| 失败重试 / 发送确认 | 已有 | dock 失败行 + Dialog；ADR 0045 |
| 纯文本模型黄条 | 已有 | dock 里和芯片混排 |
| 图片 Lightbox | 已有 | `MediaPreview.tsx` |
| 空则不渲染附件行 | 已有 | 但有卡片时没有硬分界线 |

**本轮不碰：** `use-composer-media.ts`（2206 行，管道已工作）、Host prompt 解析、contracts、`message-attachments.tsx`（会话气泡）、Mobile、`chat-message-edit-card.tsx`（编辑态故意关掉附件）。

## 2. 真正要改的

`composer-dock.tsx`（1482 行，已超 1000 行上限）把分流 UI 散装写在卡片里：批注、ContextRef、媒体、Web 元素、失败行、黄条全挤在一个 flex wrap 里，和输入区没有明确分割线。

抽出 **一个分流区组件**，输入框永远干净。

```text
┌─ Composer 卡片（已有边框）─────────────────────┐
│  [黄条，可选]                                   │  ← 分流区，空则整层不出现
│  [图 56×56] [选区胶囊] [文件胶囊] [批注胶囊]     │
│  [失败原因 + 重试/移除，可选]                    │
│─────────────────────────────────────────────────│  ← 硬分界线
│  textarea                                        │
│  [+] 模型 …                              发送    │
└─────────────────────────────────────────────────┘
```

## 3. 文件级改动

| 动作 | 文件 | 原因 |
|---|---|---|
| **新建** | `composer-attachment-shelf.tsx` | 分流区唯一入口：黄条 / 芯片 / 失败行 / 分界线 |
| **新建** | `composer-attachment-shelf.test.tsx` | 空隐藏、有卡显示、Backspace 弹出目标 |
| **改** | `composer-dock.tsx` | 删内联分流 JSX；空输入 + 光标 0 时 Backspace 弹最后一张卡 |
| **改** | `context-ref-chip.tsx` | 文件选区显示 `文件:行-行`；文字选区显示 selection 胶囊 |
| **改** | `region-composer.css` | 分界线、56×56 缩略图、分流区 max-height 160px |
| **改** | `composer-dock.test.tsx` | 补 Backspace / 空态 / 分界线 |

Desktop 现有约定是 `src/` 下 kebab-case 平铺，**不**新建 `components/composer/` 目录。

## 4. 明确不删 / 不重写

- 失败行 + 发送确认 Dialog：ADR 0045 行为，不是屎山。
- `use-composer-media` / `use-composer-context-refs`：状态机留下，Shelf 只吃 props。
- 不新造 `CardKind` 合同：现有 `PromptAttachment` + `PromptContextRef` 已覆盖图片、文件、选区、组件/消息引用。

## 5. 本轮验收

1. 无附件时分流区 DOM 不存在，不占高度。
2. 有任一张卡时，分流区与 textarea 之间有一条可见分割线。
3. 图片、代码选区、文字/组件引用、批注都只出现在这条线上方。
4. 输入框为空且光标在开头时，Backspace 移除最后一张卡；有文字时只删文字。
5. 中文 IME 合成中不误删卡。
6. 现有失败重试、Vision 黄条、粘贴/拖放测试仍绿。

## 6. 进度（2026-08-19）

Phase 1 已落地。Phase 2 继续：GIF / 大图分辨率角标、分流区 180ms 展开、终端/报错胶囊图标、键盘巡检（Shift+Tab / 方向键 / Delete / Space）。

**明确跳过：** 发送前 Token 预估（F5.1）。底部 Usage Ring 已经是发完后的真实占用，不再另做客户端瞎算。

Lightbox 点击放大沿用 `MediaPreview`，不重做。终端「Add to Chat」数据通路已有，本轮只补分流区上的胶囊外观。
