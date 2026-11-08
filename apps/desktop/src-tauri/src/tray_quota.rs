//! macOS menu-bar tray icon + OAuth quota popover window.
//!
//! - Only shown when the Host reports at least one connected OAuth subscription
//!   account (`tray_quota_set_visible(true)`). When zero OAuth accounts are
//!   connected, the tray icon is hidden and any open popover is destroyed.
//! - Clicking the menu-bar icon toggles the lightweight popover webview
//!   (`tray-quota.html`) anchored directly below the tray icon rect.
//! - Clicking inside the popover to open piwin (or open OAuth settings) raises
//!   the main window and dismisses the popover.

use std::sync::Mutex;

#[cfg(target_os = "macos")]
use tauri::image::Image;
#[cfg(target_os = "macos")]
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::webview::WebviewWindowBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WindowEvent};

pub(crate) const TRAY_QUOTA_LABEL: &str = "tray-quota";
#[cfg(target_os = "macos")]
const TRAY_ICON_ID: &str = "piwin-oauth-tray";

const DEFAULT_POPOVER_WIDTH: f64 = 340.0;
const DEFAULT_POPOVER_HEIGHT: f64 = 280.0;
const MIN_POPOVER_HEIGHT: f64 = 120.0;
const MAX_POPOVER_HEIGHT: f64 = 620.0;

#[derive(Clone, Copy, Debug)]
struct AnchorRect {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    is_physical: bool,
}

#[derive(Default)]
pub(crate) struct TrayQuotaState {
    last_anchor: Mutex<Option<AnchorRect>>,
}

/// Convert `alpaca-mark-white.png` into a clean white- silhouette RGBA template
/// image where background luminance becomes transparent and white foreground
/// becomes opaque template ink.
#[cfg(target_os = "macos")]
fn build_template_tray_image() -> Option<Image<'static>> {
    const RAW_PNG: &[u8] = include_bytes!("../../public/ui/alpaca-mark-white.png");
    let decoder = png::Decoder::new(std::io::Cursor::new(RAW_PNG));
    let mut reader = decoder.read_info().ok()?;
    let mut buf = vec![0u8; reader.output_buffer_size()?];
    let info = reader.next_frame(&mut buf).ok()?;
    let bytes = &buf[..info.buffer_size()];

    let width = info.width;
    let height = info.height;
    let mut rgba = Vec::with_capacity((width * height * 4) as usize);

    match info.color_type {
        png::ColorType::Rgba => {
            for pixel in bytes.chunks_exact(4) {
                let r = pixel[0] as u16;
                let g = pixel[1] as u16;
                let b = pixel[2] as u16;
                let a = pixel[3] as u16;
                let luma = (r * 77 + g * 150 + b * 29) >> 8;
                let out_alpha = ((luma * a) / 255) as u8;
                rgba.extend_from_slice(&[255, 255, 255, out_alpha]);
            }
        }
        png::ColorType::Rgb => {
            for pixel in bytes.chunks_exact(3) {
                let r = pixel[0] as u16;
                let g = pixel[1] as u16;
                let b = pixel[2] as u16;
                let luma = ((r * 77 + g * 150 + b * 29) >> 8) as u8;
                rgba.extend_from_slice(&[255, 255, 255, luma]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in bytes.chunks_exact(2) {
                let luma = pixel[0] as u16;
                let a = pixel[1] as u16;
                let out_alpha = ((luma * a) / 255) as u8;
                rgba.extend_from_slice(&[255, 255, 255, out_alpha]);
            }
        }
        png::ColorType::Grayscale => {
            for &luma in bytes {
                rgba.extend_from_slice(&[255, 255, 255, luma]);
            }
        }
        png::ColorType::Indexed => return None,
    }

    Some(Image::new_owned(rgba, width, height))
}

/// Install the macOS menu-bar tray icon (initially hidden until the main
/// window reports connected OAuth accounts).
pub(crate) fn install(app: &AppHandle) {
    #[cfg(target_os = "macos")]
    {
        let Some(icon) = build_template_tray_image() else {
            eprintln!("[piwin] could not decode tray template icon");
            return;
        };
        let handle = app.clone();
        let built = TrayIconBuilder::with_id(TRAY_ICON_ID)
            .icon(icon)
            .icon_as_template(true)
            .tooltip("piwin · OAuth Quota")
            .show_menu_on_left_click(false)
            .on_tray_icon_event(move |_tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    rect,
                    ..
                } = event
                {
                    let anchor = extract_anchor_rect(rect);
                    if let Some(state) = handle.try_state::<TrayQuotaState>() {
                        if let Ok(mut guard) = state.last_anchor.lock() {
                            *guard = Some(anchor);
                        }
                    }
                    let app_for_task = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = toggle_popover_window(&app_for_task, Some(anchor));
                    });
                }
            })
            .build(app);

        match built {
            Ok(tray) => {
                // Hidden by default: "没有oauth就不展示"
                let _ = tray.set_visible(false);
            }
            Err(error) => {
                eprintln!("[piwin] failed to build macOS tray icon: {error}");
            }
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
    }
}

#[cfg(target_os = "macos")]
fn extract_anchor_rect(rect: tauri::Rect) -> AnchorRect {
    match (rect.position, rect.size) {
        (tauri::Position::Physical(pos), tauri::Size::Physical(size)) => AnchorRect {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width as f64,
            height: size.height as f64,
            is_physical: true,
        },
        (tauri::Position::Logical(pos), tauri::Size::Logical(size)) => AnchorRect {
            x: pos.x,
            y: pos.y,
            width: size.width,
            height: size.height,
            is_physical: false,
        },
        (tauri::Position::Physical(pos), tauri::Size::Logical(size)) => AnchorRect {
            x: pos.x as f64,
            y: pos.y as f64,
            width: size.width,
            height: size.height,
            is_physical: false,
        },
        (tauri::Position::Logical(pos), tauri::Size::Physical(size)) => AnchorRect {
            x: pos.x,
            y: pos.y,
            width: size.width as f64,
            height: size.height as f64,
            is_physical: true,
        },
    }
}

fn position_popover_below_anchor(
    window: &WebviewWindow,
    anchor: Option<AnchorRect>,
    popover_width: f64,
) {
    let scale = window.scale_factor().unwrap_or(2.0).max(1.0);
    if let Some(rect) = anchor {
        let (logical_x, logical_y, logical_w, logical_h) = if rect.is_physical {
            (
                rect.x / scale,
                rect.y / scale,
                rect.width / scale,
                rect.height / scale,
            )
        } else {
            (rect.x, rect.y, rect.width, rect.height)
        };
        let target_x = (logical_x + (logical_w / 2.0) - (popover_width / 2.0)).max(12.0);
        let target_y = (logical_y + logical_h + 6.0).max(28.0);
        let _ = window.set_position(tauri::LogicalPosition::new(target_x, target_y));
    }
}

fn build_popover_window(
    app: &AppHandle,
    anchor: Option<AnchorRect>,
) -> tauri::Result<WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        TRAY_QUOTA_LABEL,
        WebviewUrl::App("tray-quota.html".into()),
    )
    .title("")
    .inner_size(DEFAULT_POPOVER_WIDTH, DEFAULT_POPOVER_HEIGHT)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .focused(true)
    .shadow(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    let window = builder.build()?;
    let _ = window.set_shadow(false);
    position_popover_below_anchor(&window, anchor, DEFAULT_POPOVER_WIDTH);

    let window_for_events = window.clone();
    window.on_window_event(move |event| {
        if matches!(event, WindowEvent::Focused(false)) {
            let _ = window_for_events.hide();
        }
    });

    Ok(window)
}

fn toggle_popover_window(app: &AppHandle, anchor: Option<AnchorRect>) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(TRAY_QUOTA_LABEL) {
        let is_visible = window.is_visible().unwrap_or(false);
        if is_visible {
            window.hide().map_err(|e| e.to_string())?;
            return Ok(false);
        }
        position_popover_below_anchor(&window, anchor, DEFAULT_POPOVER_WIDTH);
        let _ = window.set_always_on_top(true);
        let _ = window.set_visible_on_all_workspaces(true);
        let _ = window.set_shadow(false);
        window.show().map_err(|e| e.to_string())?;
        let _ = window.set_focus();
        let _ = app.emit("tray-quota-opened", ());
        return Ok(true);
    }

    let window = build_popover_window(app, anchor).map_err(|e| e.to_string())?;
    let _ = window.set_always_on_top(true);
    let _ = window.set_visible_on_all_workspaces(true);
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    let _ = app.emit("tray-quota-opened", ());
    Ok(true)
}

/// Show or hide the macOS menu-bar tray icon according to whether the user has
/// any active OAuth subscription accounts.
#[tauri::command]
pub async fn tray_quota_set_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        if let Some(tray) = app.tray_by_id(TRAY_ICON_ID) {
            tray.set_visible(visible).map_err(|e| e.to_string())?;
        }
    }
    if !visible {
        if let Some(window) = app.get_webview_window(TRAY_QUOTA_LABEL) {
            let _ = window.destroy();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn tray_quota_hide(app: AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TRAY_QUOTA_LABEL) {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tray_quota_resize(app: AppHandle, height: f64) -> Result<(), String> {
    let clamped = height.clamp(MIN_POPOVER_HEIGHT, MAX_POPOVER_HEIGHT);
    if let Some(window) = app.get_webview_window(TRAY_QUOTA_LABEL) {
        window
            .set_size(tauri::LogicalSize::new(DEFAULT_POPOVER_WIDTH, clamped))
            .map_err(|e| e.to_string())?;
        let anchor = app
            .try_state::<TrayQuotaState>()
            .and_then(|s| s.last_anchor.lock().ok().and_then(|g| *g));
        if anchor.is_some() {
            position_popover_below_anchor(&window, anchor, DEFAULT_POPOVER_WIDTH);
        }
    }
    Ok(())
}

/// Hide the tray popover, raise the main piwin window, and optionally navigate
/// the main window to a specific settings section (e.g. `"oauth"`).
#[tauri::command]
pub async fn tray_quota_open_piwin(
    app: AppHandle,
    section: Option<String>,
) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(TRAY_QUOTA_LABEL) {
        let _ = window.hide();
    }
    crate::pet_overlay::raise_main_window(&app)?;
    if let Some(sec) = section {
        let _ = app.emit(
            "tray-quota-navigate",
            serde_json::json!({ "section": sec }),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn template_icon_decodes_from_alpaca_png() {
        let img = build_template_tray_image().expect("template icon should decode");
        assert_eq!(img.width(), 64);
        assert_eq!(img.height(), 64);
        assert_eq!(img.rgba().len(), 64 * 64 * 4);
    }
}
