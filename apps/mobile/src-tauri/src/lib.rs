mod credential_store;
mod external_open;
mod webview_chrome;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
        builder = builder.plugin(tauri_plugin_piwin_healthkit::init());
        builder = builder.plugin(tauri_plugin_websocket::init());
        builder = builder.plugin(tauri_plugin_notification::init());
        // Used from Rust only (external_open.rs); no shell command is exposed
        // to the page.
        builder = builder.plugin(tauri_plugin_shell::init());
    }

    builder = builder.plugin(
        tauri_plugin_keyring_store::Builder::new()
            .service("app.piwin.mobile.credentials")
            .build(),
    );

    // The default interface is the Desktop workbench build, whose Artifact
    // iframes need the isolated document scheme under the packaged page CSP.
    builder = piwin_artifact_webview::register_artifact_documents(builder);

    builder
        .setup(|app| {
            webview_chrome::install(app);
            piwin_artifact_webview::install_artifact_bridge(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            credential_store::mobile_credential_read,
            credential_store::mobile_credential_write,
            credential_store::mobile_credential_clear,
            external_open::mobile_open_external,
            piwin_artifact_webview::artifact_document_put,
        ])
        .run(tauri::generate_context!())
        .expect("error while running piwin shell");
}
