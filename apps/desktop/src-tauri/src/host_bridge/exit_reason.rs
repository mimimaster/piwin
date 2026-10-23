//! Why a sidecar died: the stderr tail, the startup-failure marker, and the
//! exit status, turned into one user-facing reason.
//!
//! Protocol shared with `apps/cli/src/host-serve-startup-failure.ts`: a stderr
//! line starting with `HOST_STARTUP_FATAL_PREFIX` carries the reason, and exit
//! code `HOST_STARTUP_FATAL_EXIT_CODE` means a respawn fails the same way.

use super::*;
use std::collections::VecDeque;
use std::process::ExitStatus;

pub(super) const HOST_STARTUP_FATAL_EXIT_CODE: i32 = 78;
pub(super) const HOST_STARTUP_FATAL_PREFIX: &str = "[piwin-host:fatal] ";
const STDERR_TAIL_LINES: usize = 20;
const MAX_REASON_CHARS: usize = 400;
/// After stdout EOF, how long to wait for the last stderr lines and the exit
/// status. A dying process closes both pipes within milliseconds.
pub(super) const EXIT_SETTLE_TIMEOUT: Duration = Duration::from_millis(1_000);

/// Shared between the stderr reader, the stdout reader, and request callers.
#[derive(Default)]
pub(crate) struct HostExitDiagnostics {
    stderr_tail: Mutex<VecDeque<String>>,
    fatal_message: Mutex<Option<String>>,
    stderr_closed: AtomicBool,
    /// Set once the stdout reader has classified the death.
    reason: Mutex<Option<String>>,
}

impl HostExitDiagnostics {
    pub(super) fn record_stderr_line(&self, line: &str) {
        if let Some(message) = line.strip_prefix(HOST_STARTUP_FATAL_PREFIX) {
            if let Ok(mut fatal) = self.fatal_message.lock() {
                *fatal = Some(message.trim().to_string());
            }
        }
        if let Ok(mut tail) = self.stderr_tail.lock() {
            if tail.len() == STDERR_TAIL_LINES {
                tail.pop_front();
            }
            tail.push_back(line.to_string());
        }
    }

    pub(super) fn mark_stderr_closed(&self) {
        self.stderr_closed.store(true, Ordering::Release);
    }

    pub(super) fn wait_for_stderr_closed(&self, timeout: Duration) {
        let started = Instant::now();
        while !self.stderr_closed.load(Ordering::Acquire) && started.elapsed() < timeout {
            thread::sleep(PROCESS_POLL_INTERVAL);
        }
    }

    /// Classifies the death once; later calls return the same reason.
    pub(super) fn settle(&self, status: Option<ExitStatus>) -> HostExitReason {
        let fatal = self
            .fatal_message
            .lock()
            .ok()
            .and_then(|value| value.clone());
        let last_line = self
            .stderr_tail
            .lock()
            .ok()
            .and_then(|tail| tail.back().cloned());
        let reason = summarize_exit(
            fatal.as_deref(),
            status.and_then(|value| value.code()),
            status.and_then(exit_signal),
            last_line.as_deref(),
        );
        if let Ok(mut stored) = self.reason.lock() {
            *stored = Some(reason.message.clone());
        }
        reason
    }

    /// The settled reason, for requests sent after the death.
    pub(super) fn reason(&self) -> Option<String> {
        self.reason.lock().ok().and_then(|value| value.clone())
    }
}

#[derive(Debug, PartialEq, Eq)]
pub(super) struct HostExitReason {
    pub message: String,
    /// Respawning would fail identically; the supervisor must not retry.
    pub deterministic: bool,
}

#[cfg(unix)]
fn exit_signal(status: ExitStatus) -> Option<i32> {
    use std::os::unix::process::ExitStatusExt;
    status.signal()
}

#[cfg(not(unix))]
fn exit_signal(_status: ExitStatus) -> Option<i32> {
    None
}

fn truncate_chars(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_string();
    }
    let mut truncated: String = text.chars().take(max).collect();
    truncated.push('…');
    truncated
}

/// Pure classification, unit-tested below.
pub(super) fn summarize_exit(
    fatal_message: Option<&str>,
    exit_code: Option<i32>,
    signal: Option<i32>,
    last_stderr_line: Option<&str>,
) -> HostExitReason {
    let deterministic = exit_code == Some(HOST_STARTUP_FATAL_EXIT_CODE);
    if let Some(message) = fatal_message.filter(|message| !message.is_empty()) {
        return HostExitReason {
            message: truncate_chars(message, MAX_REASON_CHARS),
            deterministic,
        };
    }
    let status = match (exit_code, signal) {
        (Some(code), _) => Some(format!("exit code {code}")),
        (None, Some(signal)) => Some(format!("killed by signal {signal}")),
        (None, None) => None,
    };
    let last_line = last_stderr_line
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(|line| truncate_chars(line, MAX_REASON_CHARS));
    let message = match (status, last_line) {
        (Some(status), Some(line)) => format!("{status}; last output: {line}"),
        (Some(status), None) => status,
        (None, Some(line)) => format!("stdout closed; last output: {line}"),
        (None, None) => "stdout closed".to_string(),
    };
    HostExitReason {
        message,
        deterministic,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_fatal_marker_wins_and_exit_78_is_deterministic() {
        let reason = summarize_exit(
            Some("/Users/a/.piwin is in use by another piwin process (pid 885)."),
            Some(HOST_STARTUP_FATAL_EXIT_CODE),
            None,
            Some("[piwin-host:fatal] ignored"),
        );
        assert_eq!(
            reason.message,
            "/Users/a/.piwin is in use by another piwin process (pid 885)."
        );
        assert!(reason.deterministic);
    }

    #[test]
    fn an_ordinary_crash_reports_status_and_last_line_and_stays_retryable() {
        let reason = summarize_exit(None, Some(1), None, Some("  TypeError: boom  "));
        assert_eq!(reason.message, "exit code 1; last output: TypeError: boom");
        assert!(!reason.deterministic);
    }

    #[test]
    fn a_signal_death_without_output_names_the_signal() {
        let reason = summarize_exit(None, None, Some(9), None);
        assert_eq!(reason.message, "killed by signal 9");
        assert!(!reason.deterministic);
    }

    #[test]
    fn unknown_status_keeps_the_stdout_closed_wording() {
        assert_eq!(
            summarize_exit(None, None, None, None).message,
            "stdout closed"
        );
    }

    #[test]
    fn the_stderr_tail_records_the_marker_and_is_bounded() {
        let diagnostics = HostExitDiagnostics::default();
        diagnostics.record_stderr_line("[piwin-host:fatal] root busy");
        for index in 0..(STDERR_TAIL_LINES + 5) {
            diagnostics.record_stderr_line(&format!("line {index}"));
        }
        let reason = diagnostics.settle(None);
        assert_eq!(reason.message, "root busy");
        assert_eq!(diagnostics.reason().as_deref(), Some("root busy"));
        assert_eq!(
            diagnostics
                .stderr_tail
                .lock()
                .map(|tail| tail.len())
                .unwrap_or(0),
            STDERR_TAIL_LINES
        );
    }
}
