//! Wire types for the `desktop:memory-pressure` sensor payload and the
//! memory-observability surfaces (snapshot command, purge event, mapping file).
//!
//! Split out of `memory_pressure.rs` (no behavior change). Rust stays a
//! policy-free sensor; tier classification lives in the webview
//! (apps/desktop/src/notes/memory-pressure.ts).

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MemoryPressureLevel {
    Normal,
    Moderate,
    Critical,
}

/// OS-level memory pressure tier reported by
/// `kern.memorystatus_vm_pressure_level` on macOS. Distinct from
/// [`MemoryPressureLevel`], which is the governor-facing classification.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum NativeOsPressureLevel {
    Normal,
    Warning,
    Urgent,
    Critical,
}

/// Which window role a WebContent process sample belongs to. A process is
/// `main` iff its window label is `main`; every other label is `auxiliary`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ProcessWindowRole {
    Main,
    Auxiliary,
}

/// Footprint/identity of one window's WebContent process. `pid`,
/// `startClock`, and `footprintBytes` stay absent (never 0) when the
/// platform SPI or rusage lookup failed — missing stays missing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ProcessSample {
    pub(crate) window_label: String,
    pub(crate) role: ProcessWindowRole,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) pid: Option<i32>,
    /// `ri_proc_start_abstime` as a decimal string: u64 exceeds JS Number
    /// precision, and the Python recorder compares by string equality.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) start_clock: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) footprint_bytes: Option<u64>,
    /// True when more than one live window maps to the same WebContent pid.
    pub(crate) shared: bool,
}

/// A window→process identity seen earlier that is no longer live. Deduped
/// by (pid, startClock): a reused pid with a new start clock is a new
/// process, not a continuation.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RetiredProcess {
    pub(crate) pid: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) start_clock: Option<String>,
    pub(crate) last_window_label: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) last_footprint_bytes: Option<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum SampleErrorKind {
    WebviewPid,
    Footprint,
    OsPressure,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SampleError {
    pub(crate) kind: SampleErrorKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) window_label: Option<String>,
    pub(crate) message: String,
}

/// How complete one monitor tick's attribution was.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum SampleQuality {
    /// Every live window produced a footprint sample.
    Full,
    /// Some windows sampled; some failed or are still resolving their pid.
    Partial,
    /// No window footprint was sampled this tick.
    #[default]
    Unavailable,
}

/// Marker for the `availableBytes` estimator. Present iff `availableBytes`
/// is present; kept so consumers can drop the field once a better estimate
/// ships without breaking parsing.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum AvailableBytesKind {
    ReclaimableEstimate,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryPressurePayload {
    /// Legacy fallback path only; byte samples leave classification to JS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) level: Option<MemoryPressureLevel>,
    /// Main-window WebContent `ri_phys_footprint`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bytes: Option<u64>,
    /// System-wide reclaimable memory estimate. Fallback only: emitted iff
    /// `osPressure` is absent (non-macOS or failed sysctl).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) available_bytes: Option<u64>,
    /// Monotonically increasing tick counter; JS acks it back through
    /// `ack_memory_sample` so the monitor never queues emissions.
    pub(crate) sample_id: u64,
    /// Wall-clock ms since epoch at sample time.
    pub(crate) timestamp_ms: u64,
    /// Monotonic ms since monitor start (duration math, immune to wall jumps).
    pub(crate) monotonic_ms: u64,
    pub(crate) app_version: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) os_pressure: Option<NativeOsPressureLevel>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) available_bytes_kind: Option<AvailableBytesKind>,
    /// Sum of footprints over distinct pids (shared WebContent counted once).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) aggregate_footprint_bytes: Option<u64>,
    pub(crate) processes: Vec<ProcessSample>,
    /// Processes retired since the previous tick (bounded; see monitor).
    pub(crate) retired_processes: Vec<RetiredProcess>,
    /// Window labels whose pid SPI returned nothing/0, or whose rusage failed.
    pub(crate) unknown_windows: Vec<String>,
    pub(crate) errors: Vec<SampleError>,
    pub(crate) quality: SampleQuality,
}

impl MemoryPressurePayload {
    /// Baseline payload for one tick; the monitor fills what it sampled.
    /// `sample_id` is allocated by the caller.
    pub(crate) fn tick(
        sample_id: u64,
        timestamp_ms: u64,
        monotonic_ms: u64,
        app_version: String,
    ) -> Self {
        Self {
            level: None,
            bytes: None,
            available_bytes: None,
            sample_id,
            timestamp_ms,
            monotonic_ms,
            app_version,
            os_pressure: None,
            available_bytes_kind: None,
            aggregate_footprint_bytes: None,
            processes: Vec::new(),
            retired_processes: Vec::new(),
            unknown_windows: Vec::new(),
            errors: Vec::new(),
            quality: SampleQuality::Unavailable,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MemoryPurgeStatus {
    Requested,
    Completed,
    Timeout,
    Unavailable,
}

/// Emitted as `desktop:memory-purge` so the recorder/frontend can correlate
/// a purge request with its WKWebsiteDataStore completions.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryPurgeResult {
    pub(crate) request_id: u64,
    pub(crate) status: MemoryPurgeStatus,
    pub(crate) window_count: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) error: Option<String>,
}

/// Return of `memory_observability_snapshot`: bounded recent history plus
/// pending-ack state, for diagnostics and tests.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ObservabilitySnapshot {
    pub(crate) samples: Vec<MemoryPressurePayload>,
    pub(crate) purge_results: Vec<MemoryPurgeResult>,
    /// Oldest emitted-but-unacked sample id, if the frontend is behind.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) pending_sample_id: Option<u64>,
    /// Ticks skipped while `pending_sample_id` was set (emissions are never
    /// queued; a stalled frontend must not pile up events).
    pub(crate) stalled_ticks: u32,
}

/// Payload-free window→process map written to
/// `diagnostics/memory/native-mapping.json` each tick. The Python recorder
/// joins on (pid, startClock) to attribute WebContent pids to windows; no
/// user content may ever appear here.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryMappingFile {
    pub(crate) timestamp_ms: u64,
    pub(crate) app_version: String,
    pub(crate) sample_id: u64,
    pub(crate) quality: SampleQuality,
    pub(crate) processes: Vec<ProcessSample>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn process_sample_serializes_camel_case_and_omits_absent_fields() {
        let sample = ProcessSample {
            window_label: "main".to_string(),
            role: ProcessWindowRole::Main,
            pid: Some(4242),
            start_clock: Some("18446744073709551615".to_string()),
            footprint_bytes: Some(1_024),
            shared: false,
        };
        let value = serde_json::to_value(&sample).expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "windowLabel": "main",
                "role": "main",
                "pid": 4242,
                "startClock": "18446744073709551615",
                "footprintBytes": 1024,
                "shared": false
            })
        );
        let round_tripped: ProcessSample =
            serde_json::from_value(value).expect("deserialize");
        assert_eq!(sample, round_tripped);

        let missing = ProcessSample {
            window_label: "pet".to_string(),
            role: ProcessWindowRole::Auxiliary,
            pid: None,
            start_clock: None,
            footprint_bytes: None,
            shared: false,
        };
        assert_eq!(
            serde_json::to_value(&missing).expect("serialize"),
            serde_json::json!({
                "windowLabel": "pet",
                "role": "auxiliary",
                "shared": false
            })
        );
    }

    #[test]
    fn retired_process_and_sample_error_shapes() {
        let retired = RetiredProcess {
            pid: 12,
            start_clock: Some("99".to_string()),
            last_window_label: "pin-1".to_string(),
            last_footprint_bytes: Some(512),
        };
        let value = serde_json::to_value(&retired).expect("serialize");
        assert_eq!(
            value,
            serde_json::json!({
                "pid": 12,
                "startClock": "99",
                "lastWindowLabel": "pin-1",
                "lastFootprintBytes": 512
            })
        );
        let back: RetiredProcess = serde_json::from_value(value).expect("deserialize");
        assert_eq!(retired, back);

        let error = SampleError {
            kind: SampleErrorKind::WebviewPid,
            window_label: None,
            message: "spi missing".to_string(),
        };
        assert_eq!(
            serde_json::to_value(&error).expect("serialize"),
            serde_json::json!({
                "kind": "webview-pid",
                "message": "spi missing"
            })
        );
        assert_eq!(
            serde_json::to_value(SampleErrorKind::Footprint).expect("serialize"),
            serde_json::json!("footprint")
        );
        assert_eq!(
            serde_json::to_value(SampleErrorKind::OsPressure).expect("serialize"),
            serde_json::json!("os-pressure")
        );
    }

    #[test]
    fn enum_wire_names_match_contract() {
        assert_eq!(
            serde_json::to_value(NativeOsPressureLevel::Warning).expect("serialize"),
            serde_json::json!("warning")
        );
        assert_eq!(
            serde_json::to_value(SampleQuality::Partial).expect("serialize"),
            serde_json::json!("partial")
        );
        assert_eq!(
            serde_json::to_value(AvailableBytesKind::ReclaimableEstimate).expect("serialize"),
            serde_json::json!("reclaimable-estimate")
        );
        assert_eq!(
            serde_json::to_value(MemoryPurgeStatus::Requested).expect("serialize"),
            serde_json::json!("requested")
        );
    }

    #[test]
    fn observability_payload_serializes_new_fields() {
        let mut payload = MemoryPressurePayload::tick(
            7,
            1_700_000_000_000,
            5_000,
            "1.2.3".to_string(),
        );
        payload.bytes = Some(2048);
        payload.os_pressure = Some(NativeOsPressureLevel::Normal);
        payload.aggregate_footprint_bytes = Some(4096);
        payload.quality = SampleQuality::Full;
        payload.unknown_windows = vec!["pin-2".to_string()];
        payload.errors = vec![SampleError {
            kind: SampleErrorKind::Footprint,
            window_label: Some("pin-2".to_string()),
            message: "rusage failed".to_string(),
        }];
        let value = serde_json::to_value(&payload).expect("serialize");
        assert_eq!(value["sampleId"], 7);
        assert_eq!(value["timestampMs"], 1_700_000_000_000_u64);
        assert_eq!(value["monotonicMs"], 5_000);
        assert_eq!(value["appVersion"], "1.2.3");
        assert_eq!(value["osPressure"], "normal");
        assert_eq!(value["aggregateFootprintBytes"], 4096);
        assert_eq!(value["quality"], "full");
        assert_eq!(value["unknownWindows"], serde_json::json!(["pin-2"]));
        assert_eq!(value["errors"][0]["kind"], "footprint");
        // Absent optionals stay absent, never null or 0.
        assert!(value.get("level").is_none());
        assert!(value.get("availableBytes").is_none());
        assert!(value.get("availableBytesKind").is_none());
    }

    #[test]
    fn purge_result_and_snapshot_shapes() {
        let requested = MemoryPurgeResult {
            request_id: 3,
            status: MemoryPurgeStatus::Requested,
            window_count: 2,
            error: None,
        };
        assert_eq!(
            serde_json::to_value(&requested).expect("serialize"),
            serde_json::json!({
                "requestId": 3,
                "status": "requested",
                "windowCount": 2
            })
        );

        let snapshot = ObservabilitySnapshot {
            samples: vec![MemoryPressurePayload::tick(1, 2, 3, "x".to_string())],
            purge_results: vec![requested],
            pending_sample_id: Some(1),
            stalled_ticks: 4,
        };
        let value = serde_json::to_value(&snapshot).expect("serialize");
        assert_eq!(value["pendingSampleId"], 1);
        assert_eq!(value["stalledTicks"], 4);
        assert_eq!(value["samples"].as_array().map(|a| a.len()), Some(1));
        assert_eq!(value["purgeResults"].as_array().map(|a| a.len()), Some(1));
    }

    #[test]
    fn mapping_file_is_payload_free() {
        let mapping = MemoryMappingFile {
            timestamp_ms: 1,
            app_version: "0.0.0".to_string(),
            sample_id: 9,
            quality: SampleQuality::Partial,
            processes: vec![],
        };
        let value = serde_json::to_value(&mapping).expect("serialize");
        assert_eq!(value["sampleId"], 9);
        assert_eq!(value["quality"], "partial");
        // Only identity fields: no bytes/level/errors/user content keys.
        assert!(value.get("bytes").is_none());
        assert!(value.get("level").is_none());
        assert!(value.get("errors").is_none());
    }
}
