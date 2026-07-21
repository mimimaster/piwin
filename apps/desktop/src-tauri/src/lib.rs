mod host_bridge;

use host_bridge::{host_is_running, host_request, host_start, host_stop, HostBridgeState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(HostBridgeState::default())
        .invoke_handler(tauri::generate_handler![
            host_start,
            host_stop,
            host_request,
            host_is_running
        ])
        .run(tauri::generate_context!())
        .expect("error while running piwin desktop");
}
