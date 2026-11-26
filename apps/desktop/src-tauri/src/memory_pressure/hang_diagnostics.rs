//! Automatic hang-evidence capture for the desktop memory-pressure monitor.
//!
//! Runs strictly off the AppKit/Tauri main thread. Detects two hang signals:
//! 1. `main-thread-stalled`: the async `with_webview` main-thread heartbeat
//!    stopped advancing for >= `MAIN_THREAD_STALL_MS` after being observed live.
//! 2. `renderer-ack-stalled`: the frontend stopped calling `ack_memory_sample`
//!    for >= `RENDERER_STALLED_TICK_THRESHOLD` consecutive monitor ticks after
//!    having acked at least once.
//!
//! When triggered (rate-limited by `HANG_CAPTURE_COOLDOWN_MS`), writes a small
//! JSON summary under `~/.piwin/diagnostics/memory/` and on macOS spawns a
//! bounded background `/usr/bin/sample` against `piwin-desktop` and the main
//! `WebContent` pid so post-mortem stacks survive a user force-quit.

use std::path::{Path, PathBuf};
use std::time::Duration;

use serde::Serialize;

/// Consecutive unacked monitor ticks (5s each → 15s) before capturing evidence.
pub(crate) const RENDERER_STALLED_TICK_THRESHOLD: u32 = 3;
/// Main-thread heartbeat silence before treating AppKit as hung (15s).
pub(crate) const MAIN_THREAD_STALL_MS: u64 = 15_000;
/// Minimum interval between hang captures to avoid disk/CPU churn.
pub(crate) const HANG_CAPTURE_COOLDOWN_MS: u64 = 10 * 60 * 1_000;
/// Maximum number of `hang-*` files kept under `diagnostics/memory/`.
const MAX_RETAINED_HANG_FILES: usize = 16;
/// Sample duration passed to macOS `/usr/bin/sample`.
#[cfg(target_os = "macos")]
const SAMPLE_DURATION_SECS: &str = "2";
/// Hard wall-clock timeout waiting for `/usr/bin/sample` before killing it.
#[cfg(target_os = "macos")]
const SAMPLE_CHILD_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum HangKind {
    MainThreadStalled,
    RendererAckStalled,
}

impl HangKind {
    fn slug(self) -> &'static str {
        match self {
            Self::MainThreadStalled => "main-thread",
            Self::RendererAckStalled => "renderer-ack",
        }
    }
}

#[derive(Clone, Debug)]
pub(crate) struct HangSignalInput {
    pub(crate) monotonic_ms: u64,
    pub(crate) main_thread_last_ack_ms: u64,
    pub(crate) ever_acked_sample: bool,
    pub(crate) consecutive_stalled_ticks: u32,
}

#[derive(Default)]
pub(crate) struct HangDetector {
    last_capture_monotonic_ms: Option<u64>,
}

impl HangDetector {
    /// Evaluate whether the current monitor tick warrants a hang capture.
    /// Pure policy so unit tests can drive every edge without OS processes.
    pub(crate) fn evaluate(&mut self, input: &HangSignalInput) -> Option<HangKind> {
        let kind = if input.main_thread_last_ack_ms > 0
            && input
                .monotonic_ms
                .saturating_sub(input.main_thread_last_ack_ms)
                >= MAIN_THREAD_STALL_MS
        {
            HangKind::MainThreadStalled
        } else if input.ever_acked_sample
            && input.consecutive_stalled_ticks >= RENDERER_STALLED_TICK_THRESHOLD
        {
            HangKind::RendererAckStalled
        } else {
            return None;
        };

        if let Some(last) = self.last_capture_monotonic_ms {
            if input.monotonic_ms.saturating_sub(last) < HANG_CAPTURE_COOLDOWN_MS {
                return None;
            }
        }
        self.last_capture_monotonic_ms = Some(input.monotonic_ms);
        Some(kind)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct HangReport {
    pub(crate) timestamp_ms: u64,
    pub(crate) monotonic_ms: u64,
    pub(crate) kind: HangKind,
    pub(crate) desktop_pid: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) main_webcontent_pid: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) main_footprint_bytes: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) main_resident_bytes: Option<u64>,
    pub(crate) consecutive_stalled_ticks: u32,
    pub(crate) main_thread_silence_ms: u64,
    pub(crate) window_count: usize,
}

/// Persist the JSON report immediately and spawn a detached background thread
/// to collect macOS `/usr/bin/sample` stacks for desktop + main WebContent.
pub(crate) fn capture_hang_evidence(dir: PathBuf, report: HangReport) {
    let prefix = format!("hang-{}-{}", report.timestamp_ms, report.kind.slug());
    let summary_path = dir.join(format!("{prefix}.json"));
    if let Ok(body) = serde_json::to_vec_pretty(&report) {
        let _ = std::fs::write(&summary_path, body);
    }
    prune_old_hang_files(&dir, MAX_RETAINED_HANG_FILES);

    #[cfg(target_os = "macos")]
    {
        let desktop_pid = report.desktop_pid as i32;
        let webcontent_pid = report.main_webcontent_pid;
        std::thread::spawn(move || {
            let desktop_out = dir.join(format!("{prefix}-desktop-{desktop_pid}.sample.txt"));
            run_macos_sample(desktop_pid, &desktop_out);
            if let Some(wc_pid) = webcontent_pid.filter(|pid| *pid > 0) {
                let wc_out = dir.join(format!("{prefix}-webcontent-{wc_pid}.sample.txt"));
                run_macos_sample(wc_pid, &wc_out);
            }
            prune_old_hang_files(&dir, MAX_RETAINED_HANG_FILES);
        });
    }
}

#[cfg(target_os = "macos")]
fn run_macos_sample(pid: i32, output_path: &Path) {
    use std::process::{Command, Stdio};
    let Ok(mut child) = Command::new("/usr/bin/sample")
        .arg(pid.to_string())
        .arg(SAMPLE_DURATION_SECS)
        .arg("-file")
        .arg(output_path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    else {
        return;
    };

    let deadline = std::time::Instant::now() + SAMPLE_CHILD_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => return,
            Ok(None) => {
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(_) => return,
        }
    }
}

/// Retain only the newest `max_files` files prefixed with `hang-`.
pub(crate) fn prune_old_hang_files(dir: &Path, max_files: usize) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(String, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            if !name.starts_with("hang-") {
                return None;
            }
            Some((name, entry.path()))
        })
        .collect();
    if files.len() <= max_files {
        return;
    }
    // Filenames embed the epoch-ms timestamp right after `hang-`, so lexicographic
    // order matches chronological order without extra stat syscalls.
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let remove_count = files.len().saturating_sub(max_files);
    for (_, path) in files.into_iter().take(remove_count) {
        let _ = std::fs::remove_file(path);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detector_ignores_cold_start_before_first_ack_and_heartbeat() {
        let mut detector = HangDetector::default();
        assert_eq!(
            detector.evaluate(&HangSignalInput {
                monotonic_ms: 60_000,
                main_thread_last_ack_ms: 0,
                ever_acked_sample: false,
                consecutive_stalled_ticks: 10,
            }),
            None
        );
    }

    #[test]
    fn detector_triggers_on_main_thread_stall_and_respects_cooldown() {
        let mut detector = HangDetector::default();
        let kind = detector.evaluate(&HangSignalInput {
            monotonic_ms: 25_000,
            main_thread_last_ack_ms: 10_000,
            ever_acked_sample: true,
            consecutive_stalled_ticks: 0,
        });
        assert_eq!(kind, Some(HangKind::MainThreadStalled));

        // Cooldown suppresses immediate re-capture.
        assert_eq!(
            detector.evaluate(&HangSignalInput {
                monotonic_ms: 25_000 + HANG_CAPTURE_COOLDOWN_MS - 1,
                main_thread_last_ack_ms: 10_000,
                ever_acked_sample: true,
                consecutive_stalled_ticks: 5,
            }),
            None
        );

        // After cooldown expires, capture is allowed again.
        assert_eq!(
            detector.evaluate(&HangSignalInput {
                monotonic_ms: 25_000 + HANG_CAPTURE_COOLDOWN_MS,
                main_thread_last_ack_ms: 10_000,
                ever_acked_sample: true,
                consecutive_stalled_ticks: 5,
            }),
            Some(HangKind::MainThreadStalled)
        );
    }

    #[test]
    fn detector_triggers_on_renderer_ack_stall_at_threshold() {
        let mut detector = HangDetector::default();
        assert_eq!(
            detector.evaluate(&HangSignalInput {
                monotonic_ms: 20_000,
                main_thread_last_ack_ms: 19_000,
                ever_acked_sample: true,
                consecutive_stalled_ticks: RENDERER_STALLED_TICK_THRESHOLD - 1,
            }),
            None
        );
        assert_eq!(
            detector.evaluate(&HangSignalInput {
                monotonic_ms: 25_000,
                main_thread_last_ack_ms: 24_000,
                ever_acked_sample: true,
                consecutive_stalled_ticks: RENDERER_STALLED_TICK_THRESHOLD,
            }),
            Some(HangKind::RendererAckStalled)
        );
    }

    #[test]
    fn prune_old_hang_files_keeps_newest_and_preserves_unrelated_files() {
        let dir = std::env::temp_dir().join(format!(
            "piwin-hang-prune-test-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("create temp dir");
        std::fs::write(dir.join("native-mapping.json"), "{}").expect("write mapping");
        for i in 1..=6 {
            std::fs::write(dir.join(format!("hang-1000{i}-renderer.json")), "{}")
                .expect("write hang file");
        }
        prune_old_hang_files(&dir, 3);
        let remaining: Vec<String> = std::fs::read_dir(&dir)
            .expect("read dir")
            .flatten()
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        assert!(remaining.contains(&"native-mapping.json".to_string()));
        assert!(!remaining.contains(&"hang-10001-renderer.json".to_string()));
        assert!(!remaining.contains(&"hang-10003-renderer.json".to_string()));
        assert!(remaining.contains(&"hang-10004-renderer.json".to_string()));
        assert!(remaining.contains(&"hang-10006-renderer.json".to_string()));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
