# Devin（Windsurf）OAuth 接入 + token 复用 可行性调研

> **调研问题**（WREN, 2026-09-23）：能否 ① 把 Devin 的 oauth 拓展内置进 piwin、② 做一张 OAuth 卡片用 Devin 套餐、③ 把 OAuth 凭据直接复用给现有 `code_search` 的 `devin_token`、④ 在网络搜索里加 `devin_web_search` 并同样复用该 token。
> **证据规则**：结论均落在本仓库或本机可核验的文件/行号上。标注「已验证」= 直接读取代码或本机实现；标注「待定」= 需 WREN 决策或需实测。
> 关联：`packages/contracts/src/code-search.ts`、`docs/research/2026-09-19-devin-code-search-verified.md`、本机 `~/Projects/windsurf-search-mcp`。

---

## 0. 结论

**四件事都能做，且其中三件是「接线」而非「造轮子」。** 但有一个硬约束会改变实现路径：

> **piwin 不加载 Pi 扩展的 provider 注册。** 直接 `pi install npm:pi-devin-provider` 不会让 Devin 出现在 piwin 里。
> 「内置」在 piwin 里只有一种可行含义：**把 provider 移植进 `packages/agent-host`**（唯一允许 import Pi 的包）。

| # | 目标 | 结论 | 净新增工作量 | 主要落点 |
|---|------|------|--------------|----------|
| ① | 内置 Devin provider | 可做，但必须移植，不能靠装扩展 | 大（~1.5–2d） | `agent-host/`（新 `devin/` 模块） |
| ② | OAuth 卡片 | 可做，卡片本身很小；**登录流才是真活** | 中（~0.5–1d） | `contracts` + `host-runtime` + `desktop` |
| ③ | `code_search` 复用 token | 可做，接缝已存在 | 小（~0.5d） | `contracts` + `host-runtime/code-search` |
| ④ | `devin_web_search` | 可做，**需要新增一个 source kind** | 小–中（~0.5–1d） | `contracts/web` + `tools-web` + `desktop` |

合计 **3–4 个专注日**（不含 ADR/文档/实测）。协议逆向部分（protobuf Connect 流）是唯一「重」的部分，而它已有**成熟参考实现**（见 §1.4）。

---

## 1. ① 内置 Devin OAuth provider

### 1.1 Pi 没有 Devin provider（已验证）

`node_modules/@earendil-works/pi-ai/dist/auth/oauth/` 仅含：
`anthropic` `device-code` `github-copilot` `kimi-coding` `oauth-page` `openai-codex` `openrouter` `pkce` `radius` `xai`。
**无 devin / windsurf / codeium。**

所以 `V1_SUBSCRIPTION_PROVIDER_IDS` 里那五个（`kimi-coding` `openai-codex` `anthropic` `xai` `github-copilot`）之所以能一键登录，是因为 Pi 内置了它们的 oauth helper。Devin 必须自己写。

### 1.2 为什么「装扩展」不通（已验证 · 硬约束）

Pi 扩展通过 `pi.registerProvider(id, cfg)` 注册 provider，注册项先进入 **ResourceLoader** 的 `pendingProviderRegistrations`，再由 Pi 的 `createAgentSessionServices()` 冲刷进 `ModelRuntime`。

piwin 的两个 ModelRuntime **都是自己 `ModelRuntime.create()` 建的，从不冲刷这个队列**：

| 运行时 | 位置 | 建法 |
|--------|------|------|
| 订阅目录（卡片/模型列表） | `packages/agent-host/src/subscription-auth.ts:305-315` | `ModelRuntime.create({authPath, modelsPath, ...SUBSCRIPTION_RUNTIME_CREATE_OPTIONS})` |
| 会话（真正发请求） | `packages/agent-host/src/backends/sdk-backend-session.ts:205-243` | `ModelRuntime.create(...)` 后逐个 `registerProvider` |
| 会话（RPC worker） | `packages/agent-host/src/rpc/worker-pi-session-factory.ts:635-655` | 同上 |

```
grep -rn "pendingProviderRegistrations" packages apps   → 0 结果
```

**结论**：`pï install` 的扩展只对 Pi TUI 生效；piwin 看不到它。piwin 里 `~/.piwin/extensions/pi-anthropic-auth` 的存在也印证了这一点——它是给 Pi TUI 用的，piwin 侧的 Claude Code provider 是自己重新注册的（见 1.3）。

### 1.3 piwin 已有现成模板（已验证 · 关键利好）

`packages/agent-host/src/anthropic-oauth/register-claude-code-provider.ts`（109 行）就是「产品自有的 OAuth provider 注册」范例：

- 从 `auth.json` 读回凭据（api_key 形状，让 `checkAuth` 通过）；
- 取 Pi 的传输实现 `anthropicMessagesApi().streamSimple` 并包一层；
- `runtime.registerProvider('anthropic-claude-code', { name, api, baseUrl, apiKey, authHeader, streamSimple, models })`。

Devin 是**同构**的，对应产物应是 `packages/agent-host/src/devin/register-devin-provider.ts`，差别只有两点：
1. 传输不是 `anthropic-messages`，而是 Devin 自己的 protobuf Connect 流；
2. 模型目录来自 Devin 的 `GetCliModelConfigs` 动态发现，而非 blueprint。

### 1.4 参考实现已存在（已验证 · 本机 + 上游）

| 来源 | 提供什么 | 许可/形态 |
|------|----------|-----------|
| `~/Projects/windsurf-search-mcp/bin/windsurf-search.mjs` | **Web 搜索**端点、请求体、双 host 回退、token 解析/登录（零依赖） | 本机，WREN 自己的仓库 |
| `github.com/fadlee/pi-devin-provider`（已完整读取） | **Chat 流**：`protocol.ts`（protobuf 编解码 + Connect 分帧）、`stream.ts`（`GetChatMessage` → Pi stream 事件）、`discovery.ts`（模型发现）、`oauth.ts`（PKCE）、`quota.ts`（配额） | MIT |

`pi-devin-provider` 的 `oauth.ts` 形状可直接照搬：

- PKCE + `http://127.0.0.1:59653/callback` 回环
- 授权页 `https://app.devin.ai/auth/cli/continue?…`
- 换 token `POST https://api.devin.ai/auth/cli/token` → `{token}`：**实测是裸 JWT**（payload 为 `{"session_id":"windsurf-session-…"}`），Windsurf 协议调用方需自行补 `devin-session-token$` 前缀（2026-09-24 更正）
- 注册形态 `{name:'Devin', api:'devin-cloud', baseUrl:'https://server.codeium.com', models, refreshModels, oauth:{login, refreshToken, getApiKey}, streamSimple}`

### 1.5 一个必须知道的限制：`models.json` 表达不了自定义 OAuth（已验证）

Pi 的 `models.json` provider schema 里 `oauth` 字段类型是 `Type.TOptional<Type.TLiteral<"radius">>`
（`@earendil-works/pi-coding-agent/dist/core/model-config.d.ts:239`）。

**即：Devin 的 OAuth 流无法写进 `models.json`，只能靠 `registerProvider()` 代码注册。** 这也再次排除了「配置即接入」。

---

## 2. ② OAuth 卡片

### 2.1 卡片本身很小（已验证）

`packages/host-runtime/src/subscription-account-status.ts:36` 是 `for (const providerId of V1_SUBSCRIPTION_PROVIDER_IDS)` 循环建卡片。因此：

- 在 `packages/contracts/src/subscription-oauth.ts:8` 的 `V1_SUBSCRIPTION_PROVIDER_IDS` 加 `'devin'` → **Host 侧卡片自动出现**；
- `:209` `V1_SUBSCRIPTION_PROVIDER_META` 是**穷尽 Record**，不加会直接编译报错（很好的护栏），需补 `{ name: 'Devin', oauthOrigin: 'oauth://devin' }`；
- `:268` `AUTH_CLI_PROVIDER_IDS`、`:38` `SUBSCRIPTION_DEFAULT_FALLBACK_ORDER` 自动跟随。

Desktop 侧有三处**人工白名单/穷尽表**需要补（否则卡片不显示或编译失败）：

| 文件 | 内容 |
|------|------|
| `apps/desktop/src/subscription-accounts.tsx:38-48` | `OAUTH_DISPLAY_PROVIDER_IDS` 显示顺序 |
| `apps/desktop/src/subscription-accounts.tsx:50-100` | `CARD_COPY`（title / tagline 中英文 / 登录按钮文案），穷尽 Record |
| `apps/desktop/src/provider-icons.tsx:119-122` | 品牌图标 + 配色 |

### 2.2 登录流才是真正的工作量（已验证）

`packages/host-runtime/src/subscription-auth-service.ts:565-600` `runLogin()` 的现有路径是：

```
runLogin → port.login(piLoginId) → Pi runtime.login(id,'oauth') → provider.auth.oauth.login
                                        ↑
                        必须有 Pi 内置的 oauth helper 才走得通
```

而 `packages/contracts/src/subscription-oauth.ts:250`：

```ts
piOauthLoginProviderId(id) → id === 'anthropic-claude-code' ? 'anthropic' : id
```

**piwin 现有设计里，登录永远委托给 Pi 内置 provider。** Devin 没有内置 provider，所以这里必须开一条新分支——与文件中已有的 `claudeCode` 特例并列。

两个可选实现：

| 方案 | 做法 | 评价 |
|------|------|------|
| **(a) 推荐** | 在**订阅运行时**上 `registerProvider('devin', { oauth })`，把 `login/refreshToken/getApiKey` 交给 Pi（Pi 的 `ExtensionOAuthConfig` 正好这三个方法），随后 `runtime.login('devin','oauth',…)` 走原路径，凭据由 Pi 自己落 `auth.json` 并同步目录 | 增量最小；复用 Pi 的凭据存储 + `synchronizeCredentialState` + 目录刷新；`token-devin` 卡片状态机零改动 |
| (b) | 像 Claude Code 那样由 piwin 自己跑 PKCE、直接写 `auth.json` | 代码更多；且 `auth.json` 里 oauth 形状的凭据会因「provider 未注册 `auth.oauth`」被 `checkAuth` 拒绝（`subscription-auth-credentials.ts` 文件头注释已说明该坑），要额外降级成 api_key 形状 |

### 2.3 待决策：远端 Host 的回环回调（Open question）

`pi-devin-provider` 用的是**固定回环端口** `127.0.0.1:59653`。
piwin 的网格是 **Host-first**（ADR：一个 Host，多个 shell）。当 Host 跑在远程机器上时，浏览器在 WREN 本地打开，回调却打到**远端机器的 127.0.0.1** —— 登录会静默失败。

现有可参考的处置：

- `AUTH_LOGIN_IDLE_MS` / `preferLoopback` / `oauth-callback-port-busy`（`AUTH_PROBLEM_CODES` 已有该码）——piwin 已经处理过 Codex 的 `1455` 端口冲突；
- 更稳的做法是**手动粘贴回调 URL**（Codex/Claude 已用「browser + paste-callback」），或走 device-code 变体。

> **建议**：本地 Host 用回环；远端 Host 走「授权页 + 粘贴回调 URL」。这条需要 WREN 拍板，因为它决定 `HostAuthPrompt` 是否要新增一种交互类型。

---

## 3. ③ `code_search` 复用 OAuth 凭据

### 3.1 今天怎么取 token（已验证）

- 契约：`packages/contracts/src/code-search.ts:88-95` —— `backend:'windsurf'` 时用 `apiKeyRef`（keychain 引用，**优先**）或 `apiKeyEnv`（环境变量兜底）。
- 门禁：`packages/host-runtime/src/code-search/tool.ts:76-100` —— 两者都没有就 `ready:false`，并提示去 Settings 配。
- 解析：`packages/host-runtime/src/secret-resolver.ts` —— `readSecretByRef()` → macOS keychain（`keychain:<service>`）→ 回退 Host 文件 `~/.piwin/secrets/<service>`（远端无 keychain 的场景）。

### 3.2 复用的接缝已经存在（已验证）

OAuth 成功后，token 落在 `~/.piwin/pi-agent/auth.json` 的 `devin` 键下；而 `packages/agent-host/src/subscription-auth-credentials.ts` 已经导出了读它的函数：

```ts
readOauthAccessToken(authPath, 'devin')   // 已支持 key / access / accessToken 三种形状
```

**建议做法**：给密钥引用加**第三种来源** —— `oauth:<providerId>`，由 `readSecretByRef` 识别并转发到 `readOauthAccessToken(authPath, 'devin')`。

- 优点：**单一事实来源**，token 轮换/刷新自动跟随，不存在副本；
- 落点：`contracts/code-search.ts`（文档 + 校验）、`host-runtime/src/secret-resolver.ts`（`oauth:` 前缀分支）、`code-search/tool.ts` 的 readiness 提示文案；`backends/windsurf-backend.ts` 复用同一条解析（它现在只认 `apiKeyRef`/`apiKeyEnv`）。
- 不建议的替代：登录时把 token **复制**一份到 `keychain:piwin-code-search-windsurf`。实现最省事，但一旦 Devin 换 token 就会静默过期（`pi-devin-provider` 的 `refreshToken` 是恒等函数，风险偏低但不为零），且等于把同一个秘密存两处。

> 注：WREN 本机现在就有 `~/.piwin/windsurf-api-key`（`windsurf-search-mcp` 的 compat 读取路径）。OAuth 落地后它是冗余的，可保留为手动兜底。

---

## 4. ④ `devin_web_search`

### 4.1 端点已实测（已验证 · 本机参考实现）

来自 `~/Projects/windsurf-search-mcp/bin/windsurf-search.mjs`：

```
POST https://server.codeium.com/exa.api_server_pb.ApiServerService/GetWebSearchResults
  回退 host: https://server.self-serve.windsurf.com
headers: Content-Type: application/json, Connect-Protocol-Version: 1
body: {
  metadata: { apiKey: "devin-session-token$…", ideName: "windsurf",
              ideVersion, extensionName: "windsurf", extensionVersion, locale: "en" },
  query, limit: ≤10, domain?, mode?
}
→ { results: [ { title, url, snippet } ] }
```

### 4.2 现有 `http` kind 做不到（已验证）

`packages/tools-web/src/search-source-providers.ts:196-238` `createHttpProvider` 是硬编码的 Open WebUI 形状：

- 认证固定 `Authorization: Bearer <key>`（Devin 要的是 `metadata.apiKey`，非 Bearer）；
- 请求体固定 `{ query, count }`（缺 `metadata`）；
- 响应只认 `{hits:[…]}` / `[…]`（Devin 返回 `{results:[…]}`）。

**结论：必须新增一个 source kind**，不能靠自定义 HTTP 源绕过去。

### 4.3 新增 kind 的落点（已验证）

| 文件 | 改动 |
|------|------|
| `packages/contracts/src/web.ts:17-29` | `WEB_SEARCH_SOURCE_KINDS` 加 `'devin'` |
| `packages/contracts/src/web.ts:44-48` | `WebSearchTestableSourceKind` 加 `'devin'`（否则 Settings 的「测试」按钮不支持） |
| `packages/contracts/src/web.ts:11-20` | `WebSearchProvider` 旧镜像联合类型同步 |
| `packages/tools-web/src/search-source-providers.ts:26-36` | `createProviderForSource` 分派 + `createDevinProvider(source, apiKey)` |
| `apps/desktop/src/settings/pages/web-page-options.ts:3-9` | `SOURCE_KIND_OPTIONS` 卡片刻度（中文文案） |
| `apps/desktop/src/settings/web-draft.ts` | 新卡片默认值 |

凭据解析**复用 §3 的 `oauth:devin`**（或 `WINDSURF_API_KEY` 兜底），不要另起一套。

### 4.4 待决策：要不要真的注册一个叫 `devin_web_search` 的工具？（Open question）

piwin 的既定设计是**模型只看到单个 `web_search` 工具**，Host 把多个 enabled source 的结果合并去重
（`packages/contracts/src/web.ts:74-77` 的注释即是该契约）。

- 若把 Devin 作为**一个 source** → 模型看到的仍是 `web_search`，行为与现有 Tavily/Brave 一致，**推荐**；
- 若要求 WREN 字面意思的独立工具 `devin_web_search` → 需在 `build-session-host-tools` 里新增工具并重排搜索路由策略（ADR 0043 的 `SearchRoutePolicy`），收益是模型能显式选择「用 Devin 搜」，代价是工具面变宽、路由复杂度上升。

> 这两种是不同的产品形态，需要 WREN 明确选一个。

---

## 5. 横向风险

1. **非官方接口**。`server.codeium.com` 的 protobuf / Connect 流与 `devin-session-token$…` 都是逆向所得；token 形状已发生过演进（`ott$` 已废弃、`sk-ws-*` 为旧式 key）。上游一改就断，且没有 SLA。Pi 内置的那五个 provider 是官方支持路径，Devin 不是。
2. **条款风险**。`windsurf-search-mcp` 自己的 README 就写明：在官方客户端之外使用该 token **可能违反提供方条款**。这是用户自担风险的决定，产品文案里应有一句提示（MCP 那条 ADR 0033「用户自负风险」的口径可以对齐）。
3. **Chat 流是 protobuf Connect 流**，不是 JSON SSE。`streamSimple` 需要移植约 200 行（编解码 + 分帧 + 分片 JSON 累积），这是全部工作量里最重的一块，但**已有 MIT 参考实现**。
4. **配额卡片**。`packages/agent-host/src/subscription-quota-fetcher.ts:183-194` 是 switch，未命中返回「不支持的套餐平台」。Devin 有 `GetUserStatus`（`pi-devin-provider/quota.ts` 已实现解析），要补一个 `case 'devin'`，否则卡片上会显示错误而不是额度。
5. **架构合规**（`AGENTS.md` §1–§2）：
   - Pi 相关代码全部留在 `agent-host` ✓（§1 规则 2）
   - 跨边界类型先进 `contracts` ✓（规则 3）
   - `agent-host` 不得 import 应用包 ✓
   - 生产源文件 ≤1000 行：`devin/` 拆成 `register-devin-provider.ts` / `protocol.ts` / `stream.ts` / `discovery.ts` / `oauth.ts`，均远低于上限 ✓

---

## 6. 建议实施顺序

1. **契约先行**：`V1_SUBSCRIPTION_PROVIDER_IDS` + `V1_SUBSCRIPTION_PROVIDER_META` + `devin` 的 ADR（记录「为什么不用扩展、而是移植进 agent-host」）。
2. **provider 移植**：`agent-host/src/devin/*` + 在 `createBackendModelRuntime` / `createWorkerModelRuntime` 的 oauth 分支里加 `devin`（现在这两个分支对非 Claude Code 的 oauth provider 是 `continue` 跳过的，见 `sdk-backend-session.ts:224-232`）。
3. **登录流**：`runLogin` 新增 `devin` 分支 + 订阅运行时 `registerProvider('devin', {oauth})`；同步决定远端 Host 的回调策略（§2.3）。
4. **凭证复用**：`oauth:<providerId>` 引用类型，同时喂给 `code_search` 与 web search（§3.2）。
5. **web 搜索源**：新增 `devin` source kind（§4.3），先按「合并进 `web_search`」实现，独立工具名另议。
6. **配额**：`case 'devin'`。

**验证方式**：`pnpm typecheck` + 相关包单测（`contracts` / `host-runtime` / `tools-web` 均有测试跑道，穷尽 Record 的改动会自然被编译器抓住）+ 一次真机登录与一次真实搜索调用。

---

## 附：本次调研未验证的部分

- Devin OAuth 授权页在**真实浏览器**里的完整跳转（`pi-devin-provider` 与 `windsurf-search-mcp` 走的是两套不同的登录链路：前者 PKCE/CLI token，后者邮箱密码 + `WindsurfPostAuth`）。**两条链路哪个在 2026-09 仍然可用，需要实测**——这会影响 §2.2 的方案选择。
- `GetWebSearchResults` 的 `mode` / `domain` 语义与额度计费归属（是否计入套餐）。
- Devin 套餐额度是否会与 Chat 用量共享（影响配额卡片的产品文案）。
