# Devin `code_search` / Fast Context — 仅 Devin 本机证据核验

> **证据规则**：本文件只采用 Devin CLI 本机数据。  
> **主源**：`~/.local/share/devin/cli/sessions.db`（`message_nodes` + `tool_call_state`）  
> **辅源**：`~/.local/share/devin/cli/_versions/3000.2.17/bin/devin` strings（仅作命名交叉）  
> **明确排除**：`~/Developer/fast-context-mcp` 及任何 fork 推断，不得作为本文件「已验证」依据。  
> 原始抽样：`docs/research/devin-code-search-evidence/`

CLI 版本（transcript）：**3000.2.17**

---

## 1. 命名（已验证）

| 层 | 值 | 证据 |
|----|-----|------|
| 模型可见 tool name | **`code_search`** | `message_nodes` assistant `tool_calls[].name`（458 次调用同源） |
| 内部 / ACP inference 名 | **`find_code_context`** | `tool_call_state._meta["cognition.ai/inferenceToolName"]` = `find_code_context`（458/458） |
| 遥测 operation | `code_search` | tool result `metadata.telemetry.operation` |
| UI title | `Searched for {search_term 截断}` | `tool_call_state.tool_call_json.title` |
| UI kind | `search` | `tool_call_json.kind` / `chisel/tool_result_meta.kind` |
| 扩展块名 | `chisel/fast_context` / `cognition.ai/fastContext` | message + tool_call_update `_meta` |
| 能力 flag（二进制） | `cognition.ai/fastContext` | CLI strings |
| 实现路径（二进制） | `toolbox/src/tools/fast_context.rs` | CLI strings |
| 输入类型（二进制） | `FindCodeContextInput` / `struct FindCodeContextInput with 2 elements` | CLI strings |

**结论**：对人叫 Fast Context；对模型注册名是 `code_search`；运行时 inference 名是 `find_code_context`。

---

## 2. 主 agent 调用契约（已验证 · 458 次）

### 2.1 参数（有且仅有 2 个）

```json
{
  "name": "code_search",
  "arguments": {
    "search_term": "Find all TSX files containing .mcp-toggle class usage under desktop/src",
    "search_folder_absolute_uri": "/Volumes/BigDisk/Projects/Projects/piwin/apps/desktop/src"
  }
}
```

样本：`devin-code-search-evidence/01-assistant-tool-call.json`

| 字段 | 出现次数 | 含义（行为） |
|------|----------|--------------|
| `search_term` | 458/458 | 自然语言问题陈述；可很长、可含任务指令 |
| `search_folder_absolute_uri` | 458/458 | **绝对路径**（尽管字段名含 uri）；可为 monorepo 子目录 |

`rawInput` 键集合统计：**只有**这两个键（对 code_search 调用）。

二进制校验文案：

- `search_term cannot be empty`
- `search_folder_absolute_uri cannot be empty; pass the absolute path of the folder to search in`

### 2.2 与其它工具的并行（已验证 · 修正先前误解）

| 模式 | 样本数（抽样 assistant 含 code_search） |
|------|----------------------------------------|
| 仅 `code_search` | 见 `05-parallel-behavior.json` |
| `code_search` + `read` / `find_file_by_name` 等同轮 | **真实存在** |

tool description 有 `IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL`（二进制 strings）。  
**实测**：模型会把 `code_search` 与其它工具放在同一 `tool_calls` 数组。  
**解释（推断，标为未严格证明）**：禁的是「多个 code_search 互并行」，不是「不能和 read 批在一起」。实现时建议：拒绝并发的第二个 `code_search`，允许与只读工具同轮。

---

## 3. 结构化结果元数据（已验证 · tool_call_state）

完成更新里 `_meta["cognition.ai/fastContext"]`（JSON 字符串）形状：

```json
{
  "searchTerm": "<echo search_term>",
  "workspaceDirectoryPath": "<echo 绝对根，通常=search_folder_absolute_uri>",
  "status": "done",
  "steps": [],
  "results": [
    {
      "path": "/absolute/path/to/file.ts",
      "ranges": [{ "start": 95, "end": 130 }]
    }
  ],
  "durationSeconds": 3.355
}
```

| 字段 | 验证结论 |
|------|----------|
| `status` | `done` 457 次（失败/取消另计） |
| `results[].path` | **绝对路径** |
| `results[].ranges[].start/end` | 1-based inclusive 行号（与 snippet 行号一致） |
| `steps` | **最终 update 中 0/457 非空**（过程 step 可能只在流式 UI，未落最终态） |
| `durationSeconds` | min 0.32 · p50 **5.26** · avg 5.10 · max 13.94（n=457） |
| 每结果文件数 | min 0 · p50 **5** · avg 5.38 · max **17**（n=457） |
| range 宽度（end-start+1） | min 1 · p50 **71** · avg 115.5 · max **3000**（n=2633） |

聚合：`devin-code-search-evidence/03-aggregate-stats.json`

---

## 4. 回给主模型的 tool content（已验证 · message_nodes）

### 4.1 固定 framing（原文）

```text
A search subagent explored the codebase, running these commands:
- Grepped <pattern> in <path>
- Read <path>
- Analysed <path>
…

It believes the snippets below are relevant to your search. Be careful evaluating their relevance — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed:

<file path="<relative-to-search-root>" total_lines=N>
 95|code line
 96|code line
…
</file>
```

完整样本：`devin-code-search-evidence/02-tool-result-message.json`

### 4.2 命令摘要标签（已验证）

在 tool content 中，以 `- Label ` 开头的搜索步骤标签：

| Label | 出现（全库匹配 framing 的 tool msg） |
|-------|--------------------------------------|
| `Grepped` | 主导 |
| `Read` | 次之 |
| `Analysed` | 少量 |

（见 `04-result-framing-stats.json`）

### 4.3 Snippet 格式（已验证）

- **始终带代码**（至少在已抽的成功 tool content 中；不是只回 path 列表）
- `<file path="...">` 的 path：**相对 `search_folder_absolute_uri`**（统计 rel 96 / abs 0）
- 行格式：`{空白填充行号}|{原文}`（行号右对齐）
- `total_lines` = 文件总行数
- 多 range 时同一 file 标签内可多段行号块（或按 range 拆多个 file 块——以实现样本为准：常按连续展示）

### 4.4 内容体量

tool `content` 字符数约在 **6k–12k** 量级（抽样），含多文件 snippet。

### 4.5 message metadata extensions（已验证）

```text
extensions.chisel/tool_call_timing: { started_at, finished_at, duration_ms }
extensions.chisel/fast_context: { 与 §3 同构；path 为绝对路径 }
extensions.chisel/tool_result_meta: { success, kind: "search" }
telemetry: { source: "tool_result", operation: "code_search" }
```

---

## 5. 二进制交叉（CLI 3000.2.17 strings，非 fork）

以下在 Devin 二进制中存在，与 DB 行为一致：

| 字符串 | 用途 |
|--------|------|
| `A search subagent the user refers to as 'Fast Context'... IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.` + 紧邻 `code_search` | 主模型 tool description + 注册名 |
| `Search problem statement that this subagent is supposed to research for.` + `search_term` | 参数描述 |
| `The absolute path of the folder where the search should be performed...` + `search_folder_absolute_uri` | 参数描述 |
| `You are an expert software engineer, responsible for providing context to another engineer...` | 子代理 system prompt |
| `restricted_exec` + `rg`/`readfile`/`tree`/`ls`/`glob` + `answer` | 子代理工具 |
| `<ANSWER>` / `<file path=` / `<range>` | 子代理最终答案协议 |
| `Problem Statement:` | 子代理 user 前缀 |
| `You have no turns left. Now you MUST provide your final ANSWER...` | 末轮强制 |
| `Fast-context search did not find relevant code. Verify with your normal grep/glob/read tools.` | 空结果文案 |
| `Note: fast-context results are best-effort; verify with your normal search tools.` | 注记 |
| `If you need to explore the codebase... use the  tool first instead of running search commands.` | 主 agent prefer-first（tool 名在二进制里为空位/拼接） |
| `disable_fast_context` | 组织开关 |
| `swe-1-6-fast` / `SWE 1.6 Fast` | 相关快模型 id（主会话样本里 generation_model 亦见 `swe-1-6`） |

**子代理 loop 的具体 maxTurns / maxCommands 数值**：二进制为 `at most %d turns/commands` 格式化串，**本核验未从 DB 读出具体数字** → 实现默认可暂用 3 turns / 6 commands，但须标为**未在会话中实证的默认值**。

**`steps` 流式内容**：最终态恒为空；过程 UI 是否填充 **未在 DB 最终行验证**。

---

### 5.1 子代理 system prompt 的逐段归属（2026-09-19 补测）

对 Devin CLI 3000.2.17 **二进制直接 grep -a**（不经 strings 抽取）逐段核验：

| 段落 / 句子 | 二进制 | 归属 |
|-------------|--------|------|
| `# IMPORTANT:` `# ENVIRONMENT` `# THINKING RULES` `# FAST-SEARCH DEFAULTS (optimize rg/tree on large repos)` `# SOME EXAMPLES OF WORKFLOWS` `# TOOL USE GUIDELINES` `# ANSWER FORMAT (strict format, including tags)` | 命中 | **Devin** |
| `Think step-by-step` / `ANCHOR` / `TRACE` / `VERIFY` | 命中 | **Devin** |
| `You must use a SINGLE restricted_exec call` / `Example restricted_exec usage` / `[TOOL_CALLS]` / `[ARGS]` | 命中 | **Devin** |
| `DO NOT EVER USE MORE THAN` / `You have at most %d turns` / `at most %d commands in a single turn` / `Each command result may be truncated` | 命中 | **Devin** |
| `You will output an XML structure` / `The line ranges must be inclusive` / `Problem Statement:` / `Find all code in the repository relevant to this` / `You have no turns left` | 命中 | **Devin** |
| `- IMPORTANT: If you need to explore the codebase to gather context … use the  tool first instead of running search commands.` | 命中（tool 名位置为空） | **Devin（主 agent prefer-first）** |
| `# NO RESULTS POLICY` / `An empty answer is always better than a misleading one` / `Do NOT return irrelevant files` | 未命中 | **fork 措辞** |
| `# RESULT COUNT` / `Aim to return at most` / `Focus on the most relevant files first` / `If fewer files are relevant, return fewer` | 未命中 | **fork 措辞** |
| `Do not search for the same pattern multiple times …` / `One well-targeted search is better …` / `PRIORITIZE READING over searching` | 未命中 | **fork 措辞** |
| repo-map 包装（`Repo Map`、`tree -L`、```text 围栏） | 未命中 | **未验证**（Devin 的包装文案未知） |

**行为侧证据仍在**：458 次调用中 `files_per_result.min = 0`，说明空答案确实会发生；二进制也含空结果句 `Fast-context search did not find relevant code. Verify with your normal grep/glob/read tools.`。因此 `# NO RESULTS POLICY` / `# RESULT COUNT` 的**行为**保留，**措辞**标注为 fork 来源。

命令槽位数：二进制可见 `command1`…`command7`，无 `command8`；fork 默认 8。piwin 按 8 生成（依 WREN 决定取 fork 值）。

## 6. 实现必抄清单（仅已验证项）

1. Tool name：`code_search`  
2. Args：`search_term` + `search_folder_absolute_uri`（绝对 path）  
3. 内部可保留 alias `find_code_context`  
4. 成功 content framing：§4.1 原文 + `Grepped`/`Read`/`Analysed` 步骤列表  
5. Snippet：相对 path 的 `<file total_lines>` + `LINE|TEXT`；默认**开**  
6. 结构化 meta：`results[{path: abs, ranges[{start,end}]}]` + `durationSeconds`  
7. 规模预期：~5 文件 / 次，range 中位 ~70 行，耗时中位 ~5s（本机观测）  
8. 空结果文案用二进制字符串  
9. prefer-first 写进主 agent system guidance  
10. 同轮可与其它只读工具并存；不要并行两个 `code_search`

---

## 7. 本核验明确未证明（禁止当 Devin 事实写进必抄）

| 项 | 状态 |
|----|------|
| fork 的 bootstrap hotspot / 无结果自动换根重试 / grep keyword 扩展 | **未在 Devin DB 验证** |
| Windsurf Connect-RPC 帧格式细节 | 未从 Devin 二进制完整还原（仅知云端存在） |
| 精确 maxTurns/maxCommands/50 行截断 | 二进制有文案与 `%d`，数值未从会话实证 |
| `steps[]` 运行中 schema | 最终态恒 `[]` |
| 「绝对禁止与任何工具并行」 | **与实测矛盾** |

---

## 8. 证据索引

| 文件 | 内容 |
|------|------|
| `devin-code-search-evidence/01-assistant-tool-call.json` | 真实 `code_search` 调用 |
| `devin-code-search-evidence/02-tool-result-message.json` | 真实 tool content + extensions |
| `devin-code-search-evidence/03-aggregate-stats.json` | 458 次聚合 |
| `devin-code-search-evidence/04-result-framing-stats.json` | 标签与 path 相对性 |
| `devin-code-search-evidence/05-parallel-behavior.json` | 并行行为 |
| 源 DB | `~/.local/share/devin/cli/sessions.db` |
| 源二进制 | `~/.local/share/devin/cli/_versions/3000.2.17/bin/devin` |

---

## 9. 一句话

**Devin 本机 458 次调用证明：`code_search(search_term, search_folder_absolute_uri)` → 约 5s 后回「命令清单 + 相对路径 snippet」，meta 里是绝对路径 + line ranges；内部名 `find_code_context`。以上足够指导 piwin 内置实现；fork 仅可作 windsurf 后端实现参考，不得覆盖本文件的产品契约。**

---

## 10. 已定决策（2026-09-19 · WREN）

| # | 决策 |
|---|------|
| 1 | **默认后端 = `model`**（piwin 已配置模型）。`windsurf` 云端为 opt-in，用户自填 token |
| 2 | 数值默认取 **本地 fork 参考值**（Devin 二进制只有 `%d` 占位）：`maxTurns 3` / `maxCommands 8` / `maxResults 10` / `treeDepth 3` / `resultMaxLines 50` / `lineMaxChars 250` |
| 3 | MCP `fast-context` **不动**，不在本变更范围内 |
| 4 | `code_search` = 与 `grep`/`read`/`bash` **同级 Host 工具**；配置进 `PiwinConfig.codeSearch`，设置走 Settings 一节 |

补充实证（本仓库自有，非 fork）：

- Devin 云端协议已有 **live-probe 验证的 piwin 自有文档**：`docs/specs/compactor-sdk.md` §9（GetUserJwt → GetChatMessage、protobuf 字段号、Connect-RPC、响应帧、已验证示例）。`windsurf` 后端应以该文档为准；fork 只用于「function-calling 如何在 `GetChatMessage` 上表达」这一层。
- `visionDelegation`（`PiwinConfig.visionDelegation` = `{ enabled, model?: ModelRef, … }`）是 **Host 侧二次模型调用**的现成先例，`codeSearch.model` 照它写。
- 现有 `completeStructuredText` / `buildCompletionBody` 是**单发**（无 `tools`），`model` 后端的多轮 tool-calling 需要新协议构造器。
