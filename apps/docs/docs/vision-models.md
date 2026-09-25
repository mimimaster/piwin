# 视觉模型与委托配置指引

在 **Piwin** 中，你可以通过配置**多模态视觉模型**来让智能体轻松看懂 UI 设计稿、网页截图、控制台报错弹窗以及各类系统架构图。

本文档将为你全面介绍**视觉委托机制**，并推荐当前主流的**免费与高性价比视觉模型**获取渠道与配置方法。

---

## 1. 什么是视觉委托 (Vision Delegation) {#vision-delegation}

很多强大的主力思考模型（或纯文本推理模型）直接处理高分辨率图片时，不仅耗费巨量上下文（Token），还会显著增加单次请求的费用与耗时。

**视觉委托机制**的运作流程：
1. **轻量模型看图**：当你粘贴或上传一张图片（如 UI 截图、控制台报错）时，Piwin 自动唤起轻量且极速的视觉模型对图片进行结构化特征提取、文字 OCR 与布局描述；
2. **主力模型推理**：将视觉模型的解析结论与你的 Prompt 一同交给主力模型（如 Claude 3.7 Sonnet / DeepSeek 等）进行代码编写与任务执行；
3. **优势**：
   - **响应极快**：轻量视觉模型通常在几百毫秒内完成看图；
   - **成本极低（甚至完全免费）**：无需用昂贵的主力模型处理原始图像矩阵；
   - **上下文更干净**：提炼后的结构化文本比原始图像占用更少 Token。

![视觉委托配置实景](/images/readme/vision.jpg)

---


## 2. 免费与高性价比视觉模型推荐 {#free-models}

以下整理了目前开发者最常用、支持 OpenAI 兼容格式或原生 API 的免费/低成本视觉模型服务商：

### 选项 A：Google AI Studio (Gemini 2.5/1.5 Flash) <span class="tag-badge tag-free">首选免费</span> <span class="tag-badge tag-fast">极速</span>

Google 为开发者提供了非常慷慨的免费 API 额度，Gemini Flash 系列拥有顶级的看图与 OCR 能力。

- **免费额度**：个人开发者可免费获取每分钟 15 次请求（15 RPM）、每天 1500 次调用的免费额度；
- **获取步骤**：
  1. 访问 [Google AI Studio 控制台](https://aistudio.google.com/) 并登录 Google 账号；
  2. 点击左侧导航栏的 **「Get API key」** 并生成你的 Key；
- **Piwin 配置参数**：
  - **Provider 类型**：OpenAI 兼容 / Google Gemini
  - **Base URL**：`https://generativelanguage.googleapis.com/v1beta/openai/`
  - **Model ID**：`gemini-2.5-flash` 或 `gemini-1.5-flash`
  - **API Key**：你的 Google AI Studio API Key

---

### 选项 B：硅基流动 (SiliconFlow) <span class="tag-badge tag-free">国内直连</span> <span class="tag-badge tag-fast">免翻墙</span>

国内极速且高性价比的模型托管平台，注册赠送额度，且内置开源通义千问视觉大模型。

- **免费/赠送额度**：新注册用户赠送 14~20 元免费额度（足够调用数十万次视觉轻量模型）；
- **获取步骤**：
  1. 访问 [硅基流动官网](https://siliconflow.cn/) 注册并登录；
  2. 进入「API 密钥」页面，新建并复制你的 API Key；
- **Piwin 配置参数**：
  - **Base URL**：`https://api.siliconflow.cn/v1`
  - **推荐 Model ID**：
    - `Qwen/Qwen2.5-VL-7B-Instruct`（轻量推荐，极快）
    - `Pro/Qwen/Qwen2.5-VL-72B-Instruct`（高精度 OCR 与复杂图表识别）
  - **API Key**：你的 SiliconFlow API Key

---

### 选项 C：OpenRouter 免费视觉模型 <span class="tag-badge tag-free">聚合免费</span>

OpenRouter 聚合了全球主流开源模型，并提供了带有 `:free` 标识的永久免费模型。

- **获取步骤**：
  1. 访问 [OpenRouter 官网](https://openrouter.ai/) 注册账号；
  2. 在「Keys」页面创建一个免费 API Key；
- **Piwin 配置参数**：
  - **Base URL**：`https://openrouter.ai/api/v1`
  - **推荐 Model ID**：
    - `meta-llama/llama-3.2-11b-vision-instruct:free`
    - `qwen/qwen-2-vl-72b-instruct:free`
  - **API Key**：你的 OpenRouter API Key

---

### 选项 D：Groq (Llama 3.2 Vision) <span class="tag-badge tag-fast">极致吞吐</span>

Groq 使用自研 LPU 芯片，推理速度可达每秒数百 Token。

- **获取步骤**：
  1. 访问 [Groq Console](https://console.groq.com/) 注册；
  2. 在「API Keys」页面生成 Key；
- **Piwin 配置参数**：
  - **Base URL**：`https://api.groq.com/openai/v1`
  - **推荐 Model ID**：`llama-3.2-11b-vision-preview` 或 `llama-3.2-90b-vision-preview`
  - **API Key**：你的 Groq API Key

---

### 选项 E：Ollama 本地离线部署 <span class="tag-badge tag-local">100% 离线</span> <span class="tag-badge tag-free">隐私安全</span>

如果你希望数据完全不离开本地电脑，可以使用 Ollama 运行本地视觉大模型。

- **运行步骤**：
  1. 安装并启动 [Ollama](https://ollama.com/)；
  2. 在终端运行以下命令下载并运行多模态模型：
     ```bash
     ollama run llama3.2-vision
     # 或者运行通义千问视觉版：
     # ollama run qwen2.5-vl
     ```
- **Piwin 配置参数**：
  - **Base URL**：`http://localhost:11434/v1`
  - **Model ID**：`llama3.2-vision:latest` 或 `qwen2.5-vl:latest`
  - **API Key**：可填任意占位字符串（如 `ollama`）

---

## 3. 在 Piwin 中完成配置步骤 {#step-by-step}

1. 打开 **Piwin 客户端**；
2. 点击左下角 **「设置 (Settings)」** 进入 **「模型与委托 (Models & Delegation)」**；
3. 找到 **「视觉委托模型 (Vision Delegate)」** 开关，将其打开；
4. 填入上述推荐的 **Base URL**、**API Key** 和 **Model ID**；
5. 点击 **「测试连通性」** 按钮，验证通过后点击保存即可！

```
┌─────────────────────────────────────────────────────────────┐
│ 视觉委托配置 (Vision Delegate)                             │
├─────────────────────────────────────────────────────────────┤
│ 启用状态:  [  ON  ]                                         │
│ Base URL:  https://generativelanguage.googleapis.com/...    │
│ API Key:   AIzaSy*********************                      │
│ Model:     gemini-2.5-flash                                 │
│                                                             │
│ [ 测试连通性 ]                    [ 配置指南 (直达本页) ]     │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. 常见问题与排查 {#troubleshooting}

::: details 1. 点击“测试连通性”提示 Connection Failed 或 401 Unauthorized
- 请检查 API Key 是否复制完整，首尾是否有不可见空格；
- 如果使用海外服务商（如 Google AI Studio / Groq），请确保你的本地网络环境可正常访问对应的 API 域名；
- 如果使用国内网络且不想配置网络代理，强烈推荐使用 **硅基流动 (SiliconFlow)** 方案。
:::

::: details 2. 发送截图时提示“模型不支持多模态输入”
- 请检查填写的 `Model ID` 是否具备 Vision 能力（例如必须是带 `-vision`、`-vl` 或 `gemini-` / `gpt-4o` 系列的名称）；
- 纯文本模型（如部分纯代码微调模型）无法直接解析图像矩阵，开启视觉委托后系统将自动代理图文转换。
:::

::: details 3. 支持哪些图片格式与大小？
- Piwin 支持 `PNG`、`JPEG/JPG`、`WEBP`、`GIF`（静态帧）格式；
- 建议单张图片压缩在 10MB 以内，以获得最快响应速度。
:::

---

## 5. 关联文档

- [模型与多模态委托总览](./model-config.md)
- [快速起步指南](./getting-started.md)
- [提示词工程中的视觉契约](./prompt-system.md#23-视觉多模态委托-ocr-契约-default_vision_delegation_system_prompt)
