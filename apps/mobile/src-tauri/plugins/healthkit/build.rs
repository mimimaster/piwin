fn main() {
    tauri_plugin::Builder::new(&[
        "healthkit_is_available",
        "healthkit_authorization_request_status",
        "healthkit_request_read_authorization",
        "healthkit_read_context",
        "healthkit_cancel_read",
    ])
    .ios_path("ios")
    .build();
}
