use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

pub struct HostBridgeState {
    inner: Mutex<Option<HostProcess>>,
}

struct HostProcess {
    child: Child,
    stdin: ChildStdin,
    pending: Arc<Mutex<HashMap<String, PendingResponse>>>,
}

struct PendingResponse {
    tx: std::sync::mpsc::Sender<Value>,
}

static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

impl Default for HostBridgeState {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
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
    // Prefer workspace root relative to this crate: apps/desktop/src-tauri -> repo root
    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let repo_root = manifest_dir
        .join("../../..")
        .canonicalize()
        .map_err(|error| format!("resolve repo root: {error}"))?;

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

    // Use CLI package cwd so relative paths resolve
    Ok((pnpm, args))
}

use std::path::PathBuf;

fn which(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    // common locations
    for candidate in [
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!("{}/.local/share/pnpm/{bin}", std::env::var("HOME").unwrap_or_default()),
    ] {
        if PathBuf::from(&candidate).is_file() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
pub fn host_start(
    app: AppHandle,
    state: State<'_, HostBridgeState>,
    mock: bool,
) -> Result<Value, String> {
    let mut guard = state.inner.lock().map_err(|error| error.to_string())?;
    if guard.is_some() {
        return Ok(serde_json::json!({ "alreadyRunning": true, "mock": mock }));
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
        format!("starting host: {program} {} (cwd={})", args.join(" "), repo_root.display()),
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
    let pending_reader = Arc::clone(&pending);
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

            // Response lines include type=response and optional id
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

            // Always push raw server messages to UI (status/event/response)
            let _ = app_reader.emit("host-message", parsed);
        }
        emit_log(&app_reader, "info", "host stdout closed");
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

    *guard = Some(HostProcess {
        child,
        stdin,
        pending,
    });

    Ok(serde_json::json!({ "started": true, "mock": mock }))
}

#[tauri::command]
pub fn host_stop(state: State<'_, HostBridgeState>) -> Result<Value, String> {
    let mut guard = state.inner.lock().map_err(|error| error.to_string())?;
    if let Some(mut process) = guard.take() {
        let _ = process.child.kill();
        let _ = process.child.wait();
    }
    Ok(serde_json::json!({ "stopped": true }))
}

#[tauri::command]
pub fn host_request(
    state: State<'_, HostBridgeState>,
    command: Value,
    timeout_ms: Option<u64>,
) -> Result<Value, String> {
    let mut guard = state.inner.lock().map_err(|error| error.to_string())?;
    let process = guard
        .as_mut()
        .ok_or_else(|| "host process is not running; call host_start first".to_string())?;

    let mut command = command;
    let id = command
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            format!(
                "tauri-{}",
                REQUEST_SEQ.fetch_add(1, Ordering::Relaxed)
            )
        });

    if let Some(object) = command.as_object_mut() {
        object.insert("id".to_string(), Value::String(id.clone()));
    }

    let (tx, rx) = std::sync::mpsc::channel::<Value>();
    {
        let mut pending = process
            .pending
            .lock()
            .map_err(|error| error.to_string())?;
        pending.insert(id.clone(), PendingResponse { tx });
    }

    let payload = serde_json::to_string(&command).map_err(|error| error.to_string())?;
    process
        .stdin
        .write_all(payload.as_bytes())
        .and_then(|_| process.stdin.write_all(b"\n"))
        .and_then(|_| process.stdin.flush())
        .map_err(|error| format!("write host stdin failed: {error}"))?;

    // Unlock while waiting so reader thread can complete.
    drop(guard);

    let timeout = Duration::from_millis(timeout_ms.unwrap_or(30_000));
    let started = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(value) => return Ok(value),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if started.elapsed() >= timeout {
                    // cleanup pending
                    if let Ok(mut g) = state.inner.lock() {
                        if let Some(process) = g.as_mut() {
                            if let Ok(mut pending) = process.pending.lock() {
                                pending.remove(&id);
                            }
                        }
                    }
                    return Err(format!("host request timed out after {}ms (id={id})", timeout.as_millis()));
                }
            }
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err("host response channel disconnected".to_string());
            }
        }
    }
}

#[tauri::command]
pub fn host_is_running(state: State<'_, HostBridgeState>) -> Result<bool, String> {
    let guard = state.inner.lock().map_err(|error| error.to_string())?;
    Ok(guard.is_some())
}
