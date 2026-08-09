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

fn build_pet_overlay_window(app: &tauri::AppHandle) -> tauri::Result<tauri::WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(
        app,
        PET_OVERLAY_LABEL,
        // Keep the cosmetic overlay on a dedicated frontend entry. Loading the
        // main index here would initialize the complete Desktop module graph in
        // a second WebContent process just to render one sprite.
        tauri::WebviewUrl::App("pet-overlay.html".into()),
    )
    .title("")
    // Initial size matches an idle Codex-scale sprite (96×104) + padding.
    // The webview resizes tightly via setSize when the pet cell geometry or
    // speech bubble band changes (see pet-overlay-app.tsx). On macOS fully
    // transparent pixels are click-through.
    .inner_size(120.0, 120.0)
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

    builder.build()
}

/// Create the WebContent process without showing it. Its page restores the
/// persisted Desktop visibility preference after transparent CSS is ready.
pub fn create_pet_overlay_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if app.get_webview_window(PET_OVERLAY_LABEL).is_none() {
        let _window = build_pet_overlay_window(app)?;
    }
    Ok(())
}

/// Create (or re-show) the pet overlay window on an explicit show request.
pub fn ensure_pet_overlay_window(app: &tauri::AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        return prepare_pet_overlay_window(&window);
    }

    let window = build_pet_overlay_window(app)?;

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

/// Raise the main app window: unminimize, show, and focus.
/// Shared by the pet-overlay click path and macOS Dock reopen.
pub fn raise_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    // Best-effort unminimize — some platforms return Err when not minimized.
    let _ = window.unminimize();
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;

    // On macOS, focusing a window does not always activate the app when the
    // click originated from a separate always-on-top overlay window, or when
    // Dock reactivation only surfaces the pet-overlay as the "visible" window.
    #[cfg(target_os = "macos")]
    {
        let _ = app.show();
    }

    Ok(())
}

/// IPC entry for the pet overlay (and any other webview) to raise main.
#[tauri::command]
pub fn show_main_window(app: tauri::AppHandle) -> Result<(), String> {
    raise_main_window(&app)
}
