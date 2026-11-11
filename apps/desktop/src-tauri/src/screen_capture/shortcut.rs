//! System-wide screenshot shortcut: ⇧⌘A on macOS, Ctrl+Shift+A elsewhere.
//!
//! The native side only forwards the key press to the main webview; the
//! webview owns the whole flow (pre-checks, permission, editor) so every entry
//! point behaves the same. When registration fails (another app holds the
//! chord, or a Wayland session without X11 grabs), the in-app shortcut in
//! `use-desktop-shortcuts.ts` still works while piwin is focused.

use tauri::{AppHandle, Emitter};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Mirrored in `screen-capture-os-tauri.ts`.
pub(crate) const SHORTCUT_EVENT: &str = "screen-capture://shortcut";

fn capture_shortcut() -> Shortcut {
    #[cfg(target_os = "macos")]
    let modifiers = Modifiers::SUPER | Modifiers::SHIFT;
    #[cfg(not(target_os = "macos"))]
    let modifiers = Modifiers::CONTROL | Modifiers::SHIFT;
    Shortcut::new(Some(modifiers), Code::KeyA)
}

pub(crate) fn install(app: &AppHandle) {
    let registered =
        app.global_shortcut()
            .on_shortcut(capture_shortcut(), |app, _shortcut, event| {
                if event.state != ShortcutState::Pressed {
                    return;
                }
                if let Err(error) = app.emit_to("main", SHORTCUT_EVENT, ()) {
                    eprintln!("[piwin] screenshot shortcut could not reach the window: {error}");
                }
            });
    if let Err(error) = registered {
        eprintln!("[piwin] global screenshot shortcut unavailable, in-app only: {error}");
    }
}

/// Settings → General owns this switch. Releasing the chord stops piwin from
/// swallowing ⇧⌘A in other apps; re-enabling registers the same handler again.
pub(crate) fn set_enabled(app: &AppHandle, enabled: bool) {
    let manager = app.global_shortcut();
    let shortcut = capture_shortcut();
    if enabled {
        if !manager.is_registered(shortcut) {
            install(app);
        }
        return;
    }
    if !manager.is_registered(shortcut) {
        return;
    }
    if let Err(error) = manager.unregister(shortcut) {
        eprintln!("[piwin] screenshot shortcut could not be released: {error}");
    }
}
