mod broker;
mod packet;

use broker::{FrameBroker, ResourceFailure, ResourceReady, MAX_PACKET_BYTES};
use packet::encode_inline_frame;
use serde_json::Value;
use std::sync::Arc;
use tauri::{Emitter, Manager, Runtime, WebviewWindow};

pub const READY_EVENT: &str = "browser-frame-resource-ready";
pub const RESOURCE_SCHEME: &str = "piwin-frame";

#[derive(Default)]
pub struct BrowserFrameState {
    broker: FrameBroker,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFrameStreamOpenResult {
    version: u8,
    stream_id: String,
    resource_url_base: String,
    max_packet_bytes: usize,
}

fn require_main_window(window: &WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("browser frame transport is available only to the main window".to_string())
    }
}

#[tauri::command]
pub fn browser_frame_stream_open(
    window: WebviewWindow,
    state: tauri::State<'_, BrowserFrameState>,
    session_id: Option<String>,
) -> Result<BrowserFrameStreamOpenResult, String> {
    require_main_window(&window)?;
    let stream_id = state.broker.open(session_id).map_err(str::to_string)?;
    #[cfg(target_os = "windows")]
    let resource_url_base = format!("http://{RESOURCE_SCHEME}.localhost/v1/{stream_id}");
    #[cfg(not(target_os = "windows"))]
    let resource_url_base = format!("{RESOURCE_SCHEME}://localhost/v1/{stream_id}");
    Ok(BrowserFrameStreamOpenResult {
        version: 1,
        resource_url_base,
        stream_id,
        max_packet_bytes: MAX_PACKET_BYTES,
    })
}

#[tauri::command]
pub fn browser_frame_delivery_ack(
    app: tauri::AppHandle,
    window: WebviewWindow,
    state: tauri::State<'_, BrowserFrameState>,
    stream_id: String,
    delivery_id: u64,
    status: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    let received = match status.as_str() {
        "received" => true,
        "failed" => false,
        _ => return Err("invalid browser frame delivery status".to_string()),
    };
    let Some(next) = state.broker.acknowledge(&stream_id, delivery_id, received) else {
        return Ok(());
    };
    let Some(main_window) = app.get_webview_window("main") else {
        state.broker.close(&stream_id);
        return Ok(());
    };
    if let Err(error) = main_window.emit(READY_EVENT, next) {
        state.broker.close(&stream_id);
        return Err(format!("failed to notify browser frame stream: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub fn browser_frame_stream_close(
    window: WebviewWindow,
    state: tauri::State<'_, BrowserFrameState>,
    stream_id: String,
) -> Result<(), String> {
    require_main_window(&window)?;
    state.broker.close(&stream_id);
    Ok(())
}

/// Replaces inline pixels before they reach the normal Tauri event lane.
pub fn prepare_host_message(
    mut message: Value,
    state: &BrowserFrameState,
) -> (Value, Vec<ResourceReady>) {
    let mut ready = Vec::new();
    match message.get("type").and_then(Value::as_str) {
        Some("browser/frame") => prepare_frame_push(&mut message, state, &mut ready),
        Some("push/batch") => {
            if let Some(items) = message.get_mut("items").and_then(Value::as_array_mut) {
                for item in items {
                    if let Some(push) = item.get_mut("push") {
                        if push.get("type").and_then(Value::as_str) == Some("browser/frame") {
                            prepare_frame_push(push, state, &mut ready);
                        }
                    }
                }
            }
        }
        _ => {}
    }
    (message, ready)
}

fn prepare_frame_push(
    frame: &mut Value,
    state: &BrowserFrameState,
    ready: &mut Vec<ResourceReady>,
) {
    let Some(payload) = frame.get("payload") else {
        return;
    };
    if payload.get("kind").and_then(Value::as_str) != Some("inline") {
        return;
    }
    let session_id = frame.get("sessionId").and_then(Value::as_str);
    let has_interest = state.broker.has_interest(session_id);
    let result = if has_interest {
        encode_inline_frame(frame).ok().map(Arc::<[u8]>::from)
    } else {
        None
    };
    let Some(packet) = result else {
        mark_frame_unavailable(frame);
        return;
    };
    let (accepted, notifications) = state.broker.publish(session_id, packet);
    if !accepted {
        mark_frame_unavailable(frame);
        return;
    }
    if let Some(payload) = frame.get_mut("payload") {
        *payload = serde_json::json!({ "kind": "binary" });
    }
    ready.extend(notifications);
}

fn mark_frame_unavailable(frame: &mut Value) {
    if let Some(payload) = frame.get_mut("payload") {
        *payload = serde_json::json!({
            "kind": "unavailable",
            "reason": "frame-channel-unavailable"
        });
    }
}

pub fn emit_ready(app: &tauri::AppHandle, notification: ResourceReady) {
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    if main_window.emit(READY_EVENT, notification.clone()).is_err() {
        if let Some(state) = app.try_state::<BrowserFrameState>() {
            state.broker.close(&notification.stream_id);
        }
    }
}

fn allowed_origin(origin: &str) -> bool {
    if tauri::is_dev() {
        return matches!(origin, "http://127.0.0.1:1420" | "http://localhost:1420");
    }
    matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    )
}

fn response(
    status: tauri::http::StatusCode,
    body: Vec<u8>,
    origin: Option<&str>,
) -> tauri::http::Response<Vec<u8>> {
    let mut response = tauri::http::Response::new(body);
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        tauri::http::header::CONTENT_TYPE,
        tauri::http::HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        tauri::http::header::CACHE_CONTROL,
        tauri::http::HeaderValue::from_static("no-store"),
    );
    headers.insert(
        tauri::http::header::X_CONTENT_TYPE_OPTIONS,
        tauri::http::HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        tauri::http::header::ACCESS_CONTROL_ALLOW_METHODS,
        tauri::http::HeaderValue::from_static("GET, OPTIONS"),
    );
    if let Some(origin) = origin {
        if let Ok(value) = tauri::http::HeaderValue::from_str(origin) {
            headers.insert(tauri::http::header::ACCESS_CONTROL_ALLOW_ORIGIN, value);
        }
    }
    response
}

fn parse_resource_path(path: &str) -> Option<(&str, u64)> {
    let mut segments = path.strip_prefix("/v1/")?.split('/');
    let stream_id = segments.next()?;
    let delivery_id = segments.next()?.parse::<u64>().ok()?;
    if segments.next().is_some() || !stream_id.starts_with('s') || stream_id.len() > 20 {
        return None;
    }
    Some((stream_id, delivery_id))
}

fn is_resource_host(host: Option<&str>) -> bool {
    #[cfg(target_os = "windows")]
    {
        host == Some("piwin-frame.localhost")
    }
    #[cfg(not(target_os = "windows"))]
    {
        host == Some("localhost")
    }
}

fn handle_resource_request<R: Runtime>(
    context: tauri::UriSchemeContext<'_, R>,
    request: tauri::http::Request<Vec<u8>>,
    responder: tauri::UriSchemeResponder,
) {
    let origin = request
        .headers()
        .get(tauri::http::header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    let is_main = context.webview_label() == "main";
    let valid_origin = origin.filter(|value| allowed_origin(value));
    if !is_main || valid_origin.is_none() || !is_resource_host(request.uri().host()) {
        responder.respond(response(
            tauri::http::StatusCode::FORBIDDEN,
            Vec::new(),
            None,
        ));
        return;
    }
    if request.method() == tauri::http::Method::OPTIONS {
        responder.respond(response(
            tauri::http::StatusCode::NO_CONTENT,
            Vec::new(),
            valid_origin,
        ));
        return;
    }
    if request.method() != tauri::http::Method::GET {
        responder.respond(response(
            tauri::http::StatusCode::METHOD_NOT_ALLOWED,
            Vec::new(),
            valid_origin,
        ));
        return;
    }
    let Some((stream_id, delivery_id)) = parse_resource_path(request.uri().path()) else {
        responder.respond(response(
            tauri::http::StatusCode::NOT_FOUND,
            Vec::new(),
            valid_origin,
        ));
        return;
    };
    let state = context.app_handle().state::<BrowserFrameState>();
    match state.broker.read(stream_id, delivery_id) {
        Ok(packet) => {
            responder.respond(response(tauri::http::StatusCode::OK, packet, valid_origin))
        }
        Err(ResourceFailure::NotFound) => responder.respond(response(
            tauri::http::StatusCode::NOT_FOUND,
            Vec::new(),
            valid_origin,
        )),
        Err(ResourceFailure::Unavailable) => responder.respond(response(
            tauri::http::StatusCode::INTERNAL_SERVER_ERROR,
            Vec::new(),
            valid_origin,
        )),
    }
}

pub fn register_resource_protocol<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol(RESOURCE_SCHEME, handle_resource_request::<R>)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn release_csp_allows_native_frame_fetches() {
        let config: Value = serde_json::from_str(include_str!("../../tauri.conf.json"))
            .expect("valid release app configuration");
        let csp = config["app"]["security"]["csp"].as_str().expect("app CSP");
        let connect = csp
            .split(';')
            .find(|directive| directive.trim().starts_with("connect-src "))
            .expect("connect-src policy");
        for origin in [
            "piwin-frame:",
            "http://piwin-frame.localhost",
            "https://piwin-frame.localhost",
        ] {
            assert!(connect.split_whitespace().any(|value| value == origin));
        }
    }

    #[test]
    fn strips_pixels_from_singular_and_batched_host_pushes() {
        let state = BrowserFrameState::default();
        let stream_id = state
            .broker
            .open(Some("session-a".to_string()))
            .unwrap_or_default();
        let frame = json!({
            "type": "browser/frame", "sessionId": "session-a", "frameId": "9",
            "ts": 1, "sourceDpr": 2, "quality": 80, "producer": "screencast",
            "generation": 2, "pageId": "page-a", "documentRevision": 3,
            "width": 1280, "height": 800, "encodedWidth": 1280, "encodedHeight": 800,
            "payload": { "kind": "inline", "dataUrl": "data:image/jpeg;base64,/9j/2Q==" }
        });
        let (single, ready) = prepare_host_message(frame.clone(), &state);
        assert_eq!(single["payload"]["kind"], "binary");
        assert!(!single.to_string().contains("/9j/2Q=="));
        assert_eq!(ready[0].stream_id, stream_id);

        let batch = json!({
            "type": "push/batch", "afterSeq": 10, "throughSeq": 11,
            "items": [{ "seq": 11, "eventId": "frame-9", "push": frame }]
        });
        let (prepared, _) = prepare_host_message(batch, &state);
        assert_eq!(prepared["afterSeq"], 10);
        assert_eq!(prepared["throughSeq"], 11);
        assert_eq!(prepared["items"][0]["seq"], 11);
        assert!(!prepared.to_string().contains("/9j/2Q=="));
    }

    #[test]
    fn refuses_browser_frames_without_a_local_stream() {
        let (prepared, ready) = prepare_host_message(
            json!({
                "type": "browser/frame", "sessionId": "session-a", "frameId": "1",
                "payload": { "kind": "inline", "dataUrl": "data:image/jpeg;base64,/9j/2Q==" }
            }),
            &BrowserFrameState::default(),
        );
        assert_eq!(prepared["payload"]["kind"], "unavailable");
        assert!(ready.is_empty());
        assert!(!prepared.to_string().contains("/9j/2Q=="));
    }
}
