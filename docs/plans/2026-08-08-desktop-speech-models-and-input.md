# Desktop ASR/TTS 模型配置与语音输入提案

| Field | Value |
|-------|-------|
| Status | In progress — Phase 1–4 code path implemented; real microphone smoke test pending |
| Date | 2026-08-08 |
| Scope | Desktop ASR first; TTS capability/config seam only |
| Related | `packages/contracts`, `packages/host-runtime`, `apps/desktop` |

## 1. 评估结论

### 1.1 Pi 原生目录不提供可复用的 ASR/TTS 模型表

当前工作区安装的 `@earendil-works/pi-ai` 版本为 `0.80.10`。它的原生
`Model` 体系是聊天模型：已知 API 是文本对话 API，模型输入模态只有
`text` / `image`；图像生成另有独立的 `ImagesModels` 体系。

Pi 静态目录中确实有名字包含 `audio` 的 OpenRouter 模型条目，例如
`openai/gpt-audio`，但它们仍被描述成普通聊天 `Model`，输入仍是
`text`，并没有 ASR 的转写请求、音频输入类型或 TTS 请求协议。因此不能
把“模型名字里有 audio”当作 ASR 能力。

对应代码证据：

- Pi 的 `KnownApi` / `Model.input`：
  `packages/agent-host/node_modules/@earendil-works/pi-ai/dist/types.d.ts`
- piwin 对 Pi 聊天目录的投影只保留 `text` / `image`：
  `packages/agent-host/src/model-catalog-reader.ts`
- piwin 对图像目录单独建了 `ImageModelCatalogEntry`，但没有 ASR/TTS
  目录：`packages/contracts/src/model-catalog.ts`

### 1.2 piwin 当前也没有 ASR/TTS 能力建模

当前 `ModelCapability` 只有 `chat`、`image-generation`、
`video-generation`；设置页只有文本、图像生成、视频生成三个模型页签。
Provider discovery 只读取 Provider 的模型列表，并不会从返回结果推断
ASR/TTS 能力。

因此，ASR 模型必须由 piwin 产品配置显式标记和选择；不能等待 Pi 原生
模型表自动提供这项能力。

## 2. 推荐方案

### 2.1 复用 Provider 和模型条目，新增能力标签

不另建一套 `speechProviders`，继续使用现有的：

```text
PiwinConfig.providers[]
  └── models[]
        ├── capabilities: chat | image-generation | video-generation
        │                 | speech-to-text | text-to-speech
        └── routes[capability]
```

新增两个产品能力标签：

- `speech-to-text`：ASR / 语音识别
- `text-to-speech`：TTS / 语音合成

这样同一个 Provider 的 API key、Base URL 和模型发现仍然只有一份，某个
模型可以同时承担多个能力，也可以只承担 ASR 或 TTS。ASR/TTS 模型不应
注册进 Pi 的聊天 Model，也不应出现在 Composer 的聊天模型选择器里。

### 2.2 独立的默认模型配置

在 `PiwinConfig` 增加独立的语音配置，不能复用聊天默认模型，也不能在
没有 ASR 配置时偷偷回退到聊天模型：

```ts
type SpeechConfig = {
  asr?: {
    defaultModel?: ModelRef;
    language?: string;
  };
  tts?: {
    defaultModel?: ModelRef;
    voice?: string;
  };
};
```

第一版只要求 `speech.asr.defaultModel`。`speech.tts.defaultModel` 作为
同一配置面向未来保留，但本阶段不实现语音播放。

模型路由继续放在对应的 `ModelConfigEntry.routes` 下：

- ASR 默认路径：OpenAI-compatible Provider 的 `/audio/transcriptions`
- TTS 默认路径：OpenAI-compatible Provider 的 `/audio/speech`
- 允许模型级别覆盖相对路径和超时；禁止绝对 URL 覆盖 Provider 主机

第一阶段只实现 OpenAI-compatible 的 ASR 请求格式。Anthropic-compatible
和 Google Gemini 不应被 UI 假装成已支持的 ASR Provider；后续按真实协议
增加独立适配器。

### 2.3 壳层负责麦克风，Host 负责已配置 Provider 的调用

“语音输入是壳层能力”仍然成立，但需要把麦克风和密钥边界分开：

```text
Desktop WebView/Tauri
  → 麦克风权限与短暂录音
  → 内存中的音频 payload
  → HostCommand: speech/transcribe
  → @piwin/speech
  → Host 解析 Provider secret，调用 ASR endpoint
  → 返回纯文本
  → Desktop 插入 Composer
  → 用户确认后走现有 session/prompt
```

原始音频只在一次请求生命周期内存在：

- 不写入 `~/.piwin/media`
- 不进入 `PromptInput`
- 不写入 Session transcript
- 不写入日志、错误消息或 Host push
- 有明确的 MIME、字节数、时长和超时上限
- 请求完成、失败或取消后释放内存

把远程 ASR 请求放在 Host，是因为当前 Provider secret 和模型调用都由
Host 管理。若让 Desktop WebView 直接调用云端 ASR，就必须把 API key
暴露给客户端，并会破坏未来远程 Host / 多客户端的一致性。以后接入
本地 ASR 或移动端原生 Speech API 时，仍可让对应客户端直接转写，再只
把文本发给 Host。

## 3. 设置页方案（本阶段最小改动）

### 3.1 设计目标

ASR 是“输入能力”，不是新的聊天模型类别。因此第一版不新增顶层“语音”
设置，也不在 `Models` 页面增加第四个页签。语音配置放进现有 Models 页面，
只增加一个紧凑的“能力默认值”区域：

```text
模型
├── 能力默认值
│   ├── 对话模型       [沿用现有默认模型]
│   ├── 语音输入 ASR   [未配置]             [配置]
│   └── 语音输出 TTS   [功能尚未接入]       （预留）
└── Provider / 模型管理
    └── 现有文本、图像、视频模型管理区域
```

这次只给 ASR 提供真实可操作的默认模型选择。TTS 只在合同和模型能力标记
中预留，不提供一个当前无法使用的“默认 TTS”设置，避免设置页出现死配置。
等 TTS 播放链路确定后，再把 TTS 行变成可配置项，不需要更换配置结构。

当前前端的 `models-page.tsx` 有文本、图像、视频三个页签，
`ProviderSettings` 负责 Provider 和模型管理。本阶段不再增加新的页签，也
不复制 Provider 数据；只在现有 Models 页面顶部补充能力默认值区域。Provider
抽离和整个 Settings 信息架构重构属于后续独立设计，本方案不提前改动其领域
边界。

### 3.2 ASR 配置卡

ASR 卡片只表达三件事：当前选中的 Provider/model、是否可用、下一步操作。

- 未配置：显示“尚未配置语音输入”，提供“配置 ASR 模型”按钮，并说明
  “录音只用于转写，不会保存音频”。
- 已配置且可用：显示 Provider 名称、模型名称和“已就绪”状态，提供“更换”
  和“清除”操作。
- 模型不存在、Provider 停用或密钥缺失：保留当前选择但显示“不可用”原因，
  提供“更换模型”或“去配置 Provider”的操作。

点击“配置 ASR 模型”打开现有 UI-kit 的 Dialog/Drawer，而不是跳转到新的
设置页：

1. 只列出已启用 Provider 下已登记的模型。
2. 只把带 `speech-to-text` 能力标签的模型列为可选项。
3. 没有可选模型时，提供“去模型管理编辑模型”的入口；编辑完成后回到
   ASR 配置，不创建第二份 Provider。
4. 语言是可选的简单字段；Endpoint path、timeout 等放在折叠的“高级”区。
5. 保存时同时写入模型能力标签和 `speech.asr.defaultModel`，避免出现
   “已选模型但没有 ASR 能力”或反过来的半配置状态。

### 3.3 模型编辑的最小扩展

不为 ASR/TTS 另做模型页。现有新增/编辑模型抽屉增加一个折叠的“能力与用途”
区，只补充两个开关：

- 语音识别（ASR）
- 语音合成（TTS，当前仅作为能力标记预留）

它们写入模型条目的 `capabilities`，不从模型名称、Pi catalog 或 Provider
返回的普通模型列表自动推断。保存任意模型时必须保留已有的其他 capability
标签和 route；这条规则要用配置测试固定下来。

设置页必须保持以下行为：

1. 没有 ASR 模型时，语音入口可以显示但置灰，并提示去 Models 页配置。
2. 有 ASR 模型但 Provider 没有密钥或 Provider 被停用时，入口仍置灰并
   显示可操作错误。
3. 重新保存文本模型时，不能清掉该模型已有的 ASR/TTS capability 标签
   或 route。
4. Pi catalog autocomplete 只能补齐名称、上下文和视觉等字段，不能把
   Pi catalog 当作 ASR 能力来源。

## 4. Desktop 语音入口

第一版采用点击开始/点击停止，不自动提交：

1. 点击麦克风按钮，申请麦克风权限并进入 `listening`。
2. 再次点击停止录音，进入 `transcribing`。
3. Host 返回文本后，将文本插入当前 Composer 光标位置；已有草稿保留。
4. 用户可以编辑识别结果，再使用现有发送按钮提交。
5. 录音中、转写中、权限拒绝、Provider 未配置、超时和取消都有独立的
   UI 状态；不能静默失败。

桌面端先不做 ASR partial result、持续听写、自动发送和 TTS 播放。接口
可以预留 partial result，但不要让第一版依赖流式 ASR。

## 5. 包和边界

计划新增一个不依赖 Pi 的 `@piwin/speech` 应用包：

- `contracts`：能力标签、`SpeechConfig`、临时转写 Command/Response
  类型和安全上限
- `speech`：Provider 协议适配、ASR 请求/响应解析、超时/取消、模型解析
- `host-runtime`：组合 `speech`，解析 Host-owned secret，处理
  `speech/transcribe`
- `apps/desktop`：麦克风捕获、语音入口、Composer 插入和状态展示
- `agent-host`：不改，不导入 speech，也不接触麦克风或音频

这符合现有依赖方向：客户端不接触 Pi，Host 是 Provider secret 与跨客户端
命令的权威，Pi 边界仍只负责 Agent。

## 6. 实施顺序

### Phase 1 — Contracts/config/model capability

- 新增 `speech-to-text` / `text-to-speech` 能力标签。
- 新增 `SpeechConfig` 及旧配置向后兼容的 normalize/save。
- 新增 ASR/TTS route 类型所需的合同字段。
- 提取“按能力解析启用模型”的纯函数。
- 补充 contracts、config-store 和 model resolver 测试。

### Phase 2 — Settings

- Models 页现有布局上方增加“能力默认值”区，不新增“语音”页签。
- 增加 ASR 配置卡、配置 Dialog/Drawer 和 ASR 默认模型保存。
- 现有 Add/Edit Model 控件在折叠的“能力与用途”区增加 ASR/TTS 标签。
- TTS 只保存能力标记，不开放默认模型选择或播放设置。
- Provider/model 保存时保留未知或其他能力标签。
- 无配置、禁用 Provider、无密钥状态可解释。

### Phase 3 — Host ASR adapter

- 新增 `@piwin/speech`。
- 首先实现 OpenAI-compatible `/audio/transcriptions`。
- Host 增加 `speech/transcribe`，只允许配置了
  `speech-to-text` 能力的模型。
- 实现 MIME/大小/时长/超时/AbortSignal 和无持久化保证。
- 用 mock fetch 覆盖 multipart 请求、文本响应、错误和取消。

### Phase 4 — Desktop Composer

- 增加 `use-speech-input` 或等价的桌面 hook。
- 通过现有 UI-kit 添加麦克风入口。
- 实现录音、转写、插入 Composer、错误和权限状态。
- 增加组件测试，并做一次真实桌面麦克风权限 smoke test。

## 7. 明确不做

- 不修改 Pi core 或向 Pi 提交 ASR/TTS Model catalog。
- 不把 `gpt-audio` 等名字带 audio 的聊天模型自动标记为 ASR。
- 不把音频文件保存到 media 或 transcript。
- 不把 ASR 音频作为 Agent prompt attachment。
- 不在本阶段实现 TTS 播放、移动端、离线 Whisper、流式 partial ASR。
- 不让 Desktop WebView 直接持有 Host Provider API key。

## 8. 验收标准

1. 旧的 `~/.piwin/config.json` 没有 `speech` 字段时仍可正常加载。
2. 用户可以在 Models → 能力默认值 → ASR 中选择已配置的 Provider/model，
   并持久化独立默认值。
3. 未配置 ASR 时，Desktop Composer 不显示语音按钮，也不弹出设置提示；只有
   配置了可用 ASR 后才显示语音入口。
4. 配置有效 ASR 后，录音 → 转写 → Composer 插入 → 手动发送链路可用。
5. ASR 请求失败、权限拒绝、超时、取消都有安全的用户可见错误。
6. 测试能证明原始音频没有进入 media、PromptInput、transcript 或日志。

## 9. 当前实现记录（2026-08-08）

- 已完成 `ModelCapability` 的 ASR/TTS 标签、`SpeechConfig`、`speech/transcribe`
  合同和旧配置兼容归一化。
- 已完成 `@piwin/speech` 的 OpenAI-compatible multipart 转写适配器，包含
  MIME、大小、超时、相对路由和安全错误处理。
- 已完成 Models 页能力默认值区域、ASR 配置 Dialog，以及新增/编辑模型的
  ASR/TTS 能力开关；TTS 仍只保留能力标记。
- 已完成 Desktop 点击录音、停止转写、按光标插入 Composer 的链路；录音
  Blob 只留在内存，未调用 `media/save`。
- 未配置有效 ASR 时，Composer 静默隐藏语音入口；不会显示一个不可用按钮或
  引导提示。系统 Speech API fallback 仍属于后续独立阶段。
- 已补充 contracts、config-store、Host command、speech adapter、模型编辑器、
  ASR 设置和桌面辅助函数测试；仍需在真实 Tauri 桌面环境验证麦克风权限和
  各平台 MediaRecorder 编码器。
7. `pnpm typecheck` 和触及包的测试通过；`agent-host` 仍不依赖 speech。
