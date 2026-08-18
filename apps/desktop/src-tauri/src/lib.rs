mod artifact_bridge;
mod host_bridge;
mod memory_pressure;
mod pet_overlay;
mod pty_host;

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use artifact_bridge::install_artifact_bridge;
use host_bridge::{
    host_is_running, host_request, host_request_blocking, host_start, host_stop,
    observe_host_process_blocking, HostBridgeState, HostObservability,
};
use pet_overlay::{
    pet_overlay_hide, pet_overlay_show, pet_overlay_toggle, raise_main_window, show_main_window,
};
use pty_host::{
    pty_close, pty_close_all, pty_open, pty_resize, pty_write, snapshot_pty_sessions_blocking,
    PtyHostState, PtyShutdownSnapshot,
};
use serde::Serialize;
use tauri::{Emitter, Manager, WindowEvent};

struct ShutdownState {
    cleanup_started: AtomicBool,
    allow_close: AtomicBool,
}

impl Default for ShutdownState {
    fn default() -> Self {
        Self {
            cleanup_started: AtomicBool::new(false),
            allow_close: AtomicBool::new(false),
        }
    }
}

/// E4: bounded shutdown observability emitted as a Tauri event.
/// Contains no command arguments, environment variables, prompt text, or
/// credential-bearing output.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownReportPayload {
    started_at: String,
    completed_at: String,
    duration_ms: u64,
    sidecar_disposition: ShutdownDisposition,
    sidecar_pid: Option<i32>,
    mcp_children: Vec<ShutdownChildPayload>,
    pty_sessions: Vec<PtyShutdownSnapshot>,
    /// `None` means the sidecar did not explicitly confirm persistence.
    transcript_flushed: Option<bool>,
    /// `None` means no authoritative active-run tracker was available.
    cancelled_runs: Option<u32>,
    /// `None` means no authoritative active-run tracker was available.
    active_agent_runs_at_shutdown: Option<u32>,
    sidecar_alive: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShutdownChildPayload {
    kind: String,
    pid: Option<i32>,
    id: Option<String>,
}

/// The sidecar's observed termination path. A graceful process exit proves
/// only process termination; it does not prove transcript persistence or run
/// cancellation without an explicit structured acknowledgement from the host.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum ShutdownDisposition {
    Graceful,
    Abnormal,
    Forced,
    Unknown,
}

#[derive(Clone, Copy)]
struct ShutdownExecutionEvidence {
    transcript_flushed: Option<bool>,
    cancelled_runs: Option<u32>,
    active_agent_runs_at_shutdown: Option<u32>,
}

impl ShutdownExecutionEvidence {
    /// The current sidecar protocol does not emit shutdown acknowledgements or
    /// expose its active-run registry. Do not infer either fact from request or
    /// PTY counts.
    fn unavailable() -> Self {
        Self {
            transcript_flushed: None,
            cancelled_runs: None,
            active_agent_runs_at_shutdown: None,
        }
    }
}

fn build_shutdown_report(
    started_at: String,
    completed_at: String,
    duration_ms: u64,
    sidecar_disposition: ShutdownDisposition,
    sidecar_pid: Option<i32>,
    mcp_children: Vec<ShutdownChildPayload>,
    pty_sessions: Vec<PtyShutdownSnapshot>,
    sidecar_alive: bool,
    execution_evidence: ShutdownExecutionEvidence,
) -> ShutdownReportPayload {
    // An abnormal or forced sidecar exit invalidates an otherwise supplied
    // acknowledgement: its completion cannot be established at this boundary.
    let execution_evidence = match sidecar_disposition {
        ShutdownDisposition::Abnormal | ShutdownDisposition::Forced => {
            ShutdownExecutionEvidence::unavailable()
        }
        ShutdownDisposition::Graceful | ShutdownDisposition::Unknown => execution_evidence,
    };

    ShutdownReportPayload {
        started_at,
        completed_at,
        duration_ms,
        sidecar_disposition,
        sidecar_pid,
        mcp_children,
        pty_sessions,
        transcript_flushed: execution_evidence.transcript_flushed,
        cancelled_runs: execution_evidence.cancelled_runs,
        active_agent_runs_at_shutdown: execution_evidence.active_agent_runs_at_shutdown,
        sidecar_alive,
    }
}

fn read_shutdown_disposition(
    stop_result: &Result<serde_json::Value, String>,
) -> ShutdownDisposition {
    match stop_result
        .as_ref()
        .ok()
        .and_then(|response| response.get("outcome"))
        .and_then(|outcome| outcome.as_str())
    {
        Some("GracefulExit") => ShutdownDisposition::Graceful,
        Some("AbnormalExit") => ShutdownDisposition::Abnormal,
        Some("ForcedKill") => ShutdownDisposition::Forced,
        _ => ShutdownDisposition::Unknown,
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(HostBridgeState::default())
        .manage(PtyHostState::default())
        .manage(ShutdownState::default())
        .invoke_handler(tauri::generate_handler![
            host_start,
            host_stop,
            host_request,
            host_is_running,
            pty_open,
            pty_write,
            pty_resize,
            pty_close,
            pty_close_all,
            pet_overlay_show,
            pet_overlay_hide,
            pet_overlay_toggle,
            show_main_window,
            memory_pressure::purge_webview_memory
        ])
        .setup(|application| {
            install_artifact_bridge(application.handle())?;
            // Feeds the frontend Memory Governor; no-op on unsupported platforms.
            memory_pressure::spawn_memory_pressure_monitor(application.handle().clone());
            // macOS may fall back to productName for an empty config title.
            // A zero-width title keeps traffic lights while removing visible chrome text.
            if let Some(main_window) = application.get_webview_window("main") {
                main_window.set_title("\u{200B}")?;
            }
            // Pet overlay is created on demand (hide = destroy). A hidden
            // preference must not keep a second WebContent process resident.
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "pet-overlay" {
                static REAPPLYING_PET_OVERLAY_FLAGS: AtomicBool = AtomicBool::new(false);
                if matches!(event, WindowEvent::Moved(_) | WindowEvent::Focused(_)) {
                    if !REAPPLYING_PET_OVERLAY_FLAGS.swap(true, Ordering::SeqCst) {
                        let _ = window.set_always_on_top(true);
                        let _ = window.set_visible_on_all_workspaces(true);
                        REAPPLYING_PET_OVERLAY_FLAGS.store(false, Ordering::SeqCst);
                    }
                }
                // Overlay close is hide=destroy, not app quit. Missing window
                // never reaches this handler (no-op).
                return;
            }

            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            let application = window.app_handle().clone();
            let shutdown_state = application.state::<ShutdownState>();
            if shutdown_state.allow_close.load(Ordering::Acquire) {
                return;
            }
            api.prevent_close();
            if shutdown_state.cleanup_started.swap(true, Ordering::AcqRel) {
                return;
            }

            // Native close is held until child reaping and PTY teardown finish;
            // all blocking work still runs on Tauri's async blocking pool.
            let window = window.clone();
            tauri::async_runtime::spawn(async move {
                let started_at = Instant::now();
                let started_at_iso = chrono_now_iso();

                let host_state = application.state::<HostBridgeState>();
                let pty_state = application.state::<PtyHostState>();

                // E4: collect shutdown observability before teardown.
                // 1. Sidecar PID and liveness.
                let host_inner = Arc::clone(&host_state.inner);
                let host_obs: HostObservability =
                    tauri::async_runtime::spawn_blocking(move || observe_host_process_blocking(&host_inner))
                        .await
                        .unwrap_or(HostObservability {
                            sidecar_pid: None,
                            host_alive: false,
                            pending_request_count: 0,
                        });

                // 2. MCP child PIDs: send mcp/status before closing stdin.
                let mcp_children: Vec<ShutdownChildPayload> = if host_obs.host_alive {
                    let host_inner_for_mcp = Arc::clone(&host_state.inner);
                    let mcp_command = serde_json::json!({ "type": "mcp/status" });
                    let mcp_result = tauri::async_runtime::spawn_blocking(move || {
                        host_request_blocking(host_inner_for_mcp, mcp_command, Some(5_000))
                    })
                    .await;
                    match mcp_result {
                        Ok(Ok(response)) => {
                            let servers = response
                                .get("data")
                                .and_then(|d| d.get("servers"))
                                .and_then(|s| s.as_array())
                                .map(|arr| {
                                    arr.iter()
                                        .filter_map(|server| {
                                            let pid = server
                                                .get("pid")
                                                .and_then(|p| p.as_i64())
                                                .map(|p| p as i32);
                                            let id = server
                                                .get("serverId")
                                                .and_then(|s| s.as_str())
                                                .map(|s| s.to_string());
                                            let kind = "mcp".to_string();
                                            Some(ShutdownChildPayload { kind, pid, id })
                                        })
                                        .collect::<Vec<_>>()
                                })
                                .unwrap_or_default();
                            servers
                        }
                        _ => vec![],
                    }
                } else {
                    vec![]
                };

                // 3. PTY process facts before teardown mutates session state.
                let pty_sessions: Vec<PtyShutdownSnapshot> = {
                    let pty_inner = Arc::clone(&pty_state.sessions);
                    tauri::async_runtime::spawn_blocking(move || {
                        snapshot_pty_sessions_blocking(&pty_inner)
                    })
                    .await
                    .ok()
                    .and_then(Result::ok)
                    .unwrap_or_default()
                };

                // 4. Execute teardown.
                let _ = pty_host::pty_close_all(pty_state).await;

                let stop_result = host_bridge::host_stop(host_state).await;
                let sidecar_disposition = read_shutdown_disposition(&stop_result);

                // 5. Emit ShutdownReport as a host-log event.
                let completed_at_iso = chrono_now_iso();
                let duration_ms = started_at.elapsed().as_millis() as u64;

                let report = build_shutdown_report(
                    started_at_iso,
                    completed_at_iso,
                    duration_ms,
                    sidecar_disposition,
                    host_obs.sidecar_pid,
                    mcp_children,
                    pty_sessions,
                    host_obs.host_alive,
                    ShutdownExecutionEvidence::unavailable(),
                );

                let _ = application.emit("host-log", serde_json::json!({
                    "level": "info",
                    "message": format!("ShutdownReport: {}", serde_json::to_string(&report).unwrap_or_default()),
                }));

                let shutdown_state = application.state::<ShutdownState>();
                shutdown_state.allow_close.store(true, Ordering::Release);
                let _ = window.close();
            });
        })
        .build(tauri::generate_context!())
        .expect("error while building piwin desktop")
        .run(|app_handle, event| {
            // macOS Dock icon click. The floating pet-overlay is always "visible"
            // (and skip_taskbar), so has_visible_windows is often true even when
            // the main window is minimized or buried — always raise main.
            if let tauri::RunEvent::Reopen {
                has_visible_windows: _,
                ..
            } = event
            {
                let _ = raise_main_window(app_handle);
            }
        });
}

/// Best-effort ISO timestamp using system time. Not available in core Rust
/// without a crate — produce a fallback format.
fn chrono_now_iso() -> String {
    use std::time::SystemTime;
    use std::time::UNIX_EPOCH;
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    // Simple UTC ISO 8601 without sub-second precision.
    let days_since_epoch = secs / 86400;
    let time_secs = secs % 86400;
    let hours = time_secs / 3600;
    let minutes = (time_secs % 3600) / 60;
    let seconds = time_secs % 60;

    // Compute year/month/day from days_since_epoch (civil date).
    let (year, month, day) = days_to_date(days_since_epoch);

    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        year, month, day, hours, minutes, seconds
    )
}

/// Convert days since Unix epoch (1970-01-01) to (year, month, day).
fn days_to_date(days: u64) -> (u64, u64, u64) {
    let d = days as i64 + 719468; // Rata Die
    let era = if d >= 0 { d } else { d - 146096 } / 146097;
    let doe = d - era * 146097; // day of era [0, 146096]
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { y + 1 } else { y };
    (year as u64, month as u64, day as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn empty_pty_snapshot() -> PtyShutdownSnapshot {
        PtyShutdownSnapshot {
            kind: "pty".to_string(),
            id: "tauri-pty-1".to_string(),
            direct_child_pid: Some(4_242),
            unix_process_group_leader: Some(4_242),
            platform: pty_host::PtySnapshotPlatform {
                os: "macos".to_string(),
                unix_process_group_leader_supported: true,
            },
        }
    }

    #[test]
    fn graceful_shutdown_retains_explicit_execution_acknowledgements() {
        let report = build_shutdown_report(
            "2026-07-25T10:00:00Z".to_string(),
            "2026-07-25T10:00:01Z".to_string(),
            1_000,
            ShutdownDisposition::Graceful,
            Some(1_234),
            Vec::new(),
            vec![empty_pty_snapshot()],
            true,
            ShutdownExecutionEvidence {
                transcript_flushed: Some(true),
                cancelled_runs: Some(2),
                active_agent_runs_at_shutdown: Some(2),
            },
        );

        assert_eq!(report.sidecar_disposition, ShutdownDisposition::Graceful);
        assert_eq!(report.transcript_flushed, Some(true));
        assert_eq!(report.cancelled_runs, Some(2));
        assert_eq!(report.active_agent_runs_at_shutdown, Some(2));
        assert_eq!(report.pty_sessions[0].direct_child_pid, Some(4_242));
    }

    #[test]
    fn forced_shutdown_never_claims_execution_completion() {
        let report = build_shutdown_report(
            "2026-07-25T10:00:00Z".to_string(),
            "2026-07-25T10:00:01Z".to_string(),
            1_000,
            ShutdownDisposition::Forced,
            Some(1_234),
            Vec::new(),
            Vec::new(),
            false,
            ShutdownExecutionEvidence {
                transcript_flushed: Some(true),
                cancelled_runs: Some(2),
                active_agent_runs_at_shutdown: Some(2),
            },
        );

        assert_eq!(report.sidecar_disposition, ShutdownDisposition::Forced);
        assert_eq!(report.transcript_flushed, None);
        assert_eq!(report.cancelled_runs, None);
        assert_eq!(report.active_agent_runs_at_shutdown, None);
    }

    #[test]
    fn absent_stop_outcome_is_reported_as_unknown_without_inferred_counts() {
        let report = build_shutdown_report(
            "2026-07-25T10:00:00Z".to_string(),
            "2026-07-25T10:00:01Z".to_string(),
            1_000,
            read_shutdown_disposition(&Ok(serde_json::json!({ "stopped": true }))),
            None,
            Vec::new(),
            vec![empty_pty_snapshot()],
            false,
            ShutdownExecutionEvidence::unavailable(),
        );

        assert_eq!(report.sidecar_disposition, ShutdownDisposition::Unknown);
        assert_eq!(report.transcript_flushed, None);
        assert_eq!(report.cancelled_runs, None);
        assert_eq!(report.active_agent_runs_at_shutdown, None);
        assert_eq!(report.pty_sessions.len(), 1);
    }
}
