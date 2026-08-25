use serde_json::{json, Value};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "ios")]
use tauri::Manager;

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_piwin_healthkit);

#[cfg(target_os = "ios")]
struct HealthKitMobile<R: Runtime>(tauri::plugin::PluginHandle<R>);

const UNAVAILABLE: &str = "healthkit-unavailable";

#[tauri::command]
async fn healthkit_is_available<R: Runtime>(app: AppHandle<R>) -> Result<bool, String> {
    #[cfg(target_os = "ios")]
    {
        return ios_handle(&app)?
            .run_mobile_plugin("healthkit_is_available", ())
            .map_err(map_invoke_error);
    }
    let _ = app;
    Ok(false)
}

#[tauri::command]
async fn healthkit_authorization_request_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<String, String> {
    #[cfg(target_os = "ios")]
    {
        return ios_handle(&app)?
            .run_mobile_plugin_async("healthkit_authorization_request_status", ())
            .await
            .map_err(map_invoke_error);
    }
    let _ = app;
    Err(UNAVAILABLE.to_string())
}

#[tauri::command]
async fn healthkit_request_read_authorization<R: Runtime>(
    app: AppHandle<R>,
    metrics: Option<Vec<String>>,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    {
        return ios_handle(&app)?
            .run_mobile_plugin_async(
                "healthkit_request_read_authorization",
                json!({ "metrics": metrics }),
            )
            .await
            .map_err(map_invoke_error);
    }
    let _ = (app, metrics);
    Err(UNAVAILABLE.to_string())
}

#[tauri::command]
async fn healthkit_read_context<R: Runtime>(
    app: AppHandle<R>,
    request: Value,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    {
        return ios_handle(&app)?
            .run_mobile_plugin_async("healthkit_read_context", json!({ "request": request }))
            .await
            .map_err(map_invoke_error);
    }
    let _ = (app, request);
    Err(UNAVAILABLE.to_string())
}

#[tauri::command]
async fn healthkit_cancel_read<R: Runtime>(
    app: AppHandle<R>,
    request_id: String,
) -> Result<Value, String> {
    #[cfg(target_os = "ios")]
    {
        return ios_handle(&app)?
            .run_mobile_plugin(
                "healthkit_cancel_read",
                json!({ "requestId": request_id }),
            )
            .map_err(map_invoke_error);
    }
    let _ = (app, request_id);
    Ok(json!({ "cancelled": true }))
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("piwin-healthkit")
        .invoke_handler(tauri::generate_handler![
            healthkit_is_available,
            healthkit_authorization_request_status,
            healthkit_request_read_authorization,
            healthkit_read_context,
            healthkit_cancel_read,
        ])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                let handle = api.register_ios_plugin(init_plugin_piwin_healthkit)?;
                app.manage(HealthKitMobile(handle));
            }
            #[cfg(not(target_os = "ios"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "ios")]
fn ios_handle<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<tauri::plugin::PluginHandle<R>, String> {
    app.try_state::<HealthKitMobile<R>>()
        .map(|state| state.inner().0.clone())
        .ok_or_else(|| UNAVAILABLE.to_string())
}

#[cfg_attr(not(any(test, target_os = "ios")), allow(dead_code))]
fn map_invoke_error(error: impl std::fmt::Display) -> String {
    let text = error.to_string();
    for code in [
        "healthkit-unavailable",
        "healthkit-no-accessible-data",
        "healthkit-query-failed",
        "cancelled",
        "unsupported",
        "not-authorized-or-no-data",
        "query-failed",
    ] {
        if text.contains(code) {
            return code.to_string();
        }
    }
    UNAVAILABLE.to_string()
}

#[cfg(test)]
mod tests {
    #[test]
    fn maps_swift_reject_codes() {
        assert_eq!(super::UNAVAILABLE, "healthkit-unavailable");
        assert_eq!(
            super::map_invoke_error("Invoke error: healthkit-no-accessible-data"),
            "healthkit-no-accessible-data"
        );
        assert_eq!(
            super::map_invoke_error("Invoke error: cancelled"),
            "cancelled"
        );
    }
}
