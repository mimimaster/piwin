//! macOS capture: the system `screencapture` region picker plus the
//! CoreGraphics Screen Recording (TCC) preflight/request calls.

use std::path::Path;
use std::process::Command;

const SCREENCAPTURE: &str = "/usr/sbin/screencapture";
const SCREEN_RECORDING_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
}

/// Current grant for this app. Not cached: the user can revoke it at any time.
pub(super) fn preflight_access() -> bool {
    // SAFETY: argument-less CoreGraphics query, available since macOS 10.15.
    unsafe { CGPreflightScreenCaptureAccess() }
}

/// Shows the system prompt the first time; a no-op after an earlier denial.
pub(super) fn request_access() {
    // SAFETY: argument-less CoreGraphics call, available since macOS 10.15.
    let _ = unsafe { CGRequestScreenCaptureAccess() };
}

pub(super) fn open_system_settings() {
    if let Err(error) = Command::new("open").arg(SCREEN_RECORDING_SETTINGS_URL).spawn() {
        eprintln!("[piwin] could not open Screen Recording settings: {error}");
    }
}

/// Interactive region capture (`-i`), silent (`-x`), PNG. Blocks until the
/// user finishes or presses Esc; cancellation is read from the output file.
pub(super) fn capture_interactive(output: &Path) -> Result<(), String> {
    Command::new(SCREENCAPTURE)
        .args(["-i", "-x", "-t", "png"])
        .arg(output)
        .status()
        .map(|_| ())
        .map_err(|error| format!("screencapture did not start: {error}"))
}
