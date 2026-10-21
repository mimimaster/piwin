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

/// A sidecar that stays up this long proved its restart; the next unexpected
/// death starts a fresh backoff schedule. A Host that dies before this (e.g.
/// "piwin root is already owned") keeps consuming the same budget, so a
/// failing start can never respawn at the first backoff step forever.
pub(super) const RESTART_STABLE_UPTIME: Duration = Duration::from_secs(30);

/// Zero-based index into `RESTART_BACKOFF_SCHEDULE` for the next restart, or
/// `None` when the budget is spent and the supervisor must go fatal.
pub(super) fn next_restart_attempt(attempts_so_far: u32, uptime: Duration) -> Option<usize> {
    let attempts_so_far = if uptime >= RESTART_STABLE_UPTIME {
        0
    } else {
        attempts_so_far as usize
    };
    (attempts_so_far < RESTART_BACKOFF_SCHEDULE.len()).then_some(attempts_so_far)
}

/// Supervisor: retries `host_start_blocking` with exponential backoff after an
/// unexpected sidecar death. Emits `host-status` events so the UI can surface
/// "reconnecting" / "fatal" states without polling. The schedule is shared
/// across supervisors through `restart_attempts`: a restart that spawns but
/// dies before `RESTART_STABLE_UPTIME` continues the schedule instead of
/// starting over.
pub(super) fn supervise_restart(
    app: AppHandle,
    inner: Arc<Mutex<Option<Arc<HostProcess>>>>,
    lifecycle: Arc<Mutex<()>>,
    mock_flag: Arc<AtomicBool>,
    restart_attempts: Arc<AtomicU32>,
    uptime: Duration,
) {
    let mock = mock_flag.load(Ordering::Acquire);
    let Some(first_index) =
        next_restart_attempt(restart_attempts.load(Ordering::Acquire), uptime)
    else {
        emit_fatal(&app);
        return;
    };
    for (index, delay) in RESTART_BACKOFF_SCHEDULE.iter().enumerate().skip(first_index) {
        let attempt = (index + 1) as u32;
        restart_attempts.store(attempt, Ordering::Release);
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
            Arc::clone(&restart_attempts),
            mock,
        ) {
            Ok(_) => {
                // Spawned, not yet proven: the attempt stays counted until the
                // new sidecar outlives RESTART_STABLE_UPTIME.
                emit_status(&app, "restarted", None);
                emit_log(&app, "info", "host supervisor: restart spawned");
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
    emit_fatal(&app);
}

fn emit_fatal(app: &AppHandle) {
    emit_status(app, "fatal", None);
    emit_log(
        app,
        "error",
        format!(
            "host supervisor: exhausted {} restart attempts; restart piwin to retry",
            RESTART_BACKOFF_SCHEDULE.len()
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_deaths_consume_one_shared_budget() {
        let quick = Duration::from_millis(5);
        assert_eq!(next_restart_attempt(0, quick), Some(0));
        assert_eq!(next_restart_attempt(1, quick), Some(1));
        assert_eq!(next_restart_attempt(3, quick), Some(3));
        assert_eq!(
            next_restart_attempt(RESTART_BACKOFF_SCHEDULE.len() as u32, quick),
            None
        );
    }

    #[test]
    fn a_stable_sidecar_earns_a_fresh_schedule() {
        let exhausted = RESTART_BACKOFF_SCHEDULE.len() as u32;
        assert_eq!(next_restart_attempt(exhausted, RESTART_STABLE_UPTIME), Some(0));
    }
}
