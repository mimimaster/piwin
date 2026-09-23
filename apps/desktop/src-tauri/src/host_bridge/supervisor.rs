//! Restart supervision: bounded backoff after an unexpected sidecar death
//! (host death must not require an app restart).

use super::*;

/// Auto-restart backoff schedule (ADR: host death must not require app restart).
/// Each entry is the delay before that retry attempt. After the schedule is
/// exhausted, the supervisor gives up and surfaces a fatal log to the UI.
pub(super) const RESTART_BACKOFF_SCHEDULE: &[Duration] = &[
    Duration::from_millis(500),
    Duration::from_millis(1_000),
    Duration::from_millis(2_000),
    Duration::from_millis(4_000),
];

/// Supervisor: retries `host_start_blocking` with exponential backoff after an
/// unexpected sidecar death. Emits `host-status` events so the UI can surface
/// "reconnecting" / "fatal" states without polling. Gives up after
/// `RESTART_BACKOFF_SCHEDULE` attempts and emits a fatal status.
pub(super) fn supervise_restart(
    app: AppHandle,
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock_flag: Arc<AtomicBool>,
) {
    let mock = mock_flag.load(Ordering::Acquire);
    for (index, delay) in RESTART_BACKOFF_SCHEDULE.iter().enumerate() {
        let attempt = (index + 1) as u32;
        emit_status(&app, "reconnecting", Some(attempt));
        emit_log(
            &app,
            "warn",
            format!(
                "host supervisor: retry {}/{} in {:?} (mock={mock})",
                attempt,
                RESTART_BACKOFF_SCHEDULE.len(),
                delay
            ),
        );
        thread::sleep(*delay);

        // If a manual host_stop or a concurrent host_start already replaced
        // the process, don't fight it — check if the current one is alive.
        if let Some(existing) = inner.lock().ok().and_then(|guard| guard.clone()) {
            if existing.alive.load(Ordering::Acquire) {
                emit_log(
                    &app,
                    "info",
                    "host supervisor: process already alive, aborting restart",
                );
                return;
            }
        }

        match host_start_blocking(
            app.clone(),
            Arc::clone(&inner),
            Arc::clone(&lifecycle),
            Arc::clone(&mock_flag),
            mock,
        ) {
            Ok(_) => {
                emit_status(&app, "restarted", None);
                emit_log(&app, "info", "host supervisor: restart succeeded");
                return;
            }
            Err(error) => {
                emit_log(
                    &app,
                    "error",
                    format!(
                        "host supervisor: restart {}/{} failed: {error}",
                        attempt,
                        RESTART_BACKOFF_SCHEDULE.len()
                    ),
                );
            }
        }
    }
    emit_status(&app, "fatal", None);
    emit_log(
        &app,
        "error",
        format!(
            "host supervisor: exhausted {} restart attempts",
            RESTART_BACKOFF_SCHEDULE.len()
        ),
    );
}
