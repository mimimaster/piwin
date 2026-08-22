#[cfg(target_os = "macos")]
mod macos {
    use objc2::{
        define_class, msg_send,
        rc::Retained,
        runtime::{NSObject, ProtocolObject},
        DeclaredClass, MainThreadOnly,
    };
    use objc2_foundation::{ns_string, MainThreadMarker, NSObjectProtocol, NSString};
    use objc2_web_kit::{WKScriptMessage, WKScriptMessageHandler, WKUserContentController};
    use serde_json::Value;
    use tauri::{AppHandle, Emitter, Manager};

    const ARTIFACT_BRIDGE_EVENT: &str = "piwin-artifact-bridge";
    const MAX_ARTIFACT_BRIDGE_BYTES: usize = 32 * 1024;

    pub struct ArtifactBridgeHandlerIvars {
        app_handle: AppHandle,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[ivars = ArtifactBridgeHandlerIvars]
        struct ArtifactBridgeHandler;

        unsafe impl NSObjectProtocol for ArtifactBridgeHandler {}

        unsafe impl WKScriptMessageHandler for ArtifactBridgeHandler {
            #[unsafe(method(userContentController:didReceiveScriptMessage:))]
            fn did_receive(
                this: &ArtifactBridgeHandler,
                _controller: &WKUserContentController,
                message: &WKScriptMessage,
            ) {
                // The handler runs on WKWebView's main thread. WKWebView may
                // report sandbox data frames as about:blank, so frame URL is
                // not a stable trust signal. Main-frame rejection plus the
                // bounded protocol parser and UI channelId match are stable.
                unsafe {
                    let frame = message.frameInfo();
                    if frame.isMainFrame() {
                        return;
                    }

                    let body = message.body();
                    let Ok(body) = body.downcast::<NSString>() else {
                        return;
                    };
                    let Some(payload) = parse_artifact_bridge_message(&body.to_string()) else {
                        return;
                    };
                    let _ = this
                        .ivars()
                        .app_handle
                        .emit_to("main", ARTIFACT_BRIDGE_EVENT, payload);
                }
            }
        }
    );

    impl ArtifactBridgeHandler {
        fn install(controller: &WKUserContentController, app_handle: AppHandle) {
            let marker = MainThreadMarker::new().expect("WKWebView setup must run on main thread");
            let allocated = marker
                .alloc::<ArtifactBridgeHandler>()
                .set_ivars(ArtifactBridgeHandlerIvars { app_handle });
            let handler: Retained<Self> = unsafe { msg_send![super(allocated), init] };
            let protocol_handler = ProtocolObject::from_ref(&*handler);
            unsafe {
                controller
                    .addScriptMessageHandler_name(protocol_handler, ns_string!("piwinArtifact"));
            }
            // WKUserContentController retains the registered handler.
        }
    }

    pub fn install_artifact_bridge(app_handle: &AppHandle) -> tauri::Result<()> {
        let Some(webview) = app_handle.get_webview_window("main") else {
            return Ok(());
        };
        let app_handle = app_handle.clone();
        webview.with_webview(move |platform_webview| unsafe {
            let controller: &WKUserContentController = &*platform_webview.controller().cast();
            ArtifactBridgeHandler::install(controller, app_handle);
        })?;
        Ok(())
    }

    fn parse_artifact_bridge_message(body: &str) -> Option<Value> {
        if body.len() > MAX_ARTIFACT_BRIDGE_BYTES {
            return None;
        }
        let payload: Value = serde_json::from_str(body).ok()?;
        let channel_id = payload.get("channelId")?.as_str()?;
        if channel_id.is_empty() || channel_id.len() > 200 {
            return None;
        }
        match payload.get("type")?.as_str()? {
            "piwin-artifact:size" => {
                payload.get("height")?.as_f64()?;
                payload.get("viewportHeight")?.as_f64()?;
                payload.get("revision")?.as_u64()?;
            }
            "piwin-artifact:action" => match payload.get("action")?.as_str()? {
                "flashcard/rate"
                | "flashcard/open-source"
                | "composer/propose-text"
                | "artifact/download-unsupported" => {}
                _ => return None,
            },
            _ => return None,
        }
        Some(payload)
    }

    #[cfg(test)]
    mod tests {
        use super::parse_artifact_bridge_message;

        #[test]
        fn accepts_only_bounded_known_messages() {
            assert!(parse_artifact_bridge_message(
                r#"{"type":"piwin-artifact:size","channelId":"artifact-1","height":684,"viewportHeight":80,"revision":0}"#
            )
            .is_some());
            assert!(parse_artifact_bridge_message(
                r#"{"type":"piwin-artifact:size","channelId":"artifact-1","height":684}"#
            )
            .is_none());
            assert!(parse_artifact_bridge_message(
                r#"{"type":"unknown","channelId":"artifact-1","height":684}"#
            )
            .is_none());
            assert!(parse_artifact_bridge_message(
                r#"{"type":"piwin-artifact:action","channelId":"artifact-1","action":"shell/run"}"#
            )
            .is_none());
            assert!(parse_artifact_bridge_message(
                r#"{"type":"piwin-artifact:action","channelId":"artifact-1","action":"artifact/download-unsupported","payload":{"filename":"demo.html"}}"#
            )
            .is_some());
        }
    }
}

#[cfg(target_os = "macos")]
pub use macos::install_artifact_bridge;

#[cfg(not(target_os = "macos"))]
pub fn install_artifact_bridge(_app_handle: &tauri::AppHandle) -> tauri::Result<()> {
    Ok(())
}
