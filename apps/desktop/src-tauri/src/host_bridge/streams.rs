//! Child stream readers: the stdout JSONL protocol lane and stderr log
//! forwarding.

use super::*;
use std::process::{ChildStderr, ChildStdout};
use super::logs::emit_host_push;
use super::supervisor::supervise_restart;

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
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock_flag: Arc<AtomicBool>,
) {
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
        alive_reader.store(false, Ordering::Release);
        if shutting_down_reader.load(Ordering::Acquire) {
            emit_log(
                &app_reader,
                "info",
                "host process stdout closed during shutdown",
            );
        } else {
            fail_all_pending(&pending_reader, "stdout closed");
            emit_log(
                &app_reader,
                "error",
                "host process stdout closed unexpectedly — supervisor will restart",
            );
            // Spawn a supervisor thread that retries host_start with backoff.
            // The reader thread exits after launching the supervisor; the
            // supervisor's host_start_blocking will spawn a fresh reader.
            thread::spawn(move || {
                supervise_restart(
                    app_for_supervisor,
                    inner_for_supervisor,
                    lifecycle_for_supervisor,
                    mock_flag_for_supervisor,
                );
            });
        }
    });
}

/// Forwards the sidecar's stderr as warning logs; diagnostics only.
pub(super) fn spawn_stderr_reader(app: AppHandle, stderr: ChildStderr) {
    let app_err = app.clone();
    thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line_result in reader.lines() {
            if let Ok(line) = line_result {
                if !line.trim().is_empty() {
                    emit_log(&app_err, "warn", format!("host stderr: {line}"));
                }
            } else {
                break;
            }
        }
    });
}
