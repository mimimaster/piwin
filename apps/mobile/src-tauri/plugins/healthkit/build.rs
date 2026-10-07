fn main() {
    tauri_plugin::Builder::new(&[
        "healthkit_is_available",
        "healthkit_authorization_request_status",
        "healthkit_request_read_authorization",
        "healthkit_read_context",
        "healthkit_cancel_read",
        "healthkit_background_sync_configure",
        "healthkit_background_sync_status",
        "healthkit_background_sync_now",
    ])
    .ios_path("ios")
    .build();
}
