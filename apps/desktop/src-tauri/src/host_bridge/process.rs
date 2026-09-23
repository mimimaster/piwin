//! Host process supervision: liveness probes, graceful stdin-EOF stop,
//! forced termination, and reaping.

use super::*;
use super::pending::fail_pending_after_stop;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum StopOutcome {
    GracefulExit,
    AbnormalExit,
    ForcedKill,
}

/**
 * E4: collect bounded, non-secret observability data before shutting down the
 * host bridge. Returns sidecar PID, MCP child PIDs (from mcp/status), and a
 * snapshot of pending request count.
 *
 * This must be called BEFORE host_stop closes stdin, so the host can still
 * respond to `mcp/status`.
 */
pub struct HostObservability {
    pub sidecar_pid: Option<i32>,
    pub host_alive: bool,
    pub pending_request_count: usize,
}

/**
 * Retrieve bounded observability from the host process. Returns sidecar PID
 * (if known), liveness flag, and pending request count.
 *
 * This acquires the child lock briefly to call try_wait() and id(). It does
 * NOT close stdin or send any commands.
 */
pub fn observe_host_process_blocking(
    inner: &Arc<Mutex<Option<Arc<HostProcess>>>>,
) -> HostObservability {
    let process = match inner.lock().ok().and_then(|guard| guard.clone()) {
        Some(process) => process,
        None => {
            return HostObservability {
                sidecar_pid: None,
                host_alive: false,
                pending_request_count: 0,
            };
        }
    };

    let alive = process.alive.load(Ordering::Acquire);
    let pid = process.child.lock().ok().map(|child| child.id() as i32);

    HostObservability {
        sidecar_pid: pid,
        host_alive: alive,
        pending_request_count: process.pending.lock().ok().map_or(0, |map| map.len()),
    }
}

pub(super) fn process_has_exited(process: &HostProcess) -> bool {
    process
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.try_wait().ok())
        .flatten()
        .is_some()
}

pub(super) fn stop_process(process: &HostProcess) -> Result<StopOutcome, String> {
    // Publish this before closing the pipe so the reader can distinguish
    // expected EOF from an unexpected sidecar death.
    process.shutting_down.store(true, Ordering::Release);
    close_stdin(process)?;

    // host serve treats stdin EOF as a shutdown request. Give its runtime a
    // short bounded window to flush/dispose before using process termination.
    if let Some(exit_status) = wait_for_process_exit(process, HOST_GRACEFUL_SHUTDOWN_TIMEOUT) {
        let exit_status = reap_process(process).map(|_| exit_status)?;
        process.alive.store(false, Ordering::Release);
        let outcome = if exit_status.success() {
            StopOutcome::GracefulExit
        } else {
            StopOutcome::AbnormalExit
        };
        fail_pending_after_stop(&process.pending, &outcome);
        return Ok(outcome);
    }

    let kill_result = {
        let mut child = process
            .child
            .lock()
            .map_err(|error| format!("lock host child for termination: {error}"))?;
        child
            .kill()
            .map_err(|error| format!("terminate host process: {error}"))
    };
    let reap_result = reap_process(process);
    process.alive.store(false, Ordering::Release);
    fail_pending_after_stop(&process.pending, &StopOutcome::ForcedKill);

    kill_result
        .and(reap_result)
        .map(|_| StopOutcome::ForcedKill)
}

pub(super) fn close_stdin(process: &HostProcess) -> Result<(), String> {
    let stdin_to_close = process
        .stdin
        .lock()
        .map_err(|error| format!("lock host stdin for shutdown: {error}"))?
        .take();
    // Drop the pipe after releasing the mutex. This unblocks the sidecar's
    // readline loop without retaining the stdin lock during any wait.
    drop(stdin_to_close);
    Ok(())
}

pub(super) fn wait_for_process_exit(process: &HostProcess, timeout: Duration) -> Option<ExitStatus> {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(exit_status) = process_exit_status(process) {
            return Some(exit_status);
        }
        thread::sleep(PROCESS_POLL_INTERVAL);
    }
    process_exit_status(process)
}

pub(super) fn process_exit_status(process: &HostProcess) -> Option<ExitStatus> {
    process
        .child
        .lock()
        .ok()
        .and_then(|mut child| child.try_wait().ok())
        .flatten()
}

pub(super) fn reap_process(process: &HostProcess) -> Result<ExitStatus, String> {
    let mut child = process
        .child
        .lock()
        .map_err(|error| format!("lock host child for reaping: {error}"))?;
    child
        .wait()
        .map_err(|error| format!("reap host process: {error}"))
}
