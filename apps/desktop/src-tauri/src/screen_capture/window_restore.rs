//! Keeps piwin out of its own screenshot (spec SC-D07): hide the main window
//! and the pet overlay before capture, then put them back.

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

/// The editor needs piwin in front. Without an image (Esc, failure), the
/// window only goes back to how it was, so a cancelled global capture does
/// not pull piwin over the app the user was in.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum MainWindowRestore {
    Raise,
    Show,
    Leave,
}

fn main_window_restore(before: MainWindowBefore, captured: bool) -> MainWindowRestore {
    match (captured, before) {
        (true, _) | (false, MainWindowBefore::Focused) => MainWindowRestore::Raise,
        (false, MainWindowBefore::Background) => MainWindowRestore::Show,
        (false, MainWindowBefore::OffScreen) => MainWindowRestore::Leave,
    }
}

pub(super) fn restore_piwin_windows(app: &AppHandle, hidden: &HiddenWindows, captured: bool) {
    if hidden.pet_overlay {
        if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
            let _ = window.show();
        }
    }
    let result = match main_window_restore(hidden.main, captured) {
        MainWindowRestore::Raise => raise_main_window(app),
        MainWindowRestore::Show => app.get_webview_window("main").map_or(Ok(()), |window| {
            window.show().map_err(|error| error.to_string())
        }),
        MainWindowRestore::Leave => Ok(()),
    };
    if let Err(error) = result {
        eprintln!("[piwin] screen capture could not restore main window: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_a_capture_or_a_focused_window_brings_piwin_forward() {
        use MainWindowBefore::*;
        assert_eq!(
            main_window_restore(OffScreen, true),
            MainWindowRestore::Raise
        );
        assert_eq!(
            main_window_restore(Background, true),
            MainWindowRestore::Raise
        );
        assert_eq!(
            main_window_restore(Focused, false),
            MainWindowRestore::Raise
        );
        assert_eq!(
            main_window_restore(Background, false),
            MainWindowRestore::Show
        );
        assert_eq!(
            main_window_restore(OffScreen, false),
            MainWindowRestore::Leave
        );
    }
}
