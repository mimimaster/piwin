//! In-app update (ADR 0097): periodic checks against the signed per-platform
//! manifests, then a one-click download + install + restart.
//!
//! The Host sidecar must be gone before the bundle is replaced and restarted:
//! - macOS: `request_restart()` goes through `ExitRequested`, so the ADR 0096
//!   graceful teardown reaps the Host before the new version starts.
//! - Windows: the NSIS installer exits the app; `on_before_exit` reaps the
//!   Host first so its files are not locked when the installer overwrites them.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, Updater, UpdaterExt};

use crate::app_shutdown;
use crate::host_bridge::{host_request_blocking, HostBridgeState};

/// Lets the window and the Host settle before the first network call.
const FIRST_CHECK_DELAY: Duration = Duration::from_secs(30);
const CHECK_INTERVAL: Duration = Duration::from_secs(6 * 60 * 60);
const BUSY_PROBE_TIMEOUT_MS: u64 = 3_000;
/// Progress events are throttled to whole-percent steps (or this many bytes
/// when the server sends no length).
const PROGRESS_BYTES_STEP: u64 = 1024 * 1024;

pub(crate) const UPDATE_AVAILABLE_EVENT: &str = "app-update://available";
pub(crate) const UPDATE_PROGRESS_EVENT: &str = "app-update://progress";

/// `tauri.conf.json` keeps this version in git; only release builds get a real one.
const DEVELOPMENT_BUILD_VERSION: &str = "0.0.0";

#[derive(Default)]
pub(crate) struct AppUpdateState {
    pending: Mutex<Option<Update>>,
    installing: AtomicBool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AvailableAppUpdate {
    version: String,
    current_version: String,
    notes: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateProgress {
    downloaded: u64,
    total: Option<u64>,
    finished: bool,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum AppUpdateInstallOutcome {
    /// Sessions are running on the local Host; the UI asks before forcing.
    #[serde(rename_all = "camelCase")]
    Busy { busy_session_count: u64 },
    /// The manifest no longer offers a newer version.
    NoUpdate,
    /// The new bundle is in place and the app is restarting.
    Restarting,
}

/// Development builds never update; the shell-only app has its own bundle id
/// and no published bundle, so the all-in-one manifest must not reach it.
fn updates_enabled(app: &AppHandle) -> bool {
    if cfg!(feature = "shell-only") {
        return false;
    }
    app.package_info().version.to_string() != DEVELOPMENT_BUILD_VERSION
}

fn build_updater(app: &AppHandle) -> Result<Updater, String> {
    let teardown_handle = app.clone();
    app.updater_builder()
        .on_before_exit(move || app_shutdown::run_terminal_teardown_blocking(&teardown_handle))
        .build()
        .map_err(|error| error.to_string())
}

fn summarize(update: &Update) -> AvailableAppUpdate {
    AvailableAppUpdate {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
    }
}

async fn check_now(app: &AppHandle) -> Result<Option<AvailableAppUpdate>, String> {
    if !updates_enabled(app) {
        return Ok(None);
    }
    let update = build_updater(app)?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    let summary = update.as_ref().map(summarize);
    if let Ok(mut pending) = app.state::<AppUpdateState>().pending.lock() {
        *pending = update;
    }
    Ok(summary)
}

/// Background checks: once shortly after launch, then every few hours. A
/// failed check is logged only; the UI stays silent when offline.
pub(crate) fn spawn_update_checks(app: AppHandle) {
    if !updates_enabled(&app) {
        return;
    }
    tauri::async_runtime::spawn(async move {
        let mut delay = FIRST_CHECK_DELAY;
        loop {
            sleep(delay).await;
            delay = CHECK_INTERVAL;
            if app.state::<AppUpdateState>().installing.load(Ordering::Acquire) {
                continue;
            }
            match check_now(&app).await {
                Ok(Some(update)) => {
                    let _ = app.emit(UPDATE_AVAILABLE_EVENT, update);
                }
                Ok(None) => {}
                Err(error) => eprintln!("[piwin desktop] update check failed: {error}"),
            }
        }
    });
}

async fn sleep(duration: Duration) {
    // The async runtime is Tokio, but this crate does not depend on it
    // directly; a blocking-pool sleep keeps the dependency list unchanged.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(duration)).await;
}

/// Busy sessions on the local sidecar, the only Host an update restarts. An
/// unreachable Host has nothing left to interrupt.
async fn local_busy_session_count(app: &AppHandle) -> u64 {
    let inner = Arc::clone(&app.state::<HostBridgeState>().inner);
    let command = serde_json::json!({ "type": "host/status" });
    let response = tauri::async_runtime::spawn_blocking(move || {
        host_request_blocking(inner, command, Some(BUSY_PROBE_TIMEOUT_MS))
    })
    .await;
    match response {
        Ok(Ok(value)) => value
            .get("data")
            .and_then(|data| data.get("busySessionCount"))
            .and_then(|count| count.as_u64())
            .unwrap_or(0),
        _ => 0,
    }
}

#[tauri::command]
pub(crate) async fn app_update_check(app: AppHandle) -> Result<Option<AvailableAppUpdate>, String> {
    check_now(&app).await
}

#[tauri::command]
pub(crate) async fn app_update_install(
    app: AppHandle,
    force: bool,
) -> Result<AppUpdateInstallOutcome, String> {
    let state = app.state::<AppUpdateState>();
    if state.installing.swap(true, Ordering::AcqRel) {
        return Err("an update is already being installed".to_string());
    }
    let outcome = install_update(&app, force).await;
    if !matches!(outcome, Ok(AppUpdateInstallOutcome::Restarting)) {
        state.installing.store(false, Ordering::Release);
    }
    outcome
}

fn pending_update(app: &AppHandle) -> Option<Update> {
    app.state::<AppUpdateState>()
        .pending
        .lock()
        .ok()
        .and_then(|pending| pending.clone())
}

async fn install_update(app: &AppHandle, force: bool) -> Result<AppUpdateInstallOutcome, String> {
    let update = match pending_update(app) {
        Some(update) => update,
        None => match check_now(app).await?.and_then(|_| pending_update(app)) {
            Some(update) => update,
            None => return Ok(AppUpdateInstallOutcome::NoUpdate),
        },
    };

    if !force {
        let busy_session_count = local_busy_session_count(app).await;
        if busy_session_count > 0 {
            return Ok(AppUpdateInstallOutcome::Busy { busy_session_count });
        }
    }

    let progress_handle = app.clone();
    let finished_handle = app.clone();
    let mut downloaded: u64 = 0;
    let mut last_reported: u64 = 0;
    update
        .download_and_install(
            move |chunk_length, total| {
                downloaded += chunk_length as u64;
                let step = total.map_or(PROGRESS_BYTES_STEP, |total| (total / 100).max(1));
                if downloaded - last_reported < step {
                    return;
                }
                last_reported = downloaded;
                let _ = progress_handle.emit(
                    UPDATE_PROGRESS_EVENT,
                    AppUpdateProgress { downloaded, total, finished: false },
                );
            },
            move || {
                let _ = finished_handle.emit(
                    UPDATE_PROGRESS_EVENT,
                    AppUpdateProgress { downloaded: 0, total: None, finished: true },
                );
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    // Windows never gets here: the installer has already exited the app.
    app.request_restart();
    Ok(AppUpdateInstallOutcome::Restarting)
}

#[cfg(test)]
mod tests {
    use super::*;

    // apps/desktop/src/app-update.ts parses exactly these shapes.
    #[test]
    fn install_outcome_serializes_with_kind_tag() {
        let busy = serde_json::to_value(AppUpdateInstallOutcome::Busy { busy_session_count: 2 })
            .expect("serialize busy");
        assert_eq!(busy, serde_json::json!({ "kind": "busy", "busySessionCount": 2 }));
        let restarting =
            serde_json::to_value(AppUpdateInstallOutcome::Restarting).expect("serialize restart");
        assert_eq!(restarting, serde_json::json!({ "kind": "restarting" }));
        let none = serde_json::to_value(AppUpdateInstallOutcome::NoUpdate).expect("serialize none");
        assert_eq!(none, serde_json::json!({ "kind": "noUpdate" }));
    }

    #[test]
    fn available_update_serializes_camel_case() {
        let update = AvailableAppUpdate {
            version: "0.2.6".to_string(),
            current_version: "0.2.5".to_string(),
            notes: None,
        };
        assert_eq!(
            serde_json::to_value(update).expect("serialize update"),
            serde_json::json!({ "version": "0.2.6", "currentVersion": "0.2.5", "notes": null })
        );
    }
}
