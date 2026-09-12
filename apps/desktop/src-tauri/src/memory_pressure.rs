//! Memory sensor feeding the frontend Memory Governor.
//!
//! Role split (docs/plans/2026-08-17-webcontent-memory-hard-cap.md): this
//! module is a policy-free sensor. Every poll it samples the main window's
//! WebContent process footprint — the number Activity Monitor shows, charging
//! the renderer for compressed pages and owned-but-unmapped IOSurfaces — plus
//! the system reclaimable ratio, and emits a `desktop:memory-pressure` Tauri
//! event carrying `{ bytes, availableBytes }`. Classification, thresholds and
//! hysteresis live in the webview (apps/desktop/src/memory-pressure.ts) so
//! policy stays unit-tested in one place, which is why the steady state is no
//! longer silent for byte samples.
//!
//! When footprint sampling is unavailable (non-macOS, or the WKWebView
//! process-identifier SPI disappears) the module falls back to the legacy
//! change-driven `{ level }` emissions derived from the system ratio, so the
//! governor still hears about global pressure.

use serde::Serialize;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

/// Sampling cadence. The governor only switches degradation tiers, so a
/// multi-second granularity is sufficient and keeps the poll cost invisible.
const POLL_INTERVAL_MS: u64 = 5_000;

/// Latest sampled main-window WebContent pid, shared with
/// `relaunch_webview_renderer`. 0 = unknown. Written by the monitor thread
/// every poll tick, so a relaunched renderer is re-learned within seconds.
static MAIN_WEBVIEW_PID: AtomicI32 = AtomicI32::new(0);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryPressureLevel {
    Normal,
    Moderate,
    Critical,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryPressurePayload {
    /// Legacy fallback path only; byte samples leave classification to JS.
    #[serde(skip_serializing_if = "Option::is_none")]
    level: Option<MemoryPressureLevel>,
    /// Main-window WebContent `ri_phys_footprint`.
    #[serde(skip_serializing_if = "Option::is_none")]
    bytes: Option<u64>,
    /// System-wide reclaimable memory estimate.
    #[serde(skip_serializing_if = "Option::is_none")]
    available_bytes: Option<u64>,
}

/// Map the reclaimable-page ratio to a governor tier. Thresholds are coarse
/// by design: the governor's actions are cache evictions, not correctness.
fn level_from_available_ratio(ratio: f64) -> MemoryPressureLevel {
    if ratio < 0.06 {
        MemoryPressureLevel::Critical
    } else if ratio < 0.15 {
        MemoryPressureLevel::Moderate
    } else {
        MemoryPressureLevel::Normal
    }
}

pub fn spawn_memory_pressure_monitor(app_handle: tauri::AppHandle) {
    let webview_pid = Arc::new(AtomicI32::new(0));
    std::thread::spawn(move || {
        let mut last_fallback_level = MemoryPressureLevel::Normal;
        loop {
            // The refresh lands asynchronously on the main thread, so this
            // tick reads the pid captured by an earlier one — fine at this
            // cadence. Re-queried every tick because WebKit relaunches
            // WebContent (new pid) after a renderer termination.
            refresh_main_webview_pid(&app_handle, &webview_pid);

            let ratio = sample_available_ratio();
            let footprint = {
                let pid = webview_pid.load(Ordering::Relaxed);
                MAIN_WEBVIEW_PID.store(pid, Ordering::Relaxed);
                if pid > 0 {
                    process_phys_footprint_bytes(pid)
                } else {
                    None
                }
            };

            match footprint {
                Some(bytes) => {
                    let available_bytes = ratio.and_then(|value| {
                        total_physical_bytes().map(|total| (value * total as f64) as u64)
                    });
                    let _ = tauri::Emitter::emit(
                        &app_handle,
                        "desktop:memory-pressure",
                        MemoryPressurePayload {
                            level: None,
                            bytes: Some(bytes),
                            available_bytes,
                        },
                    );
                }
                None => match ratio {
                    Some(value) => {
                        let level = level_from_available_ratio(value);
                        if level != last_fallback_level {
                            last_fallback_level = level;
                            let _ = tauri::Emitter::emit(
                                &app_handle,
                                "desktop:memory-pressure",
                                MemoryPressurePayload {
                                    level: Some(level),
                                    bytes: None,
                                    available_bytes: None,
                                },
                            );
                        }
                    }
                    None => {
                        // Sampling unsupported on this platform; stop the
                        // thread instead of spinning. Governor stays `normal`.
                        return;
                    }
                },
            }
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
}

/// Drop WKWebView's in-memory resource cache (decoded images, scripts, style
/// data inside the WebContent process) for every webview window. Invoked by
/// the frontend on a degradation escalation edge, after the CSS strip has
/// already destroyed backdrop-filter compositor layers. Best-effort by
/// design: degradation must not depend on the purge succeeding.
#[tauri::command]
pub fn purge_webview_memory(app_handle: tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        for window in app_handle.webview_windows().into_values() {
            let _ = window.with_webview(|platform_webview| {
                // SAFETY: with_webview hands us the live WKWebView pointer on
                // the main thread; all calls below are public WebKit API.
                unsafe {
                    use objc2_foundation::{NSDate, NSSet};
                    use objc2_web_kit::{WKWebView, WKWebsiteDataTypeMemoryCache};
                    let webview = platform_webview.inner().cast::<WKWebView>();
                    let Some(webview) = webview.as_ref() else {
                        return;
                    };
                    let data_types = NSSet::from_slice(&[WKWebsiteDataTypeMemoryCache]);
                    let completion = block2::RcBlock::new(|| {});
                    webview
                        .configuration()
                        .websiteDataStore()
                        .removeDataOfTypes_modifiedSince_completionHandler(
                            &data_types,
                            &NSDate::distantPast(),
                            &completion,
                        );
                }
            });
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = app_handle;
}

/// Kill the main window's WebContent renderer so WebKit relaunches it fresh.
///
/// Forensics 2026-08-21: after sustained streaming/HMR repaint the renderer
/// pins 1 GB+ of IOSurface backing ("Owned physical footprint (unmapped)
/// (graphics)") that survives DOM teardown, simulated memory pressure, GC,
/// and full document navigation. Only renderer death releases it (measured
/// 1365 MB → 185 MB). WKWebView reloads the page on web-process termination
/// and the shell reconnects to the Host (ADR 0038: renderer death is a client
/// disconnect, not a Host restart). Frontend policy decides *when*
/// (renderer-self-heal.ts); this command is the mechanism only.
#[tauri::command]
pub fn relaunch_webview_renderer() -> bool {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = MAIN_WEBVIEW_PID.load(Ordering::Relaxed);
        return false;
    }
    #[cfg(target_os = "macos")]
    {
        let pid = MAIN_WEBVIEW_PID.load(Ordering::Relaxed);
        if pid <= 1 {
            return false;
        }
        if !is_webcontent_process(pid) {
            return false;
        }
        // Forget the pid so a second call cannot target a recycled pid before the
        // monitor re-samples the replacement renderer.
        MAIN_WEBVIEW_PID.store(0, Ordering::Relaxed);
        unsafe { libc::kill(pid, libc::SIGKILL) == 0 }
    }
}

/// A pid may be recycled between sampling and kill; only accept processes
/// whose executable path is WebKit's WebContent XPC service.
#[cfg(target_os = "macos")]
fn is_webcontent_process(pid: i32) -> bool {
    let mut buffer = [0u8; libc::PROC_PIDPATHINFO_MAXSIZE as usize];
    let written = unsafe {
        libc::proc_pidpath(
            pid,
            buffer.as_mut_ptr() as *mut libc::c_void,
            buffer.len() as u32,
        )
    };
    if written <= 0 {
        return false;
    }
    let path = String::from_utf8_lossy(&buffer[..written as usize]);
    path.contains("com.apple.WebKit.WebContent")
}

#[cfg(not(target_os = "macos"))]
fn is_webcontent_process(_pid: i32) -> bool {
    false
}

/// Store the main window's WebContent pid into `slot`, asynchronously on the
/// main thread. Uses the long-stable WebKit SPI `-[WKWebView
/// _webProcessIdentifier]` behind a respondsToSelector guard: if the SPI ever
/// disappears the slot stays 0 and the monitor falls back to system-ratio
/// sampling instead of breaking.
#[cfg(target_os = "macos")]
fn refresh_main_webview_pid(app_handle: &tauri::AppHandle, slot: &Arc<AtomicI32>) {
    use tauri::Manager;
    let Some(window) = app_handle.get_webview_window("main") else {
        return;
    };
    let slot = Arc::clone(slot);
    let _ = window.with_webview(move |platform_webview| {
        // SAFETY: pointer is the live WKWebView owned by this window; the
        // selector is guarded before the typed send.
        unsafe {
            use objc2::runtime::AnyObject;
            use objc2::{msg_send, sel};
            let webview = platform_webview.inner().cast::<AnyObject>();
            let Some(webview) = webview.as_ref() else {
                return;
            };
            let responds: bool =
                msg_send![webview, respondsToSelector: sel!(_webProcessIdentifier)];
            if !responds {
                return;
            }
            let pid: i32 = msg_send![webview, _webProcessIdentifier];
            if pid > 0 {
                slot.store(pid, Ordering::Relaxed);
            }
        }
    });
}

#[cfg(not(target_os = "macos"))]
fn refresh_main_webview_pid(_app_handle: &tauri::AppHandle, _slot: &Arc<AtomicI32>) {}

/// `ri_phys_footprint` of an owned process, or None when unavailable. Matches
/// Activity Monitor's "Memory" column, which is what users compare against.
#[cfg(target_os = "macos")]
fn process_phys_footprint_bytes(pid: i32) -> Option<u64> {
    let mut info: libc::rusage_info_v4 = unsafe { std::mem::zeroed() };
    let result = unsafe {
        libc::proc_pid_rusage(
            pid,
            libc::RUSAGE_INFO_V4,
            &mut info as *mut libc::rusage_info_v4 as *mut libc::rusage_info_t,
        )
    };
    if result != 0 {
        return None;
    }
    (info.ri_phys_footprint > 0).then_some(info.ri_phys_footprint)
}

#[cfg(not(target_os = "macos"))]
fn process_phys_footprint_bytes(_pid: i32) -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
fn total_physical_bytes() -> Option<u64> {
    macos_total_physical_bytes()
}

#[cfg(not(target_os = "macos"))]
fn total_physical_bytes() -> Option<u64> {
    None
}

/// Reclaimable pages / total physical pages, or None when unsupported.
#[cfg(target_os = "macos")]
fn sample_available_ratio() -> Option<f64> {
    use std::mem;

    // The host port is valid for the process lifetime; sampling it once per
    // call would leak a send right per poll. mach_host_self is deprecated in
    // favor of the mach2 crate; not worth a second dependency for one call.
    static HOST_PORT: std::sync::OnceLock<libc::host_t> = std::sync::OnceLock::new();
    let host = *HOST_PORT.get_or_init(|| unsafe {
        #[allow(deprecated)]
        libc::mach_host_self()
    });

    let total_bytes = macos_total_physical_bytes()?;
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
    if page_size <= 0 || total_bytes == 0 {
        return None;
    }
    let total_pages = total_bytes / page_size as u64;
    if total_pages == 0 {
        return None;
    }

    let mut stats: libc::vm_statistics64_data_t = unsafe { mem::zeroed() };
    let mut count =
        (mem::size_of::<libc::vm_statistics64_data_t>() / mem::size_of::<libc::natural_t>())
            as libc::mach_msg_type_number_t;
    let result = unsafe {
        libc::host_statistics64(
            host,
            libc::HOST_VM_INFO64,
            &mut stats as *mut _ as *mut libc::integer_t,
            &mut count,
        )
    };
    if result != libc::KERN_SUCCESS {
        return None;
    }

    // free + speculative + purgeable + inactive approximates macOS's
    // reclaimable pool without distinguishing file-backed vs anonymous pages.
    let available_pages = stats.free_count as u64
        + stats.speculative_count as u64
        + stats.purgeable_count as u64
        + stats.inactive_count as u64;
    Some(available_pages as f64 / total_pages as f64)
}

#[cfg(target_os = "macos")]
fn macos_total_physical_bytes() -> Option<u64> {
    let mut mib: [libc::c_int; 2] = [libc::CTL_HW, libc::HW_MEMSIZE];
    let mut value: u64 = 0;
    let mut size = std::mem::size_of::<u64>();
    let result = unsafe {
        libc::sysctl(
            mib.as_mut_ptr(),
            2,
            &mut value as *mut u64 as *mut libc::c_void,
            &mut size,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 {
        return None;
    }
    Some(value)
}

#[cfg(target_os = "linux")]
fn sample_available_ratio() -> Option<f64> {
    let meminfo = std::fs::read_to_string("/proc/meminfo").ok()?;
    let mut total_kb: Option<f64> = None;
    let mut available_kb: Option<f64> = None;
    for line in meminfo.lines() {
        let parse_kb = |text: &str| {
            text.trim()
                .split_whitespace()
                .next()
                .and_then(|kb| kb.parse::<f64>().ok())
        };
        if let Some(value) = line.strip_prefix("MemTotal:") {
            total_kb = parse_kb(value);
        } else if let Some(value) = line.strip_prefix("MemAvailable:") {
            available_kb = parse_kb(value);
        }
    }
    let total = total_kb?;
    let available = available_kb.unwrap_or(0.0);
    if total <= 0.0 {
        return None;
    }
    Some(available / total)
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn sample_available_ratio() -> Option<f64> {
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ratio_tiers_map_to_governor_levels() {
        assert_eq!(level_from_available_ratio(0.5), MemoryPressureLevel::Normal);
        assert_eq!(
            level_from_available_ratio(0.15),
            MemoryPressureLevel::Normal
        );
        assert_eq!(
            level_from_available_ratio(0.149),
            MemoryPressureLevel::Moderate
        );
        assert_eq!(
            level_from_available_ratio(0.06),
            MemoryPressureLevel::Moderate
        );
        assert_eq!(
            level_from_available_ratio(0.059),
            MemoryPressureLevel::Critical
        );
        assert_eq!(level_from_available_ratio(0.0), MemoryPressureLevel::Critical);
    }

    #[test]
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    fn live_sample_is_a_sane_ratio() {
        let ratio = sample_available_ratio().expect("sampling should be supported");
        assert!((0.0..=1.0).contains(&ratio), "ratio {ratio} out of range");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn phys_footprint_of_current_process_is_positive() {
        let pid = std::process::id() as i32;
        let footprint = process_phys_footprint_bytes(pid).expect("self rusage should work");
        assert!(footprint > 0);
    }

    #[test]
    fn relaunch_refuses_non_webcontent_processes() {
        // Own test binary is not WebContent; the identity guard must refuse it.
        let pid = std::process::id() as i32;
        assert!(!is_webcontent_process(pid));
        MAIN_WEBVIEW_PID.store(pid, Ordering::Relaxed);
        assert!(!relaunch_webview_renderer());
        MAIN_WEBVIEW_PID.store(0, Ordering::Relaxed);
    }

    #[test]
    fn relaunch_refuses_unknown_pid() {
        MAIN_WEBVIEW_PID.store(0, Ordering::Relaxed);
        assert!(!relaunch_webview_renderer());
    }

    #[test]
    fn byte_sample_payload_serializes_camel_case_without_level() {
        let payload = MemoryPressurePayload {
            level: None,
            bytes: Some(1024),
            available_bytes: Some(2048),
        };
        let value = serde_json::to_value(payload).expect("payload should serialize");
        assert_eq!(
            value,
            serde_json::json!({ "bytes": 1024, "availableBytes": 2048 })
        );
    }

    #[test]
    fn fallback_payload_serializes_lowercase_level_only() {
        let payload = MemoryPressurePayload {
            level: Some(MemoryPressureLevel::Moderate),
            bytes: None,
            available_bytes: None,
        };
        let value = serde_json::to_value(payload).expect("payload should serialize");
        assert_eq!(value, serde_json::json!({ "level": "moderate" }));
    }
}
