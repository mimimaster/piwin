# Desktop 内存瘦身总方案（Memory Diet）

- Status: Research complete — 执行切片见 [`2026-08-17-desktop-memory-diet-execution.md`](./2026-08-17-desktop-memory-diet-execution.md)
- Owner: desktop
- Relates: `docs/plans/2026-08-17-webcontent-memory-hard-cap.md`（保险丝，已上线）、
  `docs/plans/2026-08-15-desktop-rendering-memory-hardening.md`（Plan A–D）

## 0. 决策约束（用户已拍板）

1. 毛玻璃必砍——凡视觉无损处全部删除；有损处给替代或保留最小面积。
2. 宠物功能可以牺牲，但优先用低成本方案保住。
3. "内存是金子"：极低性价比的常驻开销一律清除。

## 1. 实测基线（2026-08-17 16:04，dev 实例，重启后 29 分钟）

| 进程 | Footprint | 备注 |
|---|---|---|
| 主窗口 WebContent | 441 MB | 重启后 3 分钟为 402 MB → **~1.5 MB/min 的怠速膨胀**（dev + HMR）|
| 宠物 WebContent | 25 MB | 隐藏状态，平稳 |
| native shell (debug) | 104 MB | release 会明显更小 |
| Host sidecar (tsx dev) | 212 MB | tsx 加载器虚高，release 另测 |

**勘误（记录在案）**：此前将系统里另一个 181 MB 的 WebContent（PID 96583）误判为
宠物窗。该进程在 piwin 重启后仍存活，归属其他 App。宠物窗实测 25 MB。
膨胀主嫌疑回到主窗口自身（玻璃图层 churn + WebKit 缓存 + dev 虚高）。

长时膨胀参照（旧实例，重启前）：footprint 1357 MB =
837 MB unmapped graphics + 452 MB WebKit malloc + ~41 MB JIT/JS。

## 2. 调查结论（四路审计，2026-08-17）

### 2.1 毛玻璃：27 处，18 处可无损删除

完整清单与逐条判决见审计表（摘要如下；file:line 以审计时为准）：

- **删除即赚（≈18 处）**：背后是纯色/≥92% 不透明填充，模糊纯色=纯色，视觉零差异。
  代表：`.sidebar`（region-sidebar.css:26，blur16，整列常驻！）、
  `.right-panel`（region-inspector.css:21，blur16，整列常驻！）、
  `.knowledge-master-sidebar`、`.doc-cards-capability-strip`、
  `.thinking-effort-popover`、`.at-menu`、`.composer-v2-drop-overlay`、
  `.agent-interruption`、`.slash-command-menu`、`.pet-bubble`（97% 不透明！）、
  死规则 `.stage-titlebar`（TSX 无此类，直接删）等。
  ⚠️ 例外情形：compact 布局下 sidebar/right-panel 变成**悬浮抽屉盖在内容上**，
  该状态下玻璃有真实效果 → 把 blur 收窄到
  `.app-shell[data-layout='compact']` 抽屉态选择器，常态删除。
  （旁证：水墨主题早已对两条大列 `backdrop-filter: none`，
  region-sidebar.css:1556 / region-inspector.css:3957——设计上已经验证过没玻璃也成立。）
- **静态替代（≈7 处，全部仅水墨主题生效）**：背后是静态纹理
  （--ink-wash-hero 等），用**预先模糊好的纹理变体**垫底替代实时 blur。
  代表：file-tree-preview / doc-sidebar / enhanced-markdown-root /
  activity-call-chain / composer-card-v2 / bubble.role-user / 设置页卡片组。
- **确需保留（4 处，全部小面积或瞬态）**：`.provider-editor-overlay`（模态期间）、
  `.settings-feedback-host .ui-notice`（toast）、`.collapsible-content-toggle`
  （折叠块小圆钮）、`.media-lightbox-close`（灯箱关闭钮）。
- 附带：`region-sidebar.css:91` 的 `will-change: transform`（compact 侧栏）
  永久钉一张整列图层 → 改为仅动画期间生效或移除；
  两处 `will-change: width` 仅 resizing 态，无害。
  mask-image 两处均为小折叠渐隐，成本可忽略，保留。

### 2.2 媒体预览：无缩略图，按原图解码（重大发现）

- `packages/media` 只存单文件，**从不生成缩略图**。
- Composer 附件条（48px 显示）：`URL.createObjectURL(原始 File)` ——
  **压缩前的原图**解码（5MP 截图 ≈ 20 MB 解码内存，只为一个 48px 方块）。
- 会话记录里的附件（120px）：asset 协议直读仓库原文件
  （发送时若走了压缩则 ≤2048px，一张仍 ~16 MB 解码）。
- 虚拟化会卸载远处消息（好），但可视窗 + overscan 6 条内的图全按原图挂着。
- 无 srcset / image-set / decoding 提示。

### 2.3 宠物窗：25 MB 隐藏成本 + 可见时的三个坏习惯

- 独立瘦入口（pet-overlay.html，~250 KB JS，非主包）——架构本身没问题。
- 坏习惯 1：`PetSprite` 的 **rAF 循环永不停**（PetSprite.tsx:135-216），
  idle 也每帧 clearRect+drawImage；窗口 always-on-top + 全工作区可见 →
  可见时 WebKit **永远不会节流它**。
- 坏习惯 2：气泡 `backdrop-filter: blur(14px)`（97% 不透明底，视觉无用）
  + **box-shadow 无限动画**（逐帧重绘的属性，pet-bubble.css:46-53）。
- 坏习惯 3：`hide()` 只隐藏不销毁，进程常驻；位置未持久化。
- Codex 皮肤 spritesheet 1536×1872 → 解码 ~11 MB 常驻。

### 2.4 终端与 Artifact：大体健康，两个小洞

- 终端：xterm **DOM 渲染器**（无 canvas/webgl 纹理负担）、滚回默认 1000 行有界、
  关闭时正确 dispose。洞：**会话数量无上限**，且非激活会话的 xterm 全量挂着
  （仅 hidden）。
- Artifact：沙箱 iframe，**硬上限 3 个活体**（live-host-registry），虚拟化会卸载。
  洞：governor 注释声称"critical 卸载后台 artifact"**实际未实现**
  （无人 subscribe）；活体 iframe 在 overscan 内仍跑脚本动画。

### 2.5 静态资源与动画

- `public/ui` 共 13 MB。**死文件 ≈5.9 MB**：lion-seal.png/.jpg、
  inkstone-brush.png/.jpg、card-paper-bg.jpg 零引用，直接删。
- 在用的 lion-seal-v2.png（1024×1536）/ inkstone-brush-v2.png（1536×1024）
  各 ~6.3 MB 解码，按显示尺寸降采样 + 转 WebP。
- CSS `animation: infinite` 共 ~34 处（活动指示器/呼吸灯类）：窗口可见时
  持续保热图层。停车模式（W6）+ 玻璃削减后影响自然下降，不单独动。

## 3. 工作流

### W1 玻璃大砍（性价比之王，先行）

1. Phase A（零视觉风险）：删除 18 处 delete-free 玻璃 + 死规则
   `.stage-titlebar` + `will-change: transform` 收窄；
   compact 抽屉态用 `[data-layout='compact']` 变体保留玻璃。
2. Phase B（仅水墨主题）：生成预模糊纹理变体（构建期 sips/sharp 产出
   `*-blur.jpg`），7 处 replace-with-static 改为垫图；对齐验证。
3. 保留 4 处小面积/瞬态玻璃不动。
4. 回归：`renderer-resource-boundaries.test.ts` 增加"玻璃白名单"断言
   （只允许白名单选择器出现 backdrop-filter）。
- 预期：图形类 footprint 稳态 −100~250 MB，churn 显著放缓；四主题逐一目检。

### W2 媒体缩略图（第二优先）

1. `@piwin/contracts`：`MediaAsset` 增加可选 `previewPath`（契约先行，§1.3）。
2. `packages/media` `saveMediaAsset`：保存时同步产出 ≤256px WebP 预览
   （sharp 或 canvas 编码，写在原文件旁 `<uuid>.preview.webp`）。
3. Desktop：composer 附件条改用 `createImageBitmap(file, { resizeWidth })`
   生成小位图 blob（不等 host 保存）；transcript 缩略图改指 previewPath，
   灯箱继续用原文件。
- 预期：每张可视图片 −16~50 MB 解码内存；重图会话收益最大。

### W3 宠物窗拯救（用户授权可杀，先救）

1. Idle 暂停：idle 且无气泡 → `cancelAnimationFrame`，画一帧静态；
   `pet-state-push` 非 idle / hover 时恢复。随机小动作改为定时唤醒一次。
2. 气泡去玻璃（97% 不透明底，删 blur 零差异）；box-shadow 脉冲动画改
   transform/opacity 实现。
3. 隐藏即销毁：`pet_overlay_hide` → `close()` 销毁窗口；先把位置持久化
   （localStorage/config），show 时重建并复位。冷启动 ~25 MB 起步而非常驻。
4. 停车模式 CSS（W6）覆盖 pet 窗口（其入口引入同一降级样式）。
- 兜底：若仍不满意 → 原生 CALayer 重写（port 面已评估：窗口属性、
  雪碧帧步进、拖拽/点击、气泡文本），或按用户授权直接下架。
- 预期：隐藏 −25 MB；可见时 churn 归零。

### W4 终端小修

会话数上限（4）+ 显式声明 scrollback（維持 1000）+ 文档化
"terminal tab 常驻挂载"的原因。低优先。

### W5 Artifact 接上 governor

critical 压力 → 强制回收非 `forceKeep` 活体 iframe（live-host-registry
已有回收原语，补 `globalMemoryGovernor.subscribe` 接线），
让 governor 注释里的承诺成真。小改动 + 单测。

### W6 停车模式（无感回收）

窗口 `visibilityState === 'hidden'`（最小化/被全遮/切桌面）持续 2 分钟 →
`<html data-memory-parked>`（复用降级样式表拆玻璃/纹理）+ 原生
`purge_webview_memory`；`visibilitychange` 回可见的同一帧内撤销，
用户永远看不到降级帧。此前已设计并预实现过一版（后按讨论撤回），
按该版恢复 + 补 CSS 选择器与测试。

### W7 静态资源清理

删 5 个零引用文件（−5.9 MB 包体）；v2 PNG 按显示尺寸降采样转 WebP；
W1 Phase B 的预模糊变体一并产出。

### W8 测量纪律（贯穿）

1. 先打 release 包跑一天取"诚实基线"（`pnpm package:desktop`），
   每个工作流合入后复测：`footprint <主WebContent pid>` 记录
   graphics / WebKit malloc 两类目。
2. 验收目标：release 全天稳态主 WebContent **< 400 MB**；
   dev 全天 < 700 MB（即基本不触发 moderate 保险丝）；
   保险丝触发次数 ≈ 0。
3. 保险丝阈值在 W1/W2 落地后可下调（768→640 MiB 候选），另行评估。

## 4. 执行顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| P1 | W1-A + W7 死文件 + W2 | 最大收益，零/极低视觉风险 |
| P2 | W6 + W3 | 无感回收 + 宠物治理 |
| P3 | W1-B + W5 + W4 + W7 降采样 | 水墨质感打磨 + 韧性补全 |
| 贯穿 | W8 | 每步用数字验收 |

## 5. 非目标

- 不迁移 Electron/Chromium；不 fork WebKit；不做 OS 级 sandbox 内存限额。
- 水墨主题的视觉品质不降级（Phase B 用预模糊变体等效替代，非删除）。
- 不动 Host 侧会话/冷存储机制（已有独立计划）。
