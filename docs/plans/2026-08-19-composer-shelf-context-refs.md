# Composer 分流区引用入口（2026-08-19）

> 状态：Slice A–D 已落地（D 用回归测试锁老入口；真机点选用验收清单）  
> 范围：Desktop 对话划词 → 分流区胶囊。不重做文件树 / `@` / 文档 comment / 终端菜单。  
> 关联：`docs/specs/context-menu-surfaces.md`（CM-10 / §9.5 L14）、`docs/plans/2026-08-19-composer-attachment-shelf.md`、`PromptContextRef.kind = 'selection'`

## 0. 为什么做

分流区（输入框上方那层卡）已经能**显示**引用胶囊。缺的是对话里最常用的入口：

划一段模型/用户文字 → 右键「添加到对话」→ 上面出一张引用卡，**不写进输入框**。

现在右键整条气泡只有：

- 「添加到对话」= 整条消息（`main-message`）
- 「引用到输入框」= 把 `> 引用` 塞进打字区（和分流区目标相反）

划词没有独立菜单。文档 comment、终端、文件树是老入口，本计划不新造，只在最后烟一遍。

## 1. 做 / 不做

### 做（就这三刀）

1. **对话划词 → `selection` 胶囊**进分流区。  
2. **有划词时右键用选区菜单**，没划词才用整条气泡菜单。  
3. **有划词时主动作是「添加到对话」**，不再把引用写进 textarea。

### 不做

- 聊天气泡行内 comment（文档预览那套已有，不搬到对话）
- 新合同 / 新 Host resolve（已有 `kind: 'selection'`）
- 胶囊悬停代码高亮、点胶囊跳编辑器
- 系统截屏、Token 预估
- 工具卡内部再划一小段（整张工具卡已能加）
- 改「引用到输入框」在**无划词**时的整条消息行为（保持原样）

## 2. 行为规格

```text
气泡内按下右键
  ├─ 选区非空、且选区落在本气泡内
  │     菜单 = selection 菜单（添加到对话 / 询问 / 解释 / 复制）
  │     「添加到对话」→ addContextRef({ kind: 'selection', snapshotText, label })
  │     分流区出现引用胶囊；textarea 不插入 > 引用
  └─ 选区为空或选区不在本气泡
        菜单 = 现有 message 菜单（复制 / 引用到输入框 / 整条添加到对话 / …）
```

约束：

- 空选区不打开 selection 菜单（CM spec 已有）。
- 选区截断 8000 字（与 `map-to-ref.ts` / `CodePreviewView` 一致）。
- 代码围栏已有 `code-block` 菜单：围栏上右键仍走围栏菜单，不抢。
- 胶囊文案：`selection` + 截断标签（现有 `formatContextRefChipCaption`）。
- 发送仍走现有 `PromptInput.contextRefs`，Host 已能 resolve selection。

「引用到输入框」：仅出现在**整条消息**菜单。划词菜单里不要这项。

## 3. 实现步骤

### Slice A — 从气泡读出选区 target

仿 `code-preview-view.ts` 的 `computeSelectionTarget`、`xterm-surface.tsx` 的右键读选区。

| 文件 | 改动 |
|---|---|
| **新建** `apps/desktop/src/transcript-selection-target.ts` | 纯函数：`window.getSelection()` + 气泡根节点 → `ContextMenuTarget \| null`（`surface: 'selection'`，带 `snapshotText` / `label`） |
| **新建** `transcript-selection-target.test.ts` | 空选区、选区在气泡外、截断 8000、label 取首行截断 |

气泡没有可靠文件路径时，不要升级成 `kind: 'file'`，保持 `selection`。

### Slice B — 消息右键按选区切换菜单

| 文件 | 改动 |
|---|---|
| `chat-message-row.tsx` | 不要把 `messageTarget` 写死传给 `ContextMenuFromCatalog`。`onContextMenu` 时：有选区用 selection target，否则用现有 message target |
| `context-menu/ContextMenuFromCatalog.tsx` | 若现 API 只吃静态 `target`，给消息菜单一条「打开时解析 target」的口子；能在 row 内用 state（与 xterm 相同）就不必改 catalog 组件 |

嵌套：`MarkdownView` 的 `CodeBlockContextMenu` 包住围栏。围栏上的右键继续由围栏菜单处理（更内层）。只处理**围栏外正文**的划词。

### Slice C — 确认 dispatch 已够用

`dispatch.ts` 的 `add-to-chat` 已经 `mapTargetToContextRef` + `addToChat`。App 的 `addToChat` 已经 `addContextRef`。  
Slice A 产出合法 `selection` target 后，**不应再改 Host / contracts**。

补测试：

- `map-to-ref.test.ts`：无 path 的 transcript selection → `kind: 'selection'`
- `dispatch.test.ts`：该 target 的 `add-to-chat` 只 `addToChat`，不 `quoteInComposer`
- `chat-message-row` 或小型 wrapper 测试：有选区时菜单 testid/项含 `add-to-chat`，不含 `quote-in-composer`

### Slice D — 老入口烟（不改代码除非坏了）

手动过一遍，坏了单开修复，不塞进划词 PR：

1. 文件树「添加到对话」  
2. `@` 文件  
3. 整条气泡「添加到对话」（无划词）  
4. 代码围栏「添加到对话」  
5. 文档预览行 comment → 批注胶囊  
6. 终端划词「添加到对话」  
7. 报错条 / 工具卡「添加到对话」

## 3.1 进度（2026-08-19）

| Slice | 状态 | 落地 |
|---|---|---|
| A 读选区 | 已做 | `transcript-selection-target.ts`：空选区 / 气泡外 / 围栏内 / 8000 截断 |
| B 菜单切换 | 已做 | `chat-message-row` 在 `contextmenu` 当下写入 ref；`ContextMenuFromCatalog.resolveTarget` 在 portal 挂载时读 |
| C 测试 | 已做 | 选区菜单第一项 `add-to-chat`、无 `quote-in-composer`；dispatch 只 `addToChat` |
| D 烟老入口 | 已做 | `composer-shelf-entry-points.test.ts` + `@` → `contextRefFromAtItem`；气泡菜单抽出 `message-bubble-context-menu.tsx`（围栏不抢） |

## 4. 验收

1. 助手气泡里划一段字，右键第一项是「添加到对话」；点完分流区多一张引用胶囊；输入框没有 `>`。  
2. 同一气泡不划词再右键，仍是整条消息菜单，「引用到输入框」仍把引用写进 textarea。  
3. 代码围栏右键行为与现在一致。  
4. 中文 IME 选字过程中右键不误开选区菜单（选区 collapsed 则走消息菜单）。  
5. 现有 CM unit 测试仍绿。

## 5. Review（2026-08-19，未真机）

主路径对齐计划，单测覆盖选区切换 / 围栏不抢 / 老入口 map。未改代码，留给统一手测。

值得盯的：

- 报错条 (`turn-error-card`) / diff 卡不在 nested-host 选择器里。内层 Radix 通常会赢；若划词后右键变成整条消息菜单，再补选择器。
- `resolvedRef` 在两次右键之间会留下一次结果。下一次 `contextmenu` 会重写；若某条打开路径没走到 `onContextMenu`，可能仍显示上一次选区菜单。
- 选区菜单把「添加到对话」提前到第一项，文档预览里的代码划词菜单顺序也一起变了。

## 6. 风险

- **双重菜单**：围栏菜单 + 气泡菜单抢右键。处理：选区在围栏内不在气泡层改 target。  
- **`ContextMenuFromCatalog` 打开时 target 已过期**：必须在 `contextmenu` 当下读 `getSelection()`，不要用 render 时的选区。  
- **Conversation vs Agent 气泡 DOM 不同**：`computeSelectionTarget` 吃气泡根节点，不要绑死某一种 markdown 结构。
