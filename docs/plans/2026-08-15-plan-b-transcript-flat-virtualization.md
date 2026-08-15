# Plan B: Transcript 单层扁平虚拟化 (Plan B: Single-Level Flat Item Virtualization)

> **目标**：将 Transcript 从粗粒度的 Turn 级嵌套虚拟化重构为高效、无抖动的**单层 Item 扁平虚拟化**，确保 DOM 节点数恒定（< 200 个），不随会话轮数与工具调用次数增长。
> **优先级**：P1（第二执行批次，依赖 Plan A）

---

## 1. 扁平化渲染项架构设计 (Architecture)

### 1.1 数据结构定义
- **目标文件**: `apps/desktop/src/transcript-render-item.ts` (NEW)
- 将复杂的 Turn / Message / Tool 关系展平为一维渲染数组：
  ```ts
  import type { ChatMessageUi, ToolCardUi, SubagentActivityView } from './chat-reducer';

  export type AssistantMessageRenderData = Omit<ChatMessageUi, 'tools'> & {
    /** Tools are rendered as separate sibling TranscriptRenderItem instances. */
    tools: [];
  };

  export type TranscriptRenderItem =
    | { id: string; type: 'user-message'; turnId: string; message: ChatMessageUi }
    | { id: string; type: 'assistant-message'; turnId: string; message: AssistantMessageRenderData }
    | { id: string; type: 'tool-card'; turnId: string; messageId: string; tool: ToolCardUi }
    | { id: string; type: 'activity-capsule'; turnId: string; tools: ToolCardUi[] }
    | { id: string; type: 'subagent-block'; turnId: string; subagentActivity: SubagentActivityView };
  ```

### 1.2 避免重复渲染关键设计 (No Double Tool Rendering)
- **方案 A 落地**：`assistant-message` 类型的 Render Item 强制将 `tools` 置空（`tools: []`），所有工具卡由独立的 `tool-card` 或 `activity-capsule` 类型的 Render Item 渲染。
- 彻底杜绝“Assistant 渲染一次工具、ToolCard 展平后再渲染一次”的重复挂载 Bug。

---

## 2. 展平转换函数与索引构建 (Flattening Pipeline)

- **目标函数**: `flattenTranscriptTurnsToItems(turns: readonly TranscriptTurn[]): TranscriptRenderItem[]`
- **规则**：
  1. 每个 Turn 中的 `user` 消息转换为 1 个 `user-message` item；
  2. 每个 Assistant 消息转换为 1 个 `assistant-message` item（剔除 tools）；
  3. Assistant 消息包含的每个 `tool` 转换为 1 个独立的 `tool-card` item（或连续工具收拢为 `activity-capsule`）；
  4. 包含子 Agent 活动的转换为 `subagent-block` item；
  5. 输出单层扁平列表。

---

## 3. 重构 `transcript-turn-list.tsx` 为 `TranscriptItemList`

- **目标文件**: `apps/desktop/src/transcript-turn-list.tsx`
- **虚拟化核心改造**：
  1. **永远启用虚拟化**：废弃 `turnCount > 40` 门禁；
  2. **流式状态下的固定策略（Live-Tail Pinning）**：
     - 在 `streaming === true` 时，**不再禁用虚拟化**；
     - 使用自定义 `rangeExtractor`：始终将最后 2~3 个活动项（正在 streaming 的 assistant、正在运行的 tool）固定在挂载列表中；
     - 离开视口的历史项目彻底卸载，仅保留测量/估算高度的 placeholder；
  3. **动态高度与滚动锚点（Scroll Anchoring）**：
     - 结合 `useVirtualizer` 的 `estimateSize`（基于 item 类型提供高精度初值）与 `measureElement`；
     - 展开/折叠卡片时通知虚拟器重测（`virtualizer.measureElement`），杜绝滚动条跳动。

---

## 4. Plan B 验证与验收准则 (Verification)

### 自动化测试
```bash
# 运行展平逻辑与无重复渲染测试
pnpm --dir apps/desktop test transcript-render-item.test.ts

# 运行虚拟化测量与滚动固定测试
pnpm --dir apps/desktop test transcript-turn-list.test.ts

# 类型检查
pnpm typecheck
```

### 验收标准 (Acceptance Criteria)
1. 在包含 50 轮对话（每轮含 5 个工具调用）的会话中：
   - 滚动过程中，`.chat-stream` 内部真实挂载的 `TranscriptRenderItem` 始终保持在 **<= 20 个**；
   - 工具卡与 Assistant 消息无任何重复挂载；
   - 流式输出时，底部平滑自动滚屏，向上滚动查看历史时无剧烈跳跃。
