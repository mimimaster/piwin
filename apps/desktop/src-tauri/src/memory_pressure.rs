//! Host memory pressure monitor feeding the frontend Memory Governor.
//!
//! The webview governor (apps/desktop/src/memory-governor.ts) degrades UI
//! caches under pressure, but WKWebView exposes no OS-level pressure signal to
//! JS. This module samples the reclaimable-memory ratio and emits a
//! `desktop:memory-pressure` Tauri event whenever the derived level changes;
//! a frontend bridge re-dispatches it as the DOM event the governor listens
//! for. Emissions are change-driven only, so the steady state is silent.

use serde::Serialize;

/// Sampling cadence. The governor only switches degradation tiers, so a
/// multi-second granularity is sufficient and keeps the poll cost invisible.
const POLL_INTERVAL_MS: u64 = 5_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MemoryPressureLevel {
    Normal,
    Moderate,
    Critical,
}

#[derive(Clone, Copy, Serialize)]
struct MemoryPressurePayload {
    level: MemoryPressureLevel,
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
    std::thread::spawn(move || {
        let mut last_level = MemoryPressureLevel::Normal;
        loop {
            match sample_available_ratio() {
                Some(ratio) => {
                    let level = level_from_available_ratio(ratio);
                    if level != last_level {
                        last_level = level;
                        let _ = tauri::Emitter::emit(
                            &app_handle,
                            "desktop:memory-pressure",
                            MemoryPressurePayload { level },
                        );
                    }
                }
                None => {
                    // Sampling unsupported on this platform; stop the thread
                    // instead of spinning. The governor stays at `normal`.
                    return;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
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
}
