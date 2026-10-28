//! QQ-style capture overlay (spec 2026-10-25 §12.6): a borderless window over
//! the captured monitor that shows the frozen screenshot. Its webview
//! (`screen-capture.html`) picks the region and annotates, then answers with
//! the finished PNG or a cancel. The window stays hidden until the webview
//! has decoded the image, so the user never sees a blank flash.

use std::sync::mpsc;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, State, Webview, WebviewUrl, WebviewWindow, WindowEvent};

use super::{png_dimensions, ScreenCaptureState, ERROR_FAILED, ERROR_NOT_FOUND};

pub(crate) const OVERLAY_LABEL: &str = "screen-capture";

/// A webview that never reports ready (crashed bundle, failed decode) must not
/// leave an invisible window holding the capture lock forever.
const READY_TIMEOUT: Duration = Duration::from_secs(8);

/// Where the captured monitor is, in the units its platform reports.
pub(super) enum OverlayBounds {
    /// macOS global points, top-left origin.
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    Logical {
        x: f64,
        y: f64,
        width: f64,
        height: f64,
    },
    /// Windows virtual-screen pixels.
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    Physical {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
}

/// A silent capture of one whole monitor, and where to put the overlay.
pub(super) struct MonitorShot {
    pub(super) png: Vec<u8>,
    pub(super) bounds: OverlayBounds,
}

pub(super) enum OverlayReply {
    Finished(Vec<u8>),
    Cancelled,
}

enum OverlayEvent {
    Ready,
    Reply(OverlayReply),
}

/// The one overlay session that may be open at a time.
#[derive(Default)]
pub(super) struct OverlaySlot {
    session: Mutex<Option<OverlaySession>>,
}

struct OverlaySession {
    image: Vec<u8>,
    events: mpsc::Sender<OverlayEvent>,
}

impl OverlaySlot {
    fn open(&self, image: Vec<u8>) -> (mpsc::Sender<OverlayEvent>, mpsc::Receiver<OverlayEvent>) {
        let (events, receiver) = mpsc::channel();
        if let Ok(mut session) = self.session.lock() {
            *session = Some(OverlaySession {
                image,
                events: events.clone(),
            });
        }
        (events, receiver)
    }

    fn image(&self) -> Option<Vec<u8>> {
        let session = self.session.lock().ok()?;
        session.as_ref().map(|session| session.image.clone())
    }

    fn send(&self, event: OverlayEvent) -> bool {
        let Ok(session) = self.session.lock() else {
            return false;
        };
        session
            .as_ref()
            .is_some_and(|session| session.events.send(event).is_ok())
    }

    fn close(&self) {
        if let Ok(mut session) = self.session.lock() {
            *session = None;
        }
    }
}

/// Shows the overlay and waits until the user finishes, cancels, or the
/// window goes away. Always tears the window down before returning.
pub(super) async fn run_overlay(
    app: &AppHandle,
    slot: &OverlaySlot,
    shot: MonitorShot,
) -> Result<OverlayReply, String> {
    let (events, receiver) = slot.open(shot.png);
    let window = match open_overlay_window(app, &shot.bounds, events) {
        Ok(window) => window,
        Err(error) => {
            slot.close();
            return Err(format!("overlay window did not open: {error}"));
        }
    };
    let waited = tauri::async_runtime::spawn_blocking(move || wait_for_reply(&receiver)).await;
    slot.close();
    if let Err(error) = window.destroy() {
        eprintln!("[piwin] screen capture overlay was not destroyed: {error}");
    }
    match waited {
        Ok(Some(reply)) => Ok(reply),
        Ok(None) => Ok(OverlayReply::Cancelled),
        Err(error) => Err(format!("overlay wait failed: {error}")),
    }
}

/// `None` when the webview never got ready or every sender is gone.
fn wait_for_reply(receiver: &mpsc::Receiver<OverlayEvent>) -> Option<OverlayReply> {
    let deadline = Instant::now() + READY_TIMEOUT;
    let mut ready = false;
    loop {
        let event = if ready {
            receiver.recv().ok()
        } else {
            let remaining = deadline.saturating_duration_since(Instant::now());
            receiver.recv_timeout(remaining).ok()
        };
        match event? {
            OverlayEvent::Ready => ready = true,
            OverlayEvent::Reply(reply) => return Some(reply),
        }
    }
}

fn open_overlay_window(
    app: &AppHandle,
    bounds: &OverlayBounds,
    events: mpsc::Sender<OverlayEvent>,
) -> tauri::Result<WebviewWindow> {
    if let Some(stale) = app.get_webview_window(OVERLAY_LABEL) {
        let _ = stale.destroy();
    }
    let mut builder = WebviewWindowBuilder::new(
        app,
        OVERLAY_LABEL,
        // Own entry: loading the main index would boot the whole workbench.
        WebviewUrl::App("screen-capture.html".into()),
    )
    .title("")
    .decorations(false)
    // Transparent until the screenshot paints, so the live screen (identical
    // to the frozen one) shows through instead of a blank frame.
    .transparent(true)
    .resizable(false)
    .shadow(false)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .visible(false)
    .focused(true);
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let window = builder.build()?;
    match *bounds {
        OverlayBounds::Logical {
            x,
            y,
            width,
            height,
        } => {
            window.set_position(tauri::LogicalPosition::new(x, y))?;
            window.set_size(tauri::LogicalSize::new(width, height))?;
        }
        OverlayBounds::Physical {
            x,
            y,
            width,
            height,
        } => {
            window.set_position(tauri::PhysicalPosition::new(x, y))?;
            window.set_size(tauri::PhysicalSize::new(width, height))?;
        }
    }
    // Closed by the OS or a crash: treat as cancel so the capture lock frees.
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Destroyed) {
            let _ = events.send(OverlayEvent::Reply(OverlayReply::Cancelled));
        }
    });
    Ok(window)
}

fn require_overlay(webview: &Webview) -> Result<(), String> {
    if webview.label() == OVERLAY_LABEL {
        Ok(())
    } else {
        Err(ERROR_NOT_FOUND.to_string())
    }
}

/// The frozen screenshot, as raw PNG bytes.
#[tauri::command]
pub(crate) fn screen_capture_overlay_image(
    webview: Webview,
    state: State<'_, ScreenCaptureState>,
) -> Result<Response, String> {
    require_overlay(&webview)?;
    state
        .overlay
        .image()
        .map(Response::new)
        .ok_or_else(|| ERROR_NOT_FOUND.to_string())
}

/// The image is on screen in the webview; show the window over everything.
/// Async so the window work runs off the IPC thread (see `pet_overlay.rs`).
#[tauri::command]
pub(crate) async fn screen_capture_overlay_ready(
    app: AppHandle,
    webview: Webview,
    state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    require_overlay(&webview)?;
    let window = app
        .get_webview_window(OVERLAY_LABEL)
        .ok_or_else(|| ERROR_NOT_FOUND.to_string())?;
    #[cfg(target_os = "macos")]
    super::macos::lift_overlay_window(&window);
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    state.overlay.send(OverlayEvent::Ready);
    Ok(())
}

/// The finished PNG arrives as the raw request body.
#[tauri::command]
pub(crate) fn screen_capture_overlay_finish(
    request: Request<'_>,
    webview: Webview,
    state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    require_overlay(&webview)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(ERROR_FAILED.to_string());
    };
    if png_dimensions(bytes).is_none() {
        return Err(ERROR_FAILED.to_string());
    }
    if state
        .overlay
        .send(OverlayEvent::Reply(OverlayReply::Finished(bytes.clone())))
    {
        Ok(())
    } else {
        Err(ERROR_NOT_FOUND.to_string())
    }
}

#[tauri::command]
pub(crate) fn screen_capture_overlay_cancel(
    webview: Webview,
    state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    require_overlay(&webview)?;
    state
        .overlay
        .send(OverlayEvent::Reply(OverlayReply::Cancelled));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_reply_after_ready_is_returned() {
        let slot = OverlaySlot::default();
        let (_events, receiver) = slot.open(vec![7]);
        assert_eq!(slot.image(), Some(vec![7]));
        assert!(slot.send(OverlayEvent::Ready));
        assert!(slot.send(OverlayEvent::Reply(OverlayReply::Finished(vec![1]))));
        assert!(matches!(
            wait_for_reply(&receiver),
            Some(OverlayReply::Finished(bytes)) if bytes == vec![1]
        ));
    }

    #[test]
    fn closed_slot_drops_sends_and_image() {
        let slot = OverlaySlot::default();
        let (events, receiver) = slot.open(vec![7]);
        slot.close();
        assert_eq!(slot.image(), None);
        assert!(!slot.send(OverlayEvent::Ready));
        drop(events);
        assert!(wait_for_reply(&receiver).is_none());
    }
}
