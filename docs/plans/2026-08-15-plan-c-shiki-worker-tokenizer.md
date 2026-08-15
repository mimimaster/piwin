# Plan C: Shiki 视口 Worker 与紧凑分词 (Plan C: Shiki Viewport Worker & Compact Tokenizer)

> **目标**：将 Shiki TextMate 语法解析从主线程完全隔离至独立的 Web Worker，采用紧凑二进制分词结构与按行切片请求，彻底消除主线程 GC 阻塞与分词内存堆积。
> **优先级**：P2（第三执行批次，依赖 Plan A / Plan B）

---

## 1. 语法分词 Worker 协议设计 (Worker Protocol)

### 1.1 请求结构 (HighlightRequest)
- **目标文件**: `apps/desktop/src/syntax/highlight-protocol.ts` (NEW)
- 协议包含请求唯一标识与源码哈希，防止竞态覆盖：
  ```ts
  export type HighlightWorkerRequest = {
    requestId: string;
    sourceHash: string;
    code: string;
    language: string;
    theme: 'github-dark' | 'github-light';
    /** Optional line slice for viewport-based chunked tokenization. */
    lineStart?: number;
    lineEnd?: number;
  };
  ```

### 1.2 响应结构 (CompactHighlightResult)
- 采用调色板索引（Palette + Uint32Array）并通过 Transferable ArrayBuffer 零拷贝传输：
  ```ts
  export type HighlightWorkerResponse = {
    requestId: string;
    sourceHash: string;
    lineStart: number;
    lineEnd: number;
    palette: string[]; // 调色板颜色数组，例如 ['#ff7b72', '#79c0ff', '#d2a8ff']
    /** Packed triplets: [lineIndex, colStart, colEnd, colorIndex] */
    runs: Uint32Array;
  };
  ```

---

## 2. Worker 核心实现与单例池

- **目标文件**: `apps/desktop/src/syntax/highlight.worker.ts` (NEW)
- **职责**：
  1. 在 Worker 线程中初始化 Shiki 引擎与 TextMate 正则；
  2. 收到分词请求时，仅对 `[lineStart, lineEnd]` 范围进行语法分析；
  3. 将 Token 转换为紧凑的 `Uint32Array`，使用 `postMessage(response, [response.runs.buffer])` 传回；
  4. 支持新请求到达时取消或丢弃过期请求。

---

## 3. 多维度 LRU 高亮缓存池 (Multi-bounded LRU Cache)

- **目标文件**: `apps/desktop/src/syntax/highlight-cache.ts` (NEW)
- **多维度限制规则**：
  - `maxEntries = 100`（最多 100 个代码块）
  - `maxBytes = 10 * 1024 * 1024`（总内存不超过 10 MB）
  - `maxSourceBytesPerEntry = 1 * 1024 * 1024`（单条目不超过 1 MB，超大条目不进缓存）
  - `maxPendingRequests = 4`（并发请求最多 4 个，超出的旧请求自动丢弃）
- 切换会话时，主动清理非活跃 Session 的缓存条目。

---

## 4. Plan C 验证与验收准则 (Verification)

### 自动化测试
```bash
# 运行 Worker 紧凑协议与 ArrayBuffer 转换测试
pnpm --dir apps/desktop test highlight-protocol.test.ts

# 运行 LRU 缓存多维度淘汰测试
pnpm --dir apps/desktop test highlight-cache.test.ts

# 类型检查
pnpm typecheck
```

### 验收标准 (Acceptance Criteria)
1. 在 1000 行代码连续快速滚动时：
   - 主线程 Long Task（> 50ms）为 0；
   - `activeHighlightRequests` 始终保持在 `<= 4`；
   - `highlightCacheBytes` 严格保持在 `<= 10 MB`；
   - 快速切换会话不会产生过期分词覆盖新内容（`sourceHash` 校验 100% 拦截过期响应）。
