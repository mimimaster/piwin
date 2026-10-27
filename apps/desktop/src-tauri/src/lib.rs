mod app_shutdown;
mod app_update;
mod app_update_stall;
mod attention_notifications;
#[cfg(target_os = "windows")]
mod attention_notifications_windows;
mod attention_toast;
mod channel_secret_store;
mod host_bridge;
mod memory_pressure;
mod pet_overlay;
mod pty_host;
mod pty_tui;
mod reveal_in_file_manager;
mod save_user_file;
mod screen_capture;

use std::sync::atomic::{AtomicBool, Ordering};

use attention_notifications::AttentionNotificationState;
use app_shutdown::{ShutdownState, ShutdownTrigger};
use app_update::AppUpdateState;
use host_bridge::{host_is_running, host_request, host_start, host_stop, HostBridgeState};
use pet_overlay::{
    pet_overlay_hide, pet_overlay_show, pet_overlay_toggle, raise_main_window, show_main_window,
};
use pty_host::{pty_close, pty_close_all, pty_open, pty_resize, pty_write, PtyHostState};
use pty_tui::{pty_open_remote_tui, pty_open_tui};
use tauri::{Manager, WindowEvent};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    piwin_artifact_webview::register_artifact_documents(tauri::Builder::default())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_websocket::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(HostBridgeState::default())
        .manage(PtyHostState::default())
        .manage(ShutdownState::default())
        .manage(AttentionNotificationState::default())
        .manage(AppUpdateState::default())
        .manage(screen_capture::ScreenCaptureState::default())
        .invoke_handler(tauri::generate_handler![
            host_start,
            host_stop,
            host_request,
            host_is_running,
            pty_open,
            pty_open_tui,
            pty_open_remote_tui,
            pty_write,
            pty_resize,
            pty_close,
            pty_close_all,
            pet_overlay_show,
            pet_overlay_hide,
            pet_overlay_toggle,
            piwin_artifact_webview::artifact_document_put,
            show_main_window,
            reveal_in_file_manager::reveal_in_file_manager,
            reveal_in_file_manager::path_exists_locally,
            save_user_file::copy_local_file,
            save_user_file::write_saved_file,
            memory_pressure::purge_webview_memory,
            memory_pressure::relaunch_webview_renderer,
            attention_notifications::attention_capabilities,
            attention_notifications::attention_authorization_status,
            attention_notifications::attention_request_authorization,
            attention_notifications::attention_deliver,
            attention_notifications::attention_remove_delivered,
            attention_notifications::attention_take_pending_activation,
            attention_notifications::attention_open_system_settings,
            app_update::app_update_check,
            app_update::app_update_install,
            channel_secret_store::desktop_secret_read,
            channel_secret_store::desktop_secret_write,
            channel_secret_store::desktop_secret_clear,
            screen_capture::screen_capture_capabilities,
            screen_capture::screen_capture_authorization_status,
            screen_capture::screen_capture_request_authorization,
            screen_capture::screen_capture_open_system_settings,
            screen_capture::screen_capture_restart_app,
            screen_capture::screen_capture_take,
            screen_capture::screen_capture_read
        ])
        .setup(|application| {
            piwin_artifact_webview::install_artifact_bridge(application.handle())?;
            attention_notifications::install(application.handle());
            // Feeds the frontend Memory Governor; no-op on unsupported platforms.
            memory_pressure::spawn_memory_pressure_monitor(application.handle().clone());
            // ADR 0097: no-op for development and shell-only builds.
            app_update::spawn_update_checks(application.handle().clone());
            screen_capture::shortcut::install(application.handle());
            // The window title is "piwin" so the Dock menu / Window list name it;
            // `hiddenTitle` (macOS) and custom chrome (Windows) keep it off the titlebar.
            if let Some(main_window) = application.get_webview_window("main") {
                #[cfg(target_os = "windows")]
                {
                    let _ = main_window.set_decorations(false);
                    let _ = main_window.set_shadow(true);
                }
            }
            // Pet overlay is created on demand (hide = destroy). A hidden
            // preference must not keep a second WebContent process resident.
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "pet-overlay" {
                static REAPPLYING_PET_OVERLAY_FLAGS: AtomicBool = AtomicBool::new(false);
                if matches!(event, WindowEvent::Moved(_) | WindowEvent::Focused(_)) {
                    if !REAPPLYING_PET_OVERLAY_FLAGS.swap(true, Ordering::SeqCst) {
                        let _ = window.set_always_on_top(true);
                        let _ = window.set_visible_on_all_workspaces(true);
                        REAPPLYING_PET_OVERLAY_FLAGS.store(false, Ordering::SeqCst);
                    }
                }
                // Overlay close is hide=destroy, not app quit. Missing window
                // never reaches this handler (no-op).
                return;
            }

            let WindowEvent::CloseRequested { api, .. } = event else {
                return;
            };
            let application = window.app_handle().clone();
            if app_shutdown::is_teardown_complete(&application) {
                return;
            }
            api.prevent_close();
            app_shutdown::begin_graceful_shutdown(
                application,
                ShutdownTrigger::CloseWindow(window.clone()),
            );
        })
        .build(tauri::generate_context!())
        .expect("error while building piwin desktop")
        .run(|app_handle, event| match event {
            // app.exit(), last window destroyed, platform quit routed through
            // the event loop: hold it until the Host sidecar is reaped.
            tauri::RunEvent::ExitRequested { code, api, .. } => {
                if app_shutdown::is_teardown_complete(app_handle) {
                    return;
                }
                api.prevent_exit();
                app_shutdown::begin_graceful_shutdown(
                    app_handle.clone(),
                    ShutdownTrigger::ExitApp(code.unwrap_or(0)),
                );
            }
            // macOS Dock Quit / Cmd+Q go through `terminate:` and arrive here
            // without an ExitRequested; this is the last chance to stop the Host.
            tauri::RunEvent::Exit => app_shutdown::run_terminal_teardown_blocking(app_handle),
            // macOS Dock icon click. The floating pet-overlay is always "visible"
            // (and skip_taskbar), so has_visible_windows is often true even when
            // the main window is minimized or buried — always raise main.
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => {
                let _ = raise_main_window(app_handle);
            }
            _ => {}
        });
}
