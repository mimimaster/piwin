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

fn apply_pet_overlay_position(
    window: &tauri::WebviewWindow,
    x: Option<f64>,
    y: Option<f64>,
) -> tauri::Result<()> {
    if let (Some(origin_x), Some(origin_y)) = (x, y) {
        window.set_position(tauri::LogicalPosition::new(origin_x, origin_y))?;
    }
    Ok(())
}

fn build_pet_overlay_window(
    app: &tauri::AppHandle,
    x: Option<f64>,
    y: Option<f64>,
) -> tauri::Result<tauri::WebviewWindow> {
    let origin_x = x.unwrap_or(100.0);
    let origin_y = y.unwrap_or(100.0);
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
    .position(origin_x, origin_y)
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

/// Create (or re-show) the pet overlay window on an explicit show request.
/// Hidden preference must not pre-create this WebContent (hide = destroy).
pub fn ensure_pet_overlay_window(
    app: &tauri::AppHandle,
    x: Option<f64>,
    y: Option<f64>,
) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        apply_pet_overlay_position(&window, x, y)?;
        return prepare_pet_overlay_window(&window);
    }

    let window = build_pet_overlay_window(app, x, y)?;

    // Tauri's transparent + always_on_top handles the window level on all
    // platforms. On macOS, transparent + decorations(false) enables
    // click-through on fully transparent pixels automatically.
    prepare_pet_overlay_window(&window)
}

// Pet-overlay commands are `async` on purpose. Tauri executes sync commands
// inline on the IPC thread, and on Windows that thread is the WebView2 main
// thread: creating or destroying a second webview from inside a protocol
// callback deadlocks wry's custom-protocol responder (wry's own note on
// `create_webview`: it "must be called from a separate thread, otherwise the
// channel will introduce a deadlock"). The deadlock is silent but total —
// every later asset and IPC request stops being answered, so lazy chunks never
// load and the app degrades. Async commands run on the async runtime, which
// dispatches the window work to the event loop from another thread.
#[tauri::command]
pub async fn pet_overlay_show(
    app: tauri::AppHandle,
    x: Option<f64>,
    y: Option<f64>,
) -> Result<(), String> {
    ensure_pet_overlay_window(&app, x, y).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pet_overlay_hide(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        // destroy() skips CloseRequested and actually tears down the
        // WebContent. close() can leave a transparent always-on-top window
        // resident so the speech bubble keeps floating after the user hid it.
        window.destroy().map_err(|e| e.to_string())
    } else {
        Ok(())
    }
}

#[tauri::command]
pub async fn pet_overlay_toggle(app: tauri::AppHandle) -> Result<bool, String> {
    if let Some(window) = app.get_webview_window(PET_OVERLAY_LABEL) {
        if window.is_visible().map_err(|e| e.to_string())? {
            window.destroy().map_err(|e| e.to_string())?;
            Ok(false)
        } else {
            prepare_pet_overlay_window(&window).map_err(|e| e.to_string())?;
            Ok(true)
        }
    } else {
        ensure_pet_overlay_window(&app, None, None).map_err(|e| e.to_string())?;
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
