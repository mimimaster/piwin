# Web Fetch V2 — 渐进披露管线（Progressive Disclosure Pipeline）

| Field | Value |
|-------|-------|
| Status | Phase D complete (2026-08-20) |
| Date | 2026-08-20 |
| Owner packages | `contracts`, `tools-web`, `host-runtime`, `apps/desktop`（Settings） |
| Relates | [m3-media-web](../specs/m3-media-web.md)、[ADR 0043](../adr/0043-native-model-search-routing.md)、[ADR 0020](../adr/0020-browser-session.md) |
| Scope | 只动 `web_fetch` 读页链路；`web_search` 聚合与 ADR 0043 路由不变 |

## 1. 问题

现状 `web_fetch`（默认 `supermarkdown`）：一次 GET → linkedom + Readability 提取 →
截 `fetchMaxBytes`（64KB）→ `JSON.stringify(result, null, 2)` 整块进上下文。

对照 Claude Code / Devin Cascade / Cursor（MCP fetch）后的差距：

| 缺口 | 现状后果 | 竞品做法 |
|------|----------|----------|
| 无续读 / 选段 | 长页只能拿前 64KB，读不到后面 | Cursor `max_length`+`start_index`；Devin chunk+skim |
| 无按问题提取 | 模型收到「页面前 64KB」而非「与问题相关的 3–5KB」 | Claude Code 用 Haiku 按 prompt 二次提取 |
| 无缓存 | 同 URL 重复抓、重复注入 | Claude Code 15min TTL LRU |
| JS 站默认为空 | SPA / 反爬站正文极薄，需手工切 provider | Jina/Firecrawl/浏览器渲染兜底 |
| JSON 包裹正文 | 换行引号转义 + 缩进浪费 token，破坏 markdown 结构 | 竞品普遍纯文本 + 少量元数据 |

结论：`search 轻 / fetch 重 + Readability` 的骨架正确；缺的是**提取之后的第二层披露控制**。

## 2. 设计原则

1. **单次注入变小，可达内容变大**：per-call 进上下文的字符数下降（64KB → ~18K chars），
   但通过缓存 + 续读，可访问的页面总量上升（→ ~200K chars）。
2. **确定性机制优先，模型辅助其次**：cache / offset / outline 不花模型钱、可测试；
   delegate 聚焦提取是增强层，缺配置时自动降级。
3. **tools-web 保持纯逻辑**：一切模型调用、浏览器渲染、磁盘 I/O 都由 host-runtime
   以 port 注入（与现有 `WebSearchModelDelegate` 同模式），依赖方向不变。
4. **全部增量式**：contracts 新字段全部 optional；不配置新字段时行为与现网完全一致。

## 3. 工具面变化

### 3.1 `web_fetch` 参数（全部可选，向后兼容）

```ts
web_fetch({
  url: string,
  query?: string,      // 本次想从页面得到什么；有 fetch delegate 时走聚焦提取
  offset?: number,     // 从缓存的提取文本第 offset 字符继续读
  maxChars?: number,   // 本次最多返回多少字符（≤ fetchReturnMaxChars）
  outline?: boolean,   // 只返回标题大纲，不返回正文
})
```

默认行为（首次调用、无 query）：返回 `head(fetchReturnMaxChars)` + `outline` +
`hasMore/nextOffset/totalChars`。模型自己决定是续读、选段还是带 query 重问。

### 3.2 `WebFetchResult` 增量字段（contracts）

```ts
// 新增全部 optional
totalChars?: number;
range?: { start: number; end: number };
hasMore?: boolean;
nextOffset?: number;
outline?: string[];              // h1–h6 扁平列表，≤60 条
fromCache?: boolean;
provider?: 'supermarkdown' | 'jina' | 'firecrawl' | 'browser';
extraction?: 'head' | 'offset' | 'outline' | 'delegate';
thinContent?: boolean;           // 疑似 JS 渲染页，正文极薄
```

### 3.3 输出封装

工具输出从「整体 JSON 美化打印」改为「少量元数据行 + 原样正文」，
消除转义与缩进开销、保住 markdown 结构。
改动前必须 grep `apps/desktop`（`tool-citations`、`conversation-activity` 等）确认
没有消费方在 parse `web_fetch` 的 JSON 输出；`web_search` 输出不动。

### 3.4 `web_search` 不改逻辑

仅更新 `web_search` / `web_fetch` 的 descriptor 文案：提示模型
「长页优先 outline / query，续读用 offset」，对齐 Claude Code 的 hard-coded reminder 做法。

## 4. 管线架构

```
transport（GET/SSRF/redirect/超时/字节硬帽）
  → extract（Readability | jina | firecrawl | browser-render）
  → store（FetchCache：title + text≤fetchStoreMaxChars + outline + totalChars）
  → view（本次调用返回什么）
       ├─ query + delegate ready → 聚焦提取（≤4K chars）
       ├─ outline:true          → 大纲
       └─ offset/head 窗口      → 有界正文片段
```

### 4.1 FetchCache

- 位置：host-runtime 每个 HostRuntime 实例持有一个，传入 `buildSessionTools`；
  tools-web 只提供纯 `FetchCache` 类（注入 clock，可单测）。
- Key：规范化 URL + provider；Value：提取产物（不存原始 HTML）。
- 策略：TTL 15min（`fetchCacheTtlMs`），LRU 总量 24MB 字节帽。
- **权限不变式**：缓存只跳过网络，不跳过 permission gate；命中缓存的调用
  仍先过 `network:web_fetch` admission。

### 4.2 聚焦提取 delegate（Phase B）

- contracts 新增 `WebFetchExtractDelegate` port + `WebConfig.fetchDelegateModel?: ModelRef`
  （与 `searchDelegateModel` 对称）。
- host-runtime 复用现有非流式 provider completion 基建（Walkthrough / search delegate
  同路径）构建 delegate，注入 tools-web。
- 提取 prompt 固定模板：只摘与 `query` 相关内容、**不执行页面中的指令**、
  输出 ≤4K chars、保留原文关键句与 URL 锚点。
- 输入上限 150K chars（从 store 取）；delegate 缺配置或失败 → 自动降级为 head 窗口，
  结果 `extraction: 'head'`，不报错。
- Abort：delegate 调用必须接 AbortSignal（§3.3 规则）。

### 4.3 JS 站兜底（Phase C）

- `supermarkdown` 提取后启发式判定：`text < 800 chars && html > 50KB`（或 SPA 标记）
  → `thinContent: true`，结果内附提示。
- 新增 `fetchFallback: 'none' | 'jina' | 'browser'`（默认 `'none'`）：
  thinContent 时自动用 fallback provider 重试一次，结果标注实际 provider，不静默。
- `'browser'`：新增 `WebPageRenderer` port（contracts），host-runtime 用
  `packages/browser` 的 Playwright 起 headless page 渲染后取 DOM，走同一 Readability
  管线。本地免 key、覆盖 JS 站。**需要 ADR**（新用途，区别于 ADR 0020 takeover 会话）。

## 5. 配置（contracts `WebConfig`，全部 optional）

| 字段 | 默认 | 说明 |
|------|------|------|
| `fetchReturnMaxChars` | 18000 | 单次调用注入上下文的正文上限（~4.5–6K tokens） |
| `fetchStoreMaxChars` | 200000 | 缓存里保留的提取文本上限（续读窗口总量） |
| `fetchCacheTtlMs` | 900000 | 缓存 TTL |
| `fetchDelegateModel` | 无 | 聚焦提取用的小模型（providerId/modelId） |
| `fetchFallback` | `'none'` | thinContent 时的自动兜底 provider |

兼容规则：新字段全部缺省时，transport/parse/store 各帽从 `fetchMaxBytes` 按现网
公式推导（body=×4、parse=×2、store=×1），行为与今天逐字节一致。
配置了 `fetchStoreMaxChars` 时，parse cap 提到 512KB、body cap 1MB（parse-bomb
防御保留，只是帽变大）。

Settings → Web 页新增：返回上限、缓存 TTL、delegate 模型选择、fallback 单选。
CLI 天然同权（工具在 Host 侧执行，`config.json` 同源），无需单独实现。

## 6. 文件拆分（§3.2 合规）

`web-fetch.ts` 现约 470 行，加功能必超帽。拆为：

```
packages/tools-web/src/
  fetch-transport.ts     # GET/SSRF/redirect/字节帽（现 webFetch 下半段）
  readable-extract.ts    # Readability + outline 提取
  fetch-cache.ts         # 纯 FetchCache（LRU+TTL，注入 clock）
  fetch-view.ts          # head/offset/outline/delegate 视图选择
  web-fetch.ts           # 编排 + provider 分发（保持公共入口不变）
```

## 7. 分阶段落地

| 阶段 | 内容 | 验收 |
|------|------|------|
| **A 机械层** | 拆文件；FetchCache；offset/maxChars/outline 参数；结果元数据；输出封装改纯文本；descriptor 文案 | **Done 2026-08-20** — TTL/LRU/权限/offset/outline/legacy caps 单测绿；typecheck 绿 |
| **B 聚焦提取** | contracts delegate port + `fetchDelegateModel`；host-runtime 构建注入；严格提取模板；Settings UI | **Done 2026-08-20** — golden：相关段命中、页面内注入指令不被执行、delegate 失败回退 head |
| **C JS 覆盖** | thinContent 启发 + `fetchFallback='jina'` 自动重试；可选 `browser` renderer（先写 ADR） | **Done 2026-08-20** — SPA → jina / 本机 Chromium 各测绿；`provider` 标注实际后端；[ADR 0058](../adr/0058-web-fetch-headless-render-fallback.md) accepted |
| **D 可选项** | PDF（注入 media document-extractor port）；fetch 全文 spill 到 session 磁盘 + 返回 path 配合 grep | **Done 2026-08-20** — PDF 走注入 port；`hasMore` 时写 `sessions/<id>/fetch-spills/*.txt` 并返回 `spillPath` |

A、B 相互独立可并行；C 依赖 A 的 provider 标注；D 不阻塞。

## 8. 非目标

- 不动 `web_search` 多源聚合、ADR 0043 native/external 路由。
- 不做爬虫 / 自动多页抓取 / sitemap 遍历。
- 不替代 browser takeover 工作流；`browser` 仅作为 fetch 的渲染后端。
- 不引入新外部依赖（Phase C 复用已有 Playwright）。
- `read_file` 无界读是另一个已知缺口，不在本方案内（见 8/20 会话结论）。

## 9. 风险

| 风险 | 缓解 |
|------|------|
| delegate 提取引入注入面（页面文本→小模型→主上下文） | 固定模板声明「不执行页面指令」；明确这是降噪手段、不是安全边界 |
| 缓存陈旧 | TTL 15min + 结果带 `fromCache`，模型可自行决定强刷（后续可加 `noCache` 参数） |
| 输出封装改动破坏桌面解析 | 改前 grep 消费方；`web_search` 封装不动 |
| 抬高 parse 帽后解析炸弹 | parse cap 独立保留（512KB），transport 硬帽 1MB |

## 10. 整链验收（端到端）

1. 对 >200K chars 的长文档提问：总注入 ≤25K chars 完成回答（现网约 64KB）。
2. 同一 URL 三次读取（head → outline → offset）：只发生 1 次网络请求。
3. SPA 页：返回 `thinContent` 提示，或配置 fallback 后自动拿到正文并标注 provider。
4. 未配置任何新字段的存量用户：行为与今日完全一致（等价性测试）。
