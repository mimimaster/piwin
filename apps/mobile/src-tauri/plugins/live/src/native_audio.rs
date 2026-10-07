use serde_json::{json, Value};
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn live_audio_prepare<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return super::handle(&app)?
        .run_mobile_plugin_async("live_audio_prepare", json!({"connectionId": connection_id}))
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, connection_id);
        Err("live-media-unsupported".into())
    }
}

#[tauri::command]
pub async fn live_audio_connect<R: Runtime>(
    app: AppHandle<R>,
    connection: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return super::handle(&app)?
        .run_mobile_plugin_async("live_audio_connect", json!({"connection": connection}))
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, connection);
        Err("live-media-unsupported".into())
    }
}

#[tauri::command]
pub async fn live_audio_send<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    message: String,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return super::handle(&app)?
        .run_mobile_plugin_async(
            "live_audio_send",
            json!({"connectionId": connection_id, "message": message}),
        )
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, connection_id, message);
        Err("live-media-unsupported".into())
    }
}

#[tauri::command]
pub async fn live_audio_set_muted<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
    muted: bool,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return super::handle(&app)?
        .run_mobile_plugin_async(
            "live_audio_set_muted",
            json!({"connectionId": connection_id, "muted": muted}),
        )
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, connection_id, muted);
        Err("live-media-unsupported".into())
    }
}

#[tauri::command]
pub async fn live_audio_close<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return super::handle(&app)?
        .run_mobile_plugin_async("live_audio_close", json!({"connectionId": connection_id}))
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, connection_id);
        Err("live-media-unsupported".into())
    }
}

#[tauri::command]
pub async fn live_audio_take_events<R: Runtime>(
    app: AppHandle<R>,
    connection_id: String,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    return super::handle(&app)?
        .run_mobile_plugin_async(
            "live_audio_take_events",
            json!({"connectionId": connection_id}),
        )
        .await
        .map_err(|error| error.to_string());
    #[cfg(not(target_os = "ios"))]
    {
        let _ = (app, connection_id);
        Err("live-media-unsupported".into())
    }
}
