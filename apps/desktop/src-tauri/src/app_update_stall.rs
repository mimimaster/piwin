//! Stall detection for the in-app update download (ADR 0097).
//!
//! The updater plugin only offers a whole-request timeout, which would also
//! cancel a slow but healthy 110 MB download. A connection that stops sending
//! bytes (a stuck proxy, a dropped link the OS has not noticed) otherwise
//! waits forever, so the download is aborted once no bytes arrive for
//! `DOWNLOAD_STALL_TIMEOUT`.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, Instant};

pub(crate) const DOWNLOAD_STALL_TIMEOUT: Duration = Duration::from_secs(60);
/// How often the watchdog looks; also the extra wait after a download ends.
pub(crate) const DOWNLOAD_WATCH_TICK: Duration = Duration::from_secs(1);
/// Stable error the UI maps to its own stall message (apps/desktop/src/app-update.ts).
pub(crate) const DOWNLOAD_STALLED_ERROR: &str = "app-update/download-stalled";

/// Shared between the download callbacks and the watchdog loop.
pub(crate) struct DownloadStallWatch {
    started: Instant,
    /// Milliseconds after `started` when the last bytes arrived.
    last_bytes_ms: AtomicU64,
    /// Set once every byte is in: installing sends no chunks and is never a stall.
    download_finished: AtomicBool,
}

impl DownloadStallWatch {
    pub(crate) fn new() -> Self {
        Self::starting_at(Instant::now())
    }

    fn starting_at(started: Instant) -> Self {
        Self { started, last_bytes_ms: AtomicU64::new(0), download_finished: AtomicBool::new(false) }
    }

    pub(crate) fn record_bytes(&self) {
        self.record_bytes_at(Instant::now());
    }

    fn record_bytes_at(&self, now: Instant) {
        let elapsed = now.saturating_duration_since(self.started).as_millis();
        self.last_bytes_ms.store(u64::try_from(elapsed).unwrap_or(u64::MAX), Ordering::Release);
    }

    pub(crate) fn mark_download_finished(&self) {
        self.download_finished.store(true, Ordering::Release);
    }

    pub(crate) fn is_stalled(&self) -> bool {
        self.is_stalled_at(Instant::now())
    }

    fn is_stalled_at(&self, now: Instant) -> bool {
        if self.download_finished.load(Ordering::Acquire) {
            return false;
        }
        let last_bytes =
            self.started + Duration::from_millis(self.last_bytes_ms.load(Ordering::Acquire));
        now.saturating_duration_since(last_bytes) >= DOWNLOAD_STALL_TIMEOUT
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const JUST_UNDER: Duration = Duration::from_secs(59);

    #[test]
    fn no_bytes_since_start_stalls_after_the_timeout() {
        let start = Instant::now();
        let watch = DownloadStallWatch::starting_at(start);
        assert!(!watch.is_stalled_at(start + JUST_UNDER));
        assert!(watch.is_stalled_at(start + DOWNLOAD_STALL_TIMEOUT));
    }

    #[test]
    fn arriving_bytes_restart_the_timeout() {
        let start = Instant::now();
        let watch = DownloadStallWatch::starting_at(start);
        let later = start + Duration::from_secs(50);
        watch.record_bytes_at(later);
        assert!(!watch.is_stalled_at(later + JUST_UNDER));
        assert!(watch.is_stalled_at(later + DOWNLOAD_STALL_TIMEOUT));
    }

    #[test]
    fn a_finished_download_never_stalls_while_installing() {
        let start = Instant::now();
        let watch = DownloadStallWatch::starting_at(start);
        watch.mark_download_finished();
        assert!(!watch.is_stalled_at(start + DOWNLOAD_STALL_TIMEOUT * 10));
    }
}
