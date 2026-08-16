# 内存压力监测:Windows 平台接入 TODO

**日期:** 2026-08-16
**涉及代码:** `apps/desktop/src-tauri/src/memory_pressure.rs`、`apps/desktop/src/memory-governor.ts`
**状态:** macOS / Linux 已完成并验证;Windows 留空待接入(本文档)

---

## 1. 背景与现状

piwin 桌面端的 Memory Governor(前端分级降级:moderate 清高亮缓存,critical 关语法高亮/卸载 artifact)需要 OS 级内存压力信号驱动。WKWebView / WebView2 都不向前端暴露该信号,因此由 Rust 侧采样并通过 Tauri 事件 `desktop:memory-pressure` → JS 桥接(`memory-governor.ts` 末尾的 `bridgeTauriMemoryPressureEvents`)→ DOM CustomEvent → Governor。

已实现的部分:

- `memory_pressure.rs`:5 秒轮询,**仅在档位变化时** emit(平时静默);
- 阈值分档 `level_from_available_ratio`:`< 6% → critical`,`< 15% → moderate`,其余 normal(纯函数,有单测);
- macOS:`host_statistics64`(可回收页 = free + speculative + purgeable + inactive)+ `sysctl HW_MEMSIZE` 总内存;依赖 `libc`(仅挂 macOS target);
- Linux:`/proc/meminfo` 的 `MemAvailable / MemTotal`;
- 事件 payload:`{ "level": "normal" | "moderate" | "critical" }`。

**全部核心内存修复(流式累加器、composer LRU、job/run registry 驱逐等)都是跨平台 TS,Windows 上照常生效。平台相关的只有这个压力信号,属于安全网而非地基。**

## 2. 切换机制:`cfg(target_os)` 就是"按打包类型 switch"

不需要手写运行时 switch —— Cargo 按构建目标在**编译期**选择分支,构建哪种类型就编入哪种实现:

```text
cargo build / tauri build(在 Windows 上,或 --target x86_64-pc-windows-msvc)
  → 编入 #[cfg(target_os = "windows")] 分支
cargo build(macOS 主机,默认)
  → 编入 #[cfg(target_os = "macos")] 分支,libc 生效
```

当前 `memory_pressure.rs` 的三个分支:

| 分支 | 平台 | 行为 |
|---|---|---|
| `#[cfg(target_os = "macos")]` | macOS | `host_statistics64` 采样 |
| `#[cfg(target_os = "linux")]` | Linux | `/proc/meminfo` 采样 |
| `#[cfg(not(any(macos, linux)))]` | **Windows 及其它** | 返回 `None` → 监测线程启动即退出,Governor 恒为 `normal`,无报错无空转 |

依赖隔离:`libc` 在 `Cargo.toml` 的 `[target.'cfg(target_os = "macos")'.dependencies]` 下,Windows 构建不拉取。

## 3. TODO:Windows 接入清单

**时机:** 启动 Windows 打包支持时(`rustup target add x86_64-pc-windows-msvc` 之后,或在 Windows 机器上开发时)。

### 3.1 实现 `sample_available_ratio` 的 Windows 分支

在 `memory_pressure.rs` 添加(kernel32 直接 extern 声明,**零新依赖**):

```rust
#[cfg(target_os = "windows")]
fn sample_available_ratio() -> Option<f64> {
    #[repr(C)]
    #[allow(non_snake_case)]
    struct MemoryStatusEx {
        dwLength: u32,
        dwMemoryLoad: u32,
        ullTotalPhys: u64,
        ullAvailPhys: u64,
        ullTotalPageFile: u64,
        ullAvailPageFile: u64,
        ullTotalVirtual: u64,
        ullAvailVirtual: u64,
        ullAvailExtendedVirtual: u64,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(buffer: *mut MemoryStatusEx) -> i32;
    }
    let mut status = MemoryStatusEx {
        dwLength: std::mem::size_of::<MemoryStatusEx>() as u32,
        dwMemoryLoad: 0,
        ullTotalPhys: 0,
        ullAvailPhys: 0,
        ullTotalPageFile: 0,
        ullAvailPageFile: 0,
        ullTotalVirtual: 0,
        ullAvailVirtual: 0,
        ullAvailExtendedVirtual: 0,
    };
    if unsafe { GlobalMemoryStatusEx(&mut status) } == 0 || status.ullTotalPhys == 0 {
        return None;
    }
    Some(status.ullAvailPhys as f64 / status.ullTotalPhys as f64)
}
```

返回值直接喂给现有的 `level_from_available_ratio`,阈值 / 事件名 / JS 桥接 / Governor **全部复用,零改动**。

### 3.2 更新兜底分支与测试 cfg

- 把 `#[cfg(not(any(target_os = "macos", target_os = "linux")))]` 的 None 兜底改为 `not(any(macos, linux, windows))`;
- 给 `live_sample_is_a_sane_ratio` 测试的 cfg 加上 `target_os = "windows"`(该测试已断言采样比值在 0..=1,Windows 上直接复用)。

### 3.3 验证步骤

```bash
rustup target add x86_64-pc-windows-msvc
cd apps/desktop/src-tauri
cargo check --target x86_64-pc-windows-msvc   # 编译验证(无需 Windows 机器)
cargo test --lib --target x86_64-pc-windows-msvc
# 实机:tauri build 后在任务管理器压内存,确认 Governor 降级事件触发
```

**验收标准:** Windows 构建上 `desktop:memory-pressure` 事件随系统压力分档流动;macOS 构建行为不变(现有 19 个 Rust 测试保持绿)。

## 4. 备选方案(不推荐首选,但记录在案)

Windows 的 WebView2 是 Chromium 内核,JS 侧可读 `performance.memory`(`usedJSHeapSize / jsTotalHeapSize`)做纯前端兜底。缺点:只反映 webview 自身堆,看不到整机压力(Host 进程、worker 子进程吃紧时不会触发),且精确值需要 `--enable-precise-memory-info`。保持三平台统一走 Rust 侧采样,一个代码路径。
