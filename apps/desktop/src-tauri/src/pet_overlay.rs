/// Pet overlay window: a system-level transparent always-on-top window
/// that renders the pet sprite floating above all other windows.
use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

const PET_OVERLAY_LABEL: &str = "pet-overlay";

fn create_pet_overlay_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    // If the window already exists, just show it.
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        window.show()?;
        return Ok(());
    }

    let _window = WebviewWindowBuilder::new(
        app,
        PET_OVERLAY_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("")
    .inner_size(120.0, 130.0)
    .position(0.0, 0.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(true)
    .focused(false)
    .shadow(false)
    .build()?;

    // Tauri's transparent + always_on_top handles the window level on all
    // platforms. On macOS, transparent + decorations(false) enables
    // click-through on fully transparent pixels automatically.

    Ok(())
}

#[tauri::command]
pub fn pet_overlay_show(app: tauri::AppHandle) -> Result<(), String> {
    create_pet_overlay_window(&app).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pet_overlay_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        window.hide().map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn pet_overlay_toggle(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        if window.is_visible().map_err(|e| e.to_string())? {
            window.hide().map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            window.show().map_err(|e| e.to_string())?;
            Ok(true)
        }
    } else {
        create_pet_overlay_window(&app).map_err(|e| e.to_string())?;
        Ok(true)
    }
}
