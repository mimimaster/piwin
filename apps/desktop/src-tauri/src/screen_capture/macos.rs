//! macOS capture: a silent `screencapture -R` of the display under the
//! pointer, the CoreGraphics Screen Recording (TCC) preflight/request calls,
//! and the AppKit bits the overlay needs (window level, pasteboard, focus).

use std::ffi::c_void;
use std::path::Path;
use std::process::Command;

use objc2_app_kit::{
    NSApplicationActivationOptions, NSImage, NSPasteboard, NSPasteboardTypePNG,
    NSPasteboardTypeTIFF, NSRunningApplication, NSScreenSaverWindowLevel, NSWindow,
    NSWindowCollectionBehavior, NSWorkspace,
};
use objc2::AnyThread;
use objc2_foundation::NSData;

use super::overlay::OverlayBounds;

const SCREENCAPTURE: &str = "/usr/sbin/screencapture";
const SCREEN_RECORDING_SETTINGS_URL: &str =
    "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture";

#[repr(C)]
#[derive(Clone, Copy)]
struct CGPoint {
    x: f64,
    y: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGSize {
    width: f64,
    height: f64,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct CGRect {
    origin: CGPoint,
    size: CGSize,
}

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGPreflightScreenCaptureAccess() -> bool;
    fn CGRequestScreenCaptureAccess() -> bool;
    fn CGEventCreate(source: *const c_void) -> *mut c_void;
    fn CGEventGetLocation(event: *mut c_void) -> CGPoint;
    fn CGGetDisplaysWithPoint(
        point: CGPoint,
        max_displays: u32,
        displays: *mut u32,
        matching_count: *mut u32,
    ) -> i32;
    fn CGDisplayBounds(display: u32) -> CGRect;
    fn CGMainDisplayID() -> u32;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(object: *const c_void);
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

/// Bounds of the display under the pointer, in global points with a top-left
/// origin: the space both `screencapture -R` and Tauri logical positions use.
fn display_under_cursor() -> CGRect {
    // SAFETY: a NULL source is documented; the event is released right after.
    let cursor = unsafe {
        let event = CGEventCreate(std::ptr::null());
        if event.is_null() {
            None
        } else {
            let location = CGEventGetLocation(event);
            CFRelease(event.cast_const());
            Some(location)
        }
    };
    let mut display = 0u32;
    let mut count = 0u32;
    if let Some(point) = cursor {
        // SAFETY: room for exactly one display id; count is a valid out pointer.
        let status = unsafe { CGGetDisplaysWithPoint(point, 1, &mut display, &mut count) };
        if status != 0 {
            count = 0;
        }
    }
    if count == 0 {
        // SAFETY: argument-less query; always returns a display id.
        display = unsafe { CGMainDisplayID() };
    }
    // SAFETY: plain value query for a display id from the calls above.
    unsafe { CGDisplayBounds(display) }
}

/// Silent capture (`-x`) of the whole display under the pointer at native
/// resolution. Writes `output`; returns where that display is.
pub(super) fn capture_display_under_cursor(output: &Path) -> Result<OverlayBounds, String> {
    let bounds = display_under_cursor();
    let region = format!(
        "{},{},{},{}",
        bounds.origin.x.round(),
        bounds.origin.y.round(),
        bounds.size.width.round(),
        bounds.size.height.round()
    );
    let status = Command::new(SCREENCAPTURE)
        .args(["-x", "-t", "png"])
        .arg(format!("-R{region}"))
        .arg(output)
        .status()
        .map_err(|error| format!("screencapture did not start: {error}"))?;
    if !status.success() {
        return Err(format!("screencapture exited with {status}"));
    }
    Ok(OverlayBounds::Logical {
        x: bounds.origin.x,
        y: bounds.origin.y,
        width: bounds.size.width,
        height: bounds.size.height,
    })
}

/// Above the menu bar and the Dock, on every Space including full-screen apps.
pub(super) fn lift_overlay_window(window: &tauri::WebviewWindow) {
    let target = window.clone();
    let lifted = window.run_on_main_thread(move || {
        let Ok(pointer) = target.ns_window() else {
            return;
        };
        // SAFETY: Tauri hands out the live NSWindow of this webview window and
        // we are on the main thread, where AppKit requires window calls.
        let ns_window = unsafe { &*pointer.cast::<NSWindow>() };
        ns_window.setLevel(NSScreenSaverWindowLevel);
        ns_window.setCollectionBehavior(
            NSWindowCollectionBehavior::CanJoinAllSpaces
                | NSWindowCollectionBehavior::FullScreenAuxiliary
                | NSWindowCollectionBehavior::Stationary
                | NSWindowCollectionBehavior::IgnoresCycle,
        );
    });
    if let Err(error) = lifted {
        eprintln!("[piwin] screen capture overlay could not be lifted: {error}");
    }
}

/// PNG plus a TIFF copy: some apps only read TIFF image pasteboard data.
pub(super) fn copy_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    let data = NSData::with_bytes(png);
    let pasteboard = NSPasteboard::generalPasteboard();
    pasteboard.clearContents();
    // SAFETY: the type constants are AppKit statics, valid for the process.
    let (png_type, tiff_type) = unsafe { (NSPasteboardTypePNG, NSPasteboardTypeTIFF) };
    if !pasteboard.setData_forType(Some(&data), png_type) {
        return Err("pasteboard refused PNG data".to_string());
    }
    let tiff =
        NSImage::initWithData(NSImage::alloc(), &data).and_then(|image| image.TIFFRepresentation());
    if let Some(tiff) = tiff {
        pasteboard.setData_forType(Some(&tiff), tiff_type);
    }
    Ok(())
}

/// The app in front before the capture, unless it is piwin itself.
pub(super) fn frontmost_other_app() -> Option<i32> {
    let front = NSWorkspace::sharedWorkspace().frontmostApplication()?;
    let pid = front.processIdentifier();
    (pid != NSRunningApplication::currentApplication().processIdentifier()).then_some(pid)
}

/// Hands focus back after the overlay activated piwin.
pub(super) fn activate_app(pid: i32) {
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        app.activateWithOptions(NSApplicationActivationOptions::empty());
    }
}
