# piwin 文件附件支持建议

| 字段 | 内容 |
| --- | --- |
| 状态 | Implemented: P0 + P1 core |
| 日期 | 2026-08-09 |
| 范围 | P0/P1：Desktop composer、Host prompt preparation、media store、模型输入能力 |
| 相关 | `docs/prd.md`、`docs/architecture.md`、ADR 0005 |

## 1. 结论

piwin 不应把“允许上传文件”实现成一个无限制的 `<input type="file">`。
Coding agent 的附件有两种完全不同的来源：

1. 工作区内的文件：Agent 已经可以通过 Host 读取，不需要重复上传。
2. 工作区外的文件：需要保存到 `~/.piwin/media/<session>/<uuid>.*`，经过类型、安全和模型路由检查后，作为附件发送。

当前实现范围（P0 + P1）：

- PNG、JPEG、WebP 图片；
- Markdown、纯文本、日志、diff/patch；
- 常见源码和配置文件：TS/JS、Python、Go、Rust、Java、C/C++、C#、Swift、Shell、SQL、JSON、YAML、TOML、XML、CSV/TSV、HTML、CSS；
- PDF 文本提取附件；
- GIF 只保证 Desktop 预览，发给模型前默认转成首帧 PNG，不承诺动画理解。

明确暂不支持：DOCX/XLSX、压缩包、音视频和任意二进制文件。

## 2. 产品语义

### 2.1 工作区文件和外部附件分开

| 用户动作 | 语义 | 是否复制文件 |
| --- | --- | --- |
| 从工作区树拖入 `src/app.ts` | `WorkspaceFileRef`，请求 Agent 读取当前工作区文件 | 否 |
| 从 Finder 拖入 `requirements.pdf` | 外部附件 | 是，保存到 media root |
| 粘贴截图 | 图片附件 | 是，保存到 media root |
| 拖入 GIF | 本地媒体附件；模型路由时转换或拒绝 | 是 |

工作区文件不要继续把绝对路径直接拼进 composer 文本。应使用结构化 context ref 或文件附件 chip；Host 在 prompt preparation 阶段解析并校验路径。

### 2.2 附件状态

每个 chip 至少有以下状态：

- `saving`：正在写入 Host；
- `inspecting`：正在识别 MIME、编码、尺寸或提取文本；
- `ready`：可以发送；
- `warning`：可以发送，但需要用户确认，例如检测到潜在密钥或 GIF 将被转换；
- `error`：类型、大小、路径或提取失败。

发送前必须完成 preflight。不能因为上传还没结束就把一个不存在的路径交给模型，也不能静默把用户文件转换成另一种语义。

## 3. 文件类型策略

### 3.1 推荐矩阵

| 类别 | 默认类型 | UI | 模型路由 | 优先级 |
| --- | --- | --- | --- | --- |
| 静态图片 | PNG、JPEG/JPG、WebP | 缩略图、放大预览 | 模型支持时走原生图片输入 | P0 |
| GIF | GIF | 动图预览 | 默认抽首帧为 PNG；动画分析另走视频/抽帧能力 | P0 UI / P2 模型 |
| SVG | SVG | 默认源码卡片；安全预览可后置 | 作为文本/源码，不直接当原生图片 | P1 |
| 纯文本 | TXT、MD、LOG、DIFF、PATCH | 文件卡片、首行摘要 | 解码后作为有界文本上下文 | P0 |
| 源码 | TS/JS/Python/Go/Rust/Java/C/C++/C#/Swift/Shell/SQL 等 | 文件卡片、语言标签 | 作为有界文本上下文 | P0 |
| 配置/数据 | JSON、YAML、TOML、XML、CSV、TSV、HTML、CSS | 文件卡片 | 保留原始文本格式后注入 | P0 |
| 文档 | PDF | 文件卡片、页数/文本预览 | 文本提取；页图可作为图片附件 | P1 |
| Office | DOCX、XLSX、PPTX | 暂不承诺 | 需要专用解析器和安全检查 | P2 |
| 压缩包 | ZIP、TAR、GZ | 仅导入/检查流程 | 不直接进入 prompt | P2 |
| 音频 | MP3、WAV、M4A | 独立转写流程 | 走 speech/transcribe，不走普通附件 | P2 |
| 视频 | MP4、WebM、MOV | 独立视频预览 | 走视频模型或抽帧，不走普通图片输入 | P2 |
| 可执行/原生二进制 | EXE、DMG、APP、DLL、SO、OBJ 等 | 拒绝 | 禁止 | P0 |

### 3.2 GIF 的明确规则

GIF 需要拆成两个能力：

1. `previewAnimatedImage`：Desktop/WebKit 是否能显示动画；
2. `modelAnimatedImage`：当前模型是否能理解多帧动画。

两者不能复用一个 `supportsImage` 布尔值。

当前官方协议并不一致：OpenAI 图像输入文档和 Anthropic 视觉文档列出 GIF；Gemini 当前图像理解文档列出的常规图片格式不包含 GIF。因此，piwin 不能只根据 MIME 类型把 GIF 原样发给所有模型。

模型输入的默认策略：

- 静态图片：保留原格式，按模型能力发送；
- GIF：读取首帧并生成派生 PNG，模型收到的是 PNG；
- 用户明确要求“分析动画”：抽取有限数量的关键帧，并在文本中标注时间顺序；
- 需要完整视频语义时：进入独立 video attachment 路由，不伪装成 image attachment。

这样 GIF 在 UI 里仍然有价值，但不会让 Gemini 或不支持动画的模型随机报错。

## 4. 合同和模型能力

当前 `MediaAttachmentRef` 主要描述媒体路径、MIME、大小和尺寸；`PromptAttachment` 也主要围绕媒体和 web-element。通用文件支持应先扩展 `@piwin/contracts`，不能让 Desktop 自己定义一套文件对象。

建议引入稳定的通用附件合同：

```ts
type AttachmentKind = 'image' | 'text' | 'document' | 'archive';

type AttachmentRef = {
  id: string;
  kind: AttachmentKind;
  name: string;
  path: string;
  mimeType: string;
  byteSize: number;
  source: 'paste' | 'drop' | 'file-picker' | 'generated' | 'workspace';
  derivedFromId?: string;
  textEncoding?: string;
  pageCount?: number;
};
```

现有的 `MediaAttachmentRef` 可以先作为兼容别名或保留给生成媒体；不要让图片字段（如 `width`、`height`）成为所有文件的必需概念。

模型配置当前只有粗粒度的 `text | image` 输入模态。建议在 contracts 中补充由 Host 使用的输入 profile：

```ts
type ModelInputProfile = {
  text: boolean;
  imageFormats: string[];
  animatedImages: boolean;
  nativeFiles: boolean;
  maxImagesPerTurn?: number;
  maxFileBytes?: number;
};
```

未知能力必须按最保守规则处理：允许文本，静态 PNG/JPEG/WebP 需要显式 `image` 能力；不假定 GIF、PDF 或原生文件能力。

## 5. Prompt 路由

统一由 `@piwin/host-runtime` 的 PromptPreparation 决策，`@piwin/agent-host` 只负责把已经准备好的原生图片输入交给 Pi。

```text
Desktop file
  → Host media upload
  → type / magic bytes / secret / size inspection
  → AttachmentRef
  → PromptPreparation
       ├─ PNG/JPEG/WebP + vision      → native ImageContent
       ├─ GIF                         → first-frame PNG → native ImageContent
       ├─ text/code/config            → bounded extracted text
       ├─ PDF                         → extracted text (+ optional page images)
       ├─ text-only model + image     → delegation or explicit fallback
       └─ unsupported / unsafe        → user-visible error
```

关键约束：

- 图片继续走原生 `ImageContent`，不能把 base64 塞进文本 prompt；
- 文本附件只注入提取后的有界文本，不把未经检查的任意路径交给模型；
- 大文件不能因为“已经上传”就自动全部展开进上下文；后续应提供 Host-owned attachment read/search 能力；
- SDK 和 RPC 必须共享同一份 PromptPreparation 结果，不能各自判断 MIME。

## 6. 存储、上传和安全

### 6.1 存储

继续使用：

```text
~/.piwin/media/<session-id>/<uuid>.<ext>
```

文件名由 Host 生成，不能使用用户提供的路径直接写盘。附件引用保存在 transcript 中；session fork/clone 只复制引用或按内容 hash 去重，不要无条件复制大文件。

### 6.2 校验顺序

1. 客户端扩展名和 MIME 只作为提示，不作为信任依据；
2. Host 读取 magic bytes 并规范化 MIME；
3. 校验文件大小、总上传量和解码后大小；
4. 校验真实路径仍在 media root；
5. 文本按 UTF-8 优先解码，无法解码则转为二进制拒绝或要求用户确认；
6. 对 PDF、Office 和压缩包使用独立解析器，不让解析器直接执行内容；
7. 记录安全结论，不记录文件内容和密钥。

### 6.3 敏感文件

以下文件默认拒绝或必须明确确认：

- `.env`、`.npmrc`、`.pypirc`、`credentials.json`、`kubeconfig`；
- SSH 私钥、PEM/KEY/P12/PFX、云厂商凭据；
- 内容包含私钥头、API key、access token、数据库密码的普通文本文件。

`.env.example` 可以允许，但仍需内容扫描。用户要诊断敏感配置时，应提供“脱敏后附加”而不是默认把原文件发送给模型。

### 6.4 建议默认额度

这些是产品建议，不是当前配置事实：

- 图片原始文件：每个 10 MB；沿用现有图片缩放策略；
- 文本/源码：每个 5 MB，注入模型的文本默认限制在 200k 字符；
- PDF：每个 20 MB；
- 单轮所有外部附件：50 MB；
- 解压或解析后的展开大小：不超过原文件大小的 10 倍，并有条目数上限。

额度应进入 `~/.piwin/config.json`，而不是散落在 Desktop 常量里。

## 7. Desktop 交互

Composer 的加号菜单建议拆成：

- 添加图片；
- 添加文件；
- 添加工作区文件；
- 粘贴截图。

附件 chip 显示：文件图标、文件名、大小、解析状态、移除按钮。不同类型使用不同预览：

- 图片：缩略图；GIF 显示动画，但 chip 标明“发送时转首帧”；
- 代码/文本：语言标签和前几行摘要；
- PDF：页数、文件大小和提取状态；
- 不支持类型：明确显示原因和可选操作，不显示一个永远转圈的 chip。

模型不支持附件时，Send 前显示具体提示，例如：

```text
当前模型不接受 GIF。发送时将使用 GIF 首帧 PNG。
[发送首帧] [取消]
```

不要在用户不知情的情况下把 GIF、PDF 或文本文件静默转换成一段完全不同的 prompt。

## 8. Host Server / 远程客户端

当前本地 `media/save` 用 base64 立即跨桌面到 Host 保存，适合本地 sidecar。远程 Host 不能依赖本地绝对路径，也不应把几十 MB 文件塞进一个普通 command。

在开启 `mediaUpload` 能力前，协议应增加可取消、可限速的上传生命周期：

```text
media/upload-start  → uploadId + limits
media/upload-chunk  → sequence + bytes
media/upload-finish → AttachmentRef
media/upload-abort  → cleanup
```

Host 仍然是最终写入者、路径校验者和附件权限的唯一权威。Gateway 只转发 transport，不解析文件、不持有 provider secret。

## 9. 分阶段落地

### P0：可用的 coding-agent 附件

- contracts 增加通用文本/文件附件引用；
- media 增加 MIME/扩展名/magic-bytes 分类器；
- Desktop 增加“添加文件”和文本/code chip；
- Host 对小型文本、源码、配置、diff 做有界提取；
- 图片默认 PNG/JPEG/WebP；
- GIF 只预览，发送前转首帧 PNG；
- 增加 secret、大小、路径和路由测试。

### P1：文档和模型能力（当前范围）

- PDF 文本提取和页图引用；
- `ModelInputProfile` 和 provider/model capability UI；
- 视觉模型不支持的图片格式自动转换并显示确认；
- 大文本附件的 Host-owned read/search；
- transcript、fork、clone、cleanup 的附件生命周期。

### P2：明确延期，不进入当前实现

- DOCX/XLSX/PPTX 提取；
- ZIP/TAR 安全导入和目录浏览；
- 音频转写；
- 视频/动画抽帧或视频模型输入；
- 远程 Host 的分块上传和断点恢复。

## 10. 验收标准

- 工作区文件拖入不会复制文件，也不会把未经结构化处理的绝对路径拼进用户文本；
- PNG/JPEG/WebP 在 vision 模型上走原生图片输入；
- GIF 在 UI 中可预览，但模型收到的是明确的首帧 PNG 或用户选择的抽帧结果；
- 不支持 GIF 的模型不会收到 `image/gif`；
- 文本附件不会超过设定的字符/Token 上限；
- `.env`、私钥、凭据文件默认被拦截；
- ZIP 炸弹、路径穿越、伪造 MIME、超大文件都有测试；
- SDK、RPC、本地 Host 和远程 Host 使用相同的附件合同与路由结论；
- transcript 恢复后仍能显示附件，session 删除后能按策略清理附件；
- `pnpm typecheck`、相关包测试和 Desktop 手动上传/发送 smoke 全部通过。

## 最终建议

现在不要把 GIF 从文件选择器里简单删掉，也不要把它宣传成“所有模型都支持”。正确定位是：

> GIF 是 Desktop 可预览媒体；默认以首帧 PNG 作为模型附件；动画理解属于后续视频/抽帧能力。

第一优先级应是“代码/文本文件 + 静态图片 + 工作区文件引用”，而不是 DOCX、压缩包或音视频。这样最符合 coding agent 的主路径，也能复用现有的 `contracts → media → host-runtime → agent-host` 边界。

## 11. 本次落地内容

本次已实现 P0/P1 核心链路：

- `@piwin/contracts` 增加统一 MIME/扩展名/magic-byte 分类、`name` 与 `contentKind` 字段；
- Desktop 加号菜单、粘贴、拖拽、文件选择器支持代码/文本/配置/PDF/静态图片；
- GIF 在 Desktop 保留本地动图预览，发送时转首帧 PNG；无法转换时显示错误，不把 GIF 静默发给模型；
- Host media store 做大小、路径、敏感凭据文件与文本密钥扫描；
- Host PromptPreparation 将文本/源码/配置/PDF抽取为有界文本，将图片按原有 vision/delegation 链路处理；
- 工作区文件树拖拽使用受 Host 校验的 `contextRefs`，不再把绝对路径拼入用户文本；
- 远程 media/save 允许同一 P0/P1 MIME 集合，并继续只投影 Host 无关的媒体元数据。

仍按 P2 延后：Office、压缩包、音视频、远程分块上传；大文本的 Host-owned read/search 和更细粒度的模型格式 profile 也保留为后续增量，不在本次普通附件链路中伪装实现。
