//! The request pending table: request ids, the per-request response
//! channel, and the failure sweep run when the child dies.

use super::*;

pub(super) struct PendingResponse {
    pub(super) tx: std::sync::mpsc::Sender<Value>,
}

pub(super) static REQUEST_SEQ: AtomicU64 = AtomicU64::new(1);

/// Preserve a versioned local envelope (`v`, `command`, `idempotencyKey`)
/// unchanged except for assigning `command.id` used by the pending map.
pub(super) fn assign_host_request_id(command: &mut Value) -> String {
    let inner_command = command
        .get("v")
        .and_then(|value| value.as_u64())
        .filter(|version| *version == 1)
        .and_then(|_| command.get("command"))
        .cloned();
    if let Some(Value::Object(mut inner)) = inner_command {
        let request_id = inner
            .get("id")
            .and_then(|value| value.as_str())
            .map(|value| value.to_string())
            .unwrap_or_else(|| format!("tauri-{}", REQUEST_SEQ.fetch_add(1, Ordering::Relaxed)));
        inner.insert("id".to_string(), Value::String(request_id.clone()));
        if let Some(object) = command.as_object_mut() {
            object.insert("command".to_string(), Value::Object(inner));
        }
        return request_id;
    }
    let request_id = command
        .get("id")
        .and_then(|value| value.as_str())
        .map(|value| value.to_string())
        .unwrap_or_else(|| format!("tauri-{}", REQUEST_SEQ.fetch_add(1, Ordering::Relaxed)));
    if let Some(object) = command.as_object_mut() {
        object.insert("id".to_string(), Value::String(request_id.clone()));
    }
    request_id
}

pub(super) fn resolve_host_request_timeout(timeout_ms: Option<u64>) -> Option<Duration> {
    match timeout_ms {
        Some(0) => None,
        Some(milliseconds) => Some(Duration::from_millis(milliseconds)),
        None => Some(Duration::from_millis(30_000)),
    }
}

/// Drain all pending requests with an error so callers fail immediately
/// instead of waiting for a 60s timeout on a dead process.
pub(super) fn fail_all_pending(pending: &Mutex<HashMap<String, PendingResponse>>, reason: &str) {
    if let Ok(mut map) = pending.lock() {
        let error_response = serde_json::json!({
            "type": "response",
            "success": false,
            "error": format!("host process died: {reason}"),
        });
        for (_id, entry) in map.drain() {
            let _ = entry.tx.send(error_response.clone());
        }
    }
}

pub(super) fn fail_pending_after_stop(
    pending: &Mutex<HashMap<String, PendingResponse>>,
    outcome: &StopOutcome,
) {
    match outcome {
        StopOutcome::GracefulExit => {}
        StopOutcome::AbnormalExit => {
            fail_all_pending(pending, "host process exited abnormally during shutdown")
        }
        StopOutcome::ForcedKill => {
            fail_all_pending(pending, "host process required forced termination")
        }
    }
}
