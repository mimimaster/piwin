use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "ios")]
use tauri::Manager;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_piwin_live);

#[cfg(target_os = "ios")]
struct LiveMobile<R: Runtime>(tauri::plugin::PluginHandle<R>);

#[tauri::command]
async fn live_activity_status<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return handle(&app)?
        .run_mobile_plugin_async("live_activity_status", ())
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Ok(json!({ "enabled": false }))
    }
}

#[tauri::command]
async fn live_activity_sync<R: Runtime>(
    app: AppHandle<R>,
    activity: Option<Value>,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return handle(&app)?
        .run_mobile_plugin_async("live_activity_sync", json!({ "activity": activity }))
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, activity);
        Ok(json!({ "enabled": false }))
    }
}

#[tauri::command]
async fn live_activity_take_controls<R: Runtime>(app: AppHandle<R>) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return handle(&app)?
        .run_mobile_plugin_async("live_activity_take_controls", ())
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = app;
        Ok(json!([]))
    }
}

mod native_audio;
use native_audio::*;

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("piwin-live")
        .invoke_handler(tauri::generate_handler![
            live_activity_status,
            live_activity_sync,
            live_activity_take_controls,
            live_audio_prepare,
            live_audio_connect,
            live_audio_send,
            live_audio_set_muted,
            live_audio_close,
            live_audio_take_events
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            app.manage(LiveMobile(api.register_ios_plugin(init_plugin_piwin_live)?));
            #[cfg(not(target_os = "ios"))]
            let _ = (app, api);
            Ok(())
        })
        .on_event(|app, event| {
            #[cfg(target_os = "ios")]
            if let tauri::RunEvent::Opened { urls } = event {
                for url in urls.iter().filter(|url| url.scheme() == "piwin-live") {
                    if let Ok(plugin) = handle(app) {
                        #[cfg(debug_assertions)]
                        if url.host_str() == Some("simulator-preview") {
                            let payload = json!({ "url": url.as_str() });
                            tauri::async_runtime::spawn(async move {
                                if let Err(error) = plugin
                                    .run_mobile_plugin_async::<Value>(
                                        "live_activity_preview",
                                        payload,
                                    )
                                    .await
                                {
                                    eprintln!("[piwin-live] simulator preview failed: {error}");
                                }
                            });
                            continue;
                        }
                        let payload = json!({ "url": url.as_str() });
                        tauri::async_runtime::spawn(async move {
                            if let Err(error) = plugin
                                .run_mobile_plugin_async::<Value>("live_activity_open", payload)
                                .await
                            {
                                eprintln!("[piwin-live] cannot open call: {error}");
                            }
                        });
                    }
                }
            }
            #[cfg(not(target_os = "ios"))]
            let _ = (app, event);
        })
        .build()
}

#[cfg(target_os = "ios")]
fn handle<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::plugin::PluginHandle<R>, String> {
    app.try_state::<LiveMobile<R>>()
        .map(|state| state.inner().0.clone())
        .ok_or_else(|| "live-activity-unavailable".to_string())
}
