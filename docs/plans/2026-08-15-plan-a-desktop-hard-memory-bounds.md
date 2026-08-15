# Plan A: 桌面端硬内存边界与即刻防爆 (Plan A: Desktop Hard Memory Bounds & Immediate Defense)

> **目标**：在不依赖虚拟化和 Worker 的前提下，通过严格的 UI 数据窗口、零 DOM 折叠卸载、长代码纯文本熔断，**立即封死内存无界增长的漏洞**。
> **优先级**：P0（第一执行批次）

---

## 1. 真实事故压力测试夹具与诊断指标 (Phase 0)

### 1.1 诊断指标模块
- **目标文件**: `apps/desktop/src/diagnostic-metrics.ts` (NEW)
- 仅在开发环境收集，用于精准衡量渲染压力：
  - `mountedTranscriptItems`: `.chat-stream` 下挂载的 Render Item 总数
  - `mountedCodeLines`: 挂载的代码行 `<div>` 总数
  - `renderedSourceBytes`: 当前渲染的所有代码/文本原始字节数
  - `highlightCacheBytes`: 语法高亮内存缓存估算字节数
  - `activeHighlightRequests`: 进行中的分词请求并发数

### 1.2 真实事故场景压力测试夹具
- **目标文件**: `apps/desktop/src/test/fixtures/heavy-transcript.fixture.ts` (NEW)
- **目标测试**: `apps/desktop/src/test/heavy-transcript.test.ts` (NEW)
- **模拟真实场景（全面覆盖事故路径）**：
  1. 3 个历史 Turn；
  2. 其中 1 个 Turn 包含 12 个连续工具卡（包含 file view、bash、diff）；
  3. 多个 Assistant 消息各自包含 900 行 Markdown 代码块（`MarkdownView` 路径）；
  4. 至少 1 个大型 `DiffCard` 与 1 个 `CodePreviewView`；
  5. 1 个包含 10,000 字 `thinking` 与 5,000 字 `text` 的正在 streaming 的活动 Assistant 消息；
- **断言目标**：
  - 在无虚拟化情况下，折叠时 `mountedCodeLines <= 240`；
  - 展开单个代码块时，仅该代码块挂载，其余保持 0 DOM；
  - Reducer 裁剪后状态体积稳定，无无限积压。

---

## 2. Reducer 活动 Turn 与流式文本硬上限 (Phase 1.1)

### 2.1 修复活动 Turn 豁免漏洞
- **目标文件**: `apps/desktop/src/chat-reducer.ts`
- **改动逻辑**：
  - 修改 `collectRetainedTranscriptMessageIds`：在 `streaming === true` 时，**严禁从最后一个 user message 开始无脑全量保留**。
  - 改为仅保留：
    1. 正在 streaming 的 Assistant 消息（`status === 'streaming'`）；
    2. 正在运行的 Tool（`tool.status === 'running'`）；
    3. 最近的 `TRANSCRIPT_LIVE_TAIL_PIN_COUNT = 3` 个 items；
    4. 最近 `SESSION_TRANSCRIPT_PAGE_DEFAULT_ITEMS` 的尾部窗口。
  - 历史超出部分安全裁剪，完整历史保留在 Host/SQLite。

### 2.2 增加 Assistant 文本、Thinking 与 Tool Output UI 窗口限制
- **常量定义**：
  - `MAX_LIVE_ASSISTANT_TEXT_BYTES = 500_000` (500 KB)
  - `MAX_LIVE_THINKING_BYTES = 200_000` (200 KB)
  - `MAX_LIVE_TOOL_OUTPUT_BYTES = 256_000` (256 KB)
- 当 streaming 持续追加超过上限时，UI 自动保留最新滑动窗口并打上 `uiTruncated: true` 标记，提示用户可在完整历史中查看。

---

## 3. 真正的零 DOM 惰性折叠 (Phase 1.2)

### 3.1 改造 `MarkdownView.tsx` 代码块
- **目标文件**: `apps/desktop/src/MarkdownView.tsx`
- **改动逻辑**：
  - 废弃 CSS `max-height: 200px; overflow: hidden` 的伪折叠；
  - 当代码块行数 > 10 行且处于折叠状态（`collapsed === true`）时：
    - **仅渲染前 6 行预览**；
    - **第 7 行至 900 行以及其 Shiki TokenSpans 完全不挂载到 DOM**；
    - 点击「展开」后，才挂载完整代码行；
  - 这一项可立即在未展开时消灭 95% 的代码 DOM 节点。

### 3.2 确认 `ToolCallCard` 与 `DiffCard` 的卸载边界
- `ToolCallCard.tsx`：保持只在 `expanded === true` 时挂载 `DiffCard` 与详细输出，折叠时不生成重 DOM。

---

## 4. Shiki 长代码纯文本熔断与单次批量分词 (Phase 1.3)

### 4.1 语法高亮即刻熔断门禁
- **目标文件**: `apps/desktop/src/syntax-highlight.tsx`
- **改动逻辑**：
  - 定义安全阈值：
    - `MAX_HIGHLIGHT_CODE_BYTES = 40_000` (40 KB)
    - `MAX_HIGHLIGHT_LINES = 400`
  - 超过阈值时，`useHighlight` 立即返回 `null`，降级为高效纯文本，彻底禁止 TextMate 正则引擎在巨型代码上递归；
- **重构 `useHighlightLines`**：
  - 废弃 `lines.map(highlightLine)` 的 O(N) 独立解析，改为单次 `highlightCode(lines.join('\n'))` 后按行切割，降低 95% 的语法树开销。

---

## 5. Plan A 验证与验收准则 (Verification)

### 自动化测试
```bash
# 运行 Reducer 内存窗口裁剪测试
pnpm --dir apps/desktop test chat-reducer.test.ts

# 运行极限真实事故 Fixture 测试
pnpm --dir apps/desktop test heavy-transcript.test.ts

# 类型与代码格式检查
pnpm typecheck
```

### 验收标准 (Acceptance Criteria)
1. 在包含 12 个工具调用 + 900 行代码的极限夹具中：
   - 默认折叠状态下，`.chat-stream` 内部的 `mountedCodeLines <= 240`；
   - 即使持续 streaming 10,000 字 thinking，Reducer 状态体积恒定受控；
2. 打开 925 行的 `blueprint-compiler.ts`，未展开时只渲染 6 行，展开时若超过 400 行平滑降级纯文本，主线程无 GC 停顿。
