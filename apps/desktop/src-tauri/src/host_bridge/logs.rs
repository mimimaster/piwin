//! UI-facing events from the host bridge: logs, reconnection status,
//! and correlated host pushes.

use super::*;

#[derive(Clone, serde::Serialize)]
pub(super) struct HostLogPayload {
    level: String,
    message: String,
}

/// Status payload emitted to the UI so it can show reconnecting / fatal states
/// without leaking the word "host" into user-facing copy. The UI maps
/// `reconnecting` → "piwinwin 正在重连" and `fatal` → "piwinwin 遇到问题".
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct HostStatusPayload {
    /// "reconnecting" | "restarted" | "fatal"
    state: String,
    /// Retry attempt number (1-based) when state == "reconnecting".
    attempt: Option<u32>,
}

pub(super) fn emit_log(app: &AppHandle, level: &str, message: impl Into<String>) {
    let _ = app.emit(
        "host-log",
        HostLogPayload {
            level: level.to_string(),
            message: message.into(),
        },
    );
}

pub(super) fn emit_status(app: &AppHandle, state: &str, attempt: Option<u32>) {
    let _ = app.emit(
        "host-status",
        HostStatusPayload {
            state: state.to_string(),
            attempt,
        },
    );
}

/// Deliver unsolicited host pushes only to the main WebView. Responses are
/// correlated with `host_request` through the pending map and must never enter
/// this event lane: broadcasting them would make every subscriber process a
/// request result a second time.
pub(super) fn host_push_event_name(parsed: &Value) -> Option<&'static str> {
    match parsed.get("type").and_then(Value::as_str) {
        Some("response") => None,
        Some("push/batch") => Some("host-message-batch"),
        Some(_) => Some("host-message"),
        None => None,
    }
}

pub(super) fn emit_host_push(app: &AppHandle, parsed: &Value) {
    let Some(event_name) = host_push_event_name(parsed) else {
        return;
    };
    let Some(main_window) = app.get_webview_window("main") else {
        return;
    };
    let _ = main_window.emit(event_name, parsed);
}
