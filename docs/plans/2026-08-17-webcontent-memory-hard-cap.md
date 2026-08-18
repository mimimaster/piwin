# WebContent 内存硬上限：让 Memory Governor 长出牙齿

- Status: Implemented (same-day)
- Owner: desktop
- Relates: `docs/plans/2026-08-15-desktop-rendering-memory-hardening.md` (Plan D)、
  `docs/notes/2026-08-08-desktop-webcontent-memory-incident.md`

## 问题

长时间运行后主窗口 WebContent footprint 稳定爬到 1.2–1.4 GB 且不回落。
2026-08-17 实测（dev 实例，`footprint <pid>`）：

| 分类 | 大小 | 说明 |
|---|---|---|
| Owned physical footprint (unmapped) (graphics) | 837 MB | backdrop-filter 等合成层产生的 IOSurface，WebKit 持有不还 |
| WebKit malloc (bmalloc) | 452 MB | 解码图片 / 样式 / dev 模块碎片等内部缓存 |
| JS JIT + heap | ~41 MB | 业务数据本身极小（Gigacage 6 MB）|

根因不是"毛玻璃本身贵"，而是**回收链路断裂**：

1. Plan D 的 Governor（`memory-governor.ts`）只在**整机**内存紧张时收到信号
   （Rust 侧 `memory_pressure.rs` 采样系统 reclaimable ratio）。大内存机器上
   永远不触发 → WebKit 永远没有释放动机。
2. `memory-pressure.ts` 里按**进程自身字节数**分级的
   `classifyMemoryPressure`（768 MiB / 1536 MiB 阈值）没有任何生产调用方，
   是死代码。
3. 即使触发降级，动作只清 Shiki 高亮缓存（几 MB），不碰真正大头
   （合成层显存、WebKit 内存缓存）。

## 方案：传感器（Rust）→ 策略（TS）→ 执行器（CSS + 原生 purge）

角色分离，策略只存在一处（已被单测覆盖的 `classifyMemoryPressure`）：

1. **传感器** `src-tauri/src/memory_pressure.rs`
   - 每 5 s 通过 WKWebView SPI `_webProcessIdentifier`（respondsToSelector
     守卫，SPI 消失则自动回退）拿到主窗口 WebContent pid，再用
     `proc_pid_rusage(RUSAGE_INFO_V4).ri_phys_footprint` 采样——
     与 Activity Monitor"内存"列同源，包含 compressed / unmapped IOSurface。
   - 每 tick 发 `desktop:memory-pressure { bytes, availableBytes }`。
     footprint 不可用时回退旧行为（系统 ratio 分级、变更才发送）。
   - 稳态不再静默：0.2 Hz 的样本流是策略在 JS 端做滞回判断的前提。
2. **策略** `apps/desktop/src/memory-pressure.ts`
   - `installMemoryPressureBridge()`（`main.tsx` 启动时安装）监听事件，
     `applyMemoryPressureSample` 分级驱动 Governor。阈值不变：
     ≥768 MiB → moderate，≥1536 MiB → critical，64 MiB 滞回。
   - 升级沿（normal→moderate/critical）额外调用 Tauri 命令
     `purge_webview_memory`。
   - **恢复驻留（防闪烁）**：字节滞回挡不住 footprint 在阈值附近徘徊时
     毛玻璃反复关开。升级后至少驻留
     `MEMORY_PRESSURE_RECOVERY_DWELL_MS`（3 min）才允许字节样本降级；
     升级永远即时；显式 `{ level }` 载荷（回退传感器 / 手动派发）绕过驻留。
3. **执行器**
   - `memory-governor.ts` 把等级写到 `<html data-memory-pressure>`；
     `styles/memory-degradation.css`（styles.css 最后一个 import）在
     moderate+ 用 `!important` 关闭全部 `backdrop-filter` —— 合成层被销毁后
     IOSurface 池数秒内老化归还系统；critical 再卸 ink-wash 装饰纹理。
   - Rust `purge_webview_memory`：对所有 webview 窗口执行公开 API
     `WKWebsiteDataStore removeDataOfTypes:[MemoryCache] modifiedSince:distantPast`，
     丢弃解码资源缓存（bmalloc 大头之一）。

预期稳态：footprint 在 768 MiB 附近锯齿自愈（升级→卸载→回落→恢复特效），
不再单调爬到 1.3 GB+。

## 非目标 / 后续

- pet-overlay 窗口不做 CSS 降级（原生 purge 已覆盖它）；
- ink-wash 素材降采样（1536×1024 PNG ≈ 6 MB 解码/张）另行评估；
- dev 实例（Vite HMR + StrictMode + debug build）基线天然偏高数百 MB，
  产品结论以 release 包为准。

## 验证

- 单测：`classifyMemoryPressure` 既有用例；新增 governor DOM 属性、
  事件桥分发、降级 CSS 静态断言、Rust footprint 自采样 sanity。
- 手动：Web Inspector 执行
  `window.dispatchEvent(new CustomEvent('desktop:memory-pressure', { detail: { bytes: 900 * 1024 * 1024 } }))`
  → 毛玻璃消失、`footprint` 观察 graphics 类目回落；`{ bytes: 0 }` 恢复。
