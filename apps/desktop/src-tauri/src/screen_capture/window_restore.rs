//! Keeps piwin out of its own screenshot (spec SC-D07): hide the main window
//! and the pet overlay before capture, then put them back. Only the Linux
//! picker path hides windows now; the macOS / Windows overlay leaves them
//! where they are (spec §12.6), so only `CaptureEnd` is shared there.
#![cfg_attr(any(target_os = "macos", target_os = "windows"), allow(dead_code))]

use tauri::{AppHandle, Manager};

use crate::pet_overlay::{raise_main_window, PET_OVERLAY_LABEL};

/// How the main window looked before the capture.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MainWindowBefore {
    /// Hidden or minimized: not in the shot, not touched.
    OffScreen,
    /// On screen behind another app (global shortcut from elsewhere).
    Background,
    Focused,
}

/// Which windows this capture hid, so only those come back.
pub(super) struct HiddenWindows {
    main: MainWindowBefore,
    pet_overlay: bool,
}

pub(super) fn hide_piwin_windows(app: &AppHandle) -> HiddenWindows {
    let main = match app.get_webview_window("main") {
        Some(window)
            if window.is_visible().unwrap_or(false) && !window.is_minimized().unwrap_or(false) =>
        {
            let focused = window.is_focused().unwrap_or(false);
            if let Err(error) = window.hide() {
                eprintln!("[piwin] screen capture could not hide main window: {error}");
            }
            if focused {
                MainWindowBefore::Focused
            } else {
                MainWindowBefore::Background
            }
        }
        _ => MainWindowBefore::OffScreen,
    };
    // Plain hide, not pet_overlay_hide: that one destroys the overlay.
    let pet_overlay = app
        .get_webview_window(PET_OVERLAY_LABEL)
        .filter(|window| window.is_visible().unwrap_or(false))
        .map(|window| window.hide().is_ok())
        .unwrap_or(false);
    HiddenWindows { main, pet_overlay }
}

/// Where the capture left the user's attention.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum CaptureEnd {
    /// The image lands in piwin (composer or editor), so piwin comes forward.
    InPiwin,
    /// Clipboard only, cancelled, or failed: put piwin back as it was.
    Elsewhere,
}

/// Without a reason to show piwin, the window only goes back to how it was,
/// so a capture started from another app does not pull piwin over it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MainWindowRestore {
    Raise,
    Show,
    Leave,
}

fn main_window_restore(before: MainWindowBefore, end: CaptureEnd) -> MainWindowRestore {
    match (end, before) {
        (CaptureEnd::InPiwin, _) | (CaptureEnd::Elsewhere, MainWindowBefore::Focused) => {
            MainWindowRestore::Raise
        }
        (CaptureEnd::Elsewhere, MainWindowBefore::Background) => MainWindowRestore::Show,
        (CaptureEnd::Elsewhere, MainWindowBefore::OffScreen) => MainWindowRestore::Leave,
    }
}

/// Returns whether piwin was brought to the front.
pub(super) fn restore_piwin_windows(app: &AppHandle, hidden: &HiddenWindows, end: CaptureEnd) -> bool {
    if hidden.pet_overlay {
        if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
            let _ = window.show();
        }
    }
    let restore = main_window_restore(hidden.main, end);
    let result = match restore {
        MainWindowRestore::Raise => raise_main_window(app),
        MainWindowRestore::Show => app.get_webview_window("main").map_or(Ok(()), |window| {
            window.show().map_err(|error| error.to_string())
        }),
        MainWindowRestore::Leave => Ok(()),
    };
    if let Err(error) = result {
        eprintln!("[piwin] screen capture could not restore main window: {error}");
    }
    restore == MainWindowRestore::Raise
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_image_for_piwin_or_a_focused_window_brings_piwin_forward() {
        use CaptureEnd::*;
        use MainWindowBefore::*;
        assert_eq!(main_window_restore(OffScreen, InPiwin), MainWindowRestore::Raise);
        assert_eq!(main_window_restore(Background, InPiwin), MainWindowRestore::Raise);
        assert_eq!(main_window_restore(Focused, Elsewhere), MainWindowRestore::Raise);
        assert_eq!(main_window_restore(Background, Elsewhere), MainWindowRestore::Show);
        assert_eq!(main_window_restore(OffScreen, Elsewhere), MainWindowRestore::Leave);
    }
}
