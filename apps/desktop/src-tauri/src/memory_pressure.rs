//! Memory sensor feeding the frontend Memory Governor.
//!
//! Role split (docs/plans/2026-08-17-webcontent-memory-hard-cap.md): this
//! module is a policy-free sensor. Every poll it samples each window's
//! WebContent process footprint — the number Activity Monitor shows,
//! charging the renderer for compressed pages and owned-but-unmapped
//! IOSurfaces — plus the system reclaimable ratio, and emits a
//! `desktop:memory-pressure` Tauri event carrying `{ bytes, availableBytes, … }`
//! observability fields. Classification, thresholds and hysteresis live in
//! the webview (apps/desktop/src/notes/memory-pressure.ts) so policy stays
//! unit-tested in one place, which is why the steady state is no longer
//! silent for byte samples.
//!
//! Emissions are ack-gated: a `sampleId` is emitted only when no previous
//! sample awaits `ack_memory_sample`, so a stalled frontend never piles up
//! queued events (skipped ticks are counted as `stalledTicks` instead).
//! Every tick also rewrites `diagnostics/memory/native-mapping.json` — a
//! payload-free window→(pid,startClock) map the Python recorder joins on.
//!
//! When footprint sampling is unavailable (non-macOS, or the WKWebView
//! process-identifier SPI disappears) the module falls back to the legacy
//! change-driven `{ level }` emissions derived from the system ratio, so the
//! governor still hears about global pressure.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tauri::Manager;

mod monitor;
mod sampling;
mod types;

use monitor::{diagnostics_dir, write_mapping_file, MemoryObservabilityState};
use sampling::{
    level_from_available_ratio, process_rusage, refresh_webview_pids, sample_available_ratio,
    sample_os_pressure, total_physical_bytes,
};
use types::{
    AvailableBytesKind, MemoryMappingFile, MemoryPressureLevel, MemoryPressurePayload,
    MemoryPurgeResult, MemoryPurgeStatus, ProcessSample, ProcessWindowRole, RetiredProcess,
    SampleError, SampleErrorKind, SampleQuality,
};

/// Sampling cadence. The governor only switches degradation tiers, so a
/// multi-second granularity is sufficient and keeps the poll cost invisible.
const POLL_INTERVAL_MS: u64 = 5_000;

/// Purge completions outstanding after this window are reported as
/// `timeout` so `desktop:memory-purge` consumers see every request resolve.
const PURGE_COMPLETION_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Identity of a live window→WebContent mapping this tick: enough to decide
/// whether a previously known (label → pid,startClock) identity retired.
#[derive(Clone)]
struct WindowIdentity {
    pid: i32,
    start_clock: Option<u64>,
    footprint_bytes: Option<u64>,
}

pub fn spawn_memory_pressure_monitor(app_handle: tauri::AppHandle) {
    app_handle.manage(MemoryObservabilityState::default());
    std::thread::spawn(move || {
        let state = app_handle.state::<MemoryObservabilityState>().inner().clone();
        let webview_pids: Arc<Mutex<HashMap<String, i32>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let started = Instant::now();
        let mut sample_id: u64 = 0;
        let mut last_fallback_level = MemoryPressureLevel::Normal;
        // label → identity from the previous tick, for retirement tracking.
        let mut previous_identities: HashMap<String, WindowIdentity> = HashMap::new();
        loop {
            sample_id = sample_id.wrapping_add(1);
            // The refresh lands asynchronously on the main thread, so this
            // tick reads pids captured by an earlier one — fine at this
            // cadence. Re-queried every tick because WebKit relaunches
            // WebContent (new pid) after a renderer termination.
            refresh_webview_pids(&app_handle, &webview_pids);

            let app_version = app_handle.package_info().version.to_string();
            let timestamp_ms = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            let mut payload = MemoryPressurePayload::tick(
                sample_id,
                timestamp_ms,
                started.elapsed().as_millis() as u64,
                app_version.clone(),
            );

            // Live windows this tick. `webview_windows()` is thread-safe; the
            // labels are needed synchronously while pids arrive a tick late.
            let mut labels: Vec<String> = {
                use tauri::Manager;
                app_handle.webview_windows().keys().cloned().collect()
            };
            labels.sort();
            // Per-window attribution needs the WKWebView pid SPI, which only
            // exists on macOS. Elsewhere the processes/unknownWindows/errors
            // fields stay empty and the legacy ratio fallback stays quiet
            // instead of reporting every window as unknown each tick.
            #[cfg(not(target_os = "macos"))]
            labels.clear();

            // Drop pid-map entries for windows that closed since last tick.
            {
                let live: std::collections::HashSet<&String> = labels.iter().collect();
                if let Ok(mut pids) = webview_pids.lock() {
                    pids.retain(|label, _| live.contains(label));
                }
            }

            let mut current_identities: HashMap<String, WindowIdentity> = HashMap::new();
            for label in &labels {
                let pid = webview_pids
                    .lock()
                    .ok()
                    .and_then(|pids| pids.get(label).copied())
                    .filter(|pid| *pid > 0);
                let role = if label == "main" {
                    ProcessWindowRole::Main
                } else {
                    ProcessWindowRole::Auxiliary
                };
                match pid {
                    Some(pid) => match process_rusage(pid) {
                        Some(rusage) => {
                            let footprint = (rusage.footprint_bytes > 0)
                                .then_some(rusage.footprint_bytes);
                            if footprint.is_none() {
                                payload.errors.push(SampleError {
                                    kind: SampleErrorKind::Footprint,
                                    window_label: Some(label.clone()),
                                    message: "ri_phys_footprint reported 0".to_string(),
                                });
                            }
                            current_identities.insert(
                                label.clone(),
                                WindowIdentity {
                                    pid,
                                    start_clock: Some(rusage.start_clock),
                                    footprint_bytes: footprint,
                                },
                            );
                            payload.processes.push(ProcessSample {
                                window_label: label.clone(),
                                role,
                                pid: Some(pid),
                                start_clock: Some(rusage.start_clock.to_string()),
                                footprint_bytes: footprint,
                                shared: false, // set after the pid census below
                            });
                            if footprint.is_none() {
                                payload.unknown_windows.push(label.clone());
                            }
                        }
                        None => {
                            payload.errors.push(SampleError {
                                kind: SampleErrorKind::Footprint,
                                window_label: Some(label.clone()),
                                message: "proc_pid_rusage failed".to_string(),
                            });
                            payload.unknown_windows.push(label.clone());
                            payload.processes.push(ProcessSample {
                                window_label: label.clone(),
                                role,
                                pid: Some(pid),
                                start_clock: None,
                                footprint_bytes: None,
                                shared: false,
                            });
                        }
                    },
                    None => {
                        // SPI missing, window mid-relaunch, or the pid has not
                        // been captured by an earlier tick yet.
                        payload.errors.push(SampleError {
                            kind: SampleErrorKind::WebviewPid,
                            window_label: Some(label.clone()),
                            message: "no WebContent pid captured".to_string(),
                        });
                        payload.unknown_windows.push(label.clone());
                        payload.processes.push(ProcessSample {
                            window_label: label.clone(),
                            role,
                            pid: None,
                            start_clock: None,
                            footprint_bytes: None,
                            shared: false,
                        });
                    }
                }
            }

            // Shared-pid census: >1 live window mapping one WebContent pid.
            {
                let mut counts: HashMap<i32, usize> = HashMap::new();
                for process in &payload.processes {
                    if let Some(pid) = process.pid {
                        *counts.entry(pid).or_insert(0) += 1;
                    }
                }
                for process in &mut payload.processes {
                    process.shared = process
                        .pid
                        .map(|pid| counts.get(&pid).copied().unwrap_or(0) > 1)
                        .unwrap_or(false);
                }
            }

            // Footprint sum over distinct pids (shared WebContent once).
            {
                let mut seen: std::collections::HashSet<i32> = std::collections::HashSet::new();
                let mut sum: u64 = 0;
                for process in &payload.processes {
                    if let (Some(pid), Some(bytes)) = (process.pid, process.footprint_bytes) {
                        if seen.insert(pid) {
                            sum = sum.saturating_add(bytes);
                        }
                    }
                }
                if !seen.is_empty() {
                    payload.aggregate_footprint_bytes = Some(sum);
                }
            }

            // Retire identities that disappeared or changed since last tick.
            // A pid reused with a different start clock is a new process.
            for (label, previous) in &previous_identities {
                let same_identity = current_identities
                    .get(label)
                    .map(|current| {
                        current.pid == previous.pid && current.start_clock == previous.start_clock
                    })
                    .unwrap_or(false);
                if same_identity {
                    continue;
                }
                let retired = RetiredProcess {
                    pid: previous.pid,
                    start_clock: previous.start_clock.map(|clock| clock.to_string()),
                    last_window_label: label.clone(),
                    last_footprint_bytes: previous.footprint_bytes,
                };
                if state.record_retired(retired.clone()) {
                    payload.retired_processes.push(retired);
                }
            }
            previous_identities = current_identities;

            // Quality: full when every live window produced a footprint.
            let sampled = payload
                .processes
                .iter()
                .filter(|p| p.footprint_bytes.is_some())
                .count();
            payload.quality = if sampled == 0 {
                SampleQuality::Unavailable
            } else if sampled == payload.processes.len() {
                SampleQuality::Full
            } else {
                SampleQuality::Partial
            };

            payload.bytes = payload
                .processes
                .iter()
                .find(|p| p.role == ProcessWindowRole::Main)
                .and_then(|p| p.footprint_bytes)
                .filter(|bytes| *bytes > 0);

            payload.os_pressure = sample_os_pressure();
            let ratio = sample_available_ratio();
            #[cfg(target_os = "macos")]
            if payload.os_pressure.is_none() && ratio.is_some() {
                payload.errors.push(SampleError {
                    kind: SampleErrorKind::OsPressure,
                    window_label: None,
                    message: "kern.memorystatus_vm_pressure_level unavailable".to_string(),
                });
            }
            // `availableBytes` is the explicit fallback estimate: present iff
            // the native OS pressure tier could not be read.
            if payload.os_pressure.is_none() {
                payload.available_bytes = ratio.and_then(|value| {
                    total_physical_bytes().map(|total| (value * total as f64) as u64)
                });
                payload.available_bytes_kind = payload
                    .available_bytes
                    .map(|_| AvailableBytesKind::ReclaimableEstimate);
            }

            // Legacy classification fallback when no byte sample exists.
            if payload.bytes.is_none() {
                if let Some(value) = ratio {
                    let level = level_from_available_ratio(value);
                    if level != last_fallback_level {
                        last_fallback_level = level;
                        payload.level = Some(level);
                    }
                } else if payload.processes.is_empty() {
                    // Sampling unsupported on this platform; stop the thread
                    // instead of spinning. Governor stays `normal`.
                    return;
                }
            }

            // Every tick rewrites the mapping file so the recorder sees
            // window→process attribution even while emissions are ack-gated.
            let mapping = MemoryMappingFile {
                timestamp_ms: payload.timestamp_ms,
                app_version,
                sample_id,
                quality: payload.quality,
                processes: payload.processes.clone(),
            };
            write_mapping_file(&diagnostics_dir(&app_handle), &mapping);

            // Ack gate: emit only when no previous sample awaits its ack.
            // Skipped ticks are counted, never queued.
            if state.has_pending_sample() {
                state.record_stalled_tick();
            } else if payload.bytes.is_some()
                || payload.level.is_some()
                || !payload.processes.is_empty()
                || !payload.errors.is_empty()
            {
                let emit_id = payload.sample_id;
                // Pending is claimed BEFORE emit: a fast webview can invoke
                // `ack_memory_sample` while `emit` is still on the wire, and
                // the ack must land in a slot that already exists — setting
                // pending after emit could re-mark an already-acked id and
                // stall every later tick forever.
                state.set_pending_sample(emit_id);
                if tauri::Emitter::emit(&app_handle, "desktop:memory-pressure", payload.clone())
                    .is_ok()
                {
                    state.record_sample(payload);
                } else {
                    // The event never reached a listener; nothing will ack
                    // this id, so it must not hold the gate.
                    state.clear_pending_sample();
                }
            }

            std::thread::sleep(std::time::Duration::from_millis(POLL_INTERVAL_MS));
        }
    });
}

/// Frontend ack for an emitted `sampleId`. Clears the pending slot so the
/// monitor may emit the next tick; returns false for unknown/stale ids.
#[tauri::command]
pub fn ack_memory_sample(state: tauri::State<MemoryObservabilityState>, sample_id: u64) -> bool {
    state.ack_sample(sample_id)
}

/// Bounded recent history + pending-ack state for diagnostics.
#[tauri::command]
pub fn memory_observability_snapshot(
    state: tauri::State<MemoryObservabilityState>,
) -> types::ObservabilitySnapshot {
    state.snapshot()
}

fn record_and_emit_purge(
    app_handle: &tauri::AppHandle,
    state: &MemoryObservabilityState,
    result: MemoryPurgeResult,
) {
    state.record_purge(result.clone());
    let _ = tauri::Emitter::emit(app_handle, "desktop:memory-purge", result);
}

#[cfg(target_os = "macos")]
struct PurgeTracker {
    sealed: bool,
    reported: bool,
    pending: usize,
    windows: u32,
    /// Deduplicated WKWebsiteDataStore pointers — windows sharing a data
    /// store must only count one completion.
    seen_stores: std::collections::HashSet<usize>,
}

#[cfg(target_os = "macos")]
fn try_finish_purge(
    tracker: &Arc<Mutex<PurgeTracker>>,
    status: MemoryPurgeStatus,
    app_handle: &tauri::AppHandle,
    state: &MemoryObservabilityState,
    request_id: u64,
) {
    let windows = {
        let Ok(mut tracker) = tracker.lock() else {
            return;
        };
        // Completed waits for every pending data store; Timeout deliberately
        // does not — it is how a stuck completion resolves the request.
        if tracker.reported
            || !tracker.sealed
            || (tracker.pending > 0 && status == MemoryPurgeStatus::Completed)
        {
            return;
        }
        tracker.reported = true;
        tracker.windows
    };
    record_and_emit_purge(
        app_handle,
        state,
        MemoryPurgeResult {
            request_id,
            status,
            window_count: windows,
            error: None,
        },
    );
}

/// Drop WKWebView's in-memory resource cache (decoded images, scripts, style
/// data inside the WebContent process) for every webview window. Invoked by
/// the frontend on a degradation escalation edge, after the CSS strip has
/// already destroyed backdrop-filter compositor layers. Best-effort by
/// design: degradation must not depend on the purge succeeding.
///
/// Emits `desktop:memory-purge` lifecycle events: `requested` synchronously,
/// then `completed` once all deduplicated data stores finish (or `timeout`
/// after 10s), `unavailable` off macOS. Fire-and-forget: returns `()`.
#[tauri::command]
pub fn purge_webview_memory(
    app_handle: tauri::AppHandle,
    state: tauri::State<MemoryObservabilityState>,
) {
    let state = state.inner().clone();
    let request_id = state.allocate_purge_request();

    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let windows: Vec<tauri::WebviewWindow> =
            app_handle.webview_windows().into_values().collect();
        let window_count = windows.len() as u32;
        record_and_emit_purge(
            &app_handle,
            &state,
            MemoryPurgeResult {
                request_id,
                status: MemoryPurgeStatus::Requested,
                window_count,
                error: None,
            },
        );

        let tracker = Arc::new(Mutex::new(PurgeTracker {
            sealed: false,
            reported: false,
            pending: 0,
            windows: window_count,
            seen_stores: std::collections::HashSet::new(),
        }));

        for window in windows {
            let tracker = Arc::clone(&tracker);
            let app_handle = app_handle.clone();
            let state = state.clone();
            let _ = window.with_webview(move |platform_webview| {
                // SAFETY: with_webview hands us the live WKWebView pointer on
                // the main thread; all calls below are public WebKit API.
                unsafe {
                    use objc2_foundation::{NSDate, NSSet};
                    use objc2_web_kit::{WKWebView, WKWebsiteDataTypeMemoryCache};
                    let webview = platform_webview.inner().cast::<WKWebView>();
                    let Some(webview) = webview.as_ref() else {
                        return;
                    };
                    let store = webview.configuration().websiteDataStore();
                    let key = &*store as *const objc2_web_kit::WKWebsiteDataStore as usize;
                    {
                        let Ok(mut tracker) = tracker.lock() else {
                            return;
                        };
                        if !tracker.seen_stores.insert(key) {
                            // Data store already purged for this request.
                            return;
                        }
                        tracker.pending += 1;
                    }
                    let data_types = NSSet::from_slice(&[WKWebsiteDataTypeMemoryCache]);
                    let completion = block2::RcBlock::new(move || {
                        if let Ok(mut tracker) = tracker.lock() {
                            tracker.pending = tracker.pending.saturating_sub(1);
                        }
                        try_finish_purge(&tracker, MemoryPurgeStatus::Completed, &app_handle, &state, request_id);
                    });
                    store.removeDataOfTypes_modifiedSince_completionHandler(
                        &data_types,
                        &NSDate::distantPast(),
                        &completion,
                    );
                }
            });
        }

        {
            let Ok(mut tracker) = tracker.lock() else {
                return;
            };
            tracker.sealed = true;
        }
        try_finish_purge(
            &tracker,
            MemoryPurgeStatus::Completed,
            &app_handle,
            &state,
            request_id,
        );

        // A completion handler may never fire (window closing mid-purge);
        // close out the request so consumers never wait forever.
        let timeout_tracker = Arc::clone(&tracker);
        std::thread::spawn(move || {
            std::thread::sleep(PURGE_COMPLETION_TIMEOUT);
            try_finish_purge(
                &timeout_tracker,
                MemoryPurgeStatus::Timeout,
                &app_handle,
                &state,
                request_id,
            );
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        let window_count = {
            use tauri::Manager;
            app_handle.webview_windows().len() as u32
        };
        record_and_emit_purge(
            &app_handle,
            &state,
            MemoryPurgeResult {
                request_id,
                status: MemoryPurgeStatus::Requested,
                window_count,
                error: None,
            },
        );
        record_and_emit_purge(
            &app_handle,
            &state,
            MemoryPurgeResult {
                request_id,
                status: MemoryPurgeStatus::Unavailable,
                window_count,
                error: Some("memory purge requires macOS WKWebsiteDataStore".to_string()),
            },
        );
    }
}
