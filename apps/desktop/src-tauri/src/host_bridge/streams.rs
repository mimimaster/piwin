//! Child stream readers: the stdout JSONL protocol lane and stderr log
//! forwarding.

use super::exit_reason::{HostExitDiagnostics, EXIT_SETTLE_TIMEOUT};
use super::logs::{emit_fatal_status, emit_host_push};
use super::process::wait_for_process_exit;
use super::supervisor::supervise_restart;
use super::*;
use std::process::{ChildStderr, ChildStdout};

/// Reads the sidecar's stdout JSONL: correlates responses with the pending
/// table and forwards everything else to the WebView push lane. On EOF it
/// flips `alive` and, unless a graceful stop asked for it, hands off to the
/// restart supervisor.
pub(super) fn spawn_stdout_reader(
    app: AppHandle,
    stdout: ChildStdout,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    alive: Arc<AtomicBool>,
    shutting_down: Arc<AtomicBool>,
    diagnostics: Arc<HostExitDiagnostics>,
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock_flag: Arc<AtomicBool>,
    restart_attempts: Arc<AtomicU32>,
) {
    let spawned_at = Instant::now();
    let pending_reader = Arc::clone(&pending);
    let alive_reader = Arc::clone(&alive);
    let shutting_down_reader = Arc::clone(&shutting_down);
    let app_reader = app.clone();
    // Supervisor needs these to attempt a restart on unexpected death.
    let inner_for_supervisor = Arc::clone(&inner);
    let lifecycle_for_supervisor = Arc::clone(&lifecycle);
    let mock_flag_for_supervisor = Arc::clone(&mock_flag);
    let app_for_supervisor = app.clone();

    thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            let Ok(line) = line_result else {
                break;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            let parsed: Value = match serde_json::from_str(trimmed) {
                Ok(value) => value,
                Err(error) => {
                    emit_log(
                        &app_reader,
                        "warn",
                        format!("invalid host JSON line: {error}; line={trimmed}"),
                    );
                    continue;
                }
            };

            let message_type = parsed.get("type").and_then(|value| value.as_str());
            if message_type == Some("response") {
                if let Some(id) = parsed.get("id").and_then(|value| value.as_str()) {
                    let mut map = match pending_reader.lock() {
                        Ok(map) => map,
                        Err(_) => break,
                    };
                    if let Some(entry) = map.remove(id) {
                        let _ = entry.tx.send(parsed.clone());
                    }
                }
                // A response is request-correlated only. Do not broadcast it
                // as an unsolicited host push to the WebView.
                continue;
            }

            emit_host_push(&app_reader, &parsed);
        }

        // EOF is a failure during normal operation, but is the expected
        // completion signal after stdin was closed for graceful shutdown.
        if shutting_down_reader.load(Ordering::Acquire) {
            alive_reader.store(false, Ordering::Release);
            emit_log(
                &app_reader,
                "info",
                "host process stdout closed during shutdown",
            );
        } else {
            // Settle the reason before flipping `alive`, so a request that
            // sees the death also sees why.
            diagnostics.wait_for_stderr_closed(EXIT_SETTLE_TIMEOUT);
            let exit_status = find_process(&inner_for_supervisor, &diagnostics)
                .and_then(|process| wait_for_process_exit(&process, EXIT_SETTLE_TIMEOUT));
            let reason = diagnostics.settle(exit_status);
            alive_reader.store(false, Ordering::Release);
            fail_all_pending(&pending_reader, &reason.message);
            if reason.deterministic {
                // A respawn would fail identically (e.g. ~/.piwin owned by
                // another process); stop and show the reason instead.
                emit_log(
                    &app_reader,
                    "error",
                    format!(
                        "host process cannot start: {}; not restarting",
                        reason.message
                    ),
                );
                emit_fatal_status(&app_reader, Some(&reason.message));
                return;
            }
            emit_log(
                &app_reader,
                "error",
                format!(
                    "host process died unexpectedly ({}) — supervisor will restart",
                    reason.message
                ),
            );
            let last_reason = reason.message;
            // Spawn a supervisor thread that retries host_start with backoff.
            // The reader thread exits after launching the supervisor; the
            // supervisor's host_start_blocking will spawn a fresh reader.
            thread::spawn(move || {
                supervise_restart(
                    app_for_supervisor,
                    inner_for_supervisor,
                    lifecycle_for_supervisor,
                    mock_flag_for_supervisor,
                    restart_attempts,
                    spawned_at.elapsed(),
                    last_reason,
                );
            });
        }
    });
}

/// Forwards the sidecar's stderr as warning logs; diagnostics only.
pub(super) fn spawn_stderr_reader(
    app: AppHandle,
    stderr: ChildStderr,
    diagnostics: Arc<HostExitDiagnostics>,
) {
    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            if let Ok(line) = line_result {
                if !line.trim().is_empty() {
                    diagnostics.record_stderr_line(&line);
                    emit_log(&app_err, "warn", format!("host stderr: {line}"));
                }
            } else {
                break;
            }
        }
        diagnostics.mark_stderr_closed();
    });
}

/// The tracked process these readers belong to, if it is still the current one.
fn find_process(
    inner: &Mutex<Option<Arc<HostProcess>>>,
    diagnostics: &Arc<HostExitDiagnostics>,
) -> Option<Arc<HostProcess>> {
    inner
        .lock()
        .ok()
        .and_then(|guard| guard.clone())
        .filter(|process| Arc::ptr_eq(&process.diagnostics, diagnostics))
}
