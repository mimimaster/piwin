# Devin Fast Context → piwin `code_search` 逆向规格

> **核验状态（2026-09-19）**：产品契约以 **仅 Devin 本机证据** 为准，见  
> [`2026-09-19-devin-code-search-verified.md`](./2026-09-19-devin-code-search-verified.md)  
> 与 [`devin-code-search-evidence/`](./devin-code-search-evidence/)。  
> 下文中标注 fork / 可选增强的内容**不是** Devin 必抄项。

> Status: research complete (2026-09-19), dual-backend settings (2026-09-19)  
> Goal: 实现 piwin **内置** `code_search` 时，尽量照抄 Devin 的工具面、子代理 prompt、本地 executor、答案协议与结果 framing。  
> 子代理推理后端 **可配**：piwin 已配置模型，或用户自备 Windsurf/Devin token（与现有 fast-context MCP 同一条云端协议）。

## 0. 证据源

| 源 | 路径 / 说明 |
|----|-------------|
| Devin CLI 3000.2.17 | `~/.local/share/devin/cli/_versions/3000.2.17/bin/devin`（Rust/chisel，`toolbox/src/tools/fast_context.rs`） |
| Devin.app | `/Applications/Devin.app`，extension `name=windsurf` / `displayName=Devin` |
| 真实会话结果 | `~/.local/share/devin/cli/summaries/history_*.md` |
| 协议级 fork | `~/Developer/fast-context-mcp`（与二进制 system prompt / tools schema 同源） |
| 本目录附件 | `devin-fast-context-system-prompt.txt`、`devin-fast-context-restricted-exec-tools.json`、`devin-fast-context-native-result-sample.txt` |

## 1. 产品定位（照抄）

Fast Context **不是** embedding 检索，也不是主 agent 的唯一 grep。

它是主 agent 的 **一等只读工具**：内部再跑一个短命搜索子代理（小/快模型 + 本地 `rg/readfile/tree`），把「自然语言问题 → 相关文件 + 行号范围（+ snippet）」交回主上下文。

| 角色 | 职责 |
|------|------|
| 主 agent | 调用 `code_search`；之后用自己的 `grep`/`read` 核实与精读 |
| Fast Context 子代理 | 只规划与搜索；最终只产出 path + inclusive ranges |
| 本地 executor | 执行受限命令；路径沙箱在虚拟根 `/codebase` |

主 agent **仍然保留** 原生 grep/read/glob；Fast Context 只抢「未点名文件/符号时的第一枪探索」。

## 2. 主 agent 工具面（照抄）

### 2.1 命名

| 层 | Devin | piwin 建议 |
|----|-------|------------|
| 用户/能力名 | Fast Context | Code Search / Fast Context（UI 文案可双语） |
| **模型可见 tool name** | **`code_search`** | **`code_search`**（短名，必抄） |
| 内部类型 | `FindCodeContextInput` | `CodeSearchInput` |
| 实现 | `toolbox/src/tools/fast_context.rs` | `host-runtime` 工具模块 |
| ACP/capability | `cognition.ai/fastContext` | 可选 session capability flag |
| 组织开关 | `disable_fast_context` | `codeSearch.enabled` |

### 2.2 参数（严格 2 个 — 必抄）

Devin 二进制：`struct FindCodeContextInput with 2 elements`

| 字段 | Devin | piwin | 描述（原文） |
|------|-------|-------|--------------|
| 查询 | `search_term` | `query` 或照抄 `search_term` | *Search problem statement that this subagent is supposed to research for.* |
| 根目录 | `search_folder_absolute_uri` | `project_path` 或照抄 | *The absolute path of the folder where the search should be performed. In multi-repo workspaces, you have to specify a subfolder… first list the subfolders and only then call this tool…* |

校验（照抄语义）：

- `search_term` / `query` **不能为空**
- 路径 **不能为空**；必须是 **绝对路径**（名字带 uri，实际是 path）
- **禁止** `file://` / `vscode://` / `https://`（Devin 其它工具文案：*Use absolute paths. Do not use URIs like file://…*）
- multi-root：禁止直接丢 home；先 list 再进子目录

调参（turns/depth/excludes/snippets）**不对主模型暴露**；走 Host settings / env。

### 2.3 Tool description（主模型 — 必抄）

Devin 原文（与 fork 几乎一字不差；fork 仅多了 English prefer 与 “when exploring” 条件）：

```text
A search subagent the user refers to as 'Fast Context' that is ideal for exploring the codebase based on a request. This tool invokes a subagent that runs parallel grep and readfile calls over multiple turns to locate line ranges and files which might be relevant to the request. The search term should be a targeted natural language query based on what you are trying to accomplish, like 'Find where authentication requests are handled in the Express routes' or 'Modify the agentic rollout to use the new tokenizer and chat template' or 'Fix the bug where the user gets redirected from the /feed page'.  Fill out extra details that you as a smart model can infer in the question if necessary. You should always use this tool to start your search. Note: The files and line ranges returned by this tool may be some of the ones needed to complete the user's request, but you should be careful in evaluating the relevance of the results, since the subagent might make mistakes. You should consider using classical search tools afterwards to locate the rest if necessary. IMPORTANT: YOU CANNOT CALL THIS TOOL IN PARALLEL.
```

piwin 建议微调（仍保持 prefer-first）：

- 把 *always use this tool to start your search* 收成 *when the task requires exploring the codebase and does not already name a single file or function*（fork 已这么做，更不易误触发）
- 末尾 classical tools 写成 `(grep/glob/read)`，与 piwin 工具名对齐

### 2.4 主 agent system guidance（必抄）

Devin 系统提示中的硬策略：

```text
IMPORTANT: If you need to explore the codebase to gather context, and the task does not involve a single file or function which is provided by name, you should use the [code_search] tool first instead of running search commands.
```

并行策略注意：

- 主 agent **鼓励** 多个 read/grep 并行
- **`code_search` 自身禁止并行多次调用**（写在 tool description 里）

没有这句 system 级 prefer-first，光有 MCP/tool description，调用率会掉（当前 piwin MCP 冷落的主因之一）。

## 3. 子代理循环（照抄协议，换推理后端）

### 3.1 总流程

```
code_search(query, absRoot)
  → 映射 absRoot 为虚拟 /codebase
  → 构建 repo map（tree，可带 hotspot 优化）
  → messages = [system, user(Problem Statement + Repo Map)]
  → for turn in 1..(maxTurns+1):
        子模型 + tools(restricted_exec | answer)
        if answer → parse XML → 读 snippet → format 给主 agent
        if restricted_exec → 本地并行执行 command1..N → 结果回灌
        末轮前注入 force-answer
  → 空结果 / 错误 framing
```

### 3.2 默认旋钮（Devin / fork）

| 旋钮 | Devin 二进制 | fork 默认 | piwin 建议默认 |
|------|--------------|-----------|----------------|
| `maxTurns` | prompt 内 `%d` | 3 | 3 |
| `maxCommands` / 轮 | schema 固定 command1..**6**；prompt `%d` | **8** | **6**（对齐原生 schema）或 8 |
| `maxResults` | prompt `%d` | 10 | 10 |
| 单命令输出 | 约 50 行 | `FC_RESULT_MAX_LINES=50` | 50 |
| 单行字符 | — | `FC_LINE_MAX_CHARS=250` | 250 |
| tree 深度 | — | 3，超 250KB 回退 | 同左 |
| 总 API 轮 | — | `maxTurns + 1`（最后留给 answer） | 同左 |
| force answer | 有 | `You have no turns left. Now you MUST provide your final ANSWER, even if it's not complete.` | 照抄 |
| include snippets | **原生默认有** | 默认 false | **默认 true**（对齐 Devin 体验） |
| 模型 | `swe-1-6-fast` | Windsurf `MODEL_SWE_1_6_FAST` | **用户可配 modelRef** |

### 3.3 虚拟根与路径安全（必抄）

- 所有子代理 path 使用 `/codebase` 或 `/codebase/...`
- executor 映射：`/codebase` + rel → `resolve(projectRoot, rel)`
- 拒绝 `..` 逃逸与非 `/codebase` 前缀
- answer 里的 path 同样 strip `/codebase` 后做 traversal check
- 回给主 agent 的 path：Devin 原生常用 **相对 search root** 的路径（见真实 sample）

### 3.4 User message 模板（必抄）

```text
Problem Statement: {query}

Repo Map (tree -L {depth} /codebase):
```text
{tree}
```
```

二进制中另有固定句（与 Problem Statement 联用/相关）：

```text
Find all code in the repository relevant to this, and answer with the file paths and line ranges as instructed.
```

### 3.5 Force-answer 消息（必抄）

```text
You have no turns left. Now you MUST provide your final ANSWER, even if it's not complete.
```

### 3.6 子代理 system prompt（必抄全文）

完整原文见附件：

[`devin-fast-context-system-prompt.txt`](./devin-fast-context-system-prompt.txt)

占位符：`{max_turns}` `{max_commands}` `{max_results}`。

要点摘要：

- 角色：给**另一个工程师**准备上下文，不是自己改代码
- 相关文件 = 理解+实现所需的定义/调用方，不限「将被修改的文件」
- 必须覆盖 **整个语义块**（函数/类）；大块才允许截断
- 只允许 `restricted_exec`；子命令 rg/readfile/tree/ls/glob
- 策略：MAP → ANCHOR → TRACE → VERIFY；先窄后宽
- 默认 excludes 列表（见 §5）
- 每轮 **一次** restricted_exec，内含最多 N 条并行 command
- 最终 `answer` 工具，参数为 XML `<ANSWER>…`

### 3.7 子代理 tools schema（必抄）

完整 JSON 见：

[`devin-fast-context-restricted-exec-tools.json`](./devin-fast-context-restricted-exec-tools.json)

结构：

1. **`restricted_exec`**
   - `command1` required；`command2`…`commandN` optional
   - 每个 command 为 `oneOf`：`rg` | `readfile` | `tree` | `ls` | `glob`
2. **`answer`**
   - `{ answer: string }` — XML

**rg**

```json
{ "type": "rg", "pattern": "...", "path": "/codebase/...", "include"?: string[], "exclude"?: string[] }
```

**readfile**

```json
{ "type": "readfile", "file": "/codebase/...", "start_line"?: int, "end_line"?: int }
```

**tree**

```json
{ "type": "tree", "path": "/codebase/...", "levels"?: int }
```

**ls**

```json
{ "type": "ls", "path": "/codebase/...", "long_format"?: bool, "all"?: bool }
```

**glob**

```json
{ "type": "glob", "pattern": "...", "path": "/codebase/...", "type_filter"?: "file"|"directory"|"all" }
```

实现注意：

- Devin 原生 schema 描述仍写 “rg, readfile, or tree”，但 oneOf 含 ls/glob（照抄 oneOf 全集）
- 子模型若走 OpenAI/Anthropic 标准 tool calling，用 JSON schema 即可；不必复刻 `[TOOL_CALLS]restricted_exec[ARGS]{...}` 文本协议（那是 Windsurf 专用）。**语义与字段名照抄。**

### 3.8 Answer XML（必抄）

```xml
<ANSWER>
  <file path="/codebase/path/to/file.py">
    <range>10-60</range>
    <range>150-210</range>
  </file>
</ANSWER>
```

- range **inclusive**，1-indexed
- 无相关文件：`<ANSWER></ANSWER>`（空答案合法，禁止凑无关入口文件）
- 解析 regex（fork）：

```js
/<file\s+path=(["'])([^"']+)\1>([\s\S]*?)<\/file>/g
/<range>(\d+)-(\d+)<\/range>/g
```

Devin 另有：`(?s)<file\s+path\s*=\s*"([^"]*)"\s*>(.*?)</file>` 与 `<range>\s*(\d+)\s*-\s*(\d+)\s*</range>`。

## 4. 回给主 agent 的结果 framing（必抄原生风格）

### 4.1 成功（Devin 原生 — 优先抄这个）

真实会话结构：

```text
A search subagent explored the codebase, running these commands:
- Grepped ADR.*0043 in .
- Grepped native.*model.*search in .
- Read docs/adr/0043-native-model-search-routing.md
- Read packages/host-runtime/src/capabilities/search-route-resolver.ts
- …

It believes the snippets below are relevant to your search. Be careful evaluating their relevance — the subagent can make mistakes — and follow up with your normal grep/glob/read tools to fill in anything it missed:

<file path="docs/adr/0043-native-model-search-routing.md" total_lines=157>
  1|# ADR 0043: ...
  2|
  ...
</file>
```

命令摘要标签词（二进制碎片）：`Grepped` / `Reading` / `Analysing` / `Listing` / `Listed` / `Searching`  
实践中会话多用：`- Grepped {pattern} in {path}`、`- Read {path}`。

snippet 格式：

- 外层 `<file path="..." total_lines=N>`
- 行内容：`{lineNo}|{text}`（右对齐行号宽约 3+）

完整 sample：[`devin-fast-context-native-result-sample.txt`](./devin-fast-context-native-result-sample.txt)

### 4.2 成功（fork 精简版 — 可选兼容）

```text
A search subagent explored the codebase and found N relevant files.
  [1/N] /abs/path (L10-60, L120-180)
grep keywords: pat1, pat2
Note: fast-context results are best-effort; verify with your normal search tools.
```

`includeSnippets=true` 时 fork 会再附代码；原生默认就是「命令清单 + snippet」。

### 4.3 空 / 失败文案（照抄）

| 情形 | 文案 |
|------|------|
| 无相关代码 | `Fast-context search did not find relevant code. Verify with your normal grep/glob/read tools.` |
| loop 无 answer | `fast-context loop did not produce an answer` |
| 无 file ranges | `Fast-context search did not return any file ranges. Raw response:` |
| 通用注 | `Note: fast-context results are best-effort; verify with your normal search tools.` |
| 部分路径不可读 | `The search also referenced files that could not be read:` / `Found context in N file(s).` |

## 5. 本地 executor（照抄行为）

### 5.1 默认 excludes

```text
node_modules, vendor, .venv, venv,
.git, .svn, .hg,
dist, build, out, target, .next, .nuxt, .output,
__pycache__, .cache, .pytest_cache,
*.min.*,
coverage, .idea, .vscode
```

prompt 里还点名：`deps, third_party, logs, data`。

### 5.2 rg

- 使用 ripgrep（Devin 自带；fork 用 `@vscode/ripgrep`）
- 收集执行过的 `pattern` → 可作为 `grep keywords` 回传主 agent（fork 增强，值得抄）
- exclude 展开为 `--glob !pattern` / `!** /pattern`

### 5.3 readfile

- 1-indexed inclusive `start_line`/`end_line`
- 输出截断：最多 50 行，每行最多 250 字符
- 路径必须在 `/codebase` 内

### 5.4 tree / ls / glob

- tree：depth/`levels`；目录优先排序；symlink 不当目录递归（fork 行为）
- 输出中的绝对路径 remap 回 `/codebase`

### 5.5 并行

- 同一 `restricted_exec` 内 command1..N **并行**执行
- 结果按 command 键回传（fork 用 `<command1_result>…` 包装；标准 tool result 用 JSON 数组亦可，**对子模型说明格式即可**）

## 6. Repo map（建议抄 fork 的工程化，原生也有 tree）

1. 初始 `tree -L depth /codebase`（depth 默认 3）
2. 超过 ~250KB → 降低 depth，直到 fit
3. 可选 **bootstrap_hotspot**（fork）：
   - 浅 tree + 短 bootstrap 轮次猜 hotspot dirs / rg patterns
   - 再拼 top-K 子树（默认 top 4，depth 2，budget ~120KB）
4. 无结果时可选收窄到 `src/app/lib/packages/...` 重试（fork；非 Devin 二进制必有，可作 piwin 增强）

## 7. piwin 实现映射（可抄清单）

### 7.1 包边界

| 内容 | 位置 |
|------|------|
| 配置类型 `CodeSearchConfig` | `packages/contracts` |
| executor + loop + prompt + format | `packages/host-runtime`（或小模块 `code-search/`，由 host-runtime 组装） |
| 工具注册 | `build-session-host-tools.ts` |
| 主 agent guidance 注入 | session system / tool instructions 组装点 |
| Settings UI | Desktop settings 页：enable + **backend（模型 / Windsurf 云端）** + modelRef 或 token + turns/commands/snippets |
| 测试 | executor 单测、parseAnswer、format、path escape；loop 用 mock completion |

### 7.2 配置草案

```ts
type CodeSearchBackend = 'model' | 'windsurf';

type CodeSearchConfig = {
  enabled: boolean;
  /** Default `model`. `windsurf` = Devin/Windsurf cloud SWE-grep, same protocol as fast-context MCP. */
  backend: CodeSearchBackend;
  /** When backend=model: any already-configured chat model. */
  modelRef?: ModelRef;
  /**
   * When backend=windsurf: keychain ref (preferred) or env name.
   * Raw token never written to config.json. Same secret shapes as MCP:
   * `devin-session-token$…` or historical Windsurf API keys.
   */
  apiKeyRef?: string;   // e.g. keychain:piwin-code-search-windsurf
  apiKeyEnv?: string;   // e.g. WINDSURF_API_KEY
  maxTurns: number;      // default 3
  maxCommands: number;   // default 6
  maxResults: number;    // default 10
  treeDepth: number;     // default 3; 0 = auto
  includeSnippets: boolean; // default true (Devin-like)
  excludePaths: string[];
  resultMaxLines: number;   // default 50
  lineMaxChars: number;     // default 250
  timeoutMs: number;        // per completion / per Windsurf stream
};
```

Settings 控件（建议一页，对齐 web search 的 provider 选择）：

1. **启用** `code_search`
2. **推理后端** 二选一  
   - **使用已配置模型** → 模型下拉（`modelRef`）  
   - **使用 Windsurf / Devin 云端** → token/key 密码框（写入 keychain → `apiKeyRef`），可选 `WINDSURF_API_KEY` env
3. 其余 turns / snippets / excludes 为高级项，不对主模型暴露

本地 executor、`/codebase`、ANSWER XML、结果 framing **两条后端共用**。差别只在「谁规划下一轮 rg/read」。

### 7.3 推理后端（两条，Settings 切换）

本地命令循环相同；只换「规划模型」从哪来。

| | `backend: 'model'` | `backend: 'windsurf'` |
|--|---------------------|------------------------|
| 谁规划 | Host 二次 chat completion（Walkthrough 同类：非主 session UI） | Windsurf Connect-RPC + Protobuf，`MODEL_SWE_1_6_FAST` |
| 鉴权 | 所选 `modelRef` 的 provider 密钥 | 用户自备 token/key（keychain / `WINDSURF_API_KEY`） |
| 协议 | Provider 原生 tool_calls | 与 `~/Developer/fast-context-mcp` 同源：`server.self-serve.windsurf.com` |
| 何时用 | 默认；不绑 Devin 账号 | 用户有 Windsurf/Devin 额度、想用原版 SWE-grep |
| 失败 | 模型不可用 → 工具报错，不静默切云端 | key 缺失/401 → 明确提示去 Settings 填 token，不静默切模型 |

**不要静默 failover 跨后端**（配额/隐私边界不同）。用户选哪条就走哪条。

子代理 **prompt / tools / XML answer / 本地命令语义** 两条都照抄。`windsurf` 路径可以直接移植 fork 的 `core.mjs` 请求层（JWT 换票、流式 frame、`[TOOL_CALLS]` 解析），不要再依赖 MCP 进程。

### 7.4 与现有能力边界

| 能力 | 关系 |
|------|------|
| MCP `fast_context_search` | 可保留 fallback；默认路径改为内置 `code_search` |
| Host `grep`/`read`/`glob` | 保留；code_search 之后强制「可再用它们核实」 |
| `piwin_subagent` explore | 更重的调研/报告；code_search 只做短搜索 |
| `web_search` | 无关；不要混路由 |

### 7.5 UI / 工具簇

Desktop 已有测试痕迹：`resolveToolClusterKind('code_search') === 'search'` — 命名直接用 `code_search` 最省事。

### 7.6 权限

- 只读、限定 project root → 默认应比 MCP 更顺（auto 或 session trust 下直接跑）
- 不走 shell；不写盘
- 子代理 completion 消耗所选后端配额：Settings 写清「使用所选模型」或「使用 Windsurf/Devin 云端」
- Windsurf token：**只进 keychain / env**，禁止写入 `config.json`、禁止日志打印
- 不默认扫描 `state.vscdb`；用户可选手动粘贴（与 MCP `WINDSURF_API_KEY` 相同）。可选「从本机 Devin 导入」作为单独动作，不是静默行为

## 8. 验收标准（实现时）

1. 工具名 `code_search`，仅 2 个模型可见参数  
2. enabled 时 system guidance 含 prefer-first + 禁自并行  
3. 给定自然语言 query + abs root，返回 Devin 风格命令清单 + `<file total_lines>` snippets（默认）  
4. path 逃逸（`../`、绝对路径出 root）被拒绝  
5. 空仓库/无匹配 → 空答案文案，不硬凑  
6. 关掉 enabled → 工具不出现在 session manifest  
7. `backend=model` 时更换 `modelRef` 后 loop 走新模型（mock 可测）  
8. `backend=model` 时 **不需要** Windsurf 网络即可工作  
9. `backend=windsurf` 时用用户配置的 token 打云端；缺 key / 401 有明确错误，不静默切到 model  
10. token 不以明文出现在 config 或测试夹具日志  
11. `pnpm typecheck` + 单测绿  

## 9. 建议实现切片

1. **contracts + config** 类型与默认值  
2. **pure executor**（rg/readfile/tree/ls/glob + /codebase 映射）+ 单测  
3. **parseAnswer + formatNativeResult**（照抄 §4.1）+ 单测  
4. **loop**（system prompt 附件原文 + tools schema + force answer + mock model）  
5. **Host tool 注册 + system guidance 注入**  
6. **Settings：enable + backend 选择 + model 下拉 / Windsurf token（keychain）**  
7. **windsurf 适配器**：移植 fork 的 Connect-RPC 请求层，密钥从 `apiKeyRef`/`apiKeyEnv` 读  
8. 文档 / ADR（配置进 `~/.piwin` 一等 config）  
9. （可选）从 MCP fast-context 迁到内置：可提示「已配置的 WINDSURF_API_KEY 可导入 Settings」  

## 10. 不要照抄 / 不要默认做的部分

- **不要**把 Windsurf 做成唯一后端；`backend: 'model'` 必须能独立工作  
- **不要**静默从 `state.vscdb` 抽 key（可选手动「导入」除外）  
- **不要**把 token 明文写进 `config.json` 或 MCP env 展示给模型  
- **不要**跨后端静默 failover  
- **不要**用 MCP 长名 `mcp__fast-context__…` 作为主路径  
- **不要**把 explore subagent 与 `code_search` 合成一个工具  

`backend: 'windsurf'` **应当**照抄 fork 的云端协议（Connect-RPC、JWT 换票、SWE-1.6-Fast、`[TOOL_CALLS]`），这是用户显式选择的能力，不是偷偷绑死。

## 11. 一句话

**照抄 Devin 的：`code_search` 工具面、prefer-first 策略、子代理 prompt、restricted_exec、ANSWER XML、原生 framing、/codebase 沙箱。  
后端做成设置：默认用 piwin 已配置模型；用户也可粘贴 Windsurf/Devin token，走和 fast-context MCP 同一条云端请求。**
