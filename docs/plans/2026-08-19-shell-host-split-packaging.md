# 壳子 / Host 分开打包与连接收尾

| Field | Value |
|-------|-------|
| Status | Active — Phase A + packaging pins in progress on main |
| Date | 2026-08-19 |
| Related | ADR 0017, ADR 0036, [`host-server-multi-client.md`](../specs/host-server-multi-client.md), [`2026-08-17-product-wrap-up.md`](./2026-08-17-product-wrap-up.md), [`2026-08-17-mobile-cockpit-implementation.md`](./2026-08-17-mobile-cockpit-implementation.md) |

## 0. 一句话

日常仍是「一个 App 自带 Host」。另做两条可单独安装的线：**只装 Host**、**只装壳子**。壳子打开先连、先验，连不上就停在连接页，**绝不起第二份 Host**。

禁止 `git merge` `feat/standalone-host-multi-client-continuity` 和 `feat/browser-host-token-admission`。有用的连接/校验已经在当前 main；缺的是打包切线和打开流程。

## 1. 现在到底有什么

两套 Host 入口，别混：

| 入口 | 怎么说话 | 谁在用 | 占 8787？ |
|------|----------|--------|-----------|
| `piwin host serve`（打包进桌面 App） | 本机管道 | 打开桌面 App 默认起的那份 | 否 |
| `apps/host` | 网络口（默认 `ws://127.0.0.1:8787`） | 单独起的 Host；手机/壳子去连 | 是 |

壳子连「单独 Host」只走第二套。第一套是父子进程，壳子不连别人的管道。

当前 main 已经有、不要重做：

- 设置里填地址，连上后 **不再** 调 `host_start`（`App.createAppHostClient` + `transport: 'remote'`）。
- 连之前会试连一次，要 `host/status` 成功才保存。
- 握手：`client/hello` → 校验 → `host/hello`。三把钥匙只准带一把：门令 / 一次性配对码 / 已颁发的设备凭证。本机回环且 Host 没设门令时，可以不带钥匙。
- 远程发消息必须带「空闲才发 / 确认打断」。本机自带 Host 仍可省略。

缺的：

- 没存地址时，打开打包 App **仍会起本机 Host**。
- 没有「只打壳子」的安装包；`pnpm package:desktop` 把 Host 文件打进同一个 App。
- 没有「只打 Host」的安装包；`apps/host` 还是源码起。
- `apps/host` 现在也不传 worker 文件路径，单独起时子代理同样会缺文件。
- 桌面连远程只用门令，存在网页存储里；没有打开即连接墙。

## 2. 分支怎么用（移植，不 merge）

| 分支 | 拿走 | 丢掉 |
|------|------|------|
| `feat/standalone-host-multi-client-continuity` **已提交** | 已在 main：WebSocket 连接、前景准入、`projectId`。不要再 merge。 | 未提交的手机 Keychain / APNs / 大段 host-runtime 分叉 |
| 同上 **未提交 pairing** | 代码已在 main 的 `HostDevicePairing` + hello 三钥。桌面薄壳 **先不用配对当主路径**。 | 把桌面做成手机那套扫码设备凭证（可跟随后做） |
| `feat/browser-host-token-admission` | **连接墙**：没握手成功不进工作台。hello 带门令。 | 整棵 `apps/web`、同端口静态站、merge 该 worktree |

08-17 收尾里「Desktop v1 不做 pairing」仍然成立。这次收尾的校验 = **已有 hello**，不是新登录系统。

## 3. 目标形态

三种装法，同一套协议：

```text
① 一体 App（现在的 package:desktop）
   打开 → 起本机 Host → 壳子跟它说话
   给「不想管 Host」的人

② 只装 Host
   机器上常驻一份 apps/host（含 worker 文件）
   管 ~/.piwin、模型、子代理、会话

③ 只装壳子
   打开 → 连接墙 → 填本机或远程地址 → hello 通过才进工作台
   永远不在本机再起一份 Host
```

本机和远程对壳子是同一件事：地址不同。

- 本机：`ws://127.0.0.1:8787`
- 远程：Tailscale / 私有网 / 隧道后的 `ws://` 或 `wss://`

一体 App 里仍可「改连别的 Host」，但改连之后必须停掉自己起的那份（见 Phase A）。薄壳没有这份可停。

同一台机器、同一份 `~/.piwin`，永远只准一份 Host。后开的应失败，而不是再听一个端口。

## 4. 校验（不要另做登录）

单用户、自托管。没有账号、OAuth、多租户。

打开薄壳（以及一体 App 选「连接已有 Host」）的顺序：

1. 连接墙。不进聊天。
2. 填地址。非回环必须填门令（`PIWIN_HOST_TOKEN`）。回环且 Host 没设门令，允许空。
3. 建一条连接，发 `client/hello`（只带门令，或空）。
4. 收到 `host/hello`：协议版本对、`authenticated`、记下 `hostInstanceId`。
5. 再要一次 `host/status`。失败则清掉这次连接，留在墙上，说明原因。
6. 通过才保存目标、进工作台。之后重连用同一把门令。

规则：

- 门令是操作员设的共享密码，不是设备身份。桌面先走这条（跟现在设置页、浏览器门令同一条）。
- 手机继续走配对码 → 设备凭证。不要把门令写进手机钥匙串冒充设备。
- 三把钥匙不要混在一次 hello 里（main 已拒绝）。
- 连上后命令走这条已准入的连接。不要第二套 cookie / JWT。
- 忙着的 Host：远程发送先 `if-idle`，用户确认再打断。已有，保持。

设置页现有的试连可以复用，但要升成 **打开即可达的墙**，不能藏在设置里才第一次连。

## 5. 打包切线

### 5.1 一体 App（保留）

`pnpm package:desktop` 不动含义：壳 + Host 文件 + 自带 Node。打开默认起本机那份。

### 5.2 只装壳子（新）

新命令，例如 `pnpm package:desktop-shell`：

- 同一套 Desktop UI。
- **不**打进 `dist-host/`、**不**打进自带 Node。
- Rust 侧：没有 Host 文件时禁止 `host_start`；不是静默失败再重试。
- 启动永远走连接墙。

开发态：`pnpm dev:tauri` 仍可起本机 Host，方便日常。另加一种「薄壳开发」：不起本机进程，只连 `8787`。

### 5.3 只装 Host（新）

新命令，例如 `pnpm package:host`（或先文档化可运行目录，再做安装包）：

- 用现有 `pnpm bundle:host` 的 `host-serve` **不够**：那是管道入口，薄壳连不上。
- 要打的是 **`apps/host` + `dist-host/agent-worker.mjs` + 依赖 + 自带 Node**。
- 启动时把 worker 路径传给 `HostRuntime`（`agentWorkerScript`）。现在 `apps/host` 没传，必须补。
- 默认 `127.0.0.1:8787`。对外听必须设门令，或打开配对（main 已有这条守卫）。

## 6. 分期（按这个收尾，不要一次做完所有 Host 协议统一）

本切片 **不** 把一体 App 的管道改成 WebSocket。那是下一刀，能让「本机自带」和「单独 Host」变成同一种进程，但会碰 ADR 0006/0017，单独开 ADR。

### Phase A — 打开流程（先做，不依赖新安装包）

**状态（2026-08-19）：已在 main 落地。**

- `desktop-host-launch.ts`：启动方式 `sidecar` | `attach`
- `App` 门闸：未选 → 选择页；`attach` 无地址 → 连接墙（零次 `host_start`）；有地址或 sidecar → 工作台
- 设置 / 连接墙共用 `probeDesktopRemoteHost`
- Composer chip：「连接已有 Host」切到 attach 墙并停本机进程
- 打包钉：`bundle-host` Pi 0.84.2；`fetch-node-runtime` Node v22.19.0

完成：先手动起 `apps/host`，再开桌面选「连接已有 Host」，只有一份 Host，能聊天。

### Phase B — 只装壳子

**状态（2026-08-19）：已落地。** `pnpm package:desktop-shell`；`tauri.conf.json` 不含 Host 文件，一体包用 `tauri.conf.sidecar.json` overlay。薄壳 `VITE_PIWIN_SHELL_ONLY=1` + Cargo `shell-only`，`host_start` 直接拒绝。打开只有连接墙。

### Phase C — 只装 Host

**状态（2026-08-19）：已落地。** `pnpm package:host` → `dist/piwin-host/`（`host-listen.mjs` + `agent-worker.mjs` + `start-host.sh`）。`apps/host` 启动时传入 worker 路径。

### Phase D — 以后（本收尾不做）

- 一体 App 改为在本机拉起 **同一套** `apps/host`（回环 WebSocket），去掉管道。
- 桌面也用配对设备凭证，替代把门令存在网页存储。
- CLI 从进程内 Host 改成连同一地址。
- 公网、账号登录、Gateway 当执行权威。

## 7. 完成定义

1. 文档和命令分清三种装法；日常默认仍是一体 App。
2. 薄壳或「连接已有 Host」路径：**零次** `host_start`。
3. 校验只有 hello 三钥 + `host/status`；没有新账号体系。
4. 本机 `8787` 和远程地址走同一连接墙。
5. 只装 Host 时 worker 文件在包内并被传入运行时。
6. 相关测试：hello 失败留在墙；保存目标后重启不起第二份；一体 App 切远程会停本机进程。
7. `docs/release-desktop.md` 写清两条新打包命令。不 merge 那两个旧分支。

## 8. 明确不做

- merge 连续性和浏览器 token 两个 worktree
- 给壳子做用户登录
- 这一刀改掉一体 App 的管道协议
- 假装 `bundle:host` 的 `host-serve.mjs` 就是薄壳要连的那个 Host

## 9. 实现切法（对照当前 main / Pi 0.84.2）

Pi 已升到 `0.84.2`（`docs/notes/2026-08-19-pi-0.84.2-upgrade.md`）。**打开流程（Phase A）不碰 Pi。** 只装 Host / 一体包里的 Host 文件必须跟 0.84.2 对齐，否则打出来的还是旧内核。

### 9.1 打包里还停在旧派

| 位置 | 现在 | 要改成 |
|------|------|--------|
| `packages/agent-host/package.json` | `pi-coding-agent` / `pi-ai` **0.84.2** | 已对 |
| `scripts/bundle-host.mjs` `EXTERNAL_DEPS` | 仍钉 **0.80.10** | **0.84.2**（否则 `dist-host/node_modules` 是旧派） |
| `scripts/fetch-node-runtime.mjs` | Node **v22.14.0** | **≥22.19.0**（0.84 engines；升级笔记已记） |
| `bundle-host.mjs` esbuild `target` | `node20` | 可先不动；真正跑的是自带 Node，以 fetch 的版本为准 |
| `apps/host` | 不传 `agentWorkerScript` | Phase C 传入 `dist-host/agent-worker.mjs`（或包内同级路径） |

子代理缺 worker 文件，跟派版本无关。但 **Phase C 若仍按 0.80.10 去 npm install external，单独 Host 会带着旧派跑。** 这一刀应在第一次 `package:host` / 下一次 `package:desktop` 之前做完，可与 Phase A 并行，不要拖到 Phase C 才发现。

worker 入口仍是 `packages/agent-host/src/rpc-sdk-worker-entry.ts`。0.84 的事件差（`partial` 去掉等）已经在 agent-host 里接好，**不要**从旧 continuity 分支抄 worker。

### 9.2 Phase A — 文件级

现在的漏洞：没存远程地址时，`App` 建 live `HostClient` → `use-host-bootstrap` 里 `connect()` → `host_start`。设置里连远程之后 `dispose()` **已经会** `host_stop`。缺的是「还没选、还没连上」时根本不要 `connect()`。

新增（桌面，不进 contracts）：

- `desktop-host-launch.ts`：记住启动方式 `sidecar` | `attach`。跟现有 `remote-host-session.ts` 分开：地址是目标，这个是「要不要起本机进程」。
- `host-connect-wall.tsx`：从 `host-target-settings.tsx` 抽出试连（hello + `host/status`）。打开时和设置里共用。

改：

- `App.tsx` `createAppHostClient`：
  - `attach` 且已有地址 → 现在的 remote 客户端（不 `host_start`）
  - `sidecar` → 现在的 live 客户端
  - 未选，或 `attach` 但还没连上 → **不要** live 客户端；渲染连接墙，工作台不挂载（或挂着但所有 Host 请求禁用）
- `use-host-bootstrap.ts`：没有 live/remote 客户端时不要 `connect()`
- `runtime-target-chip.tsx`：能进「连接已有 Host」（开墙），不要只能在已连上时切回本机
- `host-client.test.ts` / 新测试：未选时零次 `host_start`；选 attach 失败仍零次；sidecar→attach 会 `host_stop`

一体 App 默认：第一次打开可以仍提示选择；若要少打扰，一体包默认 `sidecar`（保持现在），薄壳强制 `attach`。Phase A 在一体 App 上至少要：**一旦选了连接，重启也不会再起本机进程。**

### 9.3 Phase B / C — 打包，仍不改管道协议

- B：第二份 Tauri 配置，不拷 `dist-host`、不拷自带 Node。Rust `host_start` 在没有 Host 文件时直接报错，禁止 supervisor 重试。启动写死 `attach`。
- C：`bundle-host.mjs` 再打一个入口 `apps/host/src/index.ts` → `dist-host/host-listen.mjs`（名字可再定）。薄壳连这个，不连 `host-serve.mjs`。同一份 `agent-worker.mjs` + **0.84.2** 的 `node_modules`。

### 9.4 建议开工顺序

1. **打包对齐 0.84.2 + Node ≥22.19**（挡所有 Host 安装包，几行脚本）
2. **Phase A 打开流程**（桌面 TS/TSX，可测）
3. Phase B 薄壳包
4. Phase C 听端口的 Host 包 + `apps/host` 传入 worker 路径

打包薄壳连 `ws://` 必须走 Tauri 原生 WebSocket（`tauri-plugin-websocket`）。WKWebView 从 `https://tauri.localhost` 开 `ws://` 会直接扔 `The operation is insecure`，跟 Token 无关。
