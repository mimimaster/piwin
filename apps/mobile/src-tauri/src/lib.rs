#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default();

    #[cfg(mobile)]
    {
        builder = builder.plugin(tauri_plugin_barcode_scanner::init());
    }

    builder
        .run(tauri::generate_context!())
        .expect("error while running Piwin Mobile");
}
