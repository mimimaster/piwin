# 右侧栏浏览器工作台：保真度与可用方案

| 字段 | 值 |
|---|---|
| 状态 | F + C 已落地（2026-09-09）；T 仍待 IPC 证据 |
| 表面 | Desktop 右侧栏 Browser 面板 + Host 自有 Playwright Chromium |
| 问题 | 面板是 1×、JPEG 55 的镜像，Retina / 全宽下看起来像低像素预览 |
| 权威 | 本文。落地后同步 ADR 0020 / 0057 与 `docs/architecture.md` §8 |

关联：[ADR 0020](../adr/0020-browser-session.md)、[ADR 0057](../adr/0057-browser-takeover-workbench.md)、[CDP 完善计划](../plans/2026-09-07-browser-cdp-completeness.md)、[右侧栏全宽](./2026-09-08-right-panel-full-width.md)。

---

## 1. 产品一句话

右侧栏 Browser 是 **同一份 Host Chromium** 的工作台：用户看见的就是 agent 在开的那页，可以接管点击/输入。它必须在 Retina 上看起来像可用的桌面网页，而不是一张被拉满的压缩预览。

它 **不是** Cursor/Codex 那种嵌进 IDE 的真浏览器窗口。macOS/Linux 上 Tauri WebView 没有 CDP，做不到。继续走 Playwright `page.screencast` JPEG + 指针转发。

## 2. 目标与非目标

### 2.1 做好的标准

用户在 14/16 寸 Retina、分栏或全宽右侧栏里打开本机 `localhost` 页面时：

1. **字和 UI 边可读**，和旁边 Inkstone chrome 的对比不再是「糊图 vs 矢量」。
2. **点哪里是哪里**：坐标仍是 CSS 视口 px，和 snapshot `[box=…]`、pick 同一空间。
3. **页面布局稳定**：默认仍是桌面 1280×800 CSS，不随窄面板挤成手机站。
4. **agent 与人仍是同一份文档**：cookie、登录态、URL 一致。
5. 现有接管锁、pick、IME、console/network 抽屉、权限门禁行为不变。

### 2.2 明确不做

| 不做 | 原因 |
|---|---|
| 再加一层 CDP / raw CDP / 任意 `evaluate` 工具 | 已经在用 CDP（`page.screencast` = `Page.startScreencast`）。多一层不解糊，也不变成真窗口 |
| 用 CDP 驱动 Tauri WebView | macOS/Linux 无 CDP（ADR 0020） |
| 代理 iframe / URL 改写 | 第二份文档，CSP / cookie 和 agent 分叉（ADR 0057） |
| 把用户日常 Chrome 当主面板 | `connectOverCDP` 已是可选 attach；日常 autoConnect 仍是实验，不是清晰度方案 |
| 默认把 CSS 视口跟面板走 | 窄 inspector 会把站点打成响应式手机布局 |
| 本轮上二进制 WebSocket / WebRTC | 保真度先用现有 `browser/frame`；IPC 顶不住再拆通道 |
| PNG 100 / 无损直播 | Playwright `onFrame` 是 JPEG；无损帧打爆 IPC 且 CDP 不 ack 就停流 |
| 点选按 `img.naturalWidth` | JPEG 位图可以小于 CSS 视口，会点偏 |

## 3. 现状（代码事实）

```text
Host Chromium (DSF 默认 1, CSS 1280×800)
    → page.screencast JPEG quality 55, size 1280×1280
    → browser/frame data-URL（width/height = CSS，不是 JPEG 像素）
    → 右侧栏 <img width/height 100% object-fit:contain>
```

Chromium `DetermineSnapshotSize` 的 scale **从 1 起只减不增**：

- 只加大 `size`、DSF 仍为 1 → JPEG 还是 1280×800，无新像素
- 只把 DSF 提到 2、`size` 仍 1280 → 合成表面 2560×1600 被压回 1×，更糊或白做
- **必须两件事一起做**

截图降级路径 JPEG 70，同样是 1×。全宽右侧栏把这张图再拉大，对比更明显。

Host 工具侧 tabs / back / forward / viewport 已经有；面板 URL 栏只有前往 + 重载，没有后退/前进/标签。

## 4. 架构（不变）

```text
apps/desktop BrowserSessionPanel
    ↕ HostCommand / HostPush（browser/frame 仍是 CSS 尺寸 + JPEG data-URL）
packages/host-runtime
    → @piwin/browser 单例 BrowserSession
        → 自有 persistent Chromium（默认）
        → 或 loopback connectOverCDP（可选，不断开用户浏览器）
```

- 一台 Host Chromium；agent 工具和面板镜像同一页。
- `web_fetch` 的 browser fallback 仍是另一台一次性 Chromium（ADR 0058）。
- 点击映射继续用 `browser-workbench-pointer.ts`：`viewportWidth/Height` 来自 frame 的 CSS，letterbox 不派发。

## 5. 分阶段

### F — 保真度（必须先做，解「像素低」）

**产品**：默认工作台在 Retina 上按 2× 栅格出帧。

| 项 | 现在 | 目标 |
|---|---|---|
| CSS 视口 | 1280×800，`maxDimension` 1280 | **不动** |
| Host 自有启动 | 未设 DSF → 1 | `deviceScaleFactor: 2` |
| screencast `size` | 复用 CSS 帽 1280×1280 | **独立**：`{ width: cssW×dsf, height: cssH×dsf }`，两轴都 ≥ 合成表面，最长边帽 **2560** |
| JPEG quality | 直播 55 / 截图降级 70 | **80**（Chrome CDP 默认带；DevTools / agent-browser 同档） |
| 直播 fps | screencast 内部 ~12，降级 ~4 | 不动 |
| `browser/frame` width/height | CSS | 不动 |
| `connectOverCDP` | 同样按 1280 出帧 | **不改**用户 Chrome 的 DSF；按 `window.devicePixelRatio`（下限 1，上限 2）算 size |

规则：

1. **拆两个帽**：`maxDimension` 只管 CSS 视口；出帧用 `css × deviceScaleFactor`，再和 2560 取 min。默认 1280×800×2 → size **2560×1600**（或等价的 2560×2560 方框，实际帧按宽高比缩小）。禁止写成 2560×800。
2. **视口变化必须停掉再 `screencast.start`**。Playwright 第一次 start 会锁帧尺寸。
3. **截图 fallback** `page.screenshot({ type:'jpeg', quality: 80 })`。DSF=2 后默认 `scale:'device'` 自动是 2×。
4. 面板继续 `<img object-fit:contain>`。2× JPEG 铺到 Retina 上即可；不改 canvas、不加 `image-rendering: pixelated`。

验收（F 出口）：

- 单元：launch 带 `deviceScaleFactor: 2`；`screencast.start` 的 `quality === 80` 且 size 两轴 ≥ 1600（默认视口下 ≥ 2560×1600）；viewport 变更触发 stop+start；CDP 启动路径不传 DSF。
- 指针测试不改期望（仍是 CSS）。
- 人工：14 寸 Retina 分栏 + 全宽，打开字号 14px 的 localhost 页，字可辨；点选仍准。
- headed / loopback CDP：用户 Chrome 不被改 DSF；帧按该页 DPR 出。

### C — 工作台 chrome（F 之后，不新增协议栈）

Host 已有能力，面板没露出来。这一阶段让右侧栏用起来像浏览器，而不是一张图加地址栏。

| 项 | 行为 |
|---|---|
| 后退 / 前进 | URL 栏两侧按钮，走现有 `browser/back` `browser/forward`（用户写，受接管锁） |
| 标签 | 现有 `listTabs` / `selectTab` / `newTab` / `closeTab` 做成顶栏 chips；popup 列出不自动抢焦点（已有契约） |
| 视口指示 | 显示当前 CSS 尺寸；默认固定 1280×800。mobile / custom / follow 仍是显式选项，不是保真度开关 |
| 对话框 | 已有 Host `handleDialog`；面板在 pending dialog 时给接受/取消，避免页面挂死 |

不做：完整 Chrome UI、扩展、独立 DevTools 窗口。console/network 抽屉保持折叠。

### T — 传输（仅当 F 把 IPC 打满）

2× q80 的 JPEG 走 `browser/frame` base64，体积大约是现在的 4–8 倍。ADR 0020/0057 已记下本地 HTTP/WebSocket。

触发再做：分栏 12 fps 下 HostPush 明显卡顿、掉帧、或挤掉别的 push。

做法：同一 JPEG 缓冲走 loopback 二进制 WS；HostPush 只带 CSS width/height + seq。面板 `<img>`/`blob:` 拉像素。权限仍是 Host 会话，不把帧打到公网。不做 VP8/WebRTC。

### 以后 / 逃生口

| 项 | 何时 |
|---|---|
| 「在窗口打开」headed Host Chromium | 用户明确要真窗口；`PiwinConfig.browser.headless=false` 已有。面板镜像仍在 |
| 日常 Chrome autoConnect | 仍是实验，不宣布可用 |
| 跟面板 DPR 动态设 DSF | v1 硬编码 2 足够 Mac 主桌面；Linux 1× 多送 2× 帧可接受 |

## 6. 配置

现有 `PiwinConfig.browser`：`headless`、`cdpEndpoint`。F **不强制**新用户配置。产品默认：

```text
deviceScaleFactor = 2          # 仅自有 launch
screencastQuality = 80
screencastMaxPx = 2560
viewport = 1280×800 CSS
```

需要可调时再加配置项，不要为本轮加 settings UI。

## 7. 文件与测试归属

| 改动 | 包 |
|---|---|
| launch `deviceScaleFactor`、screencast size/quality、viewport 变更重启镜像、截图 quality | `@piwin/browser` |
| 组合默认值（若要注入 DSF/quality） | `@piwin/host-runtime` `ensureBrowserSession` |
| 后退/前进/标签 UI | `apps/desktop` `browser-session-panel` |
| 契约 | F **不必**改 `browser/frame`。C 若面板需要 tab 列表 push，再扩 `browser/state` |
| 文档 | 落地后改 ADR 0020「Frame stream cost」、ADR 0057 quality 叙述、architecture §8 |

禁止：apps 引 Pi；给模型加 CDP 工具；把 CSS `maxDimension` 继续当 JPEG 帽。

## 8. 实施顺序

1. **F**（本方案的开工切片）— 解糊。独立可合并。
2. **C** — 面板 chrome，用已有 Host 命令。
3. **T** — 有卡顿证据再开。

F 不依赖 C。C 不依赖 T。不加 CDP 里程碑。

## 9. 风险

- **带宽**：2× q80 可能让 `browser/frame` 变重。先用现有 latest-only 投影顶住；顶不住才是 T。
- **Playwright 锁 size**：不重启 screencast 时，后面的 2560 请求会被忽略。F 必须测 viewport 变更。
- **CDP attach**：用户 Chrome 可能已是 2×；若仍按 1280 出帧会把 Retina 压扁。F 的 attach 路径按页 DPR 设 size。
- **headless 检测**：DSF=2 不改善 bot 检测；headed 仍是另一条逃生口。
