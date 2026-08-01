# Spec — Vision Delegation（文本模型识图能力）

| Field | Value |
|-------|-------|
| Status | **Draft (rev 3)** |
| Date | 2026-08-01 |
| Packages | `contracts`, `agent-host`, `apps/desktop`, `apps/cli` |
| Depends on | [model-catalog-integration.md](./model-catalog-integration.md)（`input` 字段 + catalog） |
| Principle | **D2 已默认**：composer 图原生进 Pi；**D1** 在 text-only 时把图变成描述（或兜底 path）；**D3** `read` 工具图靠 Pi extension |
| Landed | D2 native `prompt({ images })` — ADR 0005 amendment 2026-08-01 |

---

## 1. 目标

让**文本模型**在收到用户粘贴/拖放的图片时，也能理解图意：

1. 主模型声明 vision → 已由 D2 原生传图（**已落地**）
2. 主模型 text-only + 开启 delegation → host 用 vision 模型描述后注入文本，**且不再把 ImageContent 传给主模型**
3. 主模型 text-only + 未开 delegation → 明确兜底（path 注入或剥离图片 + 警告），避免静默失败
4. 模型 `read` 出的图 → 可选 Pi extension（pi-vision-handoff）

**本 spec 剩余工作 = D1 + D3 + 与 Spec 1 的分流接线；D2 不再是待办。**

---

## 2. 现状（rev3）

| 事实 | 代码位置 |
|------|----------|
| Composer media **默认原生 `ImageContent`** | `prompt-images.ts` + `sdk-adapter` `prompt(text, { images })` |
| `buildModelPromptInput` 对 media **只校验 path**，不注入 path 文本 | `host-runtime.ts` |
| Web-element 仍结构化文本注入 | `formatTextModelWebElementInjection` |
| Path 注入 helper 仍在 | `formatTextModelImageInjection`（**未默认调用**） |
| 注册进 Pi 时 `input` 仍可能硬编码 `['text']` | `buildPiProviderRegistration`（**Spec 1 修**） |
| 规则 | AGENTS.md §1.6；ADR 0005 amendment 2026-08-01 |

| 能力 | 状态 | 说明 |
|------|------|------|
| **D2 Native vision** | **Done** | 所有 composer media → `prompt({ images })`，**尚未**按 `input` 分流 |
| **D1 Text-only delegation** | **P0 待做** | text-only 时描述注入 + **剥离 images** |
| **D3 read 工具图** | **P0 文档 + 可选 extension** | host 看不到 tool→model 中间态 |

### 2.1 D2 落地后的新风险（rev3 必须处理）

D2 之前：text-only 至少收到 path 字符串。  
D2 之后：text-only **也会收到 ImageContent**。

| 风险 | 说明 |
|------|------|
| API 报错 | 部分 text-only endpoint 收到 image part 直接 4xx |
| 静默丢弃 | 部分 provider 忽略 image part，用户以为模型看了图 |
| 成本 | 大图 base64 进上下文，对「看不了」的模型也计费/占内存 |

因此 D1 **不是**「在 path 注入之上加描述」，而是：

> **当主模型不支持 image 时，改变 D2 的默认行为**（描述注入 或 path 兜底，且不向主模型传 ImageContent）。

---

## 3. 分层：composer 附件 vs `read` 工具

```text
用户 paste/drop 图片
  → media/save → PromptInput.attachments（path 引用，UI/transcript SoT）
  → buildModelPromptInput（host，将 async）
       ├─ primary.input 含 image     → 保留 attachments；text 不注入 path
       │                              adapter → prompt(text, { images })   【D2 已有】
       ├─ text-only + D1 on          → 描述注入 text；attachments 清空或标记 skipImages
       │                              adapter → prompt(text) 无 images     【D1 待做】
       └─ text-only + D1 off         → path 注入 text；attachments 清空或 skipImages
                                      adapter → prompt(text) 无 images     【兜底】
  → Pi session.prompt(...)

模型调用 read(path.png)
  → Pi 内置 read 返回 image content block
  → 【host 看不到 tool→model 中间态】
  → 需 Pi extension 的 context / input 钩子（pi-vision-handoff）【D3】
```

| 图片来源 | 谁处理 | 原因 |
|----------|--------|------|
| composer 附件 | **piwin host** | 已在 `buildModelPromptInput` + adapter 边界；可按 `input` 分流 |
| `read` 工具 | **Pi extension** | tool result 在 Pi 内核；wrap `read` 要复制 magic-byte/Photon 逻辑 → 违反 adapters-over-forks |

### 3.1 与 pi-vision-handoff 的协作（rev3 更新）

**D2 之后的重要变化**：composer 图现在是真正的 image block，extension 的 `context` / `input` 钩子**也能看到**它们（以前是 path 字符串，钩子接不住）。

| 路径 | host D1 | extension |
|------|---------|-----------|
| composer + multimodal | 不处理（D2 透传） | 透传 |
| composer + text-only + D1 on | **host 先描述并剥离 images** | 通常无 image block，不触发 |
| composer + text-only + D1 off | path 兜底 / 剥离 | 若仍传了 images 且装了 extension → 可描述；**piwin 默认应剥离，避免双处理** |
| `read` + text-only | host 不可见 | extension 描述替换 |

**协作原则**：

1. **Spec 1 必须修 `input` 注册** — extension 与 D1 都依赖它判断 text-only。
2. **composer 的 text-only 优先 host D1**（不依赖用户装 extension；Settings 可配）。
3. **host 在 D1/兜底路径必须 `skipImages`**，避免 extension 与 host 对同一张图描述两次。
4. **`read` 工具图** 仍只靠 extension（或未来 bundled extension）。
5. 配置同步 extension 文件格式 → Phase H 可选，P0 只文档引导。

### 3.2 场景矩阵（rev3）

| 场景 | host | adapter images | extension |
|------|------|----------------|-----------|
| multimodal + composer 图 | 校验 path | **传 ImageContent（D2）** | 透传 |
| text-only + composer + D1 on | 描述注入 | **不传** | 无 block |
| text-only + composer + D1 off | path 注入（兜底） | **不传** | 无 block |
| text-only + `read` + extension | — | — | 描述替换 |
| text-only + `read` + 无 extension | — | — | 图可能被丢弃/无效 |
| multimodal + `read` | — | — | 透传 |

---

## 4. D1 — Text-only delegation（P0）

### 4.1 contracts

```ts
// config.ts
export type VisionDelegationConfig = {
  /** 默认 false */
  enabled: boolean;
  /**
   * 描述用 vision 模型。必须是已配置 provider 下的模型，
   * 且建议 input 含 image（host 启动时校验，不满足则 enabled 视为无效并 log warn）。
   */
  model?: ModelRef;
  /** 默认 "Describe this image in detail for a coding agent. Include text in the image verbatim." */
  systemPrompt?: string;
  /** 默认 30_000 */
  timeoutMs?: number;
  /** 默认 true */
  cacheEnabled?: boolean;
};

export type PiwinConfig = {
  // ...
  visionDelegation?: VisionDelegationConfig;
};
```

```ts
// ipc — 测试/预览用
| { id?: string; type: 'vision/delegate'; input: VisionDelegateInput }
| { id?: string; type: 'vision/cache/clear' }

export type VisionDelegateInput = {
  /** media root 下绝对路径（优先） */
  imagePath?: string;
  imageBase64?: string;
  mimeType: string;
  prompt?: string;
};

export type VisionDelegateResult = {
  description: string;
  model: ModelRef;
  durationMs: number;
  cacheHit: boolean;
};
```

`config-store`：`createDefault` 可不设 `visionDelegation`；load 时若存在则浅校验 `enabled` boolean。

### 4.2 何时 delegation

```ts
export function shouldDelegateVision(params: {
  /** 本 turn 主模型的 input；来自 config 的 ModelConfigEntry.input */
  primaryModelInput: readonly ModelInputModality[] | undefined;
  hasMediaAttachments: boolean;
  config: VisionDelegationConfig | undefined;
}): boolean {
  if (!params.config?.enabled) return false;
  if (!params.config.model) return false;
  if (!params.hasMediaAttachments) return false;
  // 省略 input = text-only（与 Spec 1 安全默认一致）
  const supportsImage = params.primaryModelInput?.includes('image') ?? false;
  return !supportsImage;
}
```

### 4.3 解析「本 turn 主模型」的 input

`PromptInput.model` 是 per-turn `ModelRef`；否则用 session/config 默认。

```ts
function resolvePrimaryModelInput(
  input: PromptInput,
  config: PiwinConfig,
): readonly ModelInputModality[] | undefined {
  const ref =
    input.model ??
    (config.defaultProviderId && config.defaultModelId
      ? {
          protocol: /* from provider */,
          providerId: config.defaultProviderId,
          modelId: config.defaultModelId,
        }
      : undefined);
  if (!ref) return undefined;
  const provider = config.providers.find((p) => p.id === ref.providerId);
  const model = provider?.models.find((m) => m.id === ref.modelId);
  return model?.input;
}
```

**不要**从 `ModelRuntime.getModel` 反查作为唯一来源：registration 可能尚未带上用户刚改的 config（session 生命周期）。以 **当前 `PiwinConfig` 快照** 为准；prompt 时重新 `loadPiwinConfig` 或 runtime 持有的最新 config（与现有 `config/set` 行为对齐）。

### 4.4 `buildModelPromptInput` 异步化 + 分流（rev3 核心）

**现状（D2 后）**：同步；media 只校验；adapter 无条件 `loadPromptImages`。

**目标签名**：

```ts
buildModelPromptInput: (input: PromptInput, signal?: AbortSignal) => Promise<PromptInput>
```

**分流伪代码**：

```ts
async function buildModelPromptInput(input, signal) {
  // 1. validate media paths / web-element inject (sync part)
  // 2. resolve primaryModelInput from config
  // 3. if no media attachments → return
  // 4. if supportsImage → return { ...input, attachments: safeMedia }  // adapter loads images
  // 5. if shouldDelegateVision →
  //      for each media: description = await delegate(...)
  //      text += description blocks
  //      return { ...input, text, attachments: nonMediaOnly, skipImages: true }
  // 6. else fallback path inject + skipImages: true
}
```

**`skipImages` 信号（rev3 新增）**：

D1 / path 兜底时必须阻止 adapter 再 `loadPromptImages`。两种实现二选一（实现时选更小 diff）：

| 方案 | 做法 |
|------|------|
| A | `PromptInput` 增加内部/可选 `skipImages?: boolean`（contracts 或 host-only 扩展字段） |
| B | D1/兜底时 **清空 media attachments**（web-element 保留）；transcript 已在 `recordUserPrompt` 用原始 input 落盘 |

**推荐 B**：不扩 `PromptInput`；`recordUserPrompt` 已在 path-rewrite 前用原始 attachments（现有 `preparePromptInput` 顺序保持）。D1 后返回的 prompt 给 adapter 时 media attachments 已去掉 → `loadPromptImages` 自然为空。

调用方必须改：

| 文件 | 改动 |
|------|------|
| `host-runtime.ts` | 方法 async；注入 config + secretResolver + cache |
| `session-live-commands.ts` | `preparePromptInput` 内 `await`；同步预检路径可保留「只 validate」的轻量函数 |
| `SessionLiveContext` 类型 | 返回 `Promise<PromptInput>` |
| `session-live-commands.test.ts` | mock 改为 async |
| 同步预检 `buildModelPromptInput`（accept 前） | 拆成 `validatePromptAttachments`（sync）+ async build，或 accept 前只 validate |

**Abort**：`preparePromptInput` 已有 `throwIfPromptPreparationAborted`；delegation 的 `fetch` 必须接 `AbortSignal`，用户点停止时取消 vision 请求。

**失败策略**：单张图 delegation 失败 → 该张 **fallback 到 path 注入** + `host/log` warn；不整 turn 失败（除非未来加 strict 模式）。失败路径同样 **不传 ImageContent**。

**多图**：串行或有限并发（默认 3）；每张独立 cache key。

### 4.5 `delegateImageToVisionModel`

实现要点：

1. 校验 `imagePath` 在 media root 内（复用 `validateMediaAttachment` / `assertInsideMediaRoot`）
2. 读文件 → base64；可选 resize（P1，可先原图 + timeout）
3. 用 **delegation 模型** 所属 provider 的 protocol 发 **非流式** chat completion（带 image part）
4. 密钥：`SecretResolver.resolveProviderSecret(provider)`，与 discover/test 一致
5. 超时：`AbortSignal.timeout(timeoutMs)` 与外部 signal 组合

Protocol 分支：

- openai-compatible → `/chat/completions` + `image_url` data URL
- anthropic-compatible → `/v1/messages` + `image` base64 source
- google-gemini → `generateContent` + `inline_data`

**禁止**为了省事去调 Pi session 的 agent loop（会污染会话、触发工具）。只做一次性 completion。

可选：若 `ModelRuntime.completeSimple` 在 host 侧可安全构造且不绑 session，可用；否则直接 `fetch`（与 `image-gen-tool` 模式一致，更可控）。

### 4.6 缓存

```
key = sha256(fileBytes | mime | visionProviderId | visionModelId | systemPrompt | userPrompt)
```

- 默认内存 LRU（如 64 条）
- `cacheEnabled: false` 跳过
- 只缓存成功结果
- `vision/cache/clear` 清空

### 4.7 注入文本格式

```text
[attached image — vision description]
path: /Users/.../.piwin/media/<session>/<id>.png
mime: image/png
model: <providerId>/<modelId>

<description text>
```

保留 path，便于模型后续 `read` 或用户对照；description 是主体。

Path 兜底（D1 off 或 delegation 失败）仍用：

```text
[attached image]
path: ...
mime: ...
size: ... bytes
```

（`formatTextModelImageInjection`）

### 4.8 Settings UI

独立 section（Models 页下方或新页）：

- 开关 enabled
- 模型选择：仅列出 **已配置** 且 `input` 含 `image` 的模型；若列表为空，提示先在 Spec 1 流程添加 vision 模型
- systemPrompt / timeoutMs / cacheEnabled
- 测试：选图 → `vision/delegate` → 展示结果
- 清除缓存
- 信息块：`read` 工具图需安装 pi-vision-handoff（依赖 Spec 1 已修 input）

### 4.9 与 Spec 1 前置检查联动（rev3 文案）

```ts
if (hasImage && !supportsImage) {
  if (visionDelegationEnabledAndConfigured) {
    // 不弹阻塞 confirm；可选轻量「将描述图片…」
  } else {
    // confirm：当前会 path 兜底且不向主模型传图；建议开 delegation 或换 vision 模型
    // （在 D1 落地前的过渡期：当前代码仍会传 ImageContent — 见 §2.1；
    //   D1 落地后 confirm 文案改为 path 兜底说明）
  }
}
```

Delegation 在 host 内、`session/prompt` 返回 accepted 之后的 preparing 阶段完成 → UI 上表现为发送变慢；应用 spinner / status（「描述图片中…」）。

---

## 5. D2 — 原生 vision path（**已落地**）

### 5.1 已实现行为

| 步骤 | 实现 |
|------|------|
| 落盘 | `media/save` → `~/.piwin/media/` |
| 校验 | `buildModelPromptInput` → `validateMediaAttachment` |
| 加载 | `loadPromptImages(attachments)` |
| 发送 | `piSession.prompt(text, { images })` |
| transcript | 存 path 引用，不存 base64 |

### 5.2 仍属 D1 的接线（不要算进 D2）

| 项 | 说明 |
|----|------|
| 按 `input` 决定是否传 images | D1 / 兜底必须 `skipImages` |
| 大图 resize | 可选 P1，可与 D1 一起做 |
| text-only 默认行为 | D1 off → path 兜底（**改掉「无脑传 ImageContent」**） |

### 5.3 安全（保持）

- 图片体积上限：复用 `media.maxPasteBytes`
- 路径必须在 media root
- 禁止 base64 塞进 **text** prompt（原生 ImageContent part 除外）

---

## 6. D3 — `read` 工具图（P0 文档 / P2 自研 extension）

| 阶段 | 做法 |
|------|------|
| P0 | README / Settings 文案：安装 `pi-vision-handoff`；依赖 Spec 1 input 修复 |
| P2 | 可选：piwin bundled extension 钩 `context`，读 `visionDelegation` 配置，去掉第三方依赖 |

P0 **不**把第三方 extension 打进默认安装。

**与 D2 的关系**：composer 图已是 image block，若用户装了 extension 且 host **未**在 text-only 路径剥离 images，extension 可能对 composer 图也生效。  
**piwin 默认策略仍是 host 分流 + skipImages**，避免依赖 extension 才能安全使用 text-only。

---

## 7. 实现任务总表

### Phase E — D1 核心（P0）

| ID | Task | Exit |
|----|------|------|
| E1 | `VisionDelegationConfig` + config load/save | typecheck + config-store 测 |
| E2 | IPC 类型 vision/delegate、vision/cache/clear | typecheck |
| E3 | `shouldDelegateVision` / `resolvePrimaryModelInput` 纯函数 | 单测 |
| E4 | `delegateImageToVisionModel` 三协议 + timeout + media root 校验 | mock fetch 单测 |
| E5 | `VisionDelegationCache` | 单测 |
| E6 | `buildModelPromptInput` async + 分流（vision / D1 / path 兜底）+ 剥离 media attachments | 单测 |
| E7 | 同步预检拆分（accept 前 validate）+ session-live await + abort | 单测 |
| E8 | IPC handlers | 单测 |
| E9 | **text-only 默认不再传 ImageContent**（D1 off → path 兜底） | 单测：adapter 侧 images 为空 |

### Phase F — Settings UI

| ID | Task | Exit |
|----|------|------|
| F1 | Vision Delegation section | 手动 |
| F2 | 仅 vision 模型可选（依赖 Spec 1 input） | 手动 |
| F3 | 测试描述 + 清缓存 | 手动 |
| F4 | pi-vision-handoff 说明 | 手动 |

### Phase G — UX 联动

| ID | Task | Exit |
|----|------|------|
| G1 | handleSend 与 delegation 联动（Spec 1 C3，文案 rev3） | 手动 |
| G2 | 发送中「描述图片…」状态 | 手动 |
| G3 | CLI warning（text-only + `--image`） | 手动 |

### Phase H — 可选

| ID | Task | Exit |
|----|------|------|
| H1 | extension 配置同步（格式确认后） | 单测 |
| H2 | 大图 resize / base64 总大小 cap | 单测 |
| H3 | bundled vision extension（D3 P2） | 手动 |

**已移除**：原 Phase H 的「实现 D2 native vision」— 已在 2026-08-01 落地。

---

## 8. 测试要点

| 项 | 期望 |
|----|------|
| multimodal + 图 | text 无 `[attached image]` path 块；adapter 收到 images |
| text-only + D1 on + 图 | text 含 description；**无** images 传给 Pi |
| text-only + D1 off + 图 | text 含 path 注入；**无** images 传给 Pi |
| delegation 失败 | 该张 path fallback + warn；仍无 images |
| abort 发送 | vision fetch 取消 |
| 路径穿越 | reject |
| cache hit | 第二次无网络 |
| web-element | 仍文本注入，不受 D1 影响 |

---

## 9. 兼容性

- 默认 `visionDelegation` 缺省 = 关闭。
- **rev3 行为变化（相对 D2-only 现状）**：D1 落地后，text-only + 图 + delegation off 从「传 ImageContent」改为「path 注入且不传 images」。这是有意收紧，避免 text-only API 报错。
- `buildModelPromptInput` async 是 host 内部 breaking，需同步改调用方。
- 不强制安装任何 Pi extension。
- 依赖 Spec 1 的 `input` 字段；无 Spec 1 时 `resolvePrimaryModelInput` 恒视为 text-only → 若误开 delegation 会对「实际能看图但未声明」的模型也描述一遍（浪费但安全）。未声明 vision 的模型在 D1 off 时走 path 兜底（不再传图）。

## 10. Review 修正记录

### rev 2

| 问题 | 修正 |
|------|------|
| 「多模态原样透传」与代码不符 | 拆 D1/D2 |
| 未说明如何解析本 turn 模型 input | §4.3 |
| async 化未列调用方 | §4.4 |
| 失败/abort/多图未定义 | §4.4–4.5 |
| 写死同步 pi-vision-handoff 配置 | Phase H 可选 |

### rev 3（对齐 D2 已落地）

| 问题 | 修正 |
|------|------|
| D2 仍写 P1 / Phase H | 标为 **Done**；任务表删除实现 D2 |
| 场景矩阵仍写「multimodal 也 path 注入」 | 改为默认 ImageContent |
| D1 未要求剥离 images | §4.4 强制 skipImages / 清空 media attachments |
| 未写 D2 后 text-only 风险 | §2.1 API 报错 / 静默丢弃 / 成本 |
| extension 协作仍假设 composer 无 image block | §3.1 更新：composer 也可被钩子看到；host 优先剥离 |
| Spec 1 前置检查「仅路径注入」 | 联动文案改为 path 兜底 / 开 delegation / 换模型 |
| 默认兼容性写「关闭 = path 注入」 | 改为：关闭 + text-only = path 兜底且不传图（D1 落地后）；当前过渡期仍传图 |
