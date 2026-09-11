# 接入已有的 Pi 工作环境

| 字段 | 值 |
|------|------|
| 状态 | Phase 1 implemented（2026-09-11） |
| 日期 | 2026-09-11 |
| 性质 | 产品功能方案（不是模型名单补丁） |
| 修订 | ADR 0002、ADR 0060、ADR 0010 / 0047、套餐 OAuth spec |
| 相关 | [2026-08-22-pi-native-package-follow.md](./2026-08-22-pi-native-package-follow.md)、[2026-08-28-subscription-oauth.md](./2026-08-28-subscription-oauth.md)、[pi-extension-productization.md](./pi-extension-productization.md)、[guides/pi-extensions.md](../guides/pi-extensions.md) |

---

## 0. 一句话

piwin 是跑在 Pi 上的产品壳。已经在用 Pi 的人打开 piwin，应能把**那份工作环境**接进来：账号、模型、自己装的包、Agent 能用的扩展、技能、提示词，以及少数可移植的偏好。接进来之后，piwin 自己继续当产品权威，不再改用户的 Pi。

这不是「把模型列表同步一下」。那只是这件事里的一个零件。

---

## 1. 要解决的真正问题

piwin 从第一天就决定了两件互相打架、但又都成立的事：

1. **产品根在 `~/.piwin`。** 主题、媒体、MCP、会话索引、权限、远程 Host，都不应绑在 `~/.pi/agent` 上（ADR 0002）。
2. **内核是 Pi。** 套餐登录、发请求、在线模型目录、扩展加载，都走 `@earendil-works/pi-coding-agent`，不自己再做一套 OAuth 和模型协议。

再加上第三件，是安装形态带来的：

3. **应用打包了自己的 Pi。** 用户机器上可能还有一份 `pi` CLI。两份程序、两个版本，二进制不能混用。能读的是用户 Pi 写在磁盘上的数据。

于是今天的实际体验是：用户在 Pi 里已经登录 Codex、装过 `npm:pi-build-ios-apps`、改过默认模型和思考强度，打开 piwin 却像进了一间空房子。套餐凭证前一阵还和 CLI 抢同一份 `auth.json`；后来迁到 `{PIWIN_ROOT}/pi-agent`，test-host 干净了，但「我在 Pi 里的生活」并没有作为一件产品被接进来。

用户原来的设想是对的，需要完整展开，而不是收成「模型配置同步」：

- 套餐登录留在 Pi 这一层（引擎、格式、在线目录），这样身份、目录、发请求是同一套系统。
- piwin **单向**把用户 Pi 里能用的东西接进来；不写回 `~/.pi`。
- 扩展只接 Agent 运行时真正支持的部分：工具、钩子、确认 / 选择 / 输入 / 通知。TUI、主题、快捷键、编辑器、自定义渲染、`/reload` 不接。
- 两份 Pi 并存、版本可能不一致，这件事承认，不假装能复用用户的 `pi` 命令。

---

## 2. 产品承诺

> 本机（或这台 Host）上已经有一份 Pi 工作环境时，piwin 可以把它接进来，让用户继续用那些账号、模型和 Agent 能力。piwin 不是 Pi 终端的换皮，也不会去改用户的 Pi。

对外名称建议用 **接入 Pi 工作环境**。设置里的动作是 **检测 / 预览 / 接入 / 刷新清单**，不要对用户说「同步 catalog」或「import auth.json」。

成功标准（人话）：

1. 用过 Pi 的人，第一次打开产品，能看到「检测到本机 Pi」，并决定接什么。
2. 接进来之后：套餐账号能发消息；`pi install` 过的技能和可用扩展出现在列表里；自定义通道（Ollama 等）能变成产品里的通道；默认模型和思考强度能带过来。
3. 不接的东西用户能看明白：主题、快捷键、TUI 插件、旧会话记录，不会假装已经迁过来。
4. 之后在 Pi CLI 里再 `pi install`：产品重读清单就能看见（跟随，不写 `config.json`）。在 CLI 里登出：**不会**改 Host 已拷走的套餐凭证。自定义通道和默认模型不会在后台改 `config.json`，要再点接入。
5. test-host、远程 Host、生产 Desktop，三套环境不会误用同一份套餐凭证。

---

## 3. 非目标

| 不做 | 原因 |
|------|------|
| 调用用户安装的 `pi` 二进制 | 打包运行时才是会话内核；版本、路径、权限都不可控 |
| 默认两个进程共用一份活着的 `auth.json` | refresh token 会互相踩；test-host 会脏 |
| 把 piwin 的安装写回 `packages[]` | 双向循环，和 ADR 0060 冲突 |
| 把 Pi 的包拷进 `~/.piwin/extensions/revisions` | 双份树，和 `pi update` 脱节 |
| 后台 `fs.watch` / 每条 bash 后对账 | 刷新和编 Blueprint 时重读即可 |
| 导入 Pi 会话树 | 产品会话权威在 Host，不是 Pi JSONL |
| 导入主题、快捷键、编辑器、TUI 布局 | 产品不是 Pi 终端 |
| 默认吞掉 `SYSTEM.md` | 产品提示词另有来源；要接就单独做「导入系统提示」 |
| 把 Desktop 笔记本上的 `~/.pi` 扫进远程 Host | Host 只扫自己那台机器；跨机器是导出包，二期再说 |

---

## 4. 磁盘上到底有什么

用户 Pi 家目录默认是 `~/.pi/agent`（可用 `PI_CODING_AGENT_DIR` 改）。和产品根 `~/.piwin`、Host 运行时目录 `{PIWIN_ROOT}/pi-agent` 是三块地。

| 路径 | 它是什么 | 产品怎么对待 |
|------|----------|----------------|
| `auth.json` | 套餐 / 登录凭证 | **引擎用 Pi，文件归 Host。** 默认根做一次单向拷贝；之后各写各的 |
| `models-store.json` | 在线目录缓存（pi.dev overlay） | **不抄 CLI 的缓存。** Host 自己的 ModelRuntime 刷新，写到 `{PIWIN_ROOT}/pi-agent/` |
| `models.json` | 用户自定义 provider / 模型 | **导入成产品通道**（见 §7），不把这份文件当运行时权威 |
| `settings.json` | CLI 全局偏好 + `packages[]` | **拆开：** 包清单走只读叠加；少数偏好单向导入；TUI 项丢弃 |
| `extensions/`、`npm/`、`git/` | 扩展和包的实体 | **只读叠加进 catalog**（ADR 0060），不拷贝 |
| `skills/`、`prompts/` | 技能、提示词 | 同上，只读叠加 |
| `themes/` | 终端主题 | 忽略 |
| `sessions/` | CLI 会话 | 忽略（不把 Pi 对话变成产品会话） |
| `SYSTEM.md` | CLI 全局系统提示 | 今日已可进会话；与「接入」对齐前先明确是跟随还是关掉 |
| `trust.json` | CLI 项目信任 | 不复用；产品有自己的项目信任 |
| `.pi/settings.json`（项目内） | 项目级包和偏好 | 仅当产品已信任该项目时只读叠加 |

从已有工具一次性接入、两套应用继续分立，这一类产品动作成立。扩展在 piwin 里是跟随磁盘，不是拷进自己的扩展树；主题和快捷键不接，因为产品不是 Pi 终端。

---

## 5. 三种机制，不要合成一种「同步」

用户说的「单向同步」在实现上必须拆开。混成一种拷贝或一种共用，都会错。

```text
┌─────────────────────────────────────────────────────────────┐
│ 1. 内核（Pi 引擎，Host 持有一份运行时）                        │
│    登录 / 刷新 token / 在线模型目录 / 真正发请求               │
│    文件：{PIWIN_ROOT}/pi-agent/auth.json + models-store.json  │
└─────────────────────────────────────────────────────────────┘
          ▲ 一次性接入凭证
          │
┌─────────┴───────────────────────────────────────────────────┐
│ 用户的 Pi CLI 家目录  ~/.pi/agent                            │
│    只读。产品不写回去。                                       │
└─────────┬───────────────────────────────────────────────────┘
          │ 只读叠加包 / 技能 / 提示词 / 可用扩展
          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. 清单叠加（已有 ADR 0060 的路）                              │
│    列表和 Blueprint 每次重读磁盘，source = pi-native          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ 3. 偏好与自定义通道：一次性导入进 config.json                   │
│    默认模型、思考强度、压缩开关、models.json → 通道            │
└─────────────────────────────────────────────────────────────┘
```

**为什么凭证要拷贝、包却不拷贝**

- 凭证是有副作用的：刷新、登出会改文件。两个进程指同一份，一边登出另一边立刻坏。test-host 清 `~/.piwin-test` 也清不掉。所以文件归 Host，CLI 那份只在接入时抄缺的 key。
- 包是清单。用户在 CLI 里 `pi update`，实体仍在 `~/.pi/agent/npm`。产品每次列目录时重读，自然跟上。拷进 revisions 反而和 CLI 脱节，也违反 ADR 0060。

**为什么在线目录也不抄 CLI 的 `models-store.json`**

Pi 的新模型不是靠升整包才出现的。`ModelRuntime` 会向 `https://pi.dev/api/models/providers/{id}` 拉 overlay，缓存在 `models-store.json`。CLI 启动会后台刷，`/model` 再刷，`pi update --models` 强制刷。这和 `auth.json` 在哪无关。

产品要新模型名单，应当让 **Host 自己的** ModelRuntime 去刷，写到 `{PIWIN_ROOT}/pi-agent/models-store.json`。去读 CLI 那份缓存，等于绑死用户 Pi 的版本和刷盘时机；CLI 较新时写进去的字段，打包的 0.84.x 也不一定能用。

今天订阅 runtime 创建时带了 `allowModelNetwork: false` 和 `refreshOnCreate: false`，所以名单被钉在包内置表上。这是产品没把内核用全，不是「必须把 OAuth 放回 `~/.pi/agent`」。

---

## 6. 套餐身份（内核）

### 6.1 决定

- 登录、登出、token 刷新继续走 Pi `ModelRuntime`。不自研 PKCE，不把套餐 token 塞进通道 `apiKeyRef`。
- 运行时文件在 `{PIWIN_ROOT}/pi-agent/auth.json`。默认不 symlink、不运行时指向 `~/.pi/agent/auth.json`。
- 进阶选项「链接到 Pi CLI 凭证」可以后做，必须写明两边会抢 refresh token；test-host 永远不允许。

### 6.2 套餐是 Pi 配置的一部分

套餐账号（`auth.json`）和自定义通道、偏好、扩展一样，走 §10 那一颗「接入本机 Pi 配置」。不要单独偷偷拷、也不要另做一颗「只接入账号」当主路径。

点接入时，若 Host 还没有对应 provider：把 `~/.pi/agent/auth.json` 里缺的项拷进 `{PIWIN_ROOT}/pi-agent/auth.json`（`0600`），再 `ensureLoggedInProviders()`。已有的不覆盖。test-host / 非默认根不读。登出只改 Host 这份。

实现上文件仍归 Host，不和 CLI 共用活文件。这是落盘，不是另一套产品流程。

### 6.3 在线目录

Host 的会话 ModelRuntime 与订阅 ModelRuntime：

- 启动后对已登录的套餐 provider 做一次 `refresh({ allowNetwork: true })`（超时、可取消，失败则用缓存 / 内置表）。
- 列表、默认模型、发消息，都从**同一份** runtime 读。看见的就能发。
- 新模型只要仍走已有协议（例如 Codex 的 `openai-codex-responses`），不必为了名单去升整包。
- 协议变了（新的登录方式、新的请求字段）再升 `@earendil-works/pi-ai` 与 `pi-coding-agent`，两者一起升。

### 6.4 和 `config.json` 的关系

套餐那一行仍是产品里的可操作行（开关、默认、显示名）。它不是目录权威。权威是 runtime 刷新后的名单；`config.json` 只留用户偏好。幽灵行（目录里已经没有的模型）在刷新后应退出选择器，但不要在用户没确认时删掉用户关掉的项。

---

## 7. 自定义模型（`models.json`）

Pi 允许用户在 `~/.pi/agent/models.json` 里加 Ollama、vLLM、自建兼容端。这是「我在 Pi 里配过的通道」，不是套餐目录。

**建议：导入成产品通道，不要运行时去读那份活文件。**

原因：

- 产品通道的权威是 `config.json`。再挂一份 Pi 文件，选择器和权限会有两套名单。
- `models.json` 的 `apiKey` 支持 `!command` 和 `$ENV`。产品密钥走 keychain / `apiKeyRef`，不能把 shell 展开原样执行进 Host。
- 导入时：能识别的 `api` 映射到产品协议；字面量 key 进密钥存储；`!command` 标成「需在产品里重填密钥」，不要执行。
- 与现有通道 id 冲突：不覆盖，列入预览，由用户勾选改名或跳过。

不把 `modelsPath` 指到用户的 `models.json` 来「复用」。那会让 Host 会话加载用户文件里的任意 header 和命令。

---

## 8. 偏好（`settings.json` 的非包部分）

Pi 的 `settings.json` 大半是终端：主题、快捷键、编辑器、TUI 模式、markdown 渲染。这些丢弃。

只导入对得上产品语义的字段，写入 `config.json`（或产品设置里已有的对应项），只填空，不覆盖用户已经在产品里改过的值：

| 接入 | 不接入 |
|------|--------|
| `defaultProvider` / `defaultModel`（若接入后该模型仍可用） | `theme`、`tuiMode`、快捷键、编辑器 |
| `defaultThinkingLevel`、`modelThinkingLevels` | `hideThinkingBlock` 等纯 TUI 显示 |
| `compaction.enabled` | `packages`（走叠加，不是导入） |
| `enabledModels`（映射为产品里的启用集，需能对上 runtime） | `sessionDir`、`trackingId`、telemetry |
| `retry` 里与 Host 请求超时对应的项（若产品已有配置位） | `doubleEscapeAction`、`treeFilterMode` |

压缩的 token 预算、branch summary 等，第一期可以只接开关，避免和产品自己的压缩策略打架。

---

## 9. 包、技能、提示词、扩展（清单叠加）

这一层 **ADR 0060 已经指定，代码也已接上**：`loadDiscoveredResources` 先扫 `~/.piwin`，再只读 `~/.pi/agent` 的 `packages[]` / 松散目录。`pi install` 只改 `~/.pi`；产品列表重读就能看见；刷新带当前会话则 `extensions/apply`。产品自己的安装仍只写 `~/.piwin`。

清单跟随**已经在发生**，不等接入按钮。本方案要补的是：兼容分类、test-host 默认不跟随，以及接入预览里能关掉不兼容项。不要改口成「点按钮之后扩展才出现」——那和 ADR 0060、现有 `loadDiscoveredResources` 相反。

### 9.1 扩展兼容

Pi 扩展文档把能力写成两类：Agent 运行时（工具、事件、`confirm/select/input/notify`、命令）和终端（`ctx.ui.custom()`、自定义渲染、主题、快捷键、编辑器、`/reload`）。产品已经声明后一类不支持。

接入时必须**先分类再进 Blueprint**，不能静默加载后在会话里炸：

- 静态扫描入口源码（禁止执行模块）。已有 `detectExtensionHookEvents`。再扫 `ctx.ui.custom`、`registerTheme`、`keybinding`、`reload` 等终端 API。
- **可用：** 仅工具 / 钩子 / 基础 UI。默认启用（与 ADR 0060 的 pi-native 默认开一致），用户可关。
- **降级：** 混用了终端 API。列表可见，标注「仅 Pi 终端」，默认不装进 Blueprint。
- **未知 / 版本不匹配：** 入口依赖了打包 Pi 没有的 API。列表可见，默认关，失败信息可读。
- npm 包继续从 `~/.pi/agent/npm` 解析路径，不拷进 revisions。执行仍由打包的 Pi 在会话里 load。版本不够就标不兼容，不要为了「看起来装上了」去跑。

### 9.2 技能与提示词

技能是 Markdown，跨运行时兼容性好，叠加即可。提示词同样。主题继续忽略。项目级 `.pi/` 仅在产品已信任该项目时读取（与 ADR 0016 一致）。

### 9.3 和 test-host

今天清单叠加无条件读 `~/.pi/agent`。test-host 虽然不再继承套餐凭证，仍会看见生产环境的 Pi 包。隔离规则应与凭证对齐：

- 默认产品根：叠加 Host 机器上的 `~/.pi/agent`。
- 非默认 `PIWIN_ROOT`：默认不叠加，除非显式打开「在此 Host 跟随本机 Pi」。

---

## 10. 第一次启动：一颗推荐按钮，写入完整份可写入的 Pi 配置（含套餐）

Pi 配置包括套餐。主操作仍是一颗按钮「接入本机 Pi 配置」。点一下处理**会改 Host 落盘的部分**：套餐凭证、`models.json` 通道、可移植偏好。扩展 / 技能 / 提示词是只读跟随，预览里能看见、能关掉，不是点按钮才第一次扫到。

**不要启动后静默改 `config.json` 或静默拷 `auth.json`。** 检测到本机 Pi 就摊开这颗按钮。套餐和通道、偏好走同一次确认，不拆成启动时偷偷拷账号。

（今天 Host 启动仍会一次性拷空的 `auth.json`。按钮落地后应改成只在这次接入里拷，避免和「先确认再写」打架。）

### 10.1 检测

Host 启动时看这台机器是否存在可用的 Pi 家目录（`~/.pi/agent` 或 `PI_CODING_AGENT_DIR`）。有 `auth.json`、`settings.json`、`models.json`、`packages[]` 或松散扩展/技能任一即可视为「检测到」，于是展示推荐按钮。test-host / 非默认 `PIWIN_ROOT` 不展示。

### 10.2 点按钮之后：预览再写入

一张清单，按类勾选：

- 套餐账号（Host 还没有的 provider）
- 自定义通道（来自 `models.json`，标出缺密钥的）
- 偏好（默认模型、思考强度、压缩）
- 包与扩展（可用 / 仅终端 / 未知 分列）
- 技能、提示词（只读叠加，开关表示「在产品里启用」）

默认勾选：套餐账号、可用扩展、技能、提示词、能对上的默认模型。默认不勾：仅终端的扩展、`!command` 密钥的通道。

### 10.3 接入是一次动作

用户确认后：拷缺的套餐凭证、导入通道和偏好、清单叠加按现有路径生效。写一份接入记录（时间、来源路径、勾选项、打包 Pi 版本），便于以后「再接入」时做差量。

### 10.4 之后

- **刷新清单：** 重读 `~/.pi/agent` 的包/技能/扩展（ADR 0060 的刷新）。不自动改 `config.json`。
- **再次接入：** 同一颗按钮，打开差量预览。
- 不在后台持续同步。用户在 CLI 里的新动作，要进产品，需再点接入或刷新清单。

设置页保留同一入口，文案与首次卡片一致。扩展页的刷新仍只负责清单 + 应用到当前 Agent。

---

## 11. Host-first 与两份 Pi

| 场景 | 扫哪里 | 跑哪份 Pi |
|------|--------|-----------|
| 本机 Desktop + 本机 Host | Host 机器的 `~/.pi/agent` | 应用打包的 Pi |
| test-host | 默认不扫、不拷凭证 | 打包的 Pi，`PIWIN_ROOT=~/.piwin-test` |
| 远程 Host | **Host 那台机器**的 `~/.pi/agent` | Host 进程里的打包 Pi |
| 笔记本有 Pi、Host 在另一台机器 | 第一期不自动扫笔记本 | 需要二期「导出工作环境包」 |

远程那条必须说清楚：接进来的是服务器上的 Pi，不是你笔记本上的 Pi。否则用户会以为「我在电脑上登过 Codex，连远程 Host 就应该有」。

两份运行时的版本差是常态。界面应能看到：产品打包的 Pi 版本、检测到的 CLI 版本（能读到才显示）、在线目录的最低版本要求。CLI 更新、产品没更新时，新扩展可能不可用，这是预期，不是故障。

---

## 12. 和现有实现的关系

已经有、应保留：

- `{PIWIN_ROOT}/pi-agent/auth.json`（文件归 Host）
- 套餐登录走 `ModelRuntime`
- `loadPiNativeInventory` / `loadDiscoveredResources` 只读跟随包、技能、提示词、扩展
- 扩展产品化：安装 ≠ 执行、应用到当前 Agent、TUI 不支持的文档

按钮落地后应拿掉：启动时无确认的 `importLegacyPiSubscriptionAuthIfNeeded`。

缺的是把它收成一件产品，并补这些洞：

1. Host 打开在线模型目录刷新；选择器和发消息用同一份 runtime 名单
2. 首次检测 + 预览 + 接入（套餐差量、`models.json`、可移植偏好）
3. 扩展兼容分类，仅终端的不进 Blueprint
4. 非默认 `PIWIN_ROOT` 不跟随生产 `~/.pi/agent`
5. 接入记录、打包版本展示
6. `models.json` 的 `!command` 密钥不执行
7. `SYSTEM.md` 今日已随 `allowPiNativeInstructions` 进会话；要与「不默认吞系统提示」对齐，或明确它属于跟随而不是接入写入

---

## 13. 分阶段

**第一期（闭环）** — 已落地：

- 在线目录：订阅 runtime `refreshOnCreate: true` + 已登录 provider 一次 `refresh({ allowNetwork: true })`（约 8s，失败不崩）；会话 runtime 仍 `allowNetwork: false`
- 接入：`pi-environment/detect|preview|apply`；缺的套餐 oauth key 合并进 Host `auth.json`；无启动静默拷贝
- 扩展兼容标签；仅 `compatible` 默认进 Blueprint
- test-host / 非默认 `PIWIN_ROOT` 不叠加生产 `~/.pi/agent` 清单，也不接入凭证

**第二期**

- `models.json` → 产品通道（含密钥策略）
- 偏好导入（默认模型、思考强度、压缩开关）
- 设置页「再次接入」差量

**第三期**

- 显式「链接 Pi CLI 凭证」（可关，test-host 禁用）
- 跨机器导出 / 导入工作环境包
- 压缩预算等更细的偏好

---

## 14. 验收

1. 仅有 CLI、从未用过产品：首次打开能预览到账号和已装包；确认后能用套餐模型发一条消息。
2. 同一台机器上 CLI 再 `pi install` 一个技能：产品里点刷新清单能看见；不点则不必自动出现。
3. 仅终端的扩展出现在列表且标明不可用，当前 Agent 不加载它。
4. 清空 `~/.piwin-test` 后起 test-host：没有生产套餐，也没有生产 Pi 包。
5. 远程 Host：只出现 Host 机器 `~/.pi/agent` 里的内容。
6. 产品在设置里改默认模型、关掉某个 pi-native 扩展：不会改 `~/.pi/agent/settings.json`。
7. Codex 在线目录已有、打包 Pi 尚未内置的型号：刷新后能选、能发（协议未变的前提下）。
8. `models.json` 里带 `!command` 的通道：预览可见，接入后等待用户在产品里填密钥，Host 不执行该命令。

---

## 15. 文档与 ADR

落地时同一变更里改：

- ADR 0002：保持「文件归 Host」；补「工作环境接入是单向的，清单叠加 ≠ 凭证共用」
- ADR 0060：收进本能力；补兼容分类与 test-host 默认不叠加
- 套餐 OAuth spec：在线目录由 Host runtime 刷新，不依赖 CLI 的 `models-store.json`
- 架构文档 §5：三块目录（`~/.piwin`、`{PIWIN_ROOT}/pi-agent`、`~/.pi/agent`）和各自职责
- 扩展指南：接入时如何标注「仅 Pi 终端」

---

## 16. 来源（方案所依据的事实）

- Pi 家目录、settings、packages、models.json、extensions：`packages/coding-agent/docs/{settings,packages,models,extensions,skills,environment-variables}.md`（earendil-works/pi）
- 在线目录：`withRemoteCatalog` → `https://pi.dev/api/models/providers/{id}`；`pi update --models`；交互模式启动后台 refresh
- 产品根与凭证：ADR 0002 修订、`import-legacy-pi-auth.ts`、`resolvePiRuntimeAgentDir`
- 清单叠加：ADR 0060、`loadPiNativeInventory`、`loadDiscoveredResources`
- 扩展边界：ADR 0010 / 0047、`docs/guides/pi-extensions.md`
- 同类产品：从已有工具一次性接入、两套应用继续分立

---

## 17. 可行性核对（2026-09-11）

**方向正确，能做。** 不要把 OAuth 钉回 `~/.pi/agent` 活文件，也不要把「接入工作环境」收成只同步模型名单。

必须先认的事实：

1. **跟随和接入不是一回事。** 扩展 / 技能 / 提示词今天已经经 `loadDiscoveredResources` 只读并进 catalog 和 Blueprint，默认启用 `pi-native`。`pi install` 之后重读就能看见。接入按钮管的是会改 Host 文件的部分：套餐 `auth.json` 拷贝、`models.json` → 通道、偏好 → `config.json`。预览可以列出已跟随的扩展并允许关掉，但不能假装点按钮才第一次发现它们。
2. **启动时静默拷凭证和「点按钮才接入套餐」冲突。** `importLegacyPiSubscriptionAuthIfNeeded` 在 Host 初始化就会跑。按钮落地后应改为接入动作里拷，test-host 继续跳过。
3. **`SYSTEM.md` 已经进会话。** `contextPolicy.allowPiNativeInstructions` 为 true 时会发现 `~/.pi/agent/SYSTEM.md`。稿子里「默认忽略」与现状不符，要二选一。
4. **在线目录不依赖这份接入。** 订阅 runtime 现为 `allowModelNetwork: false` + `refreshOnCreate: false`；会话 runtime 的 `refresh({ allowNetwork: false })` 只吃 Host `pi-agent` 缓存。要新套餐型号，改的是 Host 自己的 refresh，不是去读 CLI 的 `models-store.json`。协议没变就能发；协议变了仍要升打包的 Pi。
5. **扩展兼容只能尽力。** 静态扫 `ctx.ui.custom` 会漏动态调用，也会误伤。加载失败应标不兼容并保住上一代 Agent，不能当成保证。用户 npm 包绑的是更新的 Pi API 时，打包 0.84.x 可能直接跑不起来。
6. **`models.json` 导入是最硬的一块。** 产品协议面比 Pi 窄；`!command` 密钥不能执行；Radius / 混合 api 不要装成普通通道。放第二期是对的。
7. **远程 Host 只扫 Host 那台机器的 `~/.pi/agent`。** 笔记本上的 Pi 不会过去。这不是实现漏了，是 Host-first。文案必须写明。
8. **test-host 今日仍跟随生产 `~/.pi/agent` 的包。** 凭证已经隔离，清单没有。要干净，得关非默认根的跟随。

不采纳的方向：运行时 `authPath` 指回 `~/.pi/agent/auth.json`；把 Pi 包拷进 `~/.piwin/extensions/revisions`；后台 watch 用户 Pi 并改 `config.json`。

