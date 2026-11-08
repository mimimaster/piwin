//! Observability state for the memory-pressure monitor: bounded sample/purge
//! rings, pending-ack tracking, retired-process dedup, and the
//! `native-mapping.json` diagnostics file the Python recorder correlates on.

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use super::types::{
    MemoryMappingFile, MemoryPressurePayload, MemoryPurgeResult, ObservabilitySnapshot,
    RetiredProcess,
};

/// Most recent emitted samples retained for `memory_observability_snapshot`.
const SAMPLE_RING_CAPACITY: usize = 64;
/// Most recent purge lifecycle events retained.
const PURGE_RING_CAPACITY: usize = 16;
/// Most recent retired process identities retained for dedup.
const RETIRED_RING_CAPACITY: usize = 8;

#[derive(Default)]
struct Inner {
    samples: VecDeque<MemoryPressurePayload>,
    purge_results: VecDeque<MemoryPurgeResult>,
    retired: VecDeque<RetiredProcess>,
    /// Oldest emitted sample id the frontend has not acked yet.
    pending_sample_id: Option<u64>,
    /// Ticks skipped while a pending ack was outstanding.
    stalled_ticks: u32,
    /// Monotonic purge request id allocator (ring contents are evicted, so
    /// the id cannot be derived from `purge_results`).
    next_purge_request_id: u64,
}

fn push_bounded<T>(ring: &mut VecDeque<T>, capacity: usize, item: T) {
    ring.push_back(item);
    while ring.len() > capacity {
        ring.pop_front();
    }
}

/// Managed Tauri state shared between the monitor thread and the
/// `ack_memory_sample` / `memory_observability_snapshot` /
/// `purge_webview_memory` commands.
#[derive(Clone, Default)]
pub(crate) struct MemoryObservabilityState {
    inner: Arc<Mutex<Inner>>,
}

impl MemoryObservabilityState {
    /// Retain an emitted sample. Only call for payloads actually emitted:
    /// the ring doubles as "what the frontend could have acked".
    pub(crate) fn record_sample(&self, payload: MemoryPressurePayload) {
        if let Ok(mut inner) = self.inner.lock() {
            push_bounded(&mut inner.samples, SAMPLE_RING_CAPACITY, payload);
        }
    }

    /// Frontend ack for `sample_id`. Returns true iff the id matches the
    /// current pending sample (unknown/stale ids are rejected and change
    /// nothing).
    pub(crate) fn ack_sample(&self, sample_id: u64) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        if inner.pending_sample_id == Some(sample_id) {
            inner.pending_sample_id = None;
            true
        } else {
            false
        }
    }

    /// Mark `sample_id` as awaiting an ack. Called right before emission so
    /// a fast frontend ack always lands in an existing slot.
    pub(crate) fn set_pending_sample(&self, sample_id: u64) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending_sample_id = Some(sample_id);
        }
    }

    /// Release the pending slot after a failed emission. The slot belongs to
    /// an id nothing will ever ack, so holding it would stall all later
    /// ticks; only call this when the just-claimed emit did not succeed.
    pub(crate) fn clear_pending_sample(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.pending_sample_id = None;
        }
    }

    /// A tick was skipped because the previous sample is still unacked.
    /// Emissions are never queued — a stalled frontend must not pile up
    /// events that arrive long after the memory state changed.
    pub(crate) fn record_stalled_tick(&self) {
        if let Ok(mut inner) = self.inner.lock() {
            inner.stalled_ticks = inner.stalled_ticks.saturating_add(1);
        }
    }

    /// True while an emitted sample awaits its ack.
    pub(crate) fn has_pending_sample(&self) -> bool {
        self.inner
            .lock()
            .map(|inner| inner.pending_sample_id.is_some())
            .unwrap_or(false)
    }

    /// Allocate the next purge request id. Starts at 1; a poisoned lock
    /// yields `u64::MAX`, an id the allocator can never reach via wrapping,
    /// so fallbacks never collide with a real request id.
    pub(crate) fn allocate_purge_request(&self) -> u64 {
        let Ok(mut inner) = self.inner.lock() else {
            return u64::MAX;
        };
        inner.next_purge_request_id = inner.next_purge_request_id.wrapping_add(1);
        inner.next_purge_request_id
    }

    /// Retain a purge lifecycle event (requested/completed/timeout/…).
    pub(crate) fn record_purge(&self, result: MemoryPurgeResult) {
        if let Ok(mut inner) = self.inner.lock() {
            push_bounded(&mut inner.purge_results, PURGE_RING_CAPACITY, result);
        }
    }

    /// Record a retired (no-longer-live) window→process identity. Returns
    /// true when this identity was new to the retired ring — false when it
    /// is already recorded, so the caller only reports each identity once.
    /// Dedup key is (pid, startClock): a reused pid with a new start clock
    /// is a different process.
    pub(crate) fn record_retired(&self, retired: RetiredProcess) -> bool {
        let Ok(mut inner) = self.inner.lock() else {
            return false;
        };
        let key = (retired.pid, retired.start_clock.clone());
        if inner
            .retired
            .iter()
            .any(|entry| (entry.pid, entry.start_clock.clone()) == key)
        {
            return false;
        }
        push_bounded(&mut inner.retired, RETIRED_RING_CAPACITY, retired);
        true
    }

    /// Retired identities currently held, for the next tick's dedup check.
    #[cfg(test)]
    pub(crate) fn retired_identities(&self) -> Vec<(i32, Option<String>)> {
        self.inner
            .lock()
            .map(|inner| {
                inner
                    .retired
                    .iter()
                    .map(|entry| (entry.pid, entry.start_clock.clone()))
                    .collect()
            })
            .unwrap_or_default()
    }

    pub(crate) fn snapshot(&self) -> ObservabilitySnapshot {
        let inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        ObservabilitySnapshot {
            samples: inner.samples.iter().cloned().collect(),
            purge_results: inner.purge_results.iter().cloned().collect(),
            pending_sample_id: inner.pending_sample_id,
            stalled_ticks: inner.stalled_ticks,
        }
    }
}

/// `<PIWIN_ROOT or ~/.piwin>/diagnostics/memory`, created on use. The
/// `app_handle` parameter keeps this consistent with other diagnostics paths
/// that may later prefer a Tauri-managed dir; currently unused.
pub(crate) fn diagnostics_dir(_app_handle: &tauri::AppHandle) -> PathBuf {
    diagnostics_root()
}

fn diagnostics_root() -> PathBuf {
    let root = std::env::var_os("PIWIN_ROOT")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("HOME")
                .or_else(|| std::env::var_os("USERPROFILE"))
                .map(PathBuf::from)
                .map(|home| home.join(".piwin"))
        })
        .unwrap_or_else(|| std::env::temp_dir().join("piwin"));
    let dir = root.join("diagnostics").join("memory");
    // Best-effort: the recorder is the same owner and tolerates a missing dir.
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Atomically replace `native-mapping.json` under `dir`: write a sibling tmp
/// file then rename, so a concurrent reader (the recorder) never sees a
/// half-written map. Best-effort — mapping is diagnostics, not correctness.
pub(crate) fn write_mapping_file(dir: &std::path::Path, mapping: &MemoryMappingFile) {
    let Ok(body) = serde_json::to_vec(mapping) else {
        return;
    };
    let target = dir.join("native-mapping.json");
    let tmp = dir.join("native-mapping.json.tmp");
    if std::fs::write(&tmp, body).is_err() {
        return;
    }
    let _ = std::fs::rename(&tmp, &target);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::memory_pressure::types::{
        MemoryPurgeStatus, ProcessSample, ProcessWindowRole, SampleQuality,
    };

    fn payload(sample_id: u64) -> MemoryPressurePayload {
        MemoryPressurePayload::tick(sample_id, 1_000 + sample_id, 100, "test".to_string())
    }

    #[test]
    fn sample_ring_is_bounded_and_keeps_newest() {
        let state = MemoryObservabilityState::default();
        for id in 0..(SAMPLE_RING_CAPACITY as u64 + 5) {
            state.record_sample(payload(id));
        }
        let snapshot = state.snapshot();
        assert_eq!(snapshot.samples.len(), SAMPLE_RING_CAPACITY);
        assert_eq!(
            snapshot.samples.last().map(|p| p.sample_id),
            Some(SAMPLE_RING_CAPACITY as u64 + 4)
        );
        assert_eq!(snapshot.samples.first().map(|p| p.sample_id), Some(5));
    }

    #[test]
    fn purge_ring_is_bounded() {
        let state = MemoryObservabilityState::default();
        for id in 0..(PURGE_RING_CAPACITY as u64 + 3) {
            state.record_purge(MemoryPurgeResult {
                request_id: id,
                status: MemoryPurgeStatus::Requested,
                window_count: 0,
                error: None,
            });
        }
        let snapshot = state.snapshot();
        assert_eq!(snapshot.purge_results.len(), PURGE_RING_CAPACITY);
        assert_eq!(
            snapshot.purge_results.last().map(|r| r.request_id),
            Some(PURGE_RING_CAPACITY as u64 + 2)
        );
    }

    #[test]
    fn ack_only_clears_the_pending_id() {
        let state = MemoryObservabilityState::default();
        state.set_pending_sample(7);
        // Unknown ids are rejected and leave the pending slot untouched.
        assert!(!state.ack_sample(3));
        assert!(!state.ack_sample(8));
        assert!(state.has_pending_sample());
        assert_eq!(state.snapshot().pending_sample_id, Some(7));
        assert!(state.ack_sample(7));
        assert!(!state.has_pending_sample());
        // A second ack of the same (now-stale) id is rejected.
        assert!(!state.ack_sample(7));
    }

    #[test]
    fn clear_pending_releases_the_gate_for_failed_emissions() {
        let state = MemoryObservabilityState::default();
        state.set_pending_sample(9);
        state.clear_pending_sample();
        assert!(!state.has_pending_sample());
        // Nothing holds the gate: the next emit claims a fresh pending slot
        // and its ack clears it, so a failed emit can never stall the loop.
        state.set_pending_sample(10);
        assert!(state.ack_sample(10));
    }

    #[test]
    fn purge_request_ids_never_start_at_zero() {
        let state = MemoryObservabilityState::default();
        assert_eq!(state.allocate_purge_request(), 1);
        assert_eq!(state.allocate_purge_request(), 2);
    }

    #[test]
    fn stalled_ticks_accumulate() {
        let state = MemoryObservabilityState::default();
        state.record_stalled_tick();
        state.record_stalled_tick();
        assert_eq!(state.snapshot().stalled_ticks, 2);
    }

    #[test]
    fn retired_dedups_by_pid_and_start_clock() {
        let state = MemoryObservabilityState::default();
        let retired = RetiredProcess {
            pid: 42,
            start_clock: Some("10".to_string()),
            last_window_label: "main".to_string(),
            last_footprint_bytes: Some(100),
        };
        assert!(state.record_retired(retired.clone()));
        // Same identity again → already recorded.
        assert!(!state.record_retired(retired));
        // Pid reuse with a new start clock is a different process.
        assert!(state.record_retired(RetiredProcess {
            pid: 42,
            start_clock: Some("11".to_string()),
            last_window_label: "main".to_string(),
            last_footprint_bytes: Some(120),
        }));
        assert_eq!(state.retired_identities().len(), 2);
    }

    #[test]
    fn retired_ring_is_bounded() {
        let state = MemoryObservabilityState::default();
        for id in 0..(RETIRED_RING_CAPACITY + 3) {
            assert!(state.record_retired(RetiredProcess {
                pid: id as i32,
                start_clock: None,
                last_window_label: format!("w{id}"),
                last_footprint_bytes: None,
            }));
        }
        assert_eq!(state.retired_identities().len(), RETIRED_RING_CAPACITY);
    }

    #[test]
    fn mapping_file_round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!(
            "piwin-mapping-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let mapping = MemoryMappingFile {
            timestamp_ms: 10,
            app_version: "1.0.0".to_string(),
            sample_id: 3,
            quality: SampleQuality::Full,
            processes: vec![ProcessSample {
                window_label: "main".to_string(),
                role: ProcessWindowRole::Main,
                pid: Some(42),
                start_clock: Some("7".to_string()),
                footprint_bytes: Some(1),
                shared: false,
            }],
        };
        write_mapping_file(&dir, &mapping);
        let body = std::fs::read_to_string(dir.join("native-mapping.json"))
            .expect("mapping file should exist after rename");
        let parsed: serde_json::Value = serde_json::from_str(&body).expect("valid json");
        assert_eq!(parsed["sampleId"], 3);
        assert_eq!(parsed["quality"], "full");
        assert_eq!(parsed["processes"][0]["startClock"], "7");
        // No tmp file lingers after a successful rename.
        assert!(!dir.join("native-mapping.json.tmp").exists());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn diagnostics_root_resolves_under_piwin_root_and_creates() {
        // Env is not mutated (racy under parallel tests); assert the shape
        // and the create-on-use guarantee of whichever root resolved.
        let dir = diagnostics_root();
        let mut components = dir.components().collect::<Vec<_>>();
        let leaf = components
            .pop()
            .map(|c| c.as_os_str().to_string_lossy().to_string());
        let parent = components
            .pop()
            .map(|c| c.as_os_str().to_string_lossy().to_string());
        assert_eq!(leaf, Some("memory".to_string()));
        assert_eq!(parent, Some("diagnostics".to_string()));
        assert!(dir.exists(), "diagnostics dir should be created on use");
    }
}
