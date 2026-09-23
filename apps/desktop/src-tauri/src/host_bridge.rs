use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

mod logs;
mod pending;
mod process;
mod resolve;
mod streams;
mod supervisor;

use logs::{emit_log, emit_status};
use pending::{
    assign_host_request_id, fail_all_pending, resolve_host_request_timeout, PendingResponse,
};
use process::{process_has_exited, stop_process, StopOutcome};
use resolve::{resolve_host_command, HostCommandTier};
use streams::{spawn_stderr_reader, spawn_stdout_reader};

// Re-exported for `lib.rs`, which drives stop-time observability.
pub use process::{observe_host_process_blocking, HostObservability};

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

const HOST_GRACEFUL_SHUTDOWN_TIMEOUT: Duration = Duration::from_millis(750);
const PROCESS_POLL_INTERVAL: Duration = Duration::from_millis(25);

pub(crate) const SHELL_ONLY_HOST_START_ERROR: &str =
    "this Desktop build cannot start a local Host; attach to a running Host";

pub(crate) fn is_shell_only_build() -> bool {
    cfg!(feature = "shell-only")
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
    if is_shell_only_build() {
        return Err(SHELL_ONLY_HOST_START_ERROR.to_string());
    }
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

    // Force packaged builds to own ~/.piwin; in dev mode allow PIWIN_ROOT override.
    let piwin_root = if tier != HostCommandTier::Packaged && std::env::var("PIWIN_ROOT").is_ok() {
        std::env::var("PIWIN_ROOT").ok().map(PathBuf::from)
    } else {
        app.path().home_dir().ok().map(|home| home.join(".piwin"))
    };
    if let Some(root) = piwin_root.as_ref() {
        command.env("PIWIN_ROOT", root.as_os_str());
        // Playwright snapshots PLAYWRIGHT_BROWSERS_PATH on first import. Set it
        // before JS loads so first-use Chromium lands in ~/.piwin/playwright.
        let browsers_override = if tier == HostCommandTier::Packaged {
            None
        } else {
            std::env::var("PIWIN_PLAYWRIGHT_BROWSERS_PATH")
                .ok()
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        };
        match browsers_override {
            Some(path) => {
                command.env("PLAYWRIGHT_BROWSERS_PATH", path);
            }
            None => {
                command.env(
                    "PLAYWRIGHT_BROWSERS_PATH",
                    root.join("playwright").as_os_str(),
                );
            }
        }
    }
    if tier == HostCommandTier::Packaged {
        // The bundled Host must ignore a launcher environment such as
        // PIWIN_ROOT=~/.piwin-test and always own the user's default root.
        command.env("PIWIN_DESKTOP_BUNDLED", "1");
    }

    command
        .args(&args)
        .current_dir(&cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .env("PIWIN_MOCK", if mock { "1" } else { "0" });
    // CREATE_NO_WINDOW. A console Host otherwise flashes conhost.
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
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

    spawn_stdout_reader(
        app.clone(),
        stdout,
        Arc::clone(&pending),
        Arc::clone(&alive),
        Arc::clone(&shutting_down),
        Arc::clone(&inner),
        Arc::clone(&lifecycle),
        Arc::clone(&mock_flag),
    );
    spawn_stderr_reader(app.clone(), stderr);

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
    let id = assign_host_request_id(&mut command);

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
    // Model-backed operations such as compaction are cancellable through a
    // separate control command and must not be reported as failed merely
    // because generation took longer than an acknowledgement timeout. A
    // caller-provided zero disables this transport deadline; omission keeps
    // the defensive default for ordinary requests.
    let timeout = resolve_host_request_timeout(timeout_ms);
    let started = Instant::now();
    loop {
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(value) => return Ok(value),
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                if timeout.is_some_and(|deadline| started.elapsed() >= deadline) {
                    if let Ok(mut pending) = process.pending.lock() {
                        pending.remove(&id);
                    }
                    return Err(format!(
                        "host request timed out after {}ms (id={id})",
                        timeout.map_or(0, |deadline| deadline.as_millis())
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

#[cfg(test)]
mod tests {
    use super::logs::host_push_event_name;
    use super::pending::fail_pending_after_stop;
    use super::resolve::{detect_host_triple, resolve_host_command_tiered, PackagedHostPaths};
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
    fn assign_host_request_id_keeps_envelope_identity_fields() {
        let mut envelope = serde_json::json!({
            "v": 1,
            "command": { "type": "session/abort", "sessionId": "s1", "id": "ui-9" },
            "idempotencyKey": "gesture-1",
            "clientPrincipalId": "desktop-1"
        });
        let id = assign_host_request_id(&mut envelope);
        assert_eq!(id, "ui-9");
        assert_eq!(envelope["idempotencyKey"], "gesture-1");
        assert_eq!(envelope["clientPrincipalId"], "desktop-1");
        assert_eq!(envelope["command"]["id"], "ui-9");
        assert_eq!(envelope["command"]["type"], "session/abort");
    }

    #[test]
    fn explicit_zero_disables_the_host_request_transport_deadline() {
        assert_eq!(resolve_host_request_timeout(Some(0)), None);
        assert_eq!(
            resolve_host_request_timeout(None),
            Some(Duration::from_millis(30_000))
        );
        assert_eq!(
            resolve_host_request_timeout(Some(5_000)),
            Some(Duration::from_millis(5_000))
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

    #[cfg(debug_assertions)]
    #[test]
    fn debug_resolution_ignores_a_stale_real_sized_resource_host() {
        let dir = std::env::temp_dir().join(format!(
            "piwin-host-debug-resolve-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time")
                .as_nanos()
        ));
        std::fs::create_dir_all(dir.join("host")).expect("mkdir host");
        let node_name = if cfg!(windows) {
            format!("piwin-host-{}.exe", detect_host_triple())
        } else {
            format!("piwin-host-{}", detect_host_triple())
        };
        std::fs::write(dir.join(node_name), b"node").expect("write node");
        std::fs::write(dir.join("host").join("host-serve.mjs"), vec![b'x'; 512])
            .expect("write stale host");

        let (_program, _args, tier, _assets, _cwd) =
            resolve_host_command(false, Some(dir.clone())).expect("debug resolve");

        assert_eq!(tier, HostCommandTier::Dev);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn shell_only_start_error_is_stable() {
        assert!(SHELL_ONLY_HOST_START_ERROR.contains("cannot start a local Host"));
    }

    #[cfg(not(feature = "shell-only"))]
    #[test]
    fn default_build_is_not_shell_only() {
        assert!(!is_shell_only_build());
    }

    #[cfg(feature = "shell-only")]
    #[test]
    fn shell_only_feature_refuses_local_host() {
        assert!(is_shell_only_build());
    }
}
