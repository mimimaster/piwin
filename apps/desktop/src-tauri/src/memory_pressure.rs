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

use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::Arc;

mod sampling;
mod types;

use sampling::{
    level_from_available_ratio, process_phys_footprint_bytes, refresh_main_webview_pid,
    sample_available_ratio, total_physical_bytes,
};
use types::{MemoryPressureLevel, MemoryPressurePayload};

/// Sampling cadence. The governor only switches degradation tiers, so a
/// multi-second granularity is sufficient and keeps the poll cost invisible.
const POLL_INTERVAL_MS: u64 = 5_000;

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


