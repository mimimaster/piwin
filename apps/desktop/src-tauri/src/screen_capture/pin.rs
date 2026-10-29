//! Floating always-on-top screenshot pins (贴图). Separate webview per image,
//! dedicated `screenshot-pin.html` entry so the workbench does not boot again.

use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Manager, State, Webview, WebviewUrl, WindowEvent};

use super::{png_dimensions, ScreenCaptureState, ERROR_FAILED, ERROR_NOT_FOUND};

pub(crate) const PIN_LABEL_PREFIX: &str = "screenshot-pin-";

const MAX_PIN_WINDOWS: usize = 8;
const MIN_PIN_PX: u32 = 48;
const MAX_PIN_MONITOR_FRACTION: f64 = 0.8;

#[derive(Default)]
pub(crate) struct PinStore {
    inner: Mutex<PinStoreInner>,
}

#[derive(Default)]
struct PinStoreInner {
    next_id: u64,
    images: HashMap<String, Vec<u8>>,
    order: VecDeque<String>,
}

impl PinStore {
    fn allocate_label(&self) -> String {
        let mut inner = self.inner.lock().expect("pin store lock");
        inner.next_id += 1;
        format!("{PIN_LABEL_PREFIX}{}", inner.next_id)
    }

    fn len(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| inner.images.len())
            .unwrap_or(0)
    }

    fn oldest_label(&self) -> Option<String> {
        self.inner
            .lock()
            .ok()?
            .order
            .front()
            .cloned()
    }

    fn put(&self, label: String, png: Vec<u8>) {
        let mut inner = self.inner.lock().expect("pin store lock");
        if !inner.images.contains_key(&label) {
            inner.order.push_back(label.clone());
        }
        inner.images.insert(label, png);
    }

    fn get(&self, label: &str) -> Option<Vec<u8>> {
        self.inner.lock().ok()?.images.get(label).cloned()
    }

    fn remove(&self, label: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        inner.images.remove(label);
        inner.order.retain(|item| item != label);
    }
}

/// Scale the PNG into at most `max_width` × `max_height`, never up.
pub(super) fn fit_pin_physical(
    width: u32,
    height: u32,
    max_width: u32,
    max_height: u32,
) -> (u32, u32) {
    let max_width = max_width.max(MIN_PIN_PX);
    let max_height = max_height.max(MIN_PIN_PX);
    if width == 0 || height == 0 {
        return (MIN_PIN_PX, MIN_PIN_PX);
    }
    let scale = (max_width as f64 / width as f64)
        .min(max_height as f64 / height as f64)
        .min(1.0);
    let out_width = ((width as f64) * scale).round() as u32;
    let out_height = ((height as f64) * scale).round() as u32;
    (out_width.max(1), out_height.max(1))
}

pub(crate) fn is_pin_window_label(label: &str) -> bool {
    label.starts_with(PIN_LABEL_PREFIX)
}

/// Open a pin showing `png`. Evicts the oldest pin when the cap is reached.
pub(super) fn open_pin_window(
    app: &AppHandle,
    state: &ScreenCaptureState,
    png: Vec<u8>,
) -> Result<(), String> {
    let Some((width, height)) = png_dimensions(&png) else {
        return Err(ERROR_FAILED.to_string());
    };
    if state.pins.len() >= MAX_PIN_WINDOWS {
        if let Some(oldest) = state.pins.oldest_label() {
            if let Some(window) = app.get_webview_window(&oldest) {
                let _ = window.destroy();
            }
            state.pins.remove(&oldest);
        }
    }
    let label = state.pins.allocate_label();
    state.pins.put(label.clone(), png);
    match build_pin_window(app, &label, width, height) {
        Ok(window) => {
            let app_for_event = app.clone();
            let label_for_event = label.clone();
            window.on_window_event(move |event| {
                if matches!(event, WindowEvent::Destroyed) {
                    if let Some(capture) = app_for_event.try_state::<ScreenCaptureState>() {
                        capture.pins.remove(&label_for_event);
                    }
                }
            });
            window.show().map_err(|error| error.to_string())?;
            let _ = window.set_focus();
            Ok(())
        }
        Err(error) => {
            state.pins.remove(&label);
            Err(error)
        }
    }
}

fn build_pin_window(
    app: &AppHandle,
    label: &str,
    png_width: u32,
    png_height: u32,
) -> Result<tauri::WebviewWindow, String> {
    if let Some(stale) = app.get_webview_window(label) {
        let _ = stale.destroy();
    }
    let (max_width, max_height, monitor) = pin_monitor_cap(app);
    let (width, height) = fit_pin_physical(png_width, png_height, max_width, max_height);
    let (x, y) = pin_origin(app, &monitor, width, height);
    let mut builder = WebviewWindowBuilder::new(
        app,
        label,
        WebviewUrl::App("screenshot-pin.html".into()),
    )
    .title("")
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .shadow(true)
    .skip_taskbar(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .visible(false)
    .focused(true)
    .inner_size(1.0, 1.0);
    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }
    let window = builder.build().map_err(|error| error.to_string())?;
    window
        .set_size(tauri::PhysicalSize::new(width, height))
        .map_err(|error| error.to_string())?;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    Ok(window)
}

#[derive(Clone, Copy)]
struct MonitorBox {
    x: i32,
    y: i32,
    width: u32,
    height: u32,
}

fn pin_monitor_cap(app: &AppHandle) -> (u32, u32, MonitorBox) {
    let fallback = MonitorBox {
        x: 0,
        y: 0,
        width: 1280,
        height: 800,
    };
    let Ok(monitors) = app.available_monitors() else {
        return cap_from_monitor(&fallback);
    };
    let cursor = app.cursor_position().ok();
    let chosen = cursor
        .and_then(|point| {
            monitors.iter().find(|monitor| {
                let position = monitor.position();
                let size = monitor.size();
                let x = point.x.round() as i32;
                let y = point.y.round() as i32;
                x >= position.x
                    && y >= position.y
                    && x < position.x + size.width as i32
                    && y < position.y + size.height as i32
            })
        })
        .or_else(|| monitors.first())
        .map(|monitor| {
            let position = monitor.position();
            let size = monitor.size();
            MonitorBox {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            }
        })
        .unwrap_or(fallback);
    cap_from_monitor(&chosen)
}

fn cap_from_monitor(monitor: &MonitorBox) -> (u32, u32, MonitorBox) {
    let max_width = ((monitor.width as f64) * MAX_PIN_MONITOR_FRACTION).round() as u32;
    let max_height = ((monitor.height as f64) * MAX_PIN_MONITOR_FRACTION).round() as u32;
    (max_width.max(MIN_PIN_PX), max_height.max(MIN_PIN_PX), MonitorBox { ..*monitor })
}

fn pin_origin(app: &AppHandle, monitor: &MonitorBox, width: u32, height: u32) -> (i32, i32) {
    let cursor = app.cursor_position().ok();
    let raw_x = cursor
        .map(|point| point.x.round() as i32 - 24)
        .unwrap_or(monitor.x + 40);
    let raw_y = cursor
        .map(|point| point.y.round() as i32 - 24)
        .unwrap_or(monitor.y + 40);
    let max_x = monitor.x + monitor.width.saturating_sub(width) as i32;
    let max_y = monitor.y + monitor.height.saturating_sub(height) as i32;
    (
        raw_x.clamp(monitor.x, max_x.max(monitor.x)),
        raw_y.clamp(monitor.y, max_y.max(monitor.y)),
    )
}

fn require_pin(webview: &Webview) -> Result<String, String> {
    let label = webview.label().to_string();
    if is_pin_window_label(&label) {
        Ok(label)
    } else {
        Err(ERROR_NOT_FOUND.to_string())
    }
}

/// Linux in-window editor (and tests) pin from the main window with a raw PNG.
#[tauri::command]
pub(crate) async fn screen_capture_pin(
    app: AppHandle,
    request: Request<'_>,
    state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(ERROR_FAILED.to_string());
    };
    let png = bytes.clone();
    open_pin_window(&app, &state, png)
}

#[tauri::command]
pub(crate) fn screen_capture_pin_image(
    webview: Webview,
    state: State<'_, ScreenCaptureState>,
) -> Result<Response, String> {
    let label = require_pin(&webview)?;
    state
        .pins
        .get(&label)
        .map(Response::new)
        .ok_or_else(|| ERROR_NOT_FOUND.to_string())
}

/// Async so destroy runs off the IPC thread (see `pet_overlay.rs`).
#[tauri::command]
pub(crate) async fn screen_capture_pin_close(
    app: AppHandle,
    webview: Webview,
) -> Result<(), String> {
    let label = require_pin(&webview)?;
    if let Some(window) = app.get_webview_window(&label) {
        window.destroy().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_does_not_upscale_and_keeps_aspect() {
        assert_eq!(fit_pin_physical(200, 100, 400, 400), (200, 100));
        assert_eq!(fit_pin_physical(400, 200, 200, 200), (200, 100));
        assert_eq!(fit_pin_physical(0, 10, 200, 200), (MIN_PIN_PX, MIN_PIN_PX));
    }

    #[test]
    fn store_put_get_remove_and_oldest() {
        let store = PinStore::default();
        let first = store.allocate_label();
        let second = store.allocate_label();
        store.put(first.clone(), vec![1]);
        store.put(second.clone(), vec![2]);
        assert_eq!(store.len(), 2);
        assert_eq!(store.oldest_label(), Some(first.clone()));
        assert_eq!(store.get(&first), Some(vec![1]));
        store.remove(&first);
        assert_eq!(store.oldest_label(), Some(second));
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn pin_labels_use_the_stable_prefix() {
        assert!(is_pin_window_label("screenshot-pin-3"));
        assert!(!is_pin_window_label("screen-capture"));
        assert!(!is_pin_window_label("pet-overlay"));
    }
}
