//! Interactive PTY sessions owned by the Tauri desktop process (ADR 0013).
//! Bytes flow: OS PTY ↔ this module ↔ Tauri events ↔ xterm.js renderer.
//! Node agent-host is intentionally not on this path.

use std::collections::HashMap;
use std::io::{Read, Write};
#[cfg(unix)]
use std::process::Command as ProcessCommand;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use serde_json::json;
use tauri::{AppHandle, Emitter, State};

use crate::host_bridge::{host_request, HostBridgeState};

static PTY_SEQ: AtomicU64 = AtomicU64::new(1);

pub struct PtyHostState {
    pub sessions: Arc<Mutex<HashMap<String, PtySession>>>,
}

pub(crate) struct PtySession {
    /// Kept so the child process stays alive with the master and can be reaped
    /// explicitly during teardown.
    pair_child: Box<dyn portable_pty::Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Mutex<Box<dyn Write + Send>>,
    reader_control: Arc<ReaderControl>,
    reader_thread: thread::JoinHandle<()>,
    /// The PID returned by portable-pty for the direct shell child at spawn.
    /// It may be absent on a backend that cannot expose a child PID.
    direct_child_pid: Option<i32>,
    /// portable_pty starts Unix shells in their own session/process group.
    /// This lets teardown make a best-effort attempt to stop descendants too.
    /// It is intentionally absent on Windows, where portable_pty exposes no
    /// portable process-group operation.
    #[cfg(unix)]
    process_group_leader: Option<i32>,
}

/// A bounded pre-close record for one interactive terminal. It contains only
/// process identifiers returned by the PTY backend; absent values are never
/// synthesized from session IDs or process counts.
#[derive(Clone, Serialize)]
pub struct PtyShutdownSnapshot {
    pub kind: String,
    pub id: String,
    pub direct_child_pid: Option<i32>,
    pub unix_process_group_leader: Option<i32>,
    pub platform: PtySnapshotPlatform,
}

#[derive(Clone, Serialize)]
pub struct PtySnapshotPlatform {
    pub os: String,
    pub unix_process_group_leader_supported: bool,
}

struct ReaderControl {
    closed: std::sync::atomic::AtomicBool,
    /// Serializes the closed check with event emission. This gives teardown a
    /// clear boundary: once `close` returns, no reader event can be emitted.
    event_lock: Mutex<()>,
}

impl ReaderControl {
    fn new() -> Self {
        Self {
            closed: std::sync::atomic::AtomicBool::new(false),
            event_lock: Mutex::new(()),
        }
    }

    fn close(&self) {
        let _event_guard = self
            .event_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        self.closed.store(true, Ordering::Release);
    }

    fn is_open(&self) -> bool {
        !self.closed.load(Ordering::Acquire)
    }
}

impl Default for PtyHostState {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Clone, Serialize)]
struct PtyDataPayload {
    pty_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
struct PtyExitPayload {
    pty_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<u32>,
}

#[derive(Clone, Serialize)]
pub struct PtyOpenResult {
    pub pty_id: String,
}

fn default_shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| {
        if cfg!(windows) {
            "powershell.exe".to_string()
        } else {
            "/bin/zsh".to_string()
        }
    })
}

/// Open an interactive PTY only after host project trust authorization (PSR D3).
#[tauri::command]
pub async fn pty_open(
    app: AppHandle,
    state: State<'_, PtyHostState>,
    host: State<'_, HostBridgeState>,
    cwd: String,
    project_path: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyOpenResult, String> {
    let requested_cwd = cwd.trim().to_string();
    if requested_cwd.is_empty() {
        return Err("cwd required".to_string());
    }
    let project = project_path
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| requested_cwd.clone());

    // Authoritative trust check via host; do not trust renderer-side state alone.
    let authorize_command = json!({
        "type": "project/authorize-terminal",
        "projectPath": project,
        "cwd": requested_cwd,
    });
    let authorize_response = host_request(host, authorize_command, Some(8_000)).await?;
    let success = authorize_response
        .get("success")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    if !success {
        let error = authorize_response
            .get("error")
            .and_then(|value| value.as_str())
            .unwrap_or("terminal authorization failed");
        return Err(error.to_string());
    }
    let authorized_cwd = authorize_response
        .get("data")
        .and_then(|data| data.get("cwd"))
        .and_then(|value| value.as_str())
        .unwrap_or(&requested_cwd)
        .to_string();
    if !std::path::Path::new(&authorized_cwd).is_dir() {
        return Err(format!("cwd is not a directory: {authorized_cwd}"));
    }

    let cols = cols.unwrap_or(80).max(20);
    let rows = rows.unwrap_or(24).max(5);
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || {
        pty_open_blocking(app, sessions, authorized_cwd, cols, rows)
    })
    .await
    .map_err(|error| format!("pty_open worker failed: {error}"))?
}

fn pty_open_blocking(
    app: AppHandle,
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    authorized_cwd: String,
    cols: u16,
    rows: u16,
) -> Result<PtyOpenResult, String> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("openpty: {error}"))?;

    let mut cmd = CommandBuilder::new(default_shell());
    if !cfg!(windows) {
        cmd.arg("-l");
    }
    cmd.cwd(&authorized_cwd);

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|error| format!("spawn shell: {error}"))?;
    drop(pair.slave);

    let direct_child_pid = child.process_id().map(|value| value as i32);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| format!("clone reader: {error}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| format!("take writer: {error}"))?;

    let pty_id = format!("tauri-pty-{}", PTY_SEQ.fetch_add(1, Ordering::Relaxed));
    let reader_control = Arc::new(ReaderControl::new());
    #[cfg(unix)]
    let process_group_leader = pair.master.process_group_leader().map(|value| value as i32);

    let reader_control_for_reader = Arc::clone(&reader_control);
    let app_for_reader = app.clone();
    let pty_id_for_reader = pty_id.clone();
    let reader_thread = thread::spawn(move || {
        let mut buffer = [0u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(n) => {
                    let _event_guard = reader_control_for_reader
                        .event_lock
                        .lock()
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                    if !reader_control_for_reader.is_open() {
                        break;
                    }
                    let chunk = String::from_utf8_lossy(&buffer[..n]).to_string();
                    let _ = app_for_reader.emit(
                        "pty_data",
                        PtyDataPayload {
                            pty_id: pty_id_for_reader.clone(),
                            data: chunk,
                        },
                    );
                }
                Err(error) => {
                    if error.kind() == std::io::ErrorKind::Interrupted {
                        continue;
                    }
                    break;
                }
            }
        }

        let _event_guard = reader_control_for_reader
            .event_lock
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if reader_control_for_reader.is_open() {
            let _ = app_for_reader.emit(
                "pty_exit",
                PtyExitPayload {
                    pty_id: pty_id_for_reader,
                    exit_code: None,
                },
            );
        }
    });

    {
        let mut sessions = sessions
            .lock()
            .map_err(|_| "pty state lock poisoned".to_string())?;
        sessions.insert(
            pty_id.clone(),
            PtySession {
                pair_child: child,
                master: pair.master,
                writer: Mutex::new(writer),
                reader_control,
                reader_thread,
                direct_child_pid,
                #[cfg(unix)]
                process_group_leader,
            },
        );
    }

    Ok(PtyOpenResult { pty_id })
}

/// Capture terminal process facts before shutdown mutates the PTY map.
/// Callers receive an error rather than an empty snapshot when the session
/// state cannot be observed, so shutdown logs remain truthful.
pub fn snapshot_pty_sessions_blocking(
    sessions: &Arc<Mutex<HashMap<String, PtySession>>>,
) -> Result<Vec<PtyShutdownSnapshot>, String> {
    let sessions = sessions
        .lock()
        .map_err(|_| "pty state lock poisoned while collecting shutdown snapshot".to_string())?;

    Ok(sessions
        .iter()
        .map(|(pty_id, session)| {
            build_pty_shutdown_snapshot(
                pty_id.clone(),
                session.direct_child_pid,
                #[cfg(unix)]
                session.process_group_leader,
            )
        })
        .collect())
}

fn build_pty_shutdown_snapshot(
    pty_id: String,
    direct_child_pid: Option<i32>,
    #[cfg(unix)] unix_process_group_leader: Option<i32>,
) -> PtyShutdownSnapshot {
    PtyShutdownSnapshot {
        kind: "pty".to_string(),
        id: pty_id,
        direct_child_pid,
        #[cfg(unix)]
        unix_process_group_leader,
        #[cfg(not(unix))]
        unix_process_group_leader: None,
        platform: PtySnapshotPlatform {
            os: std::env::consts::OS.to_string(),
            unix_process_group_leader_supported: cfg!(unix),
        },
    }
}

#[tauri::command]
pub async fn pty_write(
    state: State<'_, PtyHostState>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || pty_write_blocking(sessions, pty_id, data))
        .await
        .map_err(|error| format!("pty_write worker failed: {error}"))?
}

fn pty_write_blocking(
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = sessions
        .lock()
        .map_err(|_| "pty state lock poisoned".to_string())?;
    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "pty writer lock poisoned".to_string())?;
    writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("pty write: {error}"))?;
    writer
        .flush()
        .map_err(|error| format!("pty flush: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pty_resize(
    state: State<'_, PtyHostState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || pty_resize_blocking(sessions, pty_id, cols, rows))
        .await
        .map_err(|error| format!("pty_resize worker failed: {error}"))?
}

fn pty_resize_blocking(
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cols = cols.max(20);
    let rows = rows.max(5);
    let sessions = sessions
        .lock()
        .map_err(|_| "pty state lock poisoned".to_string())?;
    let session = sessions
        .get(&pty_id)
        .ok_or_else(|| format!("unknown pty: {pty_id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("pty resize: {error}"))?;
    Ok(())
}

#[tauri::command]
pub async fn pty_close(state: State<'_, PtyHostState>, pty_id: String) -> Result<(), String> {
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || pty_close_blocking(sessions, pty_id))
        .await
        .map_err(|error| format!("pty_close worker failed: {error}"))?
}

fn pty_close_blocking(
    sessions: Arc<Mutex<HashMap<String, PtySession>>>,
    pty_id: String,
) -> Result<(), String> {
    // Remove the session before terminating it. Child termination and reaping
    // may block, so no PTY map lock can be held across either operation.
    let session = sessions
        .lock()
        .map_err(|_| "pty state lock poisoned".to_string())?
        .remove(&pty_id);
    if let Some(session) = session {
        terminate_pty_session(session)?;
    }
    Ok(())
}

/// Close every PTY (project switch / window teardown).
#[tauri::command]
pub async fn pty_close_all(state: State<'_, PtyHostState>) -> Result<(), String> {
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || pty_close_all_blocking(sessions))
        .await
        .map_err(|error| format!("pty_close_all worker failed: {error}"))?
}

fn pty_close_all_blocking(sessions: Arc<Mutex<HashMap<String, PtySession>>>) -> Result<(), String> {
    // Drain the map first; every child is terminated and reaped after the
    // shared state is unlocked, allowing concurrent PTY commands to fail fast.
    let sessions_to_close = sessions
        .lock()
        .map_err(|_| "pty state lock poisoned".to_string())?
        .drain()
        .map(|(_, session)| session)
        .collect::<Vec<_>>();

    let mut errors = Vec::new();
    for session in sessions_to_close {
        if let Err(error) = terminate_pty_session(session) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "failed to close PTY sessions: {}",
            errors.join("; ")
        ))
    }
}

fn terminate_pty_session(mut session: PtySession) -> Result<(), String> {
    // Mark the reader closed before releasing the PTY handles. The reader is
    // joined below, so close_all cannot return while this thread is alive.
    session.reader_control.close();

    // Drop the master/writer before waiting so the shell sees the PTY hangup.
    drop(session.writer);
    drop(session.master);

    let kill_error = session
        .pair_child
        .kill()
        .err()
        .map(|error| error.to_string());

    #[cfg(unix)]
    terminate_unix_process_group(session.process_group_leader);

    let wait_result = session
        .pair_child
        .wait()
        .map_err(|error| format!("reap PTY child: {error}"));
    let reader_result = session
        .reader_thread
        .join()
        .map_err(|_| "PTY reader thread panicked".to_string());

    let mut errors = Vec::new();
    if let Some(error) = kill_error {
        errors.push(format!("terminate PTY child: {error}"));
    }
    if let Err(error) = wait_result {
        errors.push(error);
    }
    if let Err(error) = reader_result {
        errors.push(error);
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

#[cfg(unix)]
fn terminate_unix_process_group(process_group_leader: Option<i32>) {
    let Some(process_group_leader) = process_group_leader.filter(|value| *value > 0) else {
        return;
    };

    // portable_pty gives Unix shells a separate session/process group. Use
    // the platform kill utility instead of importing a Unix-only syscall API,
    // preserving this module's Windows build. This is best effort: a child
    // that calls setsid() can escape the group, and the group id could be
    // unavailable on unusual PTY backends. Direct child kill/wait remains the
    // mandatory portable guarantee.
    let process_group_argument = format!("-{process_group_leader}");
    let _ = ProcessCommand::new("/bin/kill")
        .args(["-KILL", "--", process_group_argument.as_str()])
        .status();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_cwd_token() {
        let cwd = "   ".trim().to_string();
        assert!(cwd.is_empty());
    }

    #[test]
    fn default_shell_is_non_empty() {
        assert!(!default_shell().is_empty());
    }

    #[test]
    fn reader_control_blocks_events_after_close() {
        let reader_control = ReaderControl::new();
        assert!(reader_control.is_open());

        reader_control.close();

        assert!(!reader_control.is_open());
    }

    #[test]
    fn shutdown_snapshot_preserves_backend_process_identifiers() {
        let snapshot = build_pty_shutdown_snapshot(
            "tauri-pty-7".to_string(),
            Some(42_001),
            #[cfg(unix)]
            Some(42_001),
        );

        assert_eq!(snapshot.kind, "pty");
        assert_eq!(snapshot.id, "tauri-pty-7");
        assert_eq!(snapshot.direct_child_pid, Some(42_001));
        #[cfg(unix)]
        assert_eq!(snapshot.unix_process_group_leader, Some(42_001));
        #[cfg(not(unix))]
        assert_eq!(snapshot.unix_process_group_leader, None);
        assert_eq!(
            snapshot.platform.unix_process_group_leader_supported,
            cfg!(unix)
        );
    }

    #[test]
    fn shutdown_snapshot_keeps_unavailable_identifiers_empty() {
        let snapshot = build_pty_shutdown_snapshot(
            "tauri-pty-8".to_string(),
            None,
            #[cfg(unix)]
            None,
        );

        assert_eq!(snapshot.direct_child_pid, None);
        assert_eq!(snapshot.unix_process_group_leader, None);
    }
}
