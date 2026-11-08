//! Wire types for the `desktop:memory-pressure` sensor payload.
//!
//! Split out of `memory_pressure.rs` (no behavior change). Rust stays a
//! policy-free sensor; tier classification lives in the webview
//! (apps/desktop/src/notes/memory-pressure.ts).

use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum MemoryPressureLevel {
    Normal,
    Moderate,
    Critical,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryPressurePayload {
    /// Legacy fallback path only; byte samples leave classification to JS.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) level: Option<MemoryPressureLevel>,
    /// Main-window WebContent `ri_phys_footprint`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) bytes: Option<u64>,
    /// System-wide reclaimable memory estimate.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) available_bytes: Option<u64>,
}
