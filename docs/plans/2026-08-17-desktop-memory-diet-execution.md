# Desktop Memory Diet — 可执行计划

- Status: S0–S8 landed 2026-08-17；S6 改为删除水墨实时 blur（高不透明实底，无预模糊贴图）；S9 不改阈值（无 release 全天样本）
- Owner: desktop
- Research: [`2026-08-17-desktop-memory-diet.md`](./2026-08-17-desktop-memory-diet.md)
- Already landed: [`2026-08-17-webcontent-memory-hard-cap.md`](./2026-08-17-webcontent-memory-hard-cap.md)（保险丝，保留为最后防线）
- Related: Plan A–D hardening、ADR 0052 media read、Windows 采样 TODO（**不并入本计划**）

## 怎么用这份文档

一条切片 = 一次 PR = 一次可回滚的行为变化。切片之间只允许在「依赖」栏标明的顺序上叠加。禁止把玻璃删除、契约变更、宠物窗口生命周期、终端上限混进同一个 PR。

开工前读：§0 约束、§1 已锁定决策、§2 切片图、对应该切片的 §3。合入后按 §4 测量协议记一笔数字，再开下一片。

---

## 0. 约束（违反即拒收）

1. **架构**：Desktop 不碰 Pi；跨边界字段先改 `@piwin/contracts`；`@piwin/media` 不引入 native 图像库（禁止 `sharp` / `libvips`）。预览缩放走 Desktop 已有的 Canvas / `createImageBitmap`。
2. **CLI 一致性**：CLI 不渲染 48px 缩略图。显示侧解码限制可以只做 Desktop；若 Host 持久化预览文件，CLI 只是多一个旁路文件，必须文档化「故意不消费」。
3. **远程安全**：`RemoteMediaAsset` 不得新增 Host 绝对路径。预览若跨远程，走现有 `media/read`（assetId），不发明 `previewPath`。
4. **视觉**：Noir / Paper / 橙白 三套扁平主题，删除玻璃后观感应与现在一致（纯色上的 blur 本就是空操作）。水墨主题里 **alpha < ~0.85 且背后是纹理/内容** 的实时 blur 留到 S6，P1 不得当空操作删掉（composer 金墨卡、用户横幅、file-tree 预览、call-chain 都是这一类）。P1 只删：非水墨纯色玻璃、水墨里已经 `blur: none` 的死规则、水墨里 ≥~0.92 不透明的填充。
5. **保险丝共存**：已上线的 `data-memory-pressure` 降级层继续工作。新属性（停车 `data-memory-parked`）必须 **OR** 进同一张降级表，卸载停车不得清掉压力档。
6. **文件体积**：`region-inspector.css` / `region-transcript.css` / `region-composer.css` 已远超 400 行预警。本计划只删规则、不往这些文件加新职责；新逻辑进独立小文件（`memory-parking.ts`、`media-preview-bitmap.ts` 等）。
7. **测试**：纯函数 / 策略 / CSS 边界必须有单测；视觉靠手动矩阵（§4.3），不写像素对比 e2e。
8. **测量口径**：产品结论以 **release 包** 为准。dev（HMR + StrictMode + debug）只作过程对照，禁止用 dev 数字验收 P1。

---

## 1. 已锁定决策（开工不再争论）

| # | 决策 | 理由 |
|---|---|---|
| D1 | 毛玻璃按白名单保留，白名单外一律删除 | 用户已拍板「砍」；27 处里 18 处视觉空操作 |
| D2 | 产品玻璃白名单 = 4 处瞬态/小面积 + 2 处 compact 打开态抽屉。水墨大面 **禁止** 实时 blur，改高不透明实底 | 4 处盖在动态内容上；水墨实时 blur 的 IOSurface 回收不回来 |
| D3 | compact 抽屉 **打开时** 允许侧栏/右栏保留 blur。右栏打开态选择器是 `.has-right-panel` + `:not(.is-collapsed)`，不是 `.nav-open` | `.nav-open` 只控制左抽屉 |
| D4 | compact 抽屉 **关闭时** 禁止 `will-change: transform` | 关掉后仍钉一张整列图层，纯浪费 |
| D5 | 宠物先救不杀：idle 停 rAF → 气泡去玻璃 → 隐藏销毁窗口 | 用户允许牺牲，但 25 MB + 三个坏习惯可修 |
| D6 | 媒体预览 **先做显示侧限解码，不改契约** | 不引入 sharp；旧资源立刻受益；远程路径安全 |
| D7 | Host 持久化 `.preview.webp` 列为可选后续（S3b），P1 不做 | 需要契约 + 全实现者同步；显示侧已能止血 |
| D8 | 停车模式在玻璃大砍之后做 | 否则停车只是把贵图层拆了再建，收益被玻璃成本淹没 |
| D9 | 水墨预模糊贴图（原 W1-B）独立切片，且必须四主题目检通过才合 | 唯一有视觉风险的替代，不和无损删除绑在一起 |
| D10 | 保险丝阈值（768/1536 MiB）本计划不改，S9 用 release 数据再评估 | 先减制造，再决定要不要把保险丝拧紧 |
| D11 | Windows 压力采样、原生 CALayer 宠物重写、下架宠物 **均不在本计划** | 已有独立 TODO / 仅作失败兜底 |

---

## 2. 切片图与批次

```text
S0 测量脚本（无产品行为）
 ├─ S1 玻璃白名单 + 无损删除          ┐
 ├─ S2 删除零引用静态资源              ├ P1  零/极低视觉风险，最大收益
 └─ S3a 显示侧缩略图解码               ┘
      │
      ├─ S4 停车模式                   ┐
      └─ S5 宠物三修（可与 S4 并行）    ├ P2  无感回收 + 宠物
      │
      ├─ S6 水墨预模糊替代（唯一有损替代）┐
      ├─ S7 Artifact 接 governor        ├ P3  质感 / 韧性
      └─ S8 终端会话上限                ┘
           │
           └─ S9 保险丝阈值评估（可能空操作）
```

S3b（Host 预览文件）仅在 S3a 合入后、重图会话仍把 WebKit malloc 顶上去时才开。默认不开。

建议合入顺序：S0 → S1 → S2（可与 S1 同周不同 PR）→ S3a → **release 复测门** → S4 ∥ S5 → S6 → S7 ∥ S8 → S9。

---

## 3. 切片说明书

每张卡片格式固定：**目标 / 不做 / 依赖 / 改哪些文件 / 测试 / 手动验收 / 风险与回滚 / 完成定义**。

### S0 — 测量协议落地（无 UI 变化）

**目标**：任何人按同一套命令能拿到「主 WebContent footprint + graphics / WebKit malloc 拆分」，避免再用错 PID。

**不做**：不改运行时、不改阈值、不打补丁到产品代码。

**依赖**：无。

**改哪些文件**：
- 新增 `docs/notes/desktop-webview-memory-measure.md`（命令、如何认主窗口 vs 宠物 vs 别人家的 WebContent）
- 可选：`scripts/desktop-webview-footprint.sh`（列出带窗口标题/父进程线索的 WebContent + `footprint` 摘要）。脚本必须失败时打印「认不出主窗口」而不是把系统里最大的 WebContent 当成 piwin。

**测试**：脚本在本机跑通一次，把输出贴进 note。无单测。

**手动验收**：
```bash
# release 包启动 10 分钟、空闲、Noir 主题、无附件、宠物关闭
# 记录：pid、Footprint 总计、graphics 行、WebKit malloc 行
```

**风险与回滚**：零产品风险。脚本认错 PID 会污染后续结论 → 完成定义里强制「宠物窗关着时只应看到一个 piwin WebContent」。

**完成定义**：note 里有一份 **release** 冷启动 10 分钟基线表（允许写「本次尚未打 release，用 debug 包注明」——但 P1 合入门仍要求 release）。

---

### S1 — 玻璃白名单 + 无损删除（P1 主切片）

**目标**：产品 CSS 里 `backdrop-filter` 只允许出现在白名单选择器上；其余删除。compact 抽屉打开时侧栏/右栏可保留 blur。水墨主题里已经写了 `backdrop-filter: none` 的规则一并删掉（死代码）。

**不做**：不引入预模糊贴图；不改保险丝；不重排 region CSS 文件。宠物气泡 blur 在本切片删（97% 不透明，空操作）；S5.2 只改脉冲动画。

**依赖**：S0 最好先有基线，不硬阻塞。

**改哪些文件**（仅删/收窄声明）：

| 文件 | 动作 |
|---|---|
| `region-sidebar.css` | 删 `.sidebar` 常态 blur；compact **打开**（`.nav-open`）才 blur；删关闭态 `will-change: transform`，改为仅过渡期间或去掉 |
| `region-inspector.css` | 删 `.right-panel` 常态 blur；compact 打开态才 blur；删水墨里已经 none 的重复规则。**水墨半透明预览面留给 S6**（见过渡允许列表） |
| `region-knowledge.css` | 删 `.knowledge-master-sidebar` blur |
| `region-doccards.css` | 删 `.doc-cards-capability-strip` blur |
| `region-composer.css` | 删非水墨 popover / at-menu / drop-overlay 的 blur；水墨 interruption / slash-menu（0.92–0.95）可删。**留下** `.composer-card-v2` blur(24) 和 thinking-effort-popover 水墨 blur(28) 给 S6 |
| `region-settings-shell.css` | 只留 feedback toast；水墨列表卡片 0.75 半透明 → **留下给 S6** |
| `region-settings-knowledge.css` | 水墨 metric/tab 半透明 → **留下给 S6** |
| `region-transcript.css` | **留下** 水墨 `.bubble.role-user`（0.72+blur24）和 `.activity-call-chain`（0.28+blur20）。**保留** `.collapsible-content-toggle` |
| `region-shell.css` | 删死规则 `.stage-titlebar` |
| `ui-foundations.css` | **保留** `.media-lightbox-close` |
| `settings-resources.css` | **保留** `.provider-editor-overlay` |
| `pet-bubble.css` | 删 blur（97% 白底） |
| `renderer-resource-boundaries.test.ts` | 升级为「全 src 扫描 backdrop-filter，命中必须在白名单 ∪ S1 过渡允许列表」 |

白名单（测试硬编码，改白名单必须改测试）：

```
.provider-editor-overlay
.settings-feedback-host .ui-notice
.collapsible-content-toggle
.media-lightbox-close
.app-shell[data-layout='compact'].nav-open > .sidebar
.app-shell[data-layout='compact'].has-right-panel > .right-panel.outward-column:not(.is-collapsed)
```

S1 合入时水墨半透明大面仍带 blur，测试必须另设 **S1 过渡允许列表**（S6 完成后清空），否则测试会逼着把金墨卡删掉。允许列表至少包括：

```
html[data-theme-visual-style='ink-wash'] .composer-card-v2
html[data-theme-visual-style='ink-wash'] .ui-popover-content.thinking-effort-popover
html[data-theme-visual-style='ink-wash'] .bubble.role-user
html[data-theme-visual-style='ink-wash'] .activity-call-chain
html[data-theme-visual-style='ink-wash'] .file-tree-preview
html[data-theme-visual-style='ink-wash'] .file-tree-header
html[data-theme-visual-style='ink-wash'] .file-tree-preview-header
html[data-theme-visual-style='ink-wash'] .doc-preview-header
html[data-theme-visual-style='ink-wash'] .doc-sidebar
html[data-theme-visual-style='ink-wash'] .enhanced-markdown-root
html[data-theme-visual-style='ink-wash'] .code-preview-view
html[data-theme-visual-style='ink-wash'] .doc-preview-state
html[data-theme-visual-style='ink-wash'] .capability-row
html[data-theme-visual-style='ink-wash'] .web-source-card
html[data-theme-visual-style='ink-wash'] .ext-list-item
html[data-theme-visual-style='ink-wash'] .mcp-server-card
html[data-theme-visual-style='ink-wash'] .model-card
html[data-theme-visual-style='ink-wash'] .model-dir
html[data-theme-visual-style='ink-wash'] .permission-mode-pills
html[data-theme-visual-style='ink-wash'] .knowledge-workspace-metric
html[data-theme-visual-style='ink-wash'] .knowledge-tab-panel
```

`memory-degradation.css` 的 `none !important` **不算产品玻璃**。扫描只读 CSS 声明，忽略注释、忽略值为 `none` 的规则。

**测试**：
- 扩展 `renderer-resource-boundaries.test.ts`：遍历 `apps/desktop/src/**/*.css`，每个含非 `none` blur 的选择器必须 ⊆ 白名单 ∪ S1 过渡允许列表。
- 现有「stage 无 blur」断言保留。
- `history-ticks-drawer.test.tsx` 里关于 containing block 的注释：行为应不变或更好（少一个 containing block）。若测试失败按新几何修断言，不要为了过测试把玻璃加回去。

**手动验收（四主题 × 两布局）**：

| 场景 | 期望 |
|---|---|
| Noir / Paper / 橙白，desktop 布局 | 侧栏、右栏、composer、气泡与现在无法区分 |
| 同上，compact，抽屉关闭 | 无玻璃；侧栏在屏外；CPU/图层不因 will-change 常驻 |
| compact，抽屉打开 | 侧栏盖在对话上，允许磨砂；关掉后立刻恢复 |
| 水墨 | 金墨 composer / 用户横幅 / 文件树预览 / call-chain **看起来应与现在一致**（P1 不删它们的 blur）。只允许「本来就是实心/近实心」的表面少一层空 blur |
| 打开 provider 编辑器 / 设置 toast / 折叠块 / 灯箱关闭钮 | 这四处仍有玻璃 |

**风险与回滚**：
- compact 选择器写错 → 抽屉打开变成实心板。回滚该文件即可。
- 水墨某卡片其实没那么不透明 → 目检打回，把该选择器移入 S6 清单，不在 S1 里发明新效果。
- `region-*.css` 超大，diff 必须只碰 blur/`will-change` 行，禁止顺手格式化。

**完成定义**：过渡允许列表测试绿；四主题目检记录（谁检的、主题、布局）。graphics 下降作为过程对照，**不**把 release 10 分钟包作为 S1 合入硬门（打包链太重）；P1 批次「完成」才要求一份 release 样本。

---

### S2 — 删除零引用静态资源

**目标**：包体 −~5.9 MB；减少误加载面。

**不做**：不转码仍在使用的 v2 PNG（那是 S6/S6.1）；不改 CSS url。

**依赖**：无，可与 S1 并行。

**改哪些文件**：删除且确认 `rg` 零引用：
- `public/ui/ink-wash/lion-seal.png`
- `public/ui/ink-wash/lion-seal.jpg`
- `public/ui/ink-wash/inkstone-brush.png`
- `public/ui/ink-wash/inkstone-brush.jpg`
- `public/ui/ink-wash/card-paper-bg.jpg`

**测试**：`rg 'lion-seal\.(png|jpg)|inkstone-brush\.(png|jpg)|card-paper-bg'` 在 `apps/desktop` 为 0。可写成小静态断言或放进 S1 的 boundaries 测试。

**风险**：CSS fallback `url('/ui/ink-wash/master-bg.jpg')` 仍在用，**不要删** `master-bg.jpg` / `hero.jpg`。

**完成定义**：死文件不在树里；水墨主题空会话页背景仍在。

---

### S3a — 显示侧限解码（P1，无契约）

**目标**：48px / 120px 的 `<img>` 不再把原图像素解进内存。灯箱继续用原图。

**不做**：不改 `SavedMediaAsset`；不加 `sharp`；不改模型侧 `ImageContent`（模型仍吃原图/已有 2048 边压缩）；不对视频做海报帧。

**依赖**：无。建议 S1 之后单独 PR，方便看 malloc 变化归因。

**改哪些文件**：
- 新增 `apps/desktop/src/media-preview-bitmap.ts`（纯函数：File/Blob → 受限尺寸 blob URL；失败回退原 URL）
- `hooks/use-composer-media.ts`：芯片预览改走受限 bitmap，revoke 旧 object URL 的路径保持
- `MediaPreview.tsx`：无 `previewUrl` 时（transcript / 文档面板）对 `convertFileSrc` 的 **asset: 原图** 也要限边解码，不能只处理 composer 的 File blob。lightbox 仍用原 URL
- 可选：`<img decoding="async">`（微优化，不替代限解码）

实现要点：
- 优先 `createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: 'low' })` → canvas → `toBlob('image/webp')` 或 jpeg。happy-dom 没有真实解码器：单测 mock `createImageBitmap` / canvas，断言调用了限边参数，不要测「输出 blob 的解码宽高」。
- transcript 的 `asset:` URL：先 `fetch` 成 blob 再走同一函数；失败回退原 URL。
- 目标边长：芯片 96、transcript 256（2× Retina 足够）。
- GIF：只取第一帧（bitmap 默认如此）；动图芯片静止可接受，灯箱仍是原文件。
- 失败（CORS、解码抛错）：回退原 URL，打 `console.warn`，不堵发送。
- **必须 revoke** bitmap blob URL，避免反向泄漏。
- 虚拟化卸载时走现有 unmount；确认 effect cleanup 里 revoke。

**测试**：
- `media-preview-bitmap.test.ts`：给定 800×600 的纯色 PNG fixture，输出 blob 的 decode 尺寸 ≤ 目标边；失败路径返回原 blob。
- composer / MediaPreview 现有测试补：芯片不把 `createObjectURL(file)` 直接赋给 48px img（可用源码断言或 hook 单测）。

**手动验收**：粘贴一张 ≥4K 截图，芯片出现期间 Activity Monitor / `footprint` 的 WebKit malloc **不应**跳十几 MB；点开灯箱允许跳上去，关掉灯箱后应回落（允许有缓存延迟）。

**风险与回滚**：
- WebKit `createImageBitmap` 选项兼容：用特性检测，不支持则 canvas drawImage 缩放。
- 远程 `media/read` 回来的是原图 bytes：S3a 在 Desktop 显示时照样缩放，远程安全。
- 回滚：还原三处调用，新文件删除。

**完成定义**：重图粘贴不再按原图像素常驻芯片；灯箱清晰度不变；`pnpm --filter @piwin/desktop test` 绿。

---

### S3b — Host 持久化预览（可选，默认不开）

仅当 S3a + S1 之后，**同一会话滚动时 malloc 仍随每张图线性涨**（说明每次挂载都重新解原图，显示侧缓存不够）才开。

**若开**：
- `SavedMediaAsset` 增加可选 `previewAssetId?: string`（**不是**绝对路径）。
- `SaveMediaInput` 增加可选 `previewBytes?: Uint8Array` + `previewMimeType`。Desktop 在 `media/save` 前用 S3a 同一函数产出预览 bytes，Host 写 `<id>.preview.webp`。
- `RemoteMediaAsset` 只加 `hasPreview?: boolean`；远端用 `media/read` + 约定后缀或独立 read 变体。禁止把路径送过网。
- 旧资产无预览：显示侧继续 S3a。
- 实现者：`packages/media`、`catalog-commands`、host-server 测试、host-runtime 测试全部更新（AGENTS.md §3.5）。
- CLI：不消费预览，在 `docs/guides` 或本计划注明故意降级。

**不做**：不在 `@piwin/media` 里解码图片。

---

### S4 — 停车模式（P2）

**目标**：窗口被系统标为 `document.visibilityState === 'hidden'` 满 2 分钟后，无感拆掉剩余玻璃/纹理并 `purge_webview_memory`；回到可见的同一帧恢复。用户看不到降级画面。

**不做**：不在前台降级（那是保险丝的事）；不把宠物「隐藏」当成 visibility hidden（宠物窗口自己的 visibility 在 S5 处理）。

**依赖**：S1。S1 之后停车拆的图层少，恢复也便宜。

**改哪些文件**：
- 新增 `apps/desktop/src/memory-parking.ts`（之前讨论稿的语义：定时器、`data-memory-parked`、uninstall/reset 供测试）
- `main.tsx`：`installMemoryParking()` 一次
- `styles/memory-degradation.css`：**已经有一份抢跑的 `data-memory-parked` 规则，而且会卸水墨纹理**（`memory-parking.ts` 已撤，属死 CSS）。S4 必须改成「只拆 blur、不卸 `--ink-wash-*`」，不要把现有规则当正确实现抄进去。
- `memory-pressure.ts`：`requestNativeWebviewMemoryPurge` 若仍是私有，抽成模块内导出或小 `webview-memory-purge.ts`，供停车与压力共用。禁止循环 import。
- 保险丝升级仍走 purge；停车也走 purge。允许连续两次，API 幂等。

交互规则：
- 停车 **不得** `globalMemoryGovernor.reset()`。
- 可见时只删 `data-memory-parked`，保留 `data-memory-pressure`。
- `PARK_AFTER_HIDDEN_MS = 120_000`。cmd-tab 来回不触发。
- 显式 `{ level }` 与停车独立。

**测试**：`memory-parking.test.ts`（happy-dom）：
- hidden 1s 不停车；hidden 120s 打属性；visible 立刻去掉属性并清 timer。
- 压力档为 moderate 时停车再唤醒，`data-memory-pressure` 仍在。

**手动验收**：最小化 2 分钟，`footprint` graphics 下降；立刻还原窗口，第一帧有玻璃（白名单那四处）且无闪白。

**风险**：水墨纹理重解码可能百毫秒闪一下 → 停车只卸 blur、保留纹理（改 CSS：`data-memory-parked` 只拆 backdrop-filter，不卸 `--ink-wash-*`）。**默认采用这条更保守的规则**，写进实现。critical 保险丝仍可卸纹理。

**完成定义**：单测绿；最小化回收可复现；唤醒无闪白。

---

### S5 — 宠物三修（P2，可与 S4 并行）

分三个 **commit**（仍一个 PR 可接受，但必须分 commit；若 hide=destroy 不稳就拆第二个 PR）。

**S5.1 Idle 停 rAF**（必做）
- `PetSprite.tsx`：宠物窗口置顶且全工作区可见时，`visibilityState` **几乎总是 visible**。停 rAF 的主条件是 `state === 'idle'` 且无 hover / 无气泡，不要把 hidden 当主路径。窗口真正 hide 时再 cancel 作为附加。
- 随机 waving/jumping：从每帧 `Math.random` 改为 `setTimeout` 单次唤醒，结束回到静态。
- 测试：用假 rAF 计数，idle 1s 内帧数 = 0（允许进入 idle 的最后一帧）。

**S5.2 气泡去玻璃**（必做）
- `pet-bubble.css`：删 `backdrop-filter`；脉冲动画改 `opacity`/`transform`，禁止无限 `box-shadow`。
- 白名单测试会扫到这个文件——S1 若先合，宠物 blur 必须在 S1 就删或把 `pet-bubble` 临时列入白名单并在本切片移除。**推荐 S1 直接删 pet-bubble blur**（97% 不透明，属无损），S5.2 只改脉冲动画。若采用此推荐，S1 文件表补一行 `pet-bubble.css`。

**S5.3 隐藏即销毁**（建议做，可降级）
- 先持久化位置：`localStorage`（与现有 `piwin.desktop.petOverlayVisible` 并列），show 时 `setPosition`。
- `pet_overlay_hide`：`close()` 掉 `"pet-overlay"` 窗口，不要 `hide()`。
- `pet_overlay_show`：已有「不存在则 create」路径，走它。
- `lib.rs` 里 Move/Focus 重打 always-on-top：窗口不存在时必须 no-op。
- 风险：重建 ~百毫秒；WebContent 进程应消失（`footprint` 只剩主窗口）。若 create 失败，设置里的开关要反映实际状态，不能显示「开着」却没有窗。
- 若 S5.3 回归成本高：**允许本 PR 只做 5.1+5.2**，5.3 单独 PR。隐藏成本保留 25 MB，但 churn 已停。
- **2026-08-17 落地**：`pet_overlay_hide` → `close()`；位置进 `piwin.desktop.petOverlayPosition`；启动不预创建，主窗 `installPetOverlayRestore()` 仅在偏好可见时建窗；`CloseRequested` 对 `"pet-overlay"` 提前返回，避免关宠物把 Host 一起拆了。create 失败时偏好回写 false。

**不做**：原生 CALayer 重写；不把主包打进宠物入口。

**完成定义**：宠物设置关闭后无第二 WebContent；idle 时 rAF 停；气泡无 blur。

---

### S6 — 水墨预模糊替代（P3，唯一视觉敏感切片）

**目标**：S1 之后若水墨仍有「看起来缺一层雾」的投诉，用**一张预模糊纹理**代替实时 blur。不是加回 `backdrop-filter`。

**不做**：不在 Noir/Paper/橙白上做任何事。

**依赖**：S1、S2。先目检 S1 后的水墨。**若过渡允许列表上的表面目检已经可接受，本切片取消并清空允许列表（删除那些 blur，或接受现状不再替代）。** 不允许列表无限期留着。

若仍要做：
- 构建期用 `sips` 或已有 Node 工具从 `hero.jpg` / `conversation-texture.jpg` 生成 `hero-blur.jpg`（半径与现 blur px 对齐：8–24）。
- CSS：`html[data-theme-visual-style='ink-wash']` 下相关表面 `background-image: var(--ink-wash-*-blur)`，**禁止**再写 `backdrop-filter`。
- 仍在用的 `lion-seal-v2.png` / `inkstone-brush-v2.png` 按显示尺寸降采样为 WebP（解码 6.3 MB → 按显示宽高 ×4）。这是资源优化，可与预模糊同 PR 或下一个小 PR。

**测试**：白名单测试继续为 0 新增 blur。资源引用测试：v2 PNG 要么还在要么 CSS 已改 WebP。

**手动验收**：水墨对话区、composer、用户气泡、文件树预览与 S1 前并排截图对比，雾感等效、文字不发糊。

**完成定义**：水墨通过目检 **或** 本切片标明 cancelled。

**2026-08-17 改判删除**：用户否决实时 blur（IOSurface 大、回收差）。不垫预模糊图。相关表面去掉 `backdrop-filter`，把底色 alpha 提到 ~0.88–0.96，金墨描边/阴影留下。允许列表清空。

---

### S7 — Artifact 接上 governor（P3）

**目标**：`critical` 时驱逐非 `forceKeep` 的 live iframe，兑现 governor 注释。`forceKeep`（canvas / 流式预览）保留。

**依赖**：无。可与 S6/S8 并行。

**改哪些文件**：
- `packages/artifact` 增加 `evictNonForceKeepArtifactHosts(): number`（或同等具名函数），供 Desktop 调用。
- `apps/desktop`：`globalMemoryGovernor.subscribe` 一处（独立小模块 `artifact-memory-bridge.ts`，避免 ArtifactFrame 再膨胀）。
- 修正 `memory-governor.ts` 注释，去掉「aspirational」。

**测试**：registry 单测：3 个普通 + 1 个 forceKeep，critical 后只剩 forceKeep。Desktop 桥：setLevel('critical') 触发 evict。

**风险**：用户正在看的非 canvas artifact 变成「Load preview」——这是 critical 救生舱的可接受代价。moderate 不驱逐。

**完成定义**：critical 后 live count 下降；恢复 normal 不自动重开（避免抖动）；用户点 Load preview 仍可。

---

### S8 — 终端会话上限（P3）

**目标**：并发 PTY/xterm 有硬顶，避免「开 20 个 hidden 终端」。

**依赖**：无。产品数字建议 **4**（含当前）。超出时 `addSession` 返回 null + 现有 toast/notice 通道提示，不静默失败。

**改哪些文件**：`use-terminal-sessions.ts` 导出 `MAX_TERMINAL_SESSIONS = 4`；`use-terminal-sessions.test.tsx` 覆盖满员。`terminal-dock.tsx` 里 `onClick={() => addSession()}` 必须处理 `null`（现有 toast/notice），否则满员时按钮无反应。

**不做**：本切片不改「非激活 xterm 仍挂载」——那是更大重构（PTY 所有权上提）。只在完成定义里记录为已知债。若 S8 后仍有内存投诉，另开「仅挂载 active XtermSurface」切片。

**完成定义**：第 5 个会话加不进去；关掉一个后可以再加。

**已知债（本切片不改）**：非激活 xterm 仍挂载。若 S8 后仍有终端内存投诉，另开「仅挂载 active XtermSurface」切片。

---

### S9 — 保险丝阈值评估（可能空 PR）

**目标**：用 S1+S3a 之后的 **release 全天** 数据决定是否把 moderate 从 768 MiB 降到 640。默认 **不改**。

**依赖**：S1、S3a、至少一次 release 全天样本。

**完成定义**：在 diet 文档补一行实测；改或不改都要写理由。禁止无数据调阈值。

**2026-08-17**：无 release 全天样本。阈值保持 moderate **768 MiB** / critical **1536 MiB** / hysteresis 64 MiB。不改。

---

## 4. 跨切片协议

### 4.1 测量（每次合入后）

在 **同一台机器、同一个主题（Noir）、宠物关闭、无附件、桌面布局** 下：

| 样本 | 何时 | 记什么 |
|---|---|---|
| cold-10m | 启动后空闲 10 分钟 | footprint 总计、graphics、WebKit malloc |
| attach-1 | 粘贴一张 ≥4K 图，不点灯箱 | malloc 增量 |
| hide-2m | 最小化 2 分钟（S4 后） | graphics 是否下降 |
| pet-off | 关闭宠物（S5.3 后） | WebContent 进程数 = 1 |

认 PID：宠物关着时 piwin 只应有一个 WebContent。若看到两个，先查是不是别人的进程（重启 piwin 后仍在的那个不是我们的）。

### 4.2 验收目标（release）

| 指标 | 目标 | 未达标怎么办 |
|---|---|---|
| 空闲 10 分钟主 WebContent | 相对 **S0 同口径 release 基线** 下降；400 MB 是假设目标，S0 之前不得当硬门 | 先查是否还在跑 debug/HMR；再查是否误删水墨大面后又加回 |
| 空闲全天 | 不触发 moderate 保险丝 | 查怠速膨胀是否仍在；考虑 S4 是否已合 |
| 4K 图芯片 | malloc 增量 < 3 MB | 查是否走了 S3a |
| 宠物关闭 | 无第二 WebContent | S5.3 |

dev 对照目标（非正式）：全天 < 700 MB。超了先怀疑 HMR 堆积，不据此加玻璃。

### 4.3 视觉矩阵（S1 / S6 强制）

检的人在 PR 描述里打勾：

- [ ] Noir desktop
- [ ] Paper desktop
- [ ] 橙白 desktop
- [ ] 水墨 desktop
- [ ] compact 抽屉开/关（任一浅色 + Noir）
- [ ] provider 编辑器、设置 toast、折叠块、灯箱关闭钮仍有玻璃

### 4.4 与已上线保险丝的关系

| 机制 | 何时动手 | 用户是否看见 |
|---|---|---|
| S1 少制造 | 永远 | 否（空操作删除） |
| S3a 少解码 | 有图时 | 否 |
| S4 停车 | 离开 2 分钟 | 否 |
| S5 宠物 | idle/隐藏 | 否 |
| 保险丝 moderate | ≥768 MiB 且被看着 | 白名单玻璃暂时变哑光 |
| 保险丝 critical | ≥1536 MiB | 高亮纯文本 + 卸纹理 |

S1 成功后保险丝应接近零触发。不要为了「更积极」在 S1 前把阈值拧紧。

### 4.5 平台

| 平台 | 本计划 |
|---|---|
| macOS | 主战场；`footprint` 验收 |
| Linux | CSS/TS 行为相同；无 IOSurface 数字，用 RSS 对照 |
| Windows | 显示侧/CSS 同样生效；进程采样仍是独立 TODO，不阻塞 |

---

## 5. 风险总表

| 风险 | 切片 | 缓解 |
|---|---|---|
| compact 抽屉变成实心 | S1 | 打开态选择器单测 + 目检 |
| 水墨雾感变弱 | S1 | 高不透明卡片接受；真缺雾走 S6，不加回实时 blur |
| bitmap API 失败 | S3a | 回退原图，不能堵发送 |
| 停车唤醒闪白 | S4 | parked 只拆 blur 不卸纹理 |
| 宠物 close 后建不回来 | S5.3 | 可降级只做 5.1+5.2；create 失败时开关回写 false |
| 契约漏改实现者 | S3b | 默认不开；若开则 typecheck 全绿才合 |
| 大 CSS 文件无关 diff | 全部 | 只改目标声明 |
| 用 dev 数字验收 | S0/S9 | 完成定义强制 release 口径 |

---

## 6. 明确不包含

- 迁移 Chromium / 改 WKWebView 私有 GPU 预算
- Host 会话冷存储、语法高亮 LRU（Plan A–D 已做）
- Windows `memory_pressure` 采样（已有 `2026-08-16-memory-pressure-windows-sampling-todo.md`）
- 原生宠物重写、下架宠物
- 给 `@piwin/media` 加 sharp
- 调保险丝阈值（除非 S9 有数据）
- 终端「仅挂载 active xterm」重构

---

## 7. 建议的第一句开工指令

> 开 S0 + S1。S1 按「过渡允许列表」留水墨半透明大面；把 `pet-bubble.css` 的 blur 删掉。S2 可同周第二 PR。S3a 等 S1 目检过后再开。

S0 不改产品代码，可与 S1 同一天做，但仍分开 commit。

---

## 8. Review log（2026-08-17）

对照 CSS 实值审过一版。已吸收进上文的阻断项：

1. §0.4 / D2 / S1 曾把水墨金墨卡、用户横幅、call-chain（alpha 0.28–0.72）写成「空操作可删」——删了会穿帮。现改为 S1 过渡允许列表，S6 再替代。
2. compact 右栏不是 `.nav-open`，是 `.has-right-panel` + `:not(.is-collapsed)`。
3. `memory-degradation.css` 已有停车选择器且会卸纹理，与 S4 保守策略相反，属抢跑死代码。
4. S1「不改宠物 CSS」与 §7「S1 删 pet-bubble」矛盾 → 锁定 S1 删 blur。
5. 宠物 `visibilityState === hidden` 在置顶窗上几乎不发生 → S5.1 以 idle 为主条件。
6. S3a 必须覆盖 transcript 的 `asset:` 原图，不只 composer File。
7. 400 MB / release-10min 不得当 S1 合入硬门。
8. 白名单扫描必须忽略 `none` 和注释。
9. S8 必须改 `terminal-dock` 的 `addSession()` 空值。

未改计划、实施时仍要小心：

- `region-inspector.css` 已 4000+ 行，S1/S6 只删声明，禁止顺手拆文件（拆文件是另一个 PR）。
- 保险丝已上线，dev 实例可能已经在 moderate 降级，目检前确认 `document.documentElement.dataset.memoryPressure`。
- `createImageBitmap` 的 resize 选项在 WKWebView 上要特性检测（计划已有 canvas 回退）。
