//! Built-in screenshot capture (spec docs/specs/2026-10-25-desktop-screenshot-annotation.md).
//!
//! Capture runs on the machine in front of the user, never on the Host. The
//! PNG stays in memory here until the webview reads it once; nothing reaches
//! the Host media library unless the user confirms the annotated result.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, State};

use window_restore::{hide_piwin_windows, restore_piwin_windows};


#[cfg(any(target_os = "linux", test))]
mod file_uri;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(target_os = "macos")]
mod macos;
#[cfg(any(target_os = "windows", test))]
mod raster;
pub(crate) mod shortcut;
mod window_restore;
#[cfg(target_os = "windows")]
mod windows;

/// Lets the hide animation finish so the capture does not catch piwin fading out.
const WINDOW_SETTLE_DELAY: Duration = Duration::from_millis(200);

pub(crate) const ERROR_BUSY: &str = "SCREEN_CAPTURE_BUSY";
pub(crate) const ERROR_DENIED: &str = "SCREEN_CAPTURE_DENIED";
pub(crate) const ERROR_UNSUPPORTED: &str = "SCREEN_CAPTURE_UNSUPPORTED";
pub(crate) const ERROR_FAILED: &str = "SCREEN_CAPTURE_FAILED";
pub(crate) const ERROR_NOT_FOUND: &str = "SCREEN_CAPTURE_NOT_FOUND";

#[derive(Default)]
pub(crate) struct ScreenCaptureState {
    busy: AtomicBool,
    store: CaptureStore,
}

/// Holds only the latest capture; a read hands it out once and forgets it.
#[derive(Default)]
struct CaptureStore {
    latest: Mutex<Option<StoredCapture>>,
    counter: AtomicU64,
}

struct StoredCapture {
    id: String,
    bytes: Vec<u8>,
}

impl CaptureStore {
    fn put(&self, bytes: Vec<u8>) -> String {
        let sequence = self.counter.fetch_add(1, Ordering::SeqCst);
        let id = format!("capture-{}-{sequence}", unix_millis());
        if let Ok(mut latest) = self.latest.lock() {
            *latest = Some(StoredCapture { id: id.clone(), bytes });
        }
        id
    }

    fn take(&self, id: &str) -> Option<Vec<u8>> {
        let mut latest = self.latest.lock().ok()?;
        if latest.as_ref().map(|capture| capture.id.as_str()) != Some(id) {
            return None;
        }
        latest.take().map(|capture| capture.bytes)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScreenCaptureCapabilities {
    supported: bool,
    system_region_picker: bool,
}

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum ScreenCaptureAuthorization {
    Authorized,
    /// macOS preflight cannot tell "never asked" from "denied".
    NotDeterminedOrDenied,
    /// Built only on platforms without capture support.
    #[cfg_attr(
        any(target_os = "macos", target_os = "windows", target_os = "linux"),
        allow(dead_code)
    )]
    Unsupported,
}

#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(tag = "status", rename_all = "camelCase")]
pub(crate) enum ScreenCaptureOutcome {
    Captured {
        id: String,
        width: u32,
        height: u32,
        #[serde(rename = "byteLength")]
        byte_length: usize,
    },
    Cancelled,
    Failed {
        code: String,
    },
}

/// Why a platform capture produced no image (cancel is `Ok(None)`, not an error).
enum CaptureError {
    /// No capture backend on this machine (e.g. Linux without a portal or tool).
    #[cfg_attr(not(target_os = "linux"), allow(dead_code))]
    Unsupported,
    Failed(String),
}

fn failed(code: &str) -> ScreenCaptureOutcome {
    ScreenCaptureOutcome::Failed {
        code: code.to_string(),
    }
}

#[tauri::command]
pub(crate) fn screen_capture_capabilities() -> ScreenCaptureCapabilities {
    ScreenCaptureCapabilities {
        supported: cfg!(any(target_os = "macos", target_os = "windows", target_os = "linux")),
        // Windows copies the whole monitor; the region is cropped in the editor.
        system_region_picker: cfg!(any(target_os = "macos", target_os = "linux")),
    }
}

#[tauri::command]
pub(crate) fn screen_capture_authorization_status() -> ScreenCaptureAuthorization {
    authorization_status()
}

#[tauri::command]
pub(crate) fn screen_capture_request_authorization() -> ScreenCaptureAuthorization {
    #[cfg(target_os = "macos")]
    {
        macos::request_access();
    }
    authorization_status()
}

#[tauri::command]
pub(crate) fn screen_capture_open_system_settings() {
    #[cfg(target_os = "macos")]
    {
        macos::open_system_settings();
    }
}

/// macOS applies a new Screen Recording grant only after relaunch. This uses
/// the same restart path as in-app update, so the Host is reaped first.
#[tauri::command]
pub(crate) fn screen_capture_restart_app(app: AppHandle) {
    app.request_restart();
}

#[tauri::command]
pub(crate) async fn screen_capture_take(
    app: AppHandle,
    state: State<'_, ScreenCaptureState>,
) -> Result<ScreenCaptureOutcome, String> {
    if state.busy.swap(true, Ordering::SeqCst) {
        return Ok(failed(ERROR_BUSY));
    }
    let outcome = take_with_hidden_windows(&app, &state).await;
    state.busy.store(false, Ordering::SeqCst);
    Ok(outcome)
}

#[tauri::command]
pub(crate) fn screen_capture_read(
    id: String,
    state: State<'_, ScreenCaptureState>,
) -> Result<tauri::ipc::Response, String> {
    state
        .store
        .take(&id)
        .map(tauri::ipc::Response::new)
        .ok_or_else(|| ERROR_NOT_FOUND.to_string())
}

fn authorization_status() -> ScreenCaptureAuthorization {
    #[cfg(target_os = "macos")]
    {
        if macos::preflight_access() {
            ScreenCaptureAuthorization::Authorized
        } else {
            ScreenCaptureAuthorization::NotDeterminedOrDenied
        }
    }
    // No capture grant exists on Windows or for the Linux portal / tools.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    {
        ScreenCaptureAuthorization::Authorized
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        ScreenCaptureAuthorization::Unsupported
    }
}

async fn take_with_hidden_windows(app: &AppHandle, state: &ScreenCaptureState) -> ScreenCaptureOutcome {
    match authorization_status() {
        ScreenCaptureAuthorization::Authorized => {}
        // SC-R11: without the grant macOS hands back a wallpaper-only image.
        ScreenCaptureAuthorization::NotDeterminedOrDenied => return failed(ERROR_DENIED),
        ScreenCaptureAuthorization::Unsupported => return failed(ERROR_UNSUPPORTED),
    }

    let hidden = hide_piwin_windows(app);
    let output = capture_temp_path();
    let capture = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(WINDOW_SETTLE_DELAY);
        run_platform_capture(&output)
    })
    .await;
    let captured = matches!(capture, Ok(Ok(Some(_))));
    restore_piwin_windows(app, &hidden, captured);

    match capture {
        Ok(Ok(Some(bytes))) => match png_dimensions(&bytes) {
            Some((width, height)) => {
                let byte_length = bytes.len();
                let id = state.store.put(bytes);
                ScreenCaptureOutcome::Captured {
                    id,
                    width,
                    height,
                    byte_length,
                }
            }
            None => {
                eprintln!("[piwin] screen capture produced an unreadable PNG");
                failed(ERROR_FAILED)
            }
        },
        Ok(Ok(None)) => ScreenCaptureOutcome::Cancelled,
        Ok(Err(CaptureError::Unsupported)) => failed(ERROR_UNSUPPORTED),
        Ok(Err(CaptureError::Failed(error))) => {
            eprintln!("[piwin] screen capture failed: {error}");
            failed(ERROR_FAILED)
        }
        Err(error) => {
            eprintln!("[piwin] screen capture task failed: {error}");
            failed(ERROR_FAILED)
        }
    }
}

fn run_platform_capture(output: &Path) -> Result<Option<Vec<u8>>, CaptureError> {
    #[cfg(target_os = "macos")]
    {
        macos::capture_interactive(output).map_err(CaptureError::Failed)?;
        collect_capture_file(output).map_err(|error| CaptureError::Failed(error.to_string()))
    }
    #[cfg(target_os = "windows")]
    {
        let _ = output;
        windows::capture_cursor_monitor()
            .map(Some)
            .map_err(CaptureError::Failed)
    }
    #[cfg(target_os = "linux")]
    {
        linux::capture_interactive(output)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows", target_os = "linux")))]
    {
        let _ = output;
        Err(CaptureError::Unsupported)
    }
}

fn capture_temp_path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "piwin-capture-{}-{}.png",
        std::process::id(),
        unix_millis()
    ))
}

/// The capture tool writes no file when the user cancels, so presence of a
/// non-empty file is the success signal (exit codes are not relied on).
/// The temp file is always removed.
fn collect_capture_file(path: &Path) -> std::io::Result<Option<Vec<u8>>> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error),
    };
    if let Err(error) = std::fs::remove_file(path) {
        eprintln!("[piwin] screen capture temp file not removed: {error}");
    }
    Ok(if bytes.is_empty() { None } else { Some(bytes) })
}

/// Width and height from the PNG IHDR chunk.
fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    if bytes.len() < 24 || bytes[..8] != SIGNATURE || &bytes[12..16] != b"IHDR" {
        return None;
    }
    let width = u32::from_be_bytes(bytes[16..20].try_into().ok()?);
    let height = u32::from_be_bytes(bytes[20..24].try_into().ok()?);
    if width == 0 || height == 0 {
        return None;
    }
    Some((width, height))
}

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png_header(width: u32, height: u32) -> Vec<u8> {
        let mut bytes = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 13];
        bytes.extend_from_slice(b"IHDR");
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes
    }

    fn scratch_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("piwin-capture-test-{}-{name}", std::process::id()))
    }

    #[test]
    fn missing_or_empty_file_means_cancelled() {
        let missing = scratch_path("missing.png");
        assert_eq!(collect_capture_file(&missing).unwrap(), None);

        let empty = scratch_path("empty.png");
        std::fs::write(&empty, b"").unwrap();
        assert_eq!(collect_capture_file(&empty).unwrap(), None);
        assert!(!empty.exists());
    }

    #[test]
    fn captured_file_is_read_then_removed() {
        let path = scratch_path("shot.png");
        std::fs::write(&path, png_header(10, 20)).unwrap();
        let bytes = collect_capture_file(&path).unwrap().unwrap();
        assert_eq!(png_dimensions(&bytes), Some((10, 20)));
        assert!(!path.exists());
    }

    #[test]
    fn rejects_non_png_bytes() {
        assert_eq!(png_dimensions(b"not a png at all, definitely not"), None);
        assert_eq!(png_dimensions(&png_header(0, 20)), None);
    }

    #[test]
    fn store_reads_once_and_newest_wins() {
        let store = CaptureStore::default();
        let first = store.put(vec![1]);
        let second = store.put(vec![2]);
        assert_ne!(first, second);
        assert_eq!(store.take(&first), None);
        assert_eq!(store.take(&second), Some(vec![2]));
        assert_eq!(store.take(&second), None);
    }

    #[test]
    fn outcome_serializes_to_the_frontend_shape() {
        let captured = serde_json::to_value(ScreenCaptureOutcome::Captured {
            id: "a".into(),
            width: 3,
            height: 4,
            byte_length: 5,
        })
        .unwrap();
        assert_eq!(
            captured,
            serde_json::json!({ "status": "captured", "id": "a", "width": 3, "height": 4, "byteLength": 5 })
        );
        assert_eq!(
            serde_json::to_value(ScreenCaptureOutcome::Cancelled).unwrap(),
            serde_json::json!({ "status": "cancelled" })
        );
        assert_eq!(
            serde_json::to_value(ScreenCaptureAuthorization::NotDeterminedOrDenied).unwrap(),
            serde_json::json!("not-determined-or-denied")
        );
    }
}
