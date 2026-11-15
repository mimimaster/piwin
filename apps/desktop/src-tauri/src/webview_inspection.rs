use serde::Serialize;

#[derive(Serialize)]
pub struct WebviewInspectionStatus {
    supported: bool,
    enabled: bool,
}

/// Opt in to Safari inspection for the caller's main view, without reloading it.
/// No application listener, preferences or startup configuration is changed.
#[tauri::command]
pub async fn webview_inspection(
    window: tauri::WebviewWindow,
    enabled: Option<bool>,
) -> Result<WebviewInspectionStatus, String> {
    if window.label() != "main" {
        return Err("WebviewInspectionUnavailable: main window required".into());
    }
    #[cfg(target_os = "macos")]
    {
        let (sender, receiver) = std::sync::mpsc::channel();
        window
            .with_webview(move |platform_webview| {
                // SAFETY: Tauri provides the live WKWebView on the main thread.
                // Check availability before calling the public macOS 13.3+ API.
                let status = unsafe {
                    use objc2::runtime::NSObjectProtocol;
                    use objc2_web_kit::WKWebView;
                    let pointer = platform_webview.inner().cast::<WKWebView>();
                    match pointer.as_ref() {
                        Some(view) if view.respondsToSelector(objc2::sel!(setInspectable:)) => {
                            if let Some(enabled) = enabled {
                                view.setInspectable(enabled);
                            }
                            Ok(WebviewInspectionStatus {
                                supported: true,
                                enabled: view.isInspectable(),
                            })
                        }
                        Some(_) => Ok(WebviewInspectionStatus {
                            supported: false,
                            enabled: false,
                        }),
                        None => Err("WebviewInspectionUnavailable: view closed".to_string()),
                    }
                };
                // The awaiting caller may have gone away during native dispatch.
                let _ = sender.send(status);
            })
            .map_err(|error| format!("WebviewInspectionUnavailable: {error}"))?;
        tauri::async_runtime::spawn_blocking(move || {
            receiver
                .recv_timeout(std::time::Duration::from_secs(3))
                .map_err(|error| format!("WebviewInspectionUnavailable: {error}"))?
        })
        .await
        .map_err(|error| format!("WebviewInspectionUnavailable: {error}"))?
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = enabled;
        Ok(WebviewInspectionStatus {
            supported: false,
            enabled: false,
        })
    }
}
