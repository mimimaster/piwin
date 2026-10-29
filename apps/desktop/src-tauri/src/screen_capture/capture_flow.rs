//! From hidden piwin windows to a finished image: the overlay path (macOS,
//! Windows) and the OS-picker path (Linux), plus handing focus back to the
//! app the user was in.

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use std::path::Path;

use tauri::AppHandle;

#[cfg(target_os = "macos")]
use super::macos;
#[cfg(target_os = "windows")]
use super::windows;
#[cfg(target_os = "windows")]
use super::windows_clipboard;
#[cfg(target_os = "linux")]
use super::linux;
#[cfg(target_os = "macos")]
use super::collect_capture_file;
#[cfg(not(target_os = "windows"))]
use super::capture_temp_path;
use super::window_restore::CaptureEnd;
use super::{
    failed, overlay, png_dimensions, CaptureError, ScreenCaptureOutcome, ScreenCaptureState,
    ERROR_FAILED, ERROR_UNSUPPORTED,
};
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
use super::WINDOW_SETTLE_DELAY;

/// The app the user was in, so focus can go back to it when piwin stays put.
pub(super) struct PreviousApp {
    #[cfg(target_os = "macos")]
    pid: Option<i32>,
    #[cfg(target_os = "windows")]
    window: isize,
}

impl PreviousApp {
    pub(super) fn record() -> Self {
        PreviousApp {
            #[cfg(target_os = "macos")]
            pid: macos::frontmost_other_app(),
            #[cfg(target_os = "windows")]
            window: windows::foreground_window(),
        }
    }

    pub(super) fn reactivate(&self) {
        #[cfg(target_os = "macos")]
        if let Some(pid) = self.pid {
            macos::activate_app(pid);
        }
        #[cfg(target_os = "windows")]
        windows::restore_foreground_window(self.window);
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
pub(super) async fn capture_and_finish(
    app: &AppHandle,
    state: &ScreenCaptureState,
    deliver_to_composer: bool,
) -> (ScreenCaptureOutcome, CaptureEnd) {
    // No settle delay: piwin's windows stay put, nothing is animating out.
    let shot = tauri::async_runtime::spawn_blocking(capture_monitor).await;
    let shot = match shot {
        Ok(Ok(shot)) => shot,
        Ok(Err(CaptureError::Unsupported)) => return (failed(ERROR_UNSUPPORTED), CaptureEnd::Elsewhere),
        Ok(Err(CaptureError::Failed(error))) => {
            eprintln!("[piwin] screen capture failed: {error}");
            return (failed(ERROR_FAILED), CaptureEnd::Elsewhere);
        }
        Err(error) => {
            eprintln!("[piwin] screen capture task failed: {error}");
            return (failed(ERROR_FAILED), CaptureEnd::Elsewhere);
        }
    };
    match overlay::run_overlay(app, &state.overlay, shot).await {
        Ok(overlay::OverlayReply::Finished(png)) => {
            finish_overlay_capture(state, &png, deliver_to_composer)
        }
        Ok(overlay::OverlayReply::Pinned(png)) => pin_overlay_capture(app, state, png),
        Ok(overlay::OverlayReply::Cancelled) => {
            (ScreenCaptureOutcome::Cancelled, CaptureEnd::Elsewhere)
        }
        Err(error) => {
            eprintln!("[piwin] screen capture overlay failed: {error}");
            (failed(ERROR_FAILED), CaptureEnd::Elsewhere)
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn pin_overlay_capture(
    app: &AppHandle,
    state: &ScreenCaptureState,
    png: Vec<u8>,
) -> (ScreenCaptureOutcome, CaptureEnd) {
    // Pin is an on-screen reference: copy like ✓, never attach to the composer.
    let (outcome, end) = finish_overlay_capture(state, &png, false);
    if let Err(error) = super::pin::open_pin_window(app, state, png) {
        eprintln!("[piwin] screenshot pin window did not open: {error}");
    }
    (outcome, end)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
fn finish_overlay_capture(
    state: &ScreenCaptureState,
    png: &[u8],
    deliver_to_composer: bool,
) -> (ScreenCaptureOutcome, CaptureEnd) {
    let Some((width, height)) = png_dimensions(png) else {
        return (failed(ERROR_FAILED), CaptureEnd::Elsewhere);
    };
    #[cfg(target_os = "macos")]
    let copy = macos::copy_png_to_clipboard(png);
    #[cfg(target_os = "windows")]
    let copy = windows_clipboard::copy_png_to_clipboard(png);
    if let Err(error) = &copy {
        eprintln!("[piwin] screenshot was not copied to the clipboard: {error}");
    }
    let byte_length = png.len();
    let id = deliver_to_composer.then(|| state.store.put(png.to_vec()));
    let end = if deliver_to_composer {
        CaptureEnd::InPiwin
    } else {
        CaptureEnd::Elsewhere
    };
    let outcome = ScreenCaptureOutcome::Captured {
        id,
        width,
        height,
        byte_length,
        annotated: true,
        copied: copy.is_ok(),
    };
    (outcome, end)
}

#[cfg(target_os = "macos")]
fn capture_monitor() -> Result<overlay::MonitorShot, CaptureError> {
    let output = capture_temp_path();
    let bounds = macos::capture_display_under_cursor(&output).map_err(CaptureError::Failed)?;
    match collect_capture_file(&output) {
        Ok(Some(png)) => Ok(overlay::MonitorShot { png, bounds }),
        Ok(None) => Err(CaptureError::Failed(
            "screencapture wrote no image".to_string(),
        )),
        Err(error) => Err(CaptureError::Failed(error.to_string())),
    }
}

#[cfg(target_os = "windows")]
fn capture_monitor() -> Result<overlay::MonitorShot, CaptureError> {
    windows::capture_cursor_monitor().map_err(CaptureError::Failed)
}

/// Linux: the portal (or a capture tool) draws the region picker; the editor
/// then opens in the main window, so piwin always comes forward with an image.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
pub(super) async fn capture_and_finish(
    _app: &AppHandle,
    state: &ScreenCaptureState,
    _deliver_to_composer: bool,
) -> (ScreenCaptureOutcome, CaptureEnd) {
    let output = capture_temp_path();
    let capture = tauri::async_runtime::spawn_blocking(move || {
        std::thread::sleep(WINDOW_SETTLE_DELAY);
        run_system_picker_capture(&output)
    })
    .await;
    match capture {
        Ok(Ok(Some(bytes))) => match png_dimensions(&bytes) {
            Some((width, height)) => {
                let byte_length = bytes.len();
                let id = state.store.put(bytes);
                let outcome = ScreenCaptureOutcome::Captured {
                    id: Some(id),
                    width,
                    height,
                    byte_length,
                    annotated: false,
                    copied: false,
                };
                (outcome, CaptureEnd::InPiwin)
            }
            None => {
                eprintln!("[piwin] screen capture produced an unreadable PNG");
                (failed(ERROR_FAILED), CaptureEnd::Elsewhere)
            }
        },
        Ok(Ok(None)) => (ScreenCaptureOutcome::Cancelled, CaptureEnd::Elsewhere),
        Ok(Err(CaptureError::Unsupported)) => (failed(ERROR_UNSUPPORTED), CaptureEnd::Elsewhere),
        Ok(Err(CaptureError::Failed(error))) => {
            eprintln!("[piwin] screen capture failed: {error}");
            (failed(ERROR_FAILED), CaptureEnd::Elsewhere)
        }
        Err(error) => {
            eprintln!("[piwin] screen capture task failed: {error}");
            (failed(ERROR_FAILED), CaptureEnd::Elsewhere)
        }
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn run_system_picker_capture(output: &Path) -> Result<Option<Vec<u8>>, CaptureError> {
    #[cfg(target_os = "linux")]
    {
        linux::capture_interactive(output)
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = output;
        Err(CaptureError::Unsupported)
    }
}

