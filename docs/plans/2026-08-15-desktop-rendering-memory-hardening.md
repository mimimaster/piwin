# 桌面端渲染与内存治理主规划 (Master Plan: Desktop Rendering & Memory Hardening)

> **目标**：彻底解决 `piwinwin` 桌面端在面对长会话、连续多轮工具调用、超长代码块与流式输出时的 WebContent 内存暴涨问题（实测曾达 14.54 GB 并引发系统级 Swap 换页卡死）。
> **拆分架构**：为了保证“小步提交、每步可独立测试、绝不破坏现有功能”，整套方案拆分为 **Plan A / B / C / D** 四个独立子计划。

---

## 核心设计原则与修正

1. **单层扁平虚拟化（Single-level Flat Items）**：
   - 严禁双层嵌套虚拟列表。渲染层展平为 `TranscriptRenderItem[]`，由单个 `@tanstack/react-virtual` 统一调度。
   - 彻底避免 `ChatMessageUi.tools` 与 `tool-card` 重复渲染：Assistant Render Item 剔除 tools，工具全部由独立 Item 渲染。
2. **真正的零 DOM 卸载（Zero-DOM Offscreen Policy）**：
   - 废弃 CSS `max-height` 伪折叠；`MarkdownCodeBlock` 在折叠时仅渲染前 8 行预览，内部重组件（`<pre><code>`、`TokenSpans`、`DiffCard`）不挂载。
   - `CollapsibleContentBlock` 采用显式 `expandable={isTall}` 声明式判定，彻底杜绝折叠测量反复振荡风险。
3. **活动 Turn 与流式文本全方位内存预算（Strict UI Windowing）**：
   - 修复 `chat-reducer.ts` 在 streaming 时将用户消息后整个 Turn 豁免淘汰的漏洞；
   - 增加 `assistant.text`（500KB）、`assistant.thinking`（200KB）基于精确 UTF-8 字节的滑动窗口裁剪，并通过 `uiTruncated: true` 标识超出窗口。
4. **Shiki 视口分词与紧凑 Worker（Compact Tokenizer Worker）**：
   - 创建 `highlight.worker.ts`，Shiki 分词在 Web Worker 运行；
   - 传输使用紧凑调色板索引（`[lineIndex, colStart, colEnd, colorIndex]` 4-word `Uint32Array`），附带 `sourceHash` 防止并发竞态；
   - LRU 缓存按字节（`maxBytes: 10MB`）与条目数（`maxEntries: 100`）双重淘汰，并接入 `desktopMetrics` 观测。
5. **科学的验收标准（Scientific Acceptance Criteria）**：
   - 放弃固定的物理 RSS 数值（受分辨率、OS 影响）；
   - 标准：**5 轮极限循环后 RSS 达到稳定平顶；`.chat-stream` 挂载 DOM 项 <= 20；折叠代码行 <= 8；activeHighlightRequests <= 4**。

---

## 子计划矩阵 (Sub-Plan Index)

| 计划编号 | 计划名称 | 核心内容 | 状态 |
|---|---|---|---|
| [Plan A](file:///Users/yorickjue/Developer/piwin/docs/plans/2026-08-15-plan-a-desktop-hard-memory-bounds.md) | **桌面端硬内存边界与即刻防爆** | Reducer live-tail 保护、UTF-8 字节精确上限、`uiTruncated` 标记、`expandable` 防抖折叠、40KB/400 行熔断、Happy-DOM 900 行真实挂载测试 | **已落地 (Completed)** |
| [Plan B](file:///Users/yorickjue/Developer/piwin/docs/plans/2026-08-15-plan-b-transcript-flat-virtualization.md) | **Transcript 单层扁平虚拟化** | 展平为 `TranscriptRenderItem[]`、接入 `TranscriptTurnList` 生产渲染链、固定最近 3 个 item、历史占位真卸载 | **已落地 (Completed)** |
| [Plan C](file:///Users/yorickjue/Developer/piwin/docs/plans/2026-08-15-plan-c-shiki-worker-tokenizer.md) | **Shiki 视口 Worker 与紧凑分词** | `highlight.worker.ts` Web Worker、`Uint32Array` 二进制传输、`sourceHash` 竞态防护、10MB 多维 LRU 缓存池与指标联动 | **已落地 (Completed)** |
| [Plan D](file:///Users/yorickjue/Developer/piwin/docs/plans/2026-08-15-plan-d-webcontent-degradation-recovery.md) | **WebContent 降级与自适应恢复** | 前端 `MemoryGovernor` 控制中心、`useHighlight` 关键压力响应与纯文本回退、缓存清空与降级订阅 | **已落地 (Completed)** |

---

## 总体实施顺序

```
Plan A (硬限制 + 零 DOM 折叠 + Reducer 边界 + UTF-8 字节精度 + 真实 DOM 压测)
   │
   ▼
Plan B (单层扁平虚拟化 + 生产渲染链接入 + Live-Tail Pinning)
   │
   ▼
Plan C (Shiki Worker + 紧凑 Uint32Array 协议 + 多维 LRU 缓存)
   │
   ▼
Plan D (MemoryGovernor 前端控制中心 + 内存压力三级降级 + 自适应回退)
```
