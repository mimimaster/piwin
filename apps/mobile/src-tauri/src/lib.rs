mod credential_store;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }

    builder = builder.plugin(
        tauri_plugin_keyring_store::Builder::new()
            .service("app.piwin.mobile.credentials")
            .build(),
    );

    builder
        .invoke_handler(tauri::generate_handler![
            credential_store::mobile_credential_read,
            credential_store::mobile_credential_write,
            credential_store::mobile_credential_clear,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Piwin Mobile");
}
