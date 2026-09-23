# Spec — 模型目录集成 + 配置优化

| Field | Value |
|-------|-------|
| Status | **Draft (rev 4)** |
| Date | 2026-08-01 (amended 2026-09-21) |
| Packages | `contracts`, `agent-host`, `host-runtime`, `apps/desktop`, `apps/cli` |
| Principle | writable = `providers[].models`；reference = Host models.dev snapshot（首次同步前 Pi bootstrap） |
| Related | [vision-delegation.md](./vision-delegation.md), [ADR 0073](../adr/0073-models-dev-reference-catalog.md) |
| Depends on code already landed | ADR 0005 amendment 2026-08-01：composer media 默认原生 `ImageContent` |


---

## 0. Amendment 2026-09-21 — models.dev 参考目录

见 [ADR 0073](../adr/0073-models-dev-reference-catalog.md)。

- IPC：`models/catalog/search` · `models/catalog/status` · `models/catalog/sync`
- 缓存：`~/.piwin/model-catalog.json`
- 同步失败保留上一份；从未同步则 Pi builtins
- Discover 仍 live-fetch provider，不改为 models.dev
- `VIDEO_GENERATION_MODEL_REGISTRY` 仍负责视频 apiStyle/path


---

## 1. 目标

1. **模型添加时自动补全**：Settings 输入模型 ID 前缀 → 下拉匹配 Pi 内置 catalog → 选中后自动带出 contextWindow / maxTokens / input / reasoning。
2. **模型能力字段贯通**：`ModelConfigEntry` 记录 `input` / `reasoning`；注册进 Pi `ModelRuntime` 时透传，让：
   - 聊天区 / 前置检查知道「能不能看图」
   - Spec 2 D1 知道何时做 text-only vision delegation
   - Pi extension（`pi-vision-handoff` 等）正确识别多模态 vs text-only
3. **聊天区模型选择器增强**：显示能力标签（vision / text-only / reasoning）。
4. **发送图片时的前置检查**：text-only + 图片 + 未开 delegation → 提示风险；已开 delegation 或模型声明 vision → 放行。
5. **参考目录可手动刷新**：Settings 「同步模型目录」拉取 `https://models.dev/api.json` 写入 `~/.piwin/model-catalog.json`；不自动拉网。`models/discover` 仍打 provider 网关。

## 2. Non-goals

| 不做 | 原因 |
|------|------|
| 自己手写全网模型库 | 参考表来自 models.dev 快照；writable 仍是用户的 `providers[].models` |
| apps 直接 import `@earendil-works/pi-*` | AGENTS.md §1.1 |
| 替换 `models/discover`（运行时 API 发现） | 互补：catalog=静态参考，discover=运行时探测 |
| 实现 vision delegation 描述注入 | Spec 2 D1 |
| 写 `~/.pi/agent/models.json` 作为能力来源 | 见 §3.4；能力靠 `ModelRuntime.registerProvider` 运行时注册 |

**已不在本 spec 范围（已落地）**：composer 原生 `prompt({ images })` — 见 ADR 0005 amendment 2026-08-01 / `prompt-images.ts`。本 spec **不再**把「原生 vision」列为待办。

---

## 3. 现状分析

### 3.1 媒体路径（2026-08-01 后）

```text
paste/drop → media/save → PromptInput.attachments（path 引用）
  → buildModelPromptInput：校验 media root，text 不注入 path
  → PiSdkAdapter：loadPromptImages → piSession.prompt(text, { images })
```

| 层 | 行为 |
|----|------|
| 落盘 / UI preview / transcript | 仍用 path（`~/.piwin/media/`） |
| 模型侧默认 | 原生 `ImageContent` |
| path 注入 | **不再默认**；`formatTextModelImageInjection` 仅作 Spec 2 兜底 |

因此：**`ModelConfigEntry.input` 现在直接影响产品行为**，不只是 UI 标签：

- `input` 含 `image` → 原生传图合理
- `input` 仅 `text`（或省略）→ 仍会传 `ImageContent`（当前实现无分流）→ 部分 text-only API 可能报错或静默丢图 → **需要 Spec 1 的能力字段 + Spec 2 的 D1 分流**

### 3.2 现有 UI 流程

**Settings → 模型配置**（`ProviderSettings.tsx` → `provider-detail.tsx` → `provider-model-list.tsx`）：

```
provider pills
  → 连接表单 (baseUrl / apiKey / headers)
  → Model Directory
      → [Discover] → provider API → DiscoverModelsDialog 导入
      → [+ Add] → AddModelDialog 手填 ID / label / limits
      → 展开 → ModelInlineEditor
      → 设为默认
```

**聊天区模型选择器**（`composer-dock` / `ThinkingEffortControl`）：

```
modelOptions = config.providers × models
  → key = "providerId::modelId"
  → 无 input / reasoning 字段
```

### 3.3 现有问题

| 问题 | 根因 | 影响（在原生传图之后） |
|------|------|------------------------|
| 手填模型 ID，无参考 | 无 catalog | UX |
| 无「能不能看图」字段 | `ModelConfigEntry` 无 `input` | **无法分流 / 无法前置检查** |
| 注册进 Pi 时全部 `input: ['text']` | `buildPiProviderRegistration` 硬编码 | extension 误判；D1 无法判断 |
| 注册进 Pi 时全部 `reasoning: true` | 同上硬编码 | thinking UI 与真实能力不符 |
| 聊天区无能力标签 | `ModelOption` 无能力字段 | UX |
| Discover 导入只有 id/label | `DiscoveredModel` 无能力；未与 catalog 合并 | 导入后仍缺 input |

### 3.4 Pi catalog 结构

`@earendil-works/pi-ai` 的 `MODELS`（`dist/models.generated.js`，公开导出）：

```ts
MODELS[providerId][modelId] = {
  id, name, api, provider, baseUrl,
  reasoning: boolean,
  input: ("text" | "image")[],
  cost: { input, output, cacheRead, cacheWrite },
  contextWindow, maxTokens,
}
```

约 34 个 provider。**agent-host 当前只依赖 `@earendil-works/pi-coding-agent`，不能直接 `import from '@earendil-works/pi-ai'`**（包解析失败）。实现时必须二选一：

| 方案 | 做法 | 推荐 |
|------|------|------|
| A | agent-host 显式加依赖 `@earendil-works/pi-ai`（版本与 pi-coding-agent 对齐） | **推荐** |
| B | 通过 `ModelRuntime.getModels()` 读 builtins（需确认 offline 下 builtins 是否完整暴露） | 备选，需先验证 |

禁止：从 `node_modules/.../pi-coding-agent/node_modules/@earendil-works/pi-ai` 深路径 import。

### 3.5 能力如何到达 Pi extension

```text
~/.piwin/config.json (providers[].models)
  → buildPiProviderRegistration(provider)
  → modelRuntime.registerProvider(id, registration)   // 运行时内存注册
  → createAgentSession({ modelRuntime, model })
  → Pi extension 通过 session / ModelRuntime 看到 model.input
```

`modelsPath: ~/.pi/agent/models.json` 是 Pi 自己的 override 文件；piwin **不**把 product config 写回该文件。  
**修好 `buildPiProviderRegistration` 的 `input` 透传即可让 extension 看到正确能力。**

### 3.6 Provider ID 不匹配（关键）

| 层 | ID 例子 |
|----|---------|
| Pi catalog | `anthropic`, `openai`, `openrouter` |
| piwin config | 用户可自定义：`my-claude-proxy`, `openai` |

**不能**用 piwin 的 `providerId` 去精确匹配 catalog 的 provider key。  
搜索 / 补全策略：

1. **主匹配**：`modelId` / `name` 子串（跨全部 catalog provider）
2. **可选过滤**：`catalogProviderId`（仅当用户明确选了 catalog 侧 provider 时）
3. **可选启发**：若 piwin provider 的 `baseUrl` / preset 对应已知 catalog provider，可 boost 排序，但不得过滤掉其他命中

选中 catalog 条目后：只把 **模型元数据**（id/name/input/reasoning/limits）填入当前 piwin provider 的 `ModelConfigEntry`；**不**改 piwin provider id。

---

## 4. 架构设计

### 4.1 数据流

```text
@earendil-works/pi-ai MODELS
  ↓ agent-host 显式依赖 + 投影
@piwin/contracts ModelCatalogEntry
  ↓ IPC models/catalog/search
apps/desktop (autocomplete / 能力标签 / 前置检查)
  ↓ 用户确认 → ModelConfigEntry（含 input/reasoning）
~/.piwin/config.json
  ↓ session 创建时 buildPiProviderRegistration
Pi ModelRuntime（内存）→ extension 可见
  ↓ 同字段
Spec 2 D1：resolvePrimaryModelInput → shouldDelegateVision
```

### 4.2 contracts 变更

**`packages/contracts/src/config.ts`**：

```ts
export type ModelInputModality = 'text' | 'image';

export type ModelConfigEntry = {
  id: string;
  label?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  tooltipMarkdown?: string;
  thinkingLevel?: ThinkingLevel;
  capabilities?: ModelCapability[];
  routes?: Partial<Record<ModelCapability, ModelRouteConfig>>;
  /**
   * 输入模态。省略 = 视为 ['text']（安全默认：不假设能看图）。
   * 来源：catalog 补全 / 用户勾选 / discover 后 catalog 合并。
   */
  input?: readonly ModelInputModality[];
  /**
   * 是否支持 reasoning/thinking。
   * 省略时：注册进 Pi 时默认 true（保持现有硬编码行为，避免破坏已有 thinking UI）。
   */
  reasoning?: boolean;
};
```

**`packages/contracts/src/model-catalog.ts`**（新文件）：

```ts
export type ModelCatalogEntry = {
  /** Pi catalog 侧 provider id（anthropic / openai / …），仅作展示与过滤，不写入 piwin provider id。 */
  catalogProviderId: string;
  modelId: string;
  name: string;
  input: readonly ModelInputModality[];
  reasoning: boolean;
  contextWindow: number;
  maxTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
};

export type ModelCatalogSearchRequest = {
  /** 模型 id 或名称子串，大小写不敏感。空 = 不按文本过滤。 */
  query?: string;
  /** 仅匹配该 catalog provider（可选）。 */
  catalogProviderId?: string;
  /** 要求 input 包含该模态（可选）。 */
  inputIncludes?: ModelInputModality;
  /** 默认 50，上限 200。 */
  limit?: number;
};

export type ModelCatalogSearchResult = {
  entries: ModelCatalogEntry[];
  /** 例如 pi-ai 包版本号。 */
  catalogVersion: string;
};
```

**`DiscoveredModel` 扩展**（`config.ts`）：

```ts
export type DiscoveredModel = {
  id: string;
  label?: string;
  /** discover 后由 host 用 catalog 按 modelId 合并时填充（可选）。 */
  input?: readonly ModelInputModality[];
  reasoning?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
};
```

**IPC**（`ipc.ts`）：

```ts
| { id?: string; type: 'models/catalog/search'; input: ModelCatalogSearchRequest }
```

HostResponse data 类型：`ModelCatalogSearchResult`。

### 4.3 agent-host 变更

#### 4.3.1 依赖

```json
// packages/agent-host/package.json
"@earendil-works/pi-ai": "0.80.10"  // 与 pi-coding-agent 同版本锁定
```

版本号以 lockfile / pi-coding-agent 实际依赖为准，实现时对齐，禁止 floating。

#### 4.3.2 修 `buildPiProviderRegistration`

```ts
// packages/agent-host/src/pi-model-runtime.ts
models: provider.models.map((model) => ({
  id: model.id,
  name: model.label?.trim() || model.id,
  api,
  baseUrl: provider.baseUrl,
  // 省略时 true：兼容现有「全开 reasoning」行为
  reasoning: model.reasoning ?? true,
  // 省略时 ['text']：安全默认，不误报 vision
  input: model.input ? [...model.input] : ['text'],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: model.contextWindow ?? DEFAULT_MODEL_CONTEXT_WINDOW,
  maxTokens: model.maxOutputTokens ?? 8_192,
  ...(provider.headers ? { headers: provider.headers } : {}),
})),
```

#### 4.3.3 `model-catalog-reader.ts`

```ts
import { MODELS } from '@earendil-works/pi-ai';
// + 从 pi-ai package.json 读 version 作为 catalogVersion

export function searchPiCatalog(request: ModelCatalogSearchRequest): ModelCatalogSearchResult
export function lookupCatalogByModelId(modelId: string): ModelCatalogEntry | undefined
/** 用 catalog 元数据填充 DiscoveredModel / ModelConfigEntry 的缺失字段（不覆盖用户已设值）。 */
export function enrichFromCatalog<T extends { id: string }>(
  entry: T,
  catalog: ModelCatalogEntry | undefined,
): T & Partial<Pick<ModelCatalogEntry, 'input' | 'reasoning' | 'contextWindow' | 'maxTokens' | 'name'>>
```

搜索规则：

- `query`：`modelId` 或 `name` 包含 query（trim + lower）
- 排序：id 前缀匹配 > name 前缀 > 子串；同级按 catalogProviderId + modelId
- `limit` clamp 到 `[1, 200]`，默认 50

#### 4.3.4 IPC handler

`catalog-commands.ts`：

```ts
case 'models/catalog/search': {
  return ok(requestId, 'models/catalog/search', searchPiCatalog(command.input ?? {}));
}
```

#### 4.3.5 Discover 后合并 catalog

`discoverProviderModels` 返回前，对每个 `DiscoveredModel` 调 `lookupCatalogByModelId` + `enrichFromCatalog`（只填缺失字段）。  
`mergeDiscoveredModels`（desktop）导入时把 `input` / `reasoning` / limits 一并写入 `ModelConfigEntry`。

### 4.4 apps/desktop 变更

#### 4.4.1 AddModelDialog — combobox

- Model ID 输入 ≥2 字符 → debounce 200ms → `models/catalog/search { query }`
- 下拉：`modelId` + `name` + catalogProviderId 小字 + vision/reasoning 标记 + ctx 简写
- 选中 → 填 label / contextWindow / maxOutputTokens / input / reasoning
- 仍允许手填不在 catalog 的 ID
- 新增「支持图片输入」勾选（默认 false；catalog 选中时按 catalog 设）

Props：

```ts
onSearchCatalog: (query: string) => Promise<ModelCatalogEntry[]>;
```

#### 4.4.2 模型列表（`provider-model-list.tsx`）

- 行内 pill（`model-caps.ts`）：`input` 含 `image` → Vision；`reasoning === true` → Reasoning
- `ModelInlineEditor`：可编辑 supportsImage / reasoning

#### 4.4.3 `model-configuration.ts`

```ts
export type ModelConfigurationDraft = {
  id: string;
  label: string;
  contextWindow: string;
  maxOutputTokens: string;
  tooltipMarkdown: string;
  thinkingLevel: ThinkingLevel | '';
  supportsImage: boolean;
  reasoning: boolean;
};
```

`createModelConfigurationEntry`：`supportsImage` → `input: supportsImage ? ['text','image'] : ['text']`；`reasoning` 写入字段。

#### 4.4.4 聊天区

`ModelOption` / `ComposerModelOption` 增加：

```ts
input?: readonly ModelInputModality[];
reasoning?: boolean;
```

`modelsFromConfig` 从 config 透传。选择器显示 vision 标记。

#### 4.4.5 发送图片前置检查（rev3，对齐原生传图）

位置：`use-composer-media.ts` `handleSend`，在 `user/send` 之前。

```ts
const hasImage = attachments.some((a) => a.kind === 'media');
if (!hasImage) { /* continue */ }
else {
  const supportsImage = modelOption?.input?.includes('image') ?? false;
  const visionDelegationOn =
    config?.visionDelegation?.enabled === true && Boolean(config.visionDelegation.model);

  if (supportsImage) {
    // 原生 ImageContent 路径（已落地）— 放行
  } else if (visionDelegationOn) {
    // Spec 2 D1 将描述注入 — 放行；可选轻量提示「将用 vision 模型描述图片」
  } else {
    // 当前实现仍会把 ImageContent 传给 text-only 主模型，可能报错或无效
    // confirm：建议切换 vision 模型，或去 Settings 开启 Vision Delegation
    // 用户仍可强制发送（不阻塞硬拦）
    if (!confirmed) return;
  }
}
```

**文案要点（rev3）**：

- 不要再说「将仅路径注入」——那已不是默认行为。
- 应说：「当前模型未声明支持图片；图片会以原生附件发送，部分文本模型可能报错或忽略。建议切换多模态模型，或开启 Vision Delegation。」

无 Spec 1 `input` 字段时：`supportsImage` 恒 false → 有图时总是走 confirm（除非已开 delegation）。这是安全默认。

### 4.5 apps/cli

`chat --image` + 主模型未声明 vision：stderr warning（不阻塞）。  
CLI 已通过 `attachments` 走 adapter 原生传图（2026-08-01）。

---

## 5. 实现任务

### Phase A — contracts + 注册修复（可独立合并）

| ID | Task | Exit |
|----|------|------|
| A1 | `ModelInputModality` + `ModelConfigEntry.input/reasoning` | typecheck |
| A2 | `model-catalog.ts` 类型 + IPC `models/catalog/search` | typecheck |
| A3 | `DiscoveredModel` 可选能力字段 | typecheck |
| A4 | agent-host 加 `@earendil-works/pi-ai` 依赖（版本锁定） | install + typecheck |
| A5 | `buildPiProviderRegistration` 透传 input/reasoning（默认见 §4.3.2） | 单测 |
| A6 | `searchPiCatalog` / `lookupCatalogByModelId` / `enrichFromCatalog` | 单测 |
| A7 | IPC handler | 单测 |
| A8 | discover 结果 catalog 合并 | 单测 |

### Phase B — Settings UI

| ID | Task | Exit |
|----|------|------|
| B1 | AddModelDialog catalog combobox | 手动 |
| B2 | 选中自动填表 + supportsImage | 手动 |
| B3 | 模型列表能力 pill | 手动 |
| B4 | ModelInlineEditor + draft 类型 | typecheck + 手动 |
| B5 | mergeDiscoveredModels 保留能力字段 | 单测 |

### Phase C — 聊天区 + 前置检查

| ID | Task | Exit |
|----|------|------|
| C1 | ModelOption 透传 input/reasoning | typecheck |
| C2 | 选择器 vision 标记 | 手动 |
| C3 | handleSend 前置检查（文案对齐原生传图 + Spec 2 D1） | 手动 |

### Phase D — 可选

| ID | Task | Exit |
|----|------|------|
| D1 | provider-presets 建议模型从 catalog 取前 N（按 preset 映射 catalogProviderId） | 手动 |

---

## 6. 配置示例

```jsonc
// ~/.piwin/config.json
{
  "providers": [{
    "id": "my-claude-proxy",
    "protocol": "anthropic-compatible",
    "name": "Claude Proxy",
    "baseUrl": "https://proxy.example.com",
    "models": [{
      "id": "claude-sonnet-4-20250514",
      "label": "Claude Sonnet 4",
      "contextWindow": 200000,
      "maxOutputTokens": 16384,
      "input": ["text", "image"],
      "reasoning": true
    }]
  }]
}
```

注意：`providers[].id` 可以是任意字符串；catalog 的 `catalogProviderId` 不会写进这里。

---

## 7. 测试

| 项 | 要求 |
|----|------|
| registration input 透传 | config `input: ['text','image']` → registration 匹配 |
| registration 默认 | 无 input → `['text']`；无 reasoning → `true` |
| search query | 子串 / catalogProviderId / inputIncludes / limit clamp |
| enrich | 不覆盖用户已设 contextWindow |
| discover merge | API 返回的 id 若在 catalog 中则带 input |
| draft round-trip | supportsImage ↔ input |
| 前置检查文案 | text-only + 图 + 无 delegation → confirm；有 vision 或 delegation → 不阻塞 |

---

## 8. 兼容性

- `input` / `reasoning` 可选；旧 config 可跑。
- 默认 `input` 视为 text-only（安全）；默认 `reasoning` 注册为 true（兼容现状）。
- 新 IPC 不影响 `models/discover`。
- autocomplete 非强制。
- **与媒体路径兼容**：本 spec 不改变 `prompt-images` / adapter 原生传图；只提供能力元数据供分流与 UX。

## 9. Review 修正记录

### rev 2

| 问题 | 修正 |
|------|------|
| 写 models.json 的错误叙述 | 改为 ModelRuntime 运行时注册 |
| `import pi-ai` 在 agent-host 不可用 | 显式加依赖 |
| providerId 与 catalog 硬匹配 | 改为 modelId 主匹配 + catalogProviderId 可选 |
| reasoning 默认 false 会破坏 thinking | 默认 true |
| Discover 无能力 | DiscoveredModel 扩展 + catalog enrich |
| 数据流 IPC 名不一致 | 统一 `models/catalog/search` |

### rev 3（对齐 ADR 0005 / 原生传图）

| 问题 | 修正 |
|------|------|
| Non-goal 写「当前仍是 path 注入 / 原生见 Spec 2」 | 删除；D2 已落地，本 spec 不再负责原生传图 |
| 前置检查文案「将仅路径注入」 | 改为「原生附件可能被 text-only 忽略/报错」+ 引导 delegation |
| `input` 字段只是标签 | 明确：现为 D1 分流与 extension 的硬依赖 |
| 与 Spec 2 关系 | Spec 1 = 能力元数据；Spec 2 = text-only 时如何处理已传入的图 |

### Amendment (2026-08-03): model edit Popover and explicit thinking levels

`ModelConfigEntry.thinkingLevels` is an optional ordered list of supported
`ThinkingLevel` values. `thinkingLevel` is the default selected value and must
belong to that list when the list is present. The Desktop composer reads this
list from the selected configured model; it does not infer levels from provider
protocol. A missing/empty list hides the effort controls while keeping the model
picker available.

Settings → Models opens an inline editor under a configured model row (click
the row, or "Edit parameters" in its `⋯` menu). The editor reads missing
context/output/input/reasoning values from the existing Pi catalog search
result, falls back to the host defaults
(128000 context and 8192 output), and never overwrites configured user values.
Vision maps to `input: ['text', 'image']`; image generation maps to
`capabilities: ['image-generation']`; reasoning maps to `reasoning`. The
editor's own Save persists the model immediately; provider connection fields
keep their separate save bar (see
`docs/specs/2026-09-23-provider-settings-master-detail.md`).

The send / edit / retry paths in `use-composer-media` and `use-session-actions`
gate `PromptInput.thinkingLevel` through `canUseThinkingLevel` against the
selected model's explicit `thinkingLevels`, so a stale effort value from a
previous model selection is never transmitted.

At the Pi boundary, the Host also projects the configured list into Pi's
model-level `thinkingLevelMap`. Configured levels are sent as canonical Pi
values, omitted levels are marked `null`, and `xhigh` / `max` therefore remain
available to Pi when the model configuration enables them. Pi receives the
canonical level and performs the final Provider-specific request mapping.
