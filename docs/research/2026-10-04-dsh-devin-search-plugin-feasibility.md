# DeepSeek Harness 接入 Devin 搜索插件：可行性调研

## 结论

**可以实现独立、可安装的 DSH 插件 bundle，无需修改 DSH 核心，也无需把主会话模型切换到 Devin。**

推荐一个安装包包含两个贡献：

1. `web_search`：实现 DSH `WebSearchProvider`，注册到 `ctx.web`，复用原生 `web_search` 工具和结果展示；bundle 将 Web service 的 `searchProvider` 显式选为 `devin`。
2. `code_search`：注册独立模型工具；内部运行受限只读搜索循环，使用 Devin/Windsurf completion client 推理，本地执行 grep/read，返回文件、行范围与片段。

这是基于当前官方源码与本地 piwin 实现的架构可行性结论，不是新插件已实现或端到端通过的声明。安装后还需要有效 Devin/Windsurf 凭据；账户额度、服务权限及协议兼容性须由真实 smoke 验证。

## 获取与版本证据

- 官方仓库：https://github.com/deepseek-ai/deepseek-harness
- 浅克隆路径：`/Volumes/BigDisk/Projects/Projects/_refs/deepseek-harness`
- 分支：`master`
- 根 package version：`0.2.1-alpha.1`
- 调研提交：`5badb15009ae1756c3afe0ae0cef1faafc290ccc`
- 提交时间：`2026-10-03 11:48:13 +0800`
- 提交标题：`Merge pull request #5648 from deepseek-harness/worktree/release-dsh-0.2.1-alpha.1`
- 本轮 `git log -1` 与 `git ls-remote origin HEAD` 返回同一 SHA；`git status --short` 无输出。最新是指查询当时的官方 HEAD，不是承诺后续不再变化。
- 未安装 DSH 依赖、未构建、未启动 DSH，未改该仓库源码。

## 一、web_search：复用能力接缝，而不是重复注册工具

### 已确认的接口

DSH `packages/web/web/src/types.ts:98–105` 定义：

```ts
interface WebSearchProvider {
  readonly id: string
  available(): boolean
  search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult>
}
```

请求是单个 `query` 与可选 `maxResults`；结果是 `sources`、`truncated` 和可选 `content`。每个 source 包含 URL、可选 title/snippet/publishedAt。原生 tool 消费者接受 `queries` 数组，逐项调用 provider，因此不需要把 piwin 的单 query 工具 schema 整体替换过去。

- 注册：`ctx.web.registerSearchProvider(provider)`，返回 disposer，并随插件生命周期卸载。
- DSH source：`packages/web/web/src/index.ts:90–129`。
- 输出规范：`packages/web/web/src/types.ts:16–53`。
- 现有 provider 模板：`packages/web/web-search-deepseek/src/index.ts:110–160`。

### 不能遗漏的默认配置

`packages/bundle/base/cordis.patch.yml:472–490` 默认指定：

- `searchProvider: deepseek-official`
- `fetchProvider: http`
- 启用原生 `tool-web`。

**仅注册 Devin provider 不会自动接管搜索。** 安装 bundle 必须显式选择 `devin`，并保留 `fetchProvider: http`。后续用户 profile/home/CLI patch 可以覆盖 bundle 的选择。DSH patch 替换整行 config，而非深合并，不能只改一个键而意外丢失其他设置。

`DSH_WEB_SEARCH_PROVIDER` 只是 config 缺省时的来源；当前 base 已有显式 searchProvider，因此不能假设设置环境变量就能覆盖默认值（`packages/web/web/src/index.ts:91–93`）。

不要重复注册同名 `web_search`：同作用域重复工具名报错，已有官方测试覆盖（`packages/core/tools/tests/tools.spec.ts:2087–2110`）。Web profile 又将 host `tool-web` 禁用并在 agent preset 中组合它（`packages/bundle/web-app/cordis.patch.yml:573–574`）；provider 方案可复用这些消费者，避免逐个替换 preset 的工具。

### piwin 可移植部分

`packages/tools-web/src/devin-search-provider.ts:9–148` 是较小的 fetch/JSON 适配层：

- 端点：`/exa.api_server_pb.ApiServerService/GetWebSearchResults`
- 地址：`https://server.codeium.com` 与 `https://server.self-serve.windsurf.com`
- 请求带 metadata/apiKey/query/limit。
- 保留取消信号，失败时按地址回退。
- 结果映射为 DSH `WebSearchResult`；不要保留 piwin 类型依赖。

本轮用于发现 DSH 官方仓库的 Host `web_search` 实际返回 `providerId: devin` 和搜索结果，证明当前运行 Host 的 Devin web-search 路径有在线返回；这不等于新 DSH provider 已通过运行验证。

## 二、code_search：独立工具 + 本地受限循环

### DSH 提供所需工具契约

- `defineTool` 与 `ctx.tools.register`：定义 schema、规范结果和渲染，再注册工具。
- `execute(args, exec)` 返回符合 `output.schema` 的结构化结果；`output.render` 转为模型内容。
- `exec.signal` 提供调用取消；`exec.agent?.session.header.cwd` 提供会话工作区。
- 可声明 timeout 与 concurrency classifier。
- 通用工具卡片即可展示，不必首先编写客户端 UI 插件。

直接核对：

- `packages/core/tools/src/schema.ts:484–558`
- `packages/core/tools/src/index.ts:335–438`
- 官方工作区/rg 用法：`packages/fs/tool-fs-search/src/search-core.ts:221–260`

### Devin 实际接入形态

不能把 `code_search` 当成一个“传代码库路径给云端，然后返回结果”的公开 API：piwin 中是本地搜索子循环，Devin/Windsurf 只负责每轮推理。

可参考以下领域模块，剥离 piwin Host/config/contracts 耦合后移植，不应依赖整个私有 piwin runtime：

- `packages/host-runtime/src/code-search/search-loop.ts`
- 同目录的 prompts、command parser、restricted executor、answer parser、repo map 和 result formatter。
- `backends/windsurf-backend.ts` 与 `backends/windsurf-protocol.ts`：JWT 交换、Connect/protobuf 流、gzip 帧和工具调用标记解析。

主要端点：`GetUserJwt` 与 `GetDevstralStream`。工具对主模型仍可保留 `search_term`、`search_folder_absolute_uri` 两个参数。

无需把 Devin 注册成 DSH 主模型 adapter：插件内 completion client 可以独立工作，主 Agent 继续使用用户原有模型。若未来想将该模型供整个 DSH 使用，再单独实现 LLM adapter，不属于本需求最小范围。

### 权限、执行世界和资源限制

- 读取必须限制在当前工作区真实路径之内，包含目录和符号链接逃逸校验；没有明确 workspace 时应拒绝，而非自动扩大到 process.cwd。
- 子循环只能运行可解析的白名单只读操作，不能执行模型输出的任意 shell。
- 优先使用 DSH 配对的 fs/subprocess 服务，并明确对应执行世界。不能把远端 Session 路径交给 Host 的 node:fs 或本地 rg。
- 首版建议明确支持本地 workspace；SSH/远程 FS 在没有完整同世界实现前明确拒绝，不静默回退。
- 透传取消；限制轮数、命令数、单文件/输出长度、总时间和并发搜索数。
- 为保守保持 piwin 的搜索使用约束，code_search 默认 exclusive/串行；web provider 的无共享可变状态请求可以并发。只读并不自动意味着所有搜索调用都应无限并行。
- DSH filesystem sandbox 的读操作并不限制观察范围；其 process SandboxMode 主要约束文件副作用，网络不在该词汇的保证内。插件必须自行落实工作区读边界。
- 插件内部直接调用能力服务不等于每轮都经过独立 model-tool 审批。不能将绕过子调用审批作为卖点；需明确外层工具授权及内部限制，遵循部署策略。
- 工作区代码片段会传给 Devin/Windsurf 云端，安装/配置说明必须披露此隐私边界。

来源：`packages/fs/fs-sandbox/README.md:46–60`、`docs/subsystems/sandbox.md:9–13`。

### 线上验证缺口

piwin `windsurf-backend.ts:10–15` 明确记录：协议、凭据、取消和错误路径由 fixture 验证，但该实现的真实线上端到端调用尚未在其验收说明中验证。本轮没有执行新的 Devin code_search 在线调用。不能把“已有协议代码”表述成“插件上线必定可用”。

## 三、可安装性与凭据

### 包格式

独立 npm package 交付 ESM 编译产物、`cordis.patch.yml`，并在 package.json 声明：

```json
{ "dsh": { "bundle": { "patch": "./cordis.patch.yml" } } }
```

官方 install command 形状：

```sh
dsh plugin --profile web add <插件包名或本地路径>
dsh --profile web --dump-config
```

卸载使用同 profile 的 `remove`。Web、headless、sdk 各自拥有安装/activation；不能声称安装到 web 就自动装入全部 profile。`sdk-minimal` 不继承 base，额外服务组合需要单独处理；Desktop profile 由 Desktop 管理，不应套用公共 CLI 管理它。

官方文档：`docs/user/develop/basic/publish.md:20–140`。对运行时必须共享实例的 DSH 包使用 peerDependencies，并为类型检查/独立测试配置 devDependencies。独立外部发布不能把仓库内部 `workspace:*` 直接当成可安装的发布版本；兼容版本范围应根据发布包版本确定。

### 凭据方案（用户澄清：OAuth 一次，持久化共用）

用户明确要求与 piwin Devin OAuth 相同的体验：**安装插件 → 发起 Devin 浏览器授权 → 保存登录凭据 → 重启后仍可用 → 两个搜索工具共用凭据**。手工填写 token 不再是首版主要入口；登录不是额外可选需求。

已核对 piwin `packages/agent-host/src/devin/oauth.ts:54–104,136–168`：

- 使用 PKCE S256 与随机 state，打开 `https://app.devin.ai/auth/cli/continue`。
- 本机 loopback callback 接收 code，校验 state；用 code + code_verifier 调用 `https://api.devin.ai/auth/cli/token` 获取 session token。
- session token 作为持久化凭据使用，而不是要求用户手动复制 API key。DSH 的 DeepSeek 登录不能替代 Devin 登录。
- **没有 refresh grant**：piwin 的 `refreshDevinCredentials` 在有效期内复用原 session，过期后要求重新登录。OAuth 结构中的 `refresh: token` 不代表可无限续期。
- code_search 所需的短期 GetUserJwt 可以由 session token 再次换取；这与刷新 OAuth session 是两回事。

插件应在 Host 侧受控持久化凭据和有效期事实，工具侧仅持有凭据引用；参考 DSH 原生 provider 的 `credential-ref` schema 和 `ctx.credentials.resolve()`。登录成功写入与登出删除如何挂接 DSH 凭据服务，需在后续实现前核对其可写接口与账户状态展示接口，不能仅凭现有 resolve 用法认定已完整支持。禁止把 token 写入普通 YAML、前端状态、日志或 tool result。

登出应清除持久化凭据与内存 JWT 缓存；session 过期/被撤销时提示重新授权。**不会自动读取本机 piwin 私有 auth.json。** 首版本地 Host 可参考 piwin loopback 流程；远程 Host 与用户浏览器不在同一机器时，callback 路由需要另行定义，不能承诺直接可用。

SDK 模式尤其不能向 stdout 输出调试信息，以免破坏 JSON-RPC；使用 Host 日志机制。

## 四、建议实现顺序与后续验收

本轮没有创建执行计划或实现插件。若继续实现，建议按以下小切片：

1. bundle + Devin WebSearchProvider + 安装时明确 provider 选择。
2. 迁移 code_search 纯领域逻辑和私有 completion client，补 DSH filesystem/execution adapter。
3. 实现 Devin OAuth 登录、凭据持久化/重启恢复、共享登录状态与登出；补 PKCE/state、取消/超时、session 失效及短期 JWT 缓存测试。
4. 补路径/符号链接边界、协议与输出 golden/fixture 测试；用独立 profile 安装 tarball，核对 dump-config、工具暴露与卸载，验证不会替换 web_fetch。
5. 用户授权后做最小真实 Devin smoke：OAuth 登录并重启后仍可用，web_search 有来源，code_search 命中已知 fixture 文件与正确行号；检查取消、失效/登出与额度边界。

## 验证状态

- 已执行：官方 git clone；本地 HEAD 与远端 HEAD 对照；干净工作树检查；官方 docs 获取；DSH 接口/默认 bundle/现有测试源与 piwin 实现交叉核对。
- 已观察：当前运行 Host 的 Devin web_search 返回在线搜索结果。
- 未执行：DSH dependency install/build/test/boot；新插件实现/安装；新插件真实 API smoke。
- 现有测试仅作为行为契约证据阅读，没有声称本轮测试通过。
- 官方项目明确处于 developer preview，公共 API pre-stable；应锁定已验证兼容版本，再按 DSH 升级说明跟进。

## 外部来源

- 官方仓库：https://github.com/deepseek-ai/deepseek-harness
- 官方插件入门：https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/
- 官方架构：https://deepseek-harness.github.io/deepseek-harness/en/reference/
- 固定提交安装文档：https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/docs/user/develop/basic/publish.md
- 固定提交 web service：https://github.com/deepseek-ai/deepseek-harness/blob/5badb15009ae1756c3afe0ae0cef1faafc290ccc/packages/web/web/src/index.ts
