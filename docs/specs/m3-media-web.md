# M3 Spec — Media + Web tools

| Field | Value |
|-------|-------|
| Status | **Implemented (partial)** |
| Date | 2026-07-20 |
| Packages | `media`, `tools-web`, `agent-host`, `contracts`, `apps/desktop`, `apps/cli` |
| Deferred source | [todo-deferred.md](../todo-deferred.md) §2 |
| Principle | **能抄就抄；只自研边界与策略** |

---

## Implementation status (2026-07-20)

**Partial — package + CLI + host wiring done; desktop UI remaining.**

| Area | Status | Notes |
|------|--------|-------|
| `@piwin/media` save/resolve + tests | Done | path under `~/.piwin/media`, mime/size policy |
| `formatTextModelImageInjection` path inject | Done | contracts; no base64 dump |
| CLI `chat --image` | Done | save via media service then inject path |
| `@piwin/tools-web` search/fetch + tools | Done | Brave/Tavily providers; fetch size/timeout/block |
| Host session tools registration | Done | `session-tools` + sdk-adapter wiring |
| Config `web` defaults / load-save | Done | agent-host config-store |
| Desktop paste/drop/chip/preview UI | **Not done** | needs Tauri composer + asset protocol |
| Network permission UI for web tools | **Not done** | can reuse permission modal later |

## 1. Goal

1. **Media**：粘贴/拖放图片 → 落盘 `~/.piwin/media/<session>/` → 聊天气泡预览 → 文本模型只注入 **本地 path**（禁止默认 base64 dump）。
2. **Web tools**：内建 `web_search` + `web_fetch`（可关，可换 provider），走 permission，结果带引用。

与 PRD 一致：图片对文本模型 = path 字符串；web 能力对文本模型很有必要。

---

## 2. Non-goals (M3)

| 不做 | 原因 |
|------|------|
| 自建搜索引擎 / 爬虫集群 | 用现成 API 或轻量 HTML 源 |
| 默认把图片变 vision multipart | 可做开关，默认 path 注入（PRD） |
| 完整 browser use（点击/登录） | 后置；需要再用 Playwright skill/MCP |
| 重写 Claude Code 私有搜索后端 | 闭源，只借鉴 **工具拆分模型** |

---

## 3. 开源调研：抄什么 / 不抄什么

### 3.1 Media（图片）

| 来源 | 能抄什么 | 不抄什么 |
|------|----------|----------|
| **本仓库 contracts** | `SaveMediaInput` / `formatTextModelImageInjection` 已定 shape | — |
| **Pi SDK** `prompt({ images })` | 仅 vision 路径可选对接 | 不默认 base64 塞上下文 |
| **浏览器 Clipboard API** | `paste` → `clipboardData.items` file | UI 自己写，无库依赖 |
| **Node `fs` + `crypto.randomUUID`** | 落盘命名 | 不必上 ORM |
| **`image-size`（npm，小库）** | 读宽高 | 可选；没有就省略 dimensions |
| **sharp** | 缩略图 | **M3 可不装**；UI 直接用原图 file URL / asset protocol |

**结论：Media 几乎不用抄大型项目**——标准库 + 已有 contracts 即可。Tauri 侧用 asset / convertFileSrc 显示本地图。

### 3.2 Web Fetch

| 来源 | 能抄什么 | License / 注意 |
|------|----------|----------------|
| **[@mozilla/readability](https://github.com/mozilla/readability)** | HTML → 正文 title/text（Firefox Reader） | Apache-2.0，**强烈建议直接用** |
| **linkedom** 或 **jsdom** | 给 Readability 提供 DOM | linkedom 更轻，优先 |
| **undici / fetch（Node 20+）** | HTTP GET、redirect、timeout | 标准 |
| Claude Code 设计（逆向文章） | **search 与 fetch 拆两个 tool**；fetch 可再摘要 | 抄架构，不抄闭源实现 |

**推荐默认栈：**

```text
fetch(url) → size/timeout/redirect 限制
  → content-type 分支
      text/html → linkedom + Readability → markdown/text
      text/*    → 截断纯文本
      其他      → 拒绝或只返回元信息
```

### 3.3 Web Search

| 来源 | 能抄什么 | 注意 |
|------|----------|------|
| **Brave Search API** | 官方 HTTP JSON，结果干净 | 要 API key；Pi 生态已有 brave-search skill 思路 |
| **Tavily / Exa / SerpAPI** | 另一类 hosted search | 可做可选 provider |
| **DuckDuckGo HTML**（无 key） | 社区 MCP 常用「无 key 兜底」 | 脆弱、ToS/频率风险，只作 **optional fallback** |
| **[AgentWebSearch-MCP](https://github.com/insung8150/AgentWebSearch-MCP)** 等 | 看 provider 接口怎么拆 | 不要整仓 fork；抄 **provider 接口** |
| **用户已有 smart-search-cli skill** | 可作为可选 SearchProvider 适配器 | 适配进 `tools-web`，别让 UI 直调 |

**推荐：`SearchProvider` 接口 + 内建 1～2 个实现**

```ts
interface SearchProvider {
  id: string;
  search(query: string, opts: { limit: number; signal?: AbortSignal }): Promise<SearchHit[]>;
}
// hits: { title, url, snippet, source? }
```

- **P0**：`brave`（env `BRAVE_API_KEY`）或 `tavily`
- **P1**：`http-json` 通用（用户填 endpoint）
- **P2**：无 key fallback（标注 unstable）

### 3.4 权限与安全（必须自研策略，可抄模式）

抄 **Claude Code / 自家 M2 permission modal** 模式：

- `web_search` / `web_fetch`：默认 `ask` 或 project-remember
- domain allow/deny 列表（fetch）
- max bytes / timeout / max redirects
- 结果进模型前 **截断**（例如 32–64KB text）

---

## 4. 架构（落在现有包上）

```text
apps/desktop (paste / preview / chips)
apps/cli (chat --image path 可选)
        │
        ▼
@piwin/media          落盘、校验 mime、path 安全
@piwin/tools-web      web_search / web_fetch 纯逻辑 + providers
        │
        ▼
@piwin/agent-host     注册 tools 给 Pi session；permission 钩子
@piwin/contracts      MediaAttachment / SearchHit / tool 结果类型
```

**硬规则（AGENTS.md）**：apps 不 import Pi；web/media 不进 `contracts` 以外的循环依赖。

---

## 5. 功能拆解（实现任务，非空转 plan）

### M3.A Media 内核（`@piwin/media`）

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M3.A1 | `saveMediaAsset`：写 `~/.piwin/media/<sessionId>/<uuid>.<ext>` | 自研 fs | 文件存在 |
| M3.A2 | mime allowlist + max bytes（读 config） | 自研 | 单测 |
| M3.A3 | path 必须 normalize 在 media root 下 | 自研安全 | 单测 traversal |
| M3.A4 | 可选 `image-size` 填 width/height | 小库 | 有则填 |
| M3.A5 | 导出 `createMediaService(root)` | 自研 | host 可注入 |

### M3.B Media UI + prompt 注入

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M3.B1 | Composer paste/drop → saveMediaAsset | Clipboard API | chip 出现 |
| M3.B2 | chip 可删 | 自研 UI | UX ok |
| M3.B3 | 发送：`PromptInput.attachments` + text 追加 `formatTextModelImageInjection` | contracts 已有 | mock/real prompt 含 path |
| M3.B4 | 历史气泡图片 preview（local path → Tauri convertFileSrc / blob URL） | Tauri API | 图能显示 |
| M3.B5 | CLI：`chat` 支持 `--image <path>` 复制进 media 再注入 | 自研 | CLI smoke |

### M3.C tools-web 内核

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M3.C1 | `SearchProvider` + `BraveSearchProvider`（或 Tavily） | 抄 HTTP 客户端模式 | 单测 mock fetch |
| M3.C2 | `web_fetch`：fetch + Readability | **Readability + linkedom** | 单测 fixture HTML |
| M3.C3 | 安全策略：timeout/size/redirect/domain | 自研 | 单测 |
| M3.C4 | 工具 schema（name/description/parameters） | 对齐 Pi registerTool | 类型稳定 |
| M3.C5 | 配置：`~/.piwin/config.json` → `web: { searchProvider, apiKeyEnv, fetchMaxBytes }` | 扩展 contracts | load/save |

### M3.D Host 接线 + 权限

| ID | Task | 抄/自研 | Exit |
|----|------|---------|------|
| M3.D1 | agent-host 创建 session 时注册 web tools（非 mock 或 mock 可 stub） | Pi `registerTool` / session tools | 模型能 call |
| M3.D2 | permission：`web_search`/`web_fetch` → ask | 复用 M2 modal | 弹窗可 allow/deny |
| M3.D3 | UI：search 结果 citation 卡片（可选 P1） | 自研简单 list | 可点 URL |

---

## 6. 配置草案

```jsonc
// ~/.piwin/config.json 增量
{
  "web": {
    "searchProvider": "brave", // "brave" | "tavily" | "none"
    "searchApiKeyEnv": "BRAVE_API_KEY",
    "searchMaxResults": 5,
    "fetchMaxBytes": 65536,
    "fetchTimeoutMs": 15000,
    "fetchAllowedUrlPrefixes": [], // empty = allow all except blocklist
    "fetchBlockedUrlPrefixes": ["file:", "localhost", "127.0.0.1"]
  },
  "media": {
    "maxPasteBytes": 10485760,
    "allowedMimeTypes": ["image/png", "image/jpeg", "image/webp", "image/gif"]
  }
}
```

（实现时把 `media` 已有字段与 `web` 新字段并进 `PiwinConfig`。）

---

## 7. 验收

1. Desktop 粘贴 PNG → `~/.piwin/media/...` 有文件 → 发送后 mock/real prompt 含 path 文本。  
2. 聊天气泡能 preview 该图。  
3. `web_fetch` 对公开文章 URL 返回可读正文（Readability）。  
4. `web_search` 在配置 key 后返回 ≥1 条 hit；无 key 时错误信息可操作。  
5. 网络 tool 触发 permission 流（或配置 always-allow for project）。  
6. `pnpm test` 覆盖 media path 安全 + fetch 截断 + search provider mock。

---

## 8. 建议实现顺序（真正动手时）

1. contracts 扩展 `web` config + SearchHit 类型  
2. `@piwin/media` 落盘（无 UI 也能 CLI 测）  
3. `@piwin/tools-web` fetch（Readability）→ search provider  
4. host 注册 tools + permission  
5. Desktop paste/preview  
6. citation UI（可薄）

**预估：** 内核 3–5 天；UI 2–3 天（一人全职量级，视 Pi tool 注册 API 摩擦而定）。

---

## 9. 风险

| 风险 | 缓解 |
|------|------|
| Pi 自定义 tool 注册 API 与版本耦合 | 只在 agent-host 适配；tools-web 保持纯函数 |
| 无 key 搜索质量差 | 不把 HTML scrape 当默认 |
| Readability 对 SPA 无效 | 文档说明；失败返回「无法提取正文」 |
| 图片 path 泄漏到不可信日志 | 日志只打 basename |
