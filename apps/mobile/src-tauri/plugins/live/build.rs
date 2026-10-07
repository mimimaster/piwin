fn main() {
    tauri_plugin::Builder::new(&[
        "live_activity_status",
        "live_activity_sync",
        "live_activity_take_controls",
        "live_audio_prepare",
        "live_audio_connect",
        "live_audio_send",
        "live_audio_set_muted",
        "live_audio_close",
        "live_audio_take_events",
        "register_listener",
        "remove_listener",
    ])
    .ios_path("ios")
    .build();
}
