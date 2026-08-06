# Compactor SDK

独立对话压缩 SDK，从 Devin CLI 的 `/compact` 机制中提取。
零依赖 piwin 包，可插拔推理后端。

> 协议细节已于 2026-08-05 通过 live HTTP probe 验证通过（`/tmp/devin-proxy/test-summary.mjs`）。

---

## 1. 背景

### 1.1 Devin 的 compaction 做了什么

Devin CLI 在对话过长时自动压缩历史。流程：

1. 把完整对话写到 `history_<session_id>.md`
2. 用一个 LLM completion 调用生成结构化摘要
3. 把摘要写到 `summaries/<session_id>.md`
4. 用摘要替换内存中的消息历史
5. 下一轮注入 continuation prompt

### 1.2 摘要调用不是 function-calling 会话

从二进制提取的关键字符串：

```
"You are a Summarizer that summarizes an agent's execution trace.
 You have no tools. Your text output will be saved to a file automatically."
```

`SummarizerVariant` 继承了 agent 框架但工具列表为空。模型输出文本就停了，实际效果等于一次普通 completion。没有 agent loop，没有额外线程，没有 function calling。

### 1.3 System prompt 在本地

摘要的 system prompt 硬编码在 Devin 的 Rust 代码里，不是 Windsurf 服务端或 Anthropic 提供的。SDK 同样在本地硬编码，用户可覆盖。

### 1.4 为什么做独立 SDK

- piwin 已有 Pi 原生 compaction（`SessionHandle.compact()`），但不是所有模式都可用
- 不是所有用户都有 Windsurf 账号
- 压缩逻辑（序列化 → 摘要 → 持久化）是通用的，不绑定 Pi
- SDK 可被 piwin 或任何其他 agent shell 引入，不产生耦合

---

## 2. 设计目标

1. **独立**：零依赖 `@piwin/*`
2. **两种后端可切换**：Devin 远程（Windsurf API）或直接 provider（OpenAI/Anthropic/Gemini）
3. **不用 function calling**：单次非流式 completion，无工具
4. **模型跟随主会话**：默认用主会话同一个模型做摘要，不单独配
5. **prompt 在本地**：system prompt 硬编码，用户可覆盖
6. **文件持久化**：history + summary 写到磁盘
7. **零魔法**：无隐藏状态、无后台线程、无自动触发。调用方决定何时压缩

---

## 3. 非目标

- 基于阈值的自动触发（调用方负责）
- 替换任何 agent 的内存消息（调用方负责）
- 注入 continuation prompt 到 agent 上下文（调用方负责）
- 流式输出摘要（太短，非流式更简单）
- 摘要过程中的 function calling / tool use（明确避免）

---

## 4. API

### 4.1 类型

```typescript
type CompactionMessageRole = 'user' | 'assistant' | 'system' | 'tool';

interface CompactionMessage {
  role: CompactionMessageRole;
  content: string;
  id?: string;
  toolName?: string;
  toolCallId?: string;
}

type CompactionBackend = 'devin' | 'provider';

interface DevinBackendConfig {
  /** Windsurf API key */
  apiKey: string;
  /** 默认 https://server.codeium.com */
  serverUrl?: string;
  /** 摘要模型 UID。省略则用 CompactOptions.modelUid，再省略用 'swe-1-7' */
  modelUid?: string;
  /** Metadata 里的版本号，默认 '3.2.23' */
  ideVersion?: string;
  /** Metadata 里的扩展版本号，默认 '1.48.2' */
  extensionVersion?: string;
  headers?: Record<string, string>;
}

interface ProviderBackendConfig {
  protocol: 'openai-compatible' | 'anthropic-compatible' | 'google-gemini';
  baseUrl: string;
  apiKey: string;
  modelId: string;
  headers?: Record<string, string>;
}

interface CompactionFileConfig {
  /** 默认 ./history */
  historyDir?: string;
  /** 默认 ./summaries */
  summaryDir?: string;
}

interface CompactorConfig {
  backend: CompactionBackend;
  devin?: DevinBackendConfig;
  provider?: ProviderBackendConfig;
  files?: CompactionFileConfig;
  /** 覆盖默认 summarizer system prompt */
  systemPrompt?: string;
  /** 默认 4096 */
  maxOutputTokens?: number;
  /** 默认 0.3 */
  temperature?: number;
  /** 默认 60000 */
  timeoutMs?: number;
}

interface CompactionResult {
  ok: boolean;
  error?: string;
  summary?: string;
  historyPath?: string;
  summaryPath?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  durationMs?: number;
}

interface CompactOptions {
  sessionId: string;
  messages: CompactionMessage[];
  /**
   * 摘要用的模型。默认用主会话同一个模型。
   * devin 后端：Windsurf 模型 UID（如 'swe-1-7', 'claude-sonnet-5'）
   * provider 后端：覆盖 config.provider.modelId
   */
  modelUid?: string;
  signal?: AbortSignal;
  systemPrompt?: string;
  customInstructions?: string;
}
```

### 4.2 函数

```typescript
function createCompactor(config: CompactorConfig): Compactor;

interface Compactor {
  compact(options: CompactOptions): Promise<CompactionResult>;
  readSummary(sessionId: string): Promise<string | null>;
  readHistory(sessionId: string): Promise<string | null>;
}
```

### 4.3 用法

```typescript
import { createCompactor } from '@piwin/compactor';

// --- Devin 后端 ---
const compactor = createCompactor({
  backend: 'devin',
  devin: { apiKey: process.env.WINDSURF_API_KEY! },
});

// --- OpenAI 后端 ---
const compactor = createCompactor({
  backend: 'provider',
  provider: {
    protocol: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: process.env.OPENAI_API_KEY!,
    modelId: 'gpt-4o-mini',
  },
});

// --- 压缩 ---
const result = await compactor.compact({
  sessionId: 'sess-abc',
  modelUid: 'swe-1-7',  // 主会话用的模型
  messages: [
    { role: 'user', content: 'Fix the auth bug' },
    { role: 'assistant', content: 'I found the issue in auth.ts...' },
  ],
});

if (result.ok) {
  console.log(result.summary);
  console.log('History:', result.historyPath);
  // 调用方负责替换消息 + 注入 continuation prompt
}
```

---

## 5. 完整流程

```
compact({ sessionId, messages, modelUid })
  │
  ├─ 1. 验证配置
  │     backend='devin'    → devin.apiKey 必填
  │     backend='provider' → provider.baseUrl/apiKey/modelId 必填
  │     messages 非空
  │
  ├─ 2. 序列化消息 → 纯文本
  │     "Conversation to summarize:
  │      [user] Fix the auth bug
  │      [assistant] I found the issue...
  │      [tool:read_file] { "path": "src/auth.ts" }
  │      ..."
  │     + customInstructions（如有）
  │
  ├─ 3. 写 history 文件 → {historyDir}/{sessionId}.md
  │     （即使后续模型调用失败，history 也保留）
  │
  ├─ 4. 调后端
  │     │
  │     ├─ devin 后端：
  │     │   a. GetUserJwt（API key → JWT）
  │     │   b. GetChatMessage（JWT → 流式摘要）
  │     │      → 逐帧 gunzip → 提取 field 3 (delta_text) → 拼接
  │     │
  │     └─ provider 后端：
  │         单次 HTTP POST（OpenAI/Anthropic/Gemini 格式）
  │         → 解析响应 → 提取文本
  │
  ├─ 5. 提取摘要
  │     从 <summary>...</summary> 标签提取
  │     无标签则用完整响应
  │     trim，拒绝空
  │
  ├─ 6. 写 summary 文件 → {summaryDir}/{sessionId}.md
  │
  └─ 7. 返回 { ok, summary, historyPath, summaryPath, usage, durationMs }
```

---

## 6. 默认 System Prompt

从 Devin CLI 二进制提取，硬编码在 SDK 里。可通过 `config.systemPrompt` 或 `options.systemPrompt` 覆盖。

```
You are a Summarizer that summarizes conversation history. You will be shown
a conversation between the user and the assistant, a coding agent. You should
summarize the conversation + work done for future work to be continued by the
coding agent. Structure your summary as follows:

<summary>
## Overview
A high-level summary of what was being worked on and the overall goal
(1-2 sentences).

## Key Details & Breadcrumbs
Important details that may be needed later (key findings, decisions,
constraints, error messages, progress or modified files, etc). For each
item, note:
- What it is and why it matters
- If it would be helpful to look at the original source, include citations
  to message ids or search terms to find the details in the history file

## Current State
What the agent was actively working on when this summary was created:
- The immediate task or step in progress
- Any pending actions or next steps that were planned
- Blockers or questions that need resolution
</summary>

IMPORTANT: Do NOT reproduce or recite any rules, instructions, or guidelines
that were included verbatim in the conversation (e.g., content inside <rules>
or <rule> tags). Rules will be re-discovered and re-injected as needed when
the agent accesses relevant files. Focus on summarizing the work done and
decisions made, not the instructions themselves.

Note, the full conversation will be saved to a history file. The full path
will be provided alongside the summary you create. Be concise but ensure
someone could resume work using only your summary plus the reference file.

Now summarize the conversation above as per the format given. Remember, do
NOT take any actions. Just provide the summary in <summary> tags.
```

---

## 7. Continuation Prompt（参考）

SDK 不注入这个 — 调用方负责。SDK 返回 `summary` 和 `historyPath`，调用方按需格式化：

```
You are continuing work from a previous conversation thread. Below is a
summary of the previous conversation thread:

{summary}

Full conversation history saved at {historyPath}.
```

---

## 8. 文件格式

### 8.1 History: `{historyDir}/{sessionId}.md`

```markdown
# Conversation History — {sessionId}

Saved at: {ISO timestamp}
Messages: {count}

---

[user] Fix the auth bug

[assistant] I found the issue in auth.ts...

[tool:read_file] toolCallId=tc_001
{ "path": "src/auth.ts" }

[assistant] The bug is on line 42...

---

# End of conversation history
```

### 8.2 Summary: `{summaryDir}/{sessionId}.md`

```markdown
# Summary — {sessionId}

Saved at: {ISO timestamp}
History: {absolute path to history file}
Input tokens: {n} | Output tokens: {n} | Duration: {ms}ms

---

{summary text}

---

# End of summary
```

---

## 9. Devin 后端协议

> 以下所有字段编号、必填项、响应格式均由 live HTTP probe 验证。

### 9.1 认证链路（2 步）

```
┌───────────────────────────────────────────────────┐
│ API key 来源（任选其一）：                          │
│  • ~/.local/share/devin/credentials.toml           │
│  • Windsurf state.vscdb（via MCP extract tool）    │
│  • 显式传入 config.devin.apiKey                    │
│ 格式: "devin-session-token$<JWT>" 或普通 key       │
└────────┬───────────────────────────────────────────┘
         │
         ▼
┌───────────────────────────────────────────────────┐
│ Step 1: GetUserJwt                                │
│ POST /exa.auth_pb.AuthService/GetUserJwt          │
│                                                   │
│ Request:  Metadata { api_key, ide_name, ... }     │
│ Response: { user_jwt (field 1) }                  │
└────────┬───────────────────────────────────────────┘
         │
         ▼  （跳过 AssignModel — 我们已知模型 UID）
         │
┌───────────────────────────────────────────────────┐
│ Step 2: GetChatMessage (streaming)                │
│ POST /exa.api_server_pb.ApiServerService/         │
│      GetChatMessage                               │
│                                                   │
│ Request:  Metadata { api_key, user_jwt }          │
│           prompt    = summarizer system prompt    │
│           chat_message_prompts = [conversation]   │
│           request_type  = 5 (Cascade)             │
│           cascade_id    = "<unique>"              │
│           planner_mode  = 1 (Default)             │
│           execution_id  = "<unique>"              │
│           chat_model_uid = options.modelUid       │
│                                                   │
│ Response: 流式 gzip 帧                             │
│           → 逐帧 gunzip → 提取 field 3 (delta_text)│
│           → trailer 帧 (flag 0x02) = JSON         │
└───────────────────────────────────────────────────┘
```

### 9.2 Step 1: GetUserJwt

```
POST {serverUrl}/exa.auth_pb.AuthService/GetUserJwt
Content-Type: application/proto
connect-protocol-version: 1

Request:
  Metadata metadata = 1;

  message Metadata {
    string ide_name          = 1;   // "windsurf"
    string extension_version = 2;   // "1.48.2"
    string api_key           = 3;   // windsurf_api_key
    string language          = 4;   // "en"
    string ide_version       = 7;   // "3.2.23"
    string extension_name    = 12;  // "windsurf"
  }

Response (200 OK, ~1730 bytes):
  string user_jwt = 1;   // JWT，用于 step 2
```

### 9.3 Step 2: GetChatMessage

```
POST {serverUrl}/exa.api_server_pb.ApiServerService/GetChatMessage
Content-Type: application/connect+proto
connect-protocol-version: 1

Request:
  message GetChatMessageRequest {
    Metadata metadata                          = 1;
    string prompt                               = 2;   // system prompt
    repeated ChatMessagePrompt chat_message_prompts = 3;
    int32 request_type                          = 7;   // 5 = Cascade（必填）
    string cascade_id                           = 16;  // 唯一 ID（必填）
    int32 planner_mode                          = 20;  // 1 = Default（必填）
    string chat_model_uid                       = 21;  // 模型 UID
    string execution_id                         = 22;  // 唯一 ID（必填）
  }

  message ChatMessagePrompt {
    string message_id = 1;
    int32  source     = 2;   // 1 = user
    string prompt     = 3;   // 消息文本
  }

  message Metadata {
    // ... 同 step 1，额外加：
    string user_jwt = 21;    // step 1 拿到的 JWT
  }
```

模型 UID 解析顺序：
```
options.modelUid ?? config.devin.modelUid ?? 'swe-1-7'
```

默认用主会话同一个模型。想用更便宜的模型做摘要，传 `modelUid: 'swe-1-6-fast'` 即可。Windsurf 后端一个 key 通吃 255+ 模型，不需要额外凭证。

> **必填字段警告**：缺少 `request_type`/`cascade_id`/`planner_mode`/`execution_id` 会导致 HTTP 200 但 trailer 报错：
> `{"error":{"code":"failed_precondition","message":"There was an error with your Cascade session..."}}`

### 9.4 响应帧结构

GetChatMessage 返回流式 Connect-RPC 帧：

```
每帧: [1 byte flags] [4 bytes BE length] [payload]

Flags:
  0x01 = gzip 压缩（所有数据帧都是 gzip）
  0x02 = end-of-stream（trailer 帧）
  0x03 = gzip + end-of-stream
```

数据帧 gunzip 后的 protobuf：

```
message GetChatMessageResponse {
  string message_id      = 1;   // "bot-<uuid>"
  bytes  timestamp       = 2;   // Timestamp 消息（二进制，不是文本！）
  string delta_text      = 3;   // ← 摘要文本块，逐帧拼接
  int32  delta_tokens    = 4;   // token 计数
  string delta_thinking  = 9;   // 模型思考过程
}
```

> **关键**：`delta_text` 是 field **3**，不是 field 2。field 2 是 Timestamp（二进制）。

Trailer 帧（最后一帧，flag 0x02 或 0x03）：
- body 是 JSON 文本（不是 protobuf），gunzip 后解析
- 成功：`{}`
- 失败：`{"error":{"code":"failed_precondition","message":"..."}}`

### 9.5 可选：AssignModel

如果想让服务端选模型而不是硬编码 `chat_model_uid`，可在 step 1 和 step 2 之间插入：

```
POST /exa.api_server_pb.ApiServerService/AssignModel

Request:
  Metadata metadata            = 1;
  string model_router_uid      = 2;
  string cascade_id            = 3;
  ChatMessagePrompt chat_message_prompt = 4;

Response:
  ModelAssignment assignment = 1;
    string assignment_jwt = 1;  // 替代 user_jwt
    string model_uid      = 2;  // 服务端分配的模型
```

SDK 默认跳过这步。调用方已知模型 UID，没必要多一次往返。

### 9.6 Protobuf 编码

SDK 手写 protobuf 编解码，零依赖。消息只用：
- Wire type 0 (varint) — 整数/枚举
- Wire type 2 (length-delimited) — 字符串和嵌套消息

```typescript
encVar(n)              // varint 编码
encTag(field, wireType)
encStr(field, s)       // 字符串字段
encMsg(field, buf)     // 嵌套消息
encV(field, v)         // varint 字段
```

解码：通用 protobuf 解码器，遍历 wire type 按 field number 提取。

### 9.7 Connect-RPC 封装

非流式（GetUserJwt）：
```
HTTP body = 原始 protobuf
Content-Type: application/proto
```

流式（GetChatMessage）：
```
Request body = 单帧: [0x00] [4B length] [protobuf]
Content-Type: application/connect+proto

Response body = 多帧序列:
  数据帧: flag=0x01, payload = gzip protobuf → gunzip → 提取 field 3
  trailer: flag=0x02/0x03, payload = gzip JSON → gunzip → 检查 error
```

### 9.8 验证过的响应示例

Probe 发送 6 条消息的测试对话，收到 123 帧：

```
Frame 0:     flag=0x01, gunzip → field 1="bot-832deae2-..."
Frame 2:     flag=0x01, gunzip → field 3="The"
Frame 3:     flag=0x01, gunzip → field 3=" user wants"
...
Frame 122:   flag=0x02, gunzip → JSON "{}" (成功)

拼接所有 field 3:
<summary>
## Overview
The user requested help fixing an authentication bug in login.ts...
## Key Details & Breadcrumbs
- Bug location: login.ts, line 42
- Issue: JWT verification was missing the secret key parameter
...
## Current State
The assistant completed both the bug fix...
</summary>
```

---

## 10. Provider 后端

单次 HTTP POST，按协议分格式：

### 10.1 OpenAI-compatible

```
POST {baseUrl}/chat/completions
Authorization: Bearer {apiKey}

{
  "model": "{modelId}",
  "messages": [
    { "role": "system", "content": "{systemPrompt}" },
    { "role": "user", "content": "{conversationText}" }
  ],
  "max_tokens": 4096,
  "temperature": 0.3,
  "stream": false
}

→ choices[0].message.content
```

### 10.2 Anthropic-compatible

```
POST {baseUrl}/messages
x-api-key: {apiKey}
anthropic-version: 2023-06-01

{
  "model": "{modelId}",
  "system": "{systemPrompt}",
  "messages": [{ "role": "user", "content": "{conversationText}" }],
  "max_tokens": 4096,
  "temperature": 0.3
}

→ content[].text (第一个 text block)
```

### 10.3 Google Gemini

```
POST {baseUrl}/models/{modelId}:generateContent

{
  "systemInstruction": { "parts": [{ "text": "{systemPrompt}" }] },
  "contents": [{ "role": "user", "parts": [{ "text": "{conversationText}" }] }],
  "generationConfig": { "maxOutputTokens": 4096, "temperature": 0.3 }
}

→ candidates[0].content.parts[].text
```

---

## 11. 错误处理

| 场景 | 行为 |
|------|------|
| 配置无效（缺 apiKey/baseUrl 等） | `{ ok: false, error: '...' }` |
| messages 为空 | `{ ok: false, error: 'No messages to compact' }` |
| GetUserJwt HTTP 错误 | `{ ok: false, error: 'GetUserJwt failed: {status}' }` |
| GetUserJwt 返回空 JWT | `{ ok: false, error: 'GetUserJwt returned empty JWT' }` |
| GetChatMessage HTTP 错误 | `{ ok: false, error: 'GetChatMessage failed: {status}' }` |
| GetChatMessage trailer 报错 | `{ ok: false, error: 'Backend rejected: {trailer message}' }` |
| Provider HTTP 错误 | `{ ok: false, error: 'Backend returned {status}' }` |
| 超时 | `{ ok: false, error: 'Request timed out after {ms}ms' }` |
| AbortSignal 触发 | `{ ok: false, error: 'Cancelled' }` |
| 模型返回空摘要 | `{ ok: false, error: 'Model returned empty summary' }` |
| 文件写入失败 | `{ ok: false, error: 'Failed to write {file}: {reason}' }` |
| 响应帧 gunzip 失败 | 跳过该帧，继续拼接 |

SDK **永不 throw**。所有错误返回在 `CompactionResult` 里。history 文件在模型调用之前写入，即使模型调用失败，history 仍保留供人工查看。

---

## 12. 包结构

```
packages/compactor/
  package.json
  tsconfig.json
  src/
    index.ts                    # 公开导出
    types.ts                    # 类型定义
    compactor.ts                # createCompactor() + Compactor
    serialize.ts                # messages → 对话文本
    extract.ts                  # 响应 → 摘要文本（<summary> 提取）
    persist.ts                  # history + summary 文件 I/O
    prompt.ts                   # 默认 system prompt
    continuation.ts             # continuation prompt 模板
    backends/
      devin-backend.ts          # Windsurf Connect-RPC 后端
      provider-backend.ts       # 直接 provider HTTP 后端
      devin-proto.ts            # 手写 protobuf 编解码
  src/**/*.test.ts              # 就近测试
```

### 依赖

**零运行时依赖。** 只用：
- `globalThis.fetch`（Node 18+）
- `node:fs/promises`（文件持久化）
- `node:path`（路径）
- `node:zlib`（`gunzipSync`，Devin 后端响应帧解压）
- `Buffer`（protobuf 字节操作）

---

## 13. 配置校验规则

| 规则 | 错误信息 |
|------|----------|
| `backend` 不在 `['devin', 'provider']` | `Invalid backend: must be 'devin' or 'provider'` |
| `backend='devin'` 但无 `config.devin` | `Devin backend requires config.devin` |
| `config.devin.apiKey` 为空 | `Devin backend requires apiKey` |
| `backend='provider'` 但无 `config.provider` | `Provider backend requires config.provider` |
| `config.provider.baseUrl` 为空 | `Provider backend requires baseUrl` |
| `config.provider.apiKey` 为空 | `Provider backend requires apiKey` |
| `config.provider.modelId` 为空 | `Provider backend requires modelId` |
| `options.messages` 为空 | `No messages to compact` |
| `options.sessionId` 为空 | `Session ID is required` |

---

## 14. 测试

### 14.1 单元测试

| 模块 | 测试点 |
|------|--------|
| `serialize.ts` | 空消息、混合角色、tool 消息、长对话、customInstructions |
| `extract.ts` | 有 `<summary>` 标签、无标签回退、空响应、嵌套标签 |
| `persist.ts` | 读写 history/summary、目录创建、路径穿越拒绝 |
| `devin-proto.ts` | 编码 Metadata、编码 GetUserJwtRequest、解码 GetUserJwtResponse、编码 GetChatMessageRequest（含必填字段 7/16/20/22）、解码流式帧（gunzip + field 3 提取）、trailer JSON 解析 |
| `provider-backend.ts` | OpenAI/Anthropic/Gemini 响应解析、HTTP 错误、超时 |
| `compactor.ts` | 配置校验、后端路由、mock fetch 端到端、abort、文件写入失败、trailer 错误 |

### 14.2 集成测试（可选）

- `backend='devin'`：真实 Windsurf API key（无 `WINDSURF_API_KEY` 时跳过）
  - 验证 GetUserJwt 返回非空 JWT
  - 验证 GetChatMessage 返回流式帧，field 3 有内容
  - 验证拼接文本包含 `<summary>` 标签
  - 验证 trailer 为 `{}`
- `backend='provider'`：真实 OpenAI/Anthropic key（无环境变量时跳过）

---

## 15. 未来扩展（不在 v1）

- **自动触发**：token 计数 + 阈值判断（`compactor.shouldCompact(messages)` → boolean）
- **增量压缩**：只摘要新消息，与已有摘要合并
- **自定义后端**：插件接口（如本地 Ollama）
- **流式输出**：摘要生成时流式返回（UI 反馈）
- **摘要校验**：拒绝过短/过长/缺必要 section 的摘要
- **分块摘要**：超长对话分块摘要再合并
