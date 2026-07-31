/// Pet overlay window: a system-level transparent always-on-top window
/// that renders the pet sprite floating above all other windows.
use tauri::webview::WebviewWindowBuilder;
use tauri::Manager;

const PET_OVERLAY_LABEL: &str = "pet-overlay";

fn prepare_pet_overlay_window(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.set_visible_on_all_workspaces(true)?;
    window.set_always_on_top(true)?;
    window.show()
}

/// Create (or re-show) the pet overlay window. Called on app startup so the
/// pet floats on the desktop by default, and by the `pet_overlay_show` command.
pub fn ensure_pet_overlay_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    // If the window already exists, just show it.
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        return prepare_pet_overlay_window(&window);
    }

    let mut builder = WebviewWindowBuilder::new(
        app,
        PET_OVERLAY_LABEL,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("")
    .inner_size(120.0, 130.0)
    .position(100.0, 100.0)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .visible_on_all_workspaces(true)
    .skip_taskbar(true)
    .resizable(false)
    .visible(false)
    .focused(false)
    .shadow(false);

    #[cfg(target_os = "macos")]
    {
        builder = builder.accept_first_mouse(true);
    }

    let window = builder.build()?;

    // Tauri's transparent + always_on_top handles the window level on all
    // platforms. On macOS, transparent + decorations(false) enables
    // click-through on fully transparent pixels automatically.
    prepare_pet_overlay_window(&window)
}

#[tauri::command]
pub fn pet_overlay_show(app: tauri::AppHandle) -> Result<(), String> {
    ensure_pet_overlay_window(&app).map_err(|e| e.to_string())
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
            prepare_pet_overlay_window(&window).map_err(|e| e.to_string())?;
            Ok(true)
        }
    } else {
        ensure_pet_overlay_window(&app).map_err(|e| e.to_string())?;
        Ok(true)
    }
}
