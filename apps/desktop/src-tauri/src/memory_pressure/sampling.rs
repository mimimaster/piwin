//! Process/system sampling for the desktop memory sensor.
//!
//! Split out of `memory_pressure.rs` (no behavior change): process identity
//! via the WKWebView `_webProcessIdentifier` SPI, `ri_phys_footprint`
//! sampling, total-physical-memory lookup, and the legacy system
//! reclaimable-ratio fallback used when byte sampling is unavailable.

use std::sync::Arc;
#[cfg(target_os = "macos")]
use std::sync::atomic::Ordering;
use std::sync::atomic::AtomicI32;

use super::types::MemoryPressureLevel;
#[cfg(test)]
use super::types::MemoryPressurePayload;

/// Map the reclaimable-page ratio to a governor tier. Thresholds are coarse
/// by design: the governor's actions are cache evictions, not correctness.
pub(crate) fn level_from_available_ratio(ratio: f64) -> MemoryPressureLevel {
    if ratio < 0.06 {
        MemoryPressureLevel::Critical
    } else if ratio < 0.15 {
        MemoryPressureLevel::Moderate
    } else {
        MemoryPressureLevel::Normal
    }
}

/// Store the main window's WebContent pid into `slot`, asynchronously on the
/// main thread. Uses the long-stable WebKit SPI `-[WKWebView
/// _webProcessIdentifier]` behind a respondsToSelector guard: if the SPI ever
/// disappears the slot stays 0 and the monitor falls back to system-ratio
/// sampling instead of breaking.
#[cfg(target_os = "macos")]
pub(crate) fn refresh_main_webview_pid(app_handle: &tauri::AppHandle, slot: &Arc<AtomicI32>) {
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
pub(crate) fn refresh_main_webview_pid(_app_handle: &tauri::AppHandle, _slot: &Arc<AtomicI32>) {}

/// `ri_phys_footprint` of an owned process, or None when unavailable. Matches
/// Activity Monitor's "Memory" column, which is what users compare against.
#[cfg(target_os = "macos")]
pub(crate) fn process_phys_footprint_bytes(pid: i32) -> Option<u64> {
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
pub(crate) fn process_phys_footprint_bytes(_pid: i32) -> Option<u64> {
    None
}

#[cfg(target_os = "macos")]
pub(crate) fn total_physical_bytes() -> Option<u64> {
    macos_total_physical_bytes()
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn total_physical_bytes() -> Option<u64> {
    None
}

/// Reclaimable pages / total physical pages, or None when unsupported.
#[cfg(target_os = "macos")]
pub(crate) fn sample_available_ratio() -> Option<f64> {
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
    let mut count = (mem::size_of::<libc::vm_statistics64_data_t>()
        / mem::size_of::<libc::natural_t>()) as libc::mach_msg_type_number_t;
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
pub(crate) fn sample_available_ratio() -> Option<f64> {
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
pub(crate) fn sample_available_ratio() -> Option<f64> {
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
        assert_eq!(
            level_from_available_ratio(0.0),
            MemoryPressureLevel::Critical
        );
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
