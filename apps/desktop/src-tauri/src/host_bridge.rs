use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

pub struct HostBridgeState {
    pub inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    /// Remembers the last mock flag so the supervisor can restart with the
    /// same mode. Set by `host_start_blocking` on every successful spawn.
    mock: Arc<AtomicBool>,
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

/// Auto-restart backoff schedule (ADR: host death must not require app restart).
/// Each entry is the delay before that retry attempt. After the schedule is
/// exhausted, the supervisor gives up and surfaces a fatal log to the UI.
const RESTART_BACKOFF_SCHEDULE: &[Duration] = &[
    Duration::from_millis(500),
    Duration::from_millis(1_000),
    Duration::from_millis(2_000),
    Duration::from_millis(4_000),
];

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
            mock: Arc::new(AtomicBool::new(false)),
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct HostLogPayload {
    level: String,
    message: String,
}

/// Status payload emitted to the UI so it can show reconnecting / fatal states
/// without leaking the word "host" into user-facing copy. The UI maps
/// `reconnecting` → "piwin 正在重连" and `fatal` → "piwin 遇到问题".
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct HostStatusPayload {
    /// "reconnecting" | "restarted" | "fatal"
    state: String,
    /// Retry attempt number (1-based) when state == "reconnecting".
    attempt: Option<u32>,
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

fn emit_status(app: &AppHandle, state: &str, attempt: Option<u32>) {
    let _ = app.emit(
        "host-status",
        HostStatusPayload {
            state: state.to_string(),
            attempt,
        },
    );
}

/// Deliver unsolicited host pushes only to the main WebView. Responses are
/// correlated with `host_request` through the pending map and must never enter
/// this event lane: broadcasting them would make every subscriber process a
/// request result a second time.
fn host_push_event_name(parsed: &Value) -> Option<&'static str> {
    match parsed.get("type").and_then(Value::as_str) {
        Some("response") => None,
        Some("push/batch") => Some("host-message-batch"),
        Some(_) => Some("host-message"),
        None => None,
    }
}

fn emit_host_push(app: &AppHandle, parsed: &Value) {
    let Some(event_name) = host_push_event_name(parsed) else {
        return;
    };
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let _ = main_window.emit(event_name, parsed);
}

/// How the host process was resolved (ADR 0017 two-tier spawn).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HostCommandTier {
    /// Packaged sidecar: bundled Node + host-serve.mjs under resources.
    Packaged,
    /// Dev: pnpm/tsx against the workspace checkout (unchanged).
    Dev,
}

/// Optional filesystem layout for the packaged tier (unit-testable without Tauri).
#[derive(Debug, Clone)]
pub(crate) struct PackagedHostPaths {
    pub node_bin: PathBuf,
    pub host_js: PathBuf,
    pub bundled_assets: PathBuf,
    pub cwd: PathBuf,
}

/// Pure resolution decision used by spawn and unit tests.
pub(crate) fn resolve_host_command_tiered(
    mock: bool,
    packaged: Option<&PackagedHostPaths>,
) -> Result<(String, Vec<String>, HostCommandTier, Option<PathBuf>), String> {
    if let Some(paths) = packaged {
        if paths.node_bin.is_file() && paths.host_js.is_file() {
            let mut args = vec![
                paths.host_js.to_string_lossy().into_owned(),
                "host".to_string(),
                "serve".to_string(),
                "--mode".to_string(),
                "sdk".to_string(),
            ];
            if mock {
                args.push("--mock".to_string());
            }
            let assets = if paths.bundled_assets.is_dir() {
                Some(paths.bundled_assets.clone())
            } else {
                None
            };
            return Ok((
                paths.node_bin.to_string_lossy().into_owned(),
                args,
                HostCommandTier::Packaged,
                assets,
            ));
        }
    }

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

    Ok((pnpm, args, HostCommandTier::Dev, None))
}

fn detect_host_triple() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (os, arch) {
        ("macos", "aarch64") => "aarch64-apple-darwin".to_string(),
        ("macos", "x86_64") => "x86_64-apple-darwin".to_string(),
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu".to_string(),
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu".to_string(),
        ("windows", "x86_64") => "x86_64-pc-windows-msvc".to_string(),
        _ => format!("{arch}-unknown-{os}"),
    }
}

fn find_sidecar_node(resource_dir: &std::path::Path) -> Option<PathBuf> {
    let triple = detect_host_triple();
    let exe_name = if cfg!(windows) {
        "piwin-host.exe"
    } else {
        "piwin-host"
    };
    let triple_name = if cfg!(windows) {
        format!("piwin-host-{triple}.exe")
    } else {
        format!("piwin-host-{triple}")
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(exe_name));
            candidates.push(dir.join(&triple_name));
        }
    }
    candidates.push(resource_dir.join(exe_name));
    candidates.push(resource_dir.join(&triple_name));
    // Dev packaging dry-run: binaries next to Cargo.toml.
    // `packaged_host_paths_from_resource_dir` guards against placeholder
    // host-serve.mjs stubs, so this candidate is safe in dev too.
    let manifest_binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    candidates.push(manifest_binaries.join(&triple_name));
    candidates.push(manifest_binaries.join(exe_name));

    candidates.into_iter().find(|path| path.is_file())
}

fn packaged_host_paths_from_resource_dir(
    resource_dir: &std::path::Path,
) -> Option<PackagedHostPaths> {
    let host_js = resource_dir.join("host").join("host-serve.mjs");
    let node_bin = find_sidecar_node(resource_dir)?;
    if !host_js.is_file() {
        return None;
    }
    // Reject placeholder stubs created by `ensure-packaging-placeholders`.
    // The real bundled host-serve.mjs is several KB; the placeholder is ~65
    // bytes. Without this guard, dev builds spawn Node on an empty file and
    // the sidecar exits immediately.
    if let Ok(metadata) = std::fs::metadata(&host_js) {
        if metadata.len() < 200 {
            return None;
        }
    }
    Some(PackagedHostPaths {
        node_bin,
        host_js: host_js.clone(),
        bundled_assets: resource_dir.join("host").join("bundled-assets"),
        cwd: resource_dir.join("host"),
    })
}

fn resolve_host_command(
    mock: bool,
    resource_dir: Option<PathBuf>,
) -> Result<
    (
        String,
        Vec<String>,
        HostCommandTier,
        Option<PathBuf>,
        PathBuf,
    ),
    String,
> {
    let packaged = resource_dir
        .as_ref()
        .and_then(|dir| packaged_host_paths_from_resource_dir(dir));
    let (program, args, tier, assets) = resolve_host_command_tiered(mock, packaged.as_ref())?;

    let cwd = match (&tier, packaged) {
        (HostCommandTier::Packaged, Some(paths)) => paths.cwd,
        _ => {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest_dir
                .join("../../..")
                .canonicalize()
                .map_err(|error| format!("resolve repo root: {error}"))?
        }
    };

    Ok((program, args, tier, assets, cwd))
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
    let mock_flag = Arc::clone(&state.mock);
    tauri::async_runtime::spawn_blocking(move || {
        host_start_blocking(app, inner, lifecycle, mock_flag, mock)
    })
    .await
    .map_err(|error| format!("host_start worker failed: {error}"))?
}

fn host_start_blocking(
    app: AppHandle,
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock_flag: Arc<AtomicBool>,
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

    let resource_dir = app
        .path()
        .resource_dir()
        .ok()
        .and_then(|path| path.canonicalize().ok());
    let (program, args, tier, assets_root, cwd) = resolve_host_command(mock, resource_dir)?;
    emit_log(
        &app,
        "info",
        format!(
            "host spawn tier={tier:?} program={program} args={} cwd={}",
            args.join(" "),
            cwd.display()
        ),
    );

    let mut command = Command::new(&program);
    command
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PIWIN_MOCK", if mock { "1" } else { "0" });
    if let Some(assets) = assets_root {
        command.env("PIWIN_BUNDLED_ASSETS_ROOT", assets);
    }
    // Packaged host resolves externals from host/node_modules next to host-serve.mjs.
    if tier == HostCommandTier::Packaged {
        let nm = cwd.join("node_modules");
        if nm.is_dir() {
            command.env("NODE_PATH", nm);
        }
    }

    let mut child = command.spawn().map_err(|error| {
        format!(
            "failed to spawn host serve via `{program}` (tier={tier:?}): {error}. \
             Dev requires pnpm/tsx on PATH; packaged builds need the host sidecar."
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
    // Remember the mock flag so the supervisor can restart with the same mode.
    mock_flag.store(mock, Ordering::Release);

    Ok(serde_json::json!({ "started": true, "mock": mock }))
}

/// Supervisor: retries `host_start_blocking` with exponential backoff after an
/// unexpected sidecar death. Emits `host-status` events so the UI can surface
/// "reconnecting" / "fatal" states without polling. Gives up after
/// `RESTART_BACKOFF_SCHEDULE` attempts and emits a fatal status.
fn supervise_restart(
    app: AppHandle,
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock_flag: Arc<AtomicBool>,
) {
    let mock = mock_flag.load(Ordering::Acquire);
    for (index, delay) in RESTART_BACKOFF_SCHEDULE.iter().enumerate() {
        let attempt = (index + 1) as u32;
        emit_status(&app, "reconnecting", Some(attempt));
        emit_log(
            &app,
            "warn",
            format!(
                "host supervisor: retry {}/{} in {:?} (mock={mock})",
                attempt,
                RESTART_BACKOFF_SCHEDULE.len(),
                delay
            ),
        );
        thread::sleep(*delay);

        // If a manual host_stop or a concurrent host_start already replaced
        // the process, don't fight it — check if the current one is alive.
        if let Some(existing) = inner.lock().ok().and_then(|guard| guard.clone()) {
            if existing.alive.load(Ordering::Acquire) {
                emit_log(
                    &app,
                    "info",
                    "host supervisor: process already alive, aborting restart",
                );
                return;
            }
        }

        match host_start_blocking(
            app.clone(),
            Arc::clone(&inner),
            Arc::clone(&lifecycle),
            Arc::clone(&mock_flag),
            mock,
        ) {
            Ok(_) => {
                emit_status(&app, "restarted", None);
                emit_log(&app, "info", "host supervisor: restart succeeded");
                return;
            }
            Err(error) => {
                emit_log(
                    &app,
                    "error",
                    format!(
                        "host supervisor: restart {}/{} failed: {error}",
                        attempt,
                        RESTART_BACKOFF_SCHEDULE.len()
                    ),
                );
            }
        }
    }
    emit_status(&app, "fatal", None);
    emit_log(
        &app,
        "error",
        format!(
            "host supervisor: exhausted {} restart attempts",
            RESTART_BACKOFF_SCHEDULE.len()
        ),
    );
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
    fn host_push_event_routing_keeps_responses_out_of_the_push_lane() {
        assert_eq!(
            host_push_event_name(&serde_json::json!({"type": "response"})),
            None
        );
        assert_eq!(
            host_push_event_name(&serde_json::json!({"type": "push/batch"})),
            Some("host-message-batch")
        );
        assert_eq!(
            host_push_event_name(&serde_json::json!({"type": "event"})),
            Some("host-message")
        );
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

    #[test]
    fn resolve_host_command_defaults_to_dev_when_packaged_absent() {
        let (program, args, tier, assets) =
            resolve_host_command_tiered(false, None).expect("dev resolve");
        assert_eq!(tier, HostCommandTier::Dev);
        assert!(assets.is_none());
        assert!(program.contains("pnpm") || program == "pnpm");
        assert!(args.iter().any(|arg| arg == "tsx"));
        assert!(args.iter().any(|arg| arg == "host"));
    }

    #[test]
    fn resolve_host_command_uses_packaged_when_paths_exist() {
        let dir = std::env::temp_dir().join(format!(
            "piwin-host-resolve-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("host")).expect("mkdir host");
        let node_bin = dir.join("piwin-host");
        let host_js = dir.join("host").join("host-serve.mjs");
        let assets = dir.join("host").join("bundled-assets");
        std::fs::write(&node_bin, b"#!/bin/sh\n").expect("write node");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = std::fs::metadata(&node_bin).expect("meta").permissions();
            perms.set_mode(0o755);
            std::fs::set_permissions(&node_bin, perms).expect("chmod");
        }
        std::fs::write(&host_js, b"// host\n").expect("write js");
        std::fs::create_dir_all(&assets).expect("mkdir assets");

        let packaged = PackagedHostPaths {
            node_bin: node_bin.clone(),
            host_js: host_js.clone(),
            bundled_assets: assets.clone(),
            cwd: dir.join("host"),
        };
        let (program, args, tier, assets_env) =
            resolve_host_command_tiered(true, Some(&packaged)).expect("packaged resolve");
        assert_eq!(tier, HostCommandTier::Packaged);
        assert_eq!(program, node_bin.to_string_lossy());
        assert_eq!(args[0], host_js.to_string_lossy());
        assert!(args.iter().any(|arg| arg == "--mock"));
        assert_eq!(assets_env, Some(assets));

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn resolve_host_command_falls_back_when_packaged_incomplete() {
        let packaged = PackagedHostPaths {
            node_bin: PathBuf::from("/nonexistent/piwin-host"),
            host_js: PathBuf::from("/nonexistent/host-serve.mjs"),
            bundled_assets: PathBuf::from("/nonexistent/bundled-assets"),
            cwd: PathBuf::from("/nonexistent"),
        };
        let (_program, _args, tier, assets) =
            resolve_host_command_tiered(false, Some(&packaged)).expect("fallback");
        assert_eq!(tier, HostCommandTier::Dev);
        assert!(assets.is_none());
    }
}
