use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

pub struct HostBridgeState {
    pub inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
}

pub(crate) struct HostProcess {
    child: Mutex<Child>,
    stdin: Mutex<Option<ChildStdin>>,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
    /// Set to false when the stdout reader thread exits (process died).
    alive: Arc<AtomicBool>,
    /// Prevents the stdout reader from treating expected shutdown EOF as a crash.
    shutting_down: Arc<AtomicBool>,
}

struct PendingResponse {
    tx: std::sync::mpsc::Sender<Value>,
}

static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);
const HOST_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(750);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);

#[derive(Debug, PartialEq, Eq)]
enum StopOutcome {
    GracefulExit,
    AbnormalExit,
    ForcedKill,
}

impl Default for HostBridgeState {
    fn default() -> Self {
        Self {
            inner: Arc::new(Mutex::new(None)),
            lifecycle: Arc::new(Mutex::new(())),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct HostLogPayload {
    level: String,
    message: String,
}

fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "host-log",
        HostLogPayload {
            level: level.to_string(),
            message: message.into(),
        },
    );
}

fn resolve_host_command(mock: bool) -> Result<(String, Vec<String>), String> {
    let pnpm = which("pnpm").unwrap_or_else(|| "pnpm".to_string());
    let mut args = vec![
        "--filter".to_string(),
        "@piwin/cli".to_string(),
        "exec".to_string(),
        "tsx".to_string(),
        "src/index.ts".to_string(),
        "host".to_string(),
        "serve".to_string(),
        "--mode".to_string(),
        "sdk".to_string(),
    ];
    if mock {
        args.push("--mock".to_string());
    }

    Ok((pnpm, args))
}

fn which(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    for candidate in [
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!(
            "{}/.local/share/pnpm/{bin}",
            std::env::var("HOME").unwrap_or_default()
        ),
    ] {
        if PathBuf::from(&candidate).is_file() {
            return Some(candidate);
        }
    }
    None
}

/// Drain all pending requests with an error so callers fail immediately
/// instead of waiting for a 60s timeout on a dead process.
fn fail_all_pending(pending: &Mutex<HashMap<String, PendingResponse>>, reason: &str) {
    if let Ok(mut map) = pending.lock() {
        let error_response = serde_json::json!({
            "type": "response",
            "success": false,
            "error": format!("host process died: {reason}"),
        });
        for (_id, entry) in map.drain() {
            let _ = entry.tx.send(error_response.clone());
        }
    }
}

fn fail_pending_after_stop(
    pending: &Mutex<HashMap<String, PendingResponse>>,
    outcome: &StopOutcome,
) {
    match outcome {
        StopOutcome::GracefulExit => {}
        StopOutcome::AbnormalExit => {
            fail_all_pending(pending, "host process exited abnormally during shutdown")
        }
        StopOutcome::ForcedKill => {
            fail_all_pending(pending, "host process required forced termination")
        }
    }
}

#[tauri::command]
pub async fn host_start(
    app: AppHandle,
    state: State<'_, HostBridgeState>,
    mock: bool,
) -> Result<Value, String> {
    let inner = Arc::clone(&state.inner);
    let lifecycle = Arc::clone(&state.lifecycle);
    tauri::async_runtime::spawn_blocking(move || host_start_blocking(app, inner, lifecycle, mock))
        .await
        .map_err(|error| format!("host_start worker failed: {error}"))?
}

fn host_start_blocking(
    app: AppHandle,
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock: bool,
) -> Result<Value, String> {
    let _lifecycle_guard = lifecycle.lock().map_err(|error| error.to_string())?;

    // If a previous process is still tracked but dead, clean it up so we can restart.
    let existing = inner.lock().map_err(|error| error.to_string())?.clone();
    if let Some(existing) = existing {
        let still_alive = existing.alive.load(Ordering::Acquire);
        let exited = process_has_exited(&existing);
        if !still_alive || exited {
            fail_all_pending(&existing.pending, "previous process exited");
            let _ = stop_process(&existing);
            let mut guard = inner.lock().map_err(|error| error.to_string())?;
            if guard
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &existing))
            {
                guard.take();
            }
            emit_log(&app, "warn", "cleaned up dead host process before restart");
        } else {
            return Ok(serde_json::json!({ "alreadyRunning": true, "mock": mock }));
        }
    }

    let (program, args) = resolve_host_command(mock)?;
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .join("../../..")
        .canonicalize()
        .map_err(|error| format!("resolve repo root: {error}"))?;
    emit_log(
        &app,
        "info",
        format!(
            "starting host: {program} {} (cwd={})",
            args.join(" "),
            repo_root.display()
        ),
    );

    let mut child = Command::new(&program)
        .args(&args)
        .current_dir(&repo_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PIWIN_MOCK", if mock { "1" } else { "0" })
        .spawn()
        .map_err(|error| {
            format!(
                "failed to spawn host serve via `{program}`: {error}. Ensure pnpm/tsx are on PATH."
            )
        })?;

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "host process missing stdin".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "host process missing stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "host process missing stderr".to_string())?;

    let pending: Arc<Mutex<HashMap<String, PendingResponse>>> =
        Arc::new(Mutex::new(HashMap::new()));
    let alive = Arc::new(AtomicBool::new(true));
    let shutting_down = Arc::new(AtomicBool::new(false));

    let pending_reader = Arc::clone(&pending);
    let alive_reader = Arc::clone(&alive);
    let shutting_down_reader = Arc::clone(&shutting_down);
    let app_reader = app.clone();

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
            }

            let _ = app_reader.emit("host-message", parsed);
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
                "host process stdout closed — host is dead",
            );
        }
    });

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

    let process = Arc::new(HostProcess {
        child: Mutex::new(child),
        stdin: Mutex::new(Some(stdin)),
        pending,
        alive,
        shutting_down,
    });
    let mut guard = inner.lock().map_err(|error| error.to_string())?;
    *guard = Some(process);

    Ok(serde_json::json!({ "started": true, "mock": mock }))
}

#[tauri::command]
pub async fn host_stop(state: State<'_, HostBridgeState>) -> Result<Value, String> {
    let inner = Arc::clone(&state.inner);
    let lifecycle = Arc::clone(&state.lifecycle);
    tauri::async_runtime::spawn_blocking(move || host_stop_blocking(inner, lifecycle))
        .await
        .map_err(|error| format!("host_stop worker failed: {error}"))?
}

fn host_stop_blocking(
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
) -> Result<Value, String> {
    let _lifecycle_guard = lifecycle.lock().map_err(|error| error.to_string())?;
    let process = inner.lock().map_err(|error| error.to_string())?.take();
    if let Some(process) = process {
        let stop_outcome = stop_process(&process)?;
        return Ok(serde_json::json!({
            "stopped": true,
            "outcome": format!("{stop_outcome:?}"),
        }));
    }
    Ok(serde_json::json!({ "stopped": true }))
}

#[tauri::command]
pub async fn host_request(
    state: State<'_, HostBridgeState>,
    command: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let inner = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || host_request_blocking(inner, command, timeout_ms))
        .await
        .map_err(|error| format!("host_request worker failed: {error}"))?
}

pub fn host_request_blocking(
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    command: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let process = inner
        .lock()
        .map_err(|error| error.to_string())?
        .clone()
        .ok_or_else(|| "host process is not running; call host_start first".to_string())?;

    // Fast-fail if the process is already known dead.
    if !process.alive.load(Ordering::Acquire) {
        return Err("host process is dead (stdout closed). Restart with host_start.".to_string());
    }

    // Also check if the OS-level process has exited.
    if process_has_exited(&process) {
        process.alive.store(false, Ordering::Release);
        fail_all_pending(&process.pending, "process exited");
        return Err("host process exited unexpectedly. Restart with host_start.".to_string());
    }

    let mut command = command;
    let id = command
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("tauri-{}", REQUEST_SEQ.fetch_add(1, Ordering::Relaxed)));

    if let Some(object) = command.as_object_mut() {
        object.insert("id".to_string(), Value::String(id.clone()));
    }

    let (tx, rx) = std::sync::mpsc::channel::<Value>();
    {
        let mut pending = process.pending.lock().map_err(|error| error.to_string())?;
        pending.insert(id.clone(), PendingResponse { tx });
    }

    let payload = serde_json::to_string(&command).map_err(|error| error.to_string())?;
    let write_result = {
        let mut stdin = process.stdin.lock().map_err(|error| error.to_string())?;
        let stdin = stdin
            .as_mut()
            .ok_or_else(|| "host process stdin is closed".to_string())?;
        stdin
            .write_all(payload.as_bytes())
            .and_then(|_| stdin.write_all(b"\n"))
            .and_then(|_| stdin.flush())
    };
    if let Err(error) = write_result {
        // Write failed — process likely dead. Clean up and report.
        if let Ok(mut pending) = process.pending.lock() {
            pending.remove(&id);
        }
        process.alive.store(false, Ordering::Release);
        return Err(format!("write host stdin failed (process dead?): {error}"));
    }

    // Unlock while waiting so reader thread can deliver responses.
    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000));
    let started = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(value) => return Ok(value),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if started.elapsed() >= timeout {
                    if let Ok(mut pending) = process.pending.lock() {
                        pending.remove(&id);
                    }
                    return Err(format!(
                        "host request timed out after {}ms (id={id})",
                        timeout.as_millis()
                    ));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(format!(
                    "host process died while waiting for response (id={id})"
                ));
            }
        }
    }
}

#[tauri::command]
pub async fn host_is_running(state: State<'_, HostBridgeState>) -> Result<bool, String> {
    let inner = Arc::clone(&state.inner);
    tauri::async_runtime::spawn_blocking(move || host_is_running_blocking(inner))
        .await
        .map_err(|error| format!("host_is_running worker failed: {error}"))?
}

fn host_is_running_blocking(inner: Arc<Mutex<Option<Arc<HostProcess>>>>) -> Result<bool, String> {
    let process = inner.lock().map_err(|error| error.to_string())?.clone();
    if let Some(process) = process {
        if !process.alive.load(Ordering::Acquire) {
            return Ok(false);
        }
        if process_has_exited(&process) {
            process.alive.store(false, Ordering::Release);
            return Ok(false);
        }
        Ok(true)
    } else {
        Ok(false)
    }
}

/**
 * E4: collect bounded, non-secret observability data before shutting down the
 * host bridge. Returns sidecar PID, MCP child PIDs (from mcp/status), and a
 * snapshot of pending request count.
 *
 * This must be called BEFORE host_stop closes stdin, so the host can still
 * respond to `mcp/status`.
 */
pub struct HostObservability {
    pub sidecar_pid: Option<i32>,
    pub host_alive: bool,
    pub pending_request_count: usize,
}

/**
 * Retrieve bounded observability from the host process. Returns sidecar PID
 * (if known), liveness flag, and pending request count.
 *
 * This acquires the child lock briefly to call try_wait() and id(). It does
 * NOT close stdin or send any commands.
 */
pub fn observe_host_process_blocking(
    inner: &Arc<Mutex<Option<Arc<HostProcess>>>>,
) -> HostObservability {
    let process = match inner.lock().ok().and_then(|guard| guard.clone()) {
        Some(process) => process,
        None => {
            return HostObservability {
                sidecar_pid: None,
                host_alive: false,
                pending_request_count: 0,
            };
        }
    };

    let alive = process.alive.load(Ordering::Acquire);
    let pid = process.child.lock().ok().map(|child| child.id() as i32);

    HostObservability {
        sidecar_pid: pid,
        host_alive: alive,
        pending_request_count: process.pending.lock().ok().map_or(0, |map| map.len()),
    }
}

fn process_has_exited(process: &HostProcess) -> bool {
    process
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.try_wait().ok())
        .flatten()
        .is_some()
}

fn stop_process(process: &HostProcess) -> Result<StopOutcome, String> {
    // Publish this before closing the pipe so the reader can distinguish
    // expected EOF from an unexpected sidecar death.
    process.shutting_down.store(true, Ordering::Release);
    close_stdin(process)?;

    // host serve treats stdin EOF as a shutdown request. Give its runtime a
    // short bounded window to flush/dispose before using process termination.
    if let Some(exit_status) = wait_for_process_exit(process, HOST_GRACEFUL_SHUTDOWN_TIMEOUT) {
        let exit_status = reap_process(process).map(|_| exit_status)?;
        process.alive.store(false, Ordering::Release);
        let outcome = if exit_status.success() {
            StopOutcome::GracefulExit
        } else {
            StopOutcome::AbnormalExit
        };
        fail_pending_after_stop(&process.pending, &outcome);
        return Ok(outcome);
    }

    let kill_result = {
        let mut child = process
            .child
            .lock()
            .map_err(|error| format!("lock host child for termination: {error}"))?;
        child
            .kill()
            .map_err(|error| format!("terminate host process: {error}"))
    };
    let reap_result = reap_process(process);
    process.alive.store(false, Ordering::Release);
    fail_pending_after_stop(&process.pending, &StopOutcome::ForcedKill);

    kill_result
        .and(reap_result)
        .map(|_| StopOutcome::ForcedKill)
}

fn close_stdin(process: &HostProcess) -> Result<(), String> {
    let stdin_to_close = process
        .stdin
        .lock()
        .map_err(|error| format!("lock host stdin for shutdown: {error}"))?
        .take();
    // Drop the pipe after releasing the mutex. This unblocks the sidecar's
    // readline loop without retaining the stdin lock during any wait.
    drop(stdin_to_close);
    Ok(())
}

fn wait_for_process_exit(process: &HostProcess, timeout: Duration) -> Option<ExitStatus> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(exit_status) = process_exit_status(process) {
            return Some(exit_status);
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
    process_exit_status(process)
}

fn process_exit_status(process: &HostProcess) -> Option<ExitStatus> {
    process
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.try_wait().ok())
        .flatten()
}

fn reap_process(process: &HostProcess) -> Result<ExitStatus, String> {
    let mut child = process
        .child
        .lock()
        .map_err(|error| format!("lock host child for reaping: {error}"))?;
    child
        .wait()
        .map_err(|error| format!("reap host process: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn graceful_exit_keeps_pending_response_receiver_available() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let pending = Mutex::new(HashMap::from([(
            "request-1".to_string(),
            PendingResponse { tx: sender },
        )]));

        fail_pending_after_stop(&pending, &StopOutcome::GracefulExit);

        assert!(receiver.try_recv().is_err());
        assert_eq!(pending.lock().expect("pending lock").len(), 1);
    }

    #[test]
    fn abnormal_exit_fails_pending_response_receiver() {
        let (sender, receiver) = std::sync::mpsc::channel();
        let pending = Mutex::new(HashMap::from([(
            "request-1".to_string(),
            PendingResponse { tx: sender },
        )]));

        fail_pending_after_stop(&pending, &StopOutcome::AbnormalExit);

        let response = receiver.try_recv().expect("pending request failure");
        assert_eq!(response["success"], false);
        assert!(pending.lock().expect("pending lock").is_empty());
    }
}
