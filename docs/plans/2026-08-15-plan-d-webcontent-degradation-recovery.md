# Plan D: WebContent 降级与 Rust 原生恢复 (Plan D: WebContent Graceful Degradation & Native Recovery)

> **目标**：在极端系统内存压力或偶发 WebContent 异常时，提供 Tauri/Rust 原生层的进程生命周期监控、自适应降级以及会话无缝恢复，杜绝应用白屏或无响应。
> **优先级**：P3（第四执行批次，依赖 Plan A / B / C）

---

## 1. Tauri / Rust 原生层生命周期监控 (Native Bridge)

### 1.1 WebContent 异常终止与重载恢复
- **目标文件**: `apps/desktop/src-tauri/src/lib.rs`
- **实现机制**：
  - 监听 Tauri Webview 进程终止事件（`on_page_load` / WebContent crash callback）；
  - 当 WebContent 意外退出时，Rust 层捕获退出信号，触发安全重新加载（Reload）；
  - 向前端发出 `desktop://webcontent-restored` 事件，前端自动从 Host/SQLite 恢复当前活跃会话的最新状态。

---

## 2. 前端内存降级控制中心 (Memory Governor)

- **目标文件**: `apps/desktop/src/memory-governor.ts` (NEW)
- **多级安全降级阶梯**：
  ```
  Level 1: 停止排队中的非视口高亮 Worker 请求
     │
     ▼
  Level 2: 清空非活跃会话的 Token LRU 缓存与历史文件预览
     │
     ▼
  Level 3: 卸载当前视口外的一切 Artifact iframe 容器
     │
     ▼
  Level 4: 降级为 Plain-text Safe Mode（临时禁用 Shiki 高亮）
  ```
- **核心原则**：
  - 承认 JS 无法“强制 GC”，Governor 的唯一职责是**丢弃引用、卸载组件、销毁 DOM、清空缓存**。

---

## 3. Plan D 验证与验收准则 (Verification)

### 自动化与手动测试
1. **进程终止恢复测试**：
   - 在终端使用 `kill -9 <WebContent_PID>` 模拟渲染进程崩溃，验证 Desktop 是否在 1 秒内自动重载并无缝恢复当前会话与输入框草稿。
2. **高压降级测试**：
   - 触发 Level 4 降级，验证代码编辑器与 Markdown 是否平滑回退至纯文本模式，无白屏、无报错。
