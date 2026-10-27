//! Linux capture: the desktop's own region picker, like `screencapture -i` on macOS.
//!
//! 1. xdg-desktop-portal `Screenshot` with `interactive: true` — GNOME, KDE and
//!    most Wayland / X11 desktops show their native capture UI.
//! 2. Without a portal, the first region tool found on PATH: grim + slurp
//!    (wlroots), gnome-screenshot, spectacle, maim, scrot.
//!
//! The portal saves into the desktop's own screenshot folder, as a normal
//! system screenshot would; piwin reads that file and leaves it in place.

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use dbus::arg::{PropMap, RefArg, Variant};
use dbus::blocking::Connection;
use dbus::message::MatchRule;

use super::file_uri::file_uri_to_path;
use super::{collect_capture_file, CaptureError};

const PORTAL_DESTINATION: &str = "org.freedesktop.portal.Desktop";
const PORTAL_PATH: &str = "/org/freedesktop/portal/desktop";
const SCREENSHOT_INTERFACE: &str = "org.freedesktop.portal.Screenshot";
const REQUEST_INTERFACE: &str = "org.freedesktop.portal.Request";
const PORTAL_CALL_TIMEOUT: Duration = Duration::from_secs(10);
/// Upper bound for the user to finish picking; keeps a stuck portal from
/// holding the capture lock forever.
const PORTAL_PICK_TIMEOUT: Duration = Duration::from_secs(600);

/// Region tools that take the output path as their last argument.
const REGION_TOOLS: &[(&str, &[&str])] = &[
    ("gnome-screenshot", &["-a", "-f"]),
    ("spectacle", &["-b", "-n", "-r", "-o"]),
    ("maim", &["-s"]),
    ("scrot", &["-s"]),
];

pub(super) fn capture_interactive(output: &Path) -> Result<Option<Vec<u8>>, CaptureError> {
    match capture_with_portal() {
        Ok(result) => Ok(result),
        Err(PortalError::Unavailable(reason)) => {
            eprintln!("[piwin] screenshot portal unavailable ({reason}); trying region tools");
            capture_with_region_tool(output)
        }
        Err(PortalError::Failed(reason)) => Err(CaptureError::Failed(reason)),
    }
}

enum PortalError {
    /// No portal or no Screenshot interface: fall back to CLI tools.
    Unavailable(String),
    /// The portal ran and failed: report it, do not open a second picker.
    Failed(String),
}

struct PortalResponse {
    path: String,
    code: u32,
    uri: Option<String>,
}

fn capture_with_portal() -> Result<Option<Vec<u8>>, PortalError> {
    let unavailable = |error: dbus::Error| PortalError::Unavailable(error.to_string());
    let connection = Connection::new_session().map_err(unavailable)?;

    // Subscribe before calling so a fast reply cannot be missed.
    let responses: Arc<Mutex<Vec<PortalResponse>>> = Arc::default();
    let sink = Arc::clone(&responses);
    connection
        .add_match(
            MatchRule::new_signal(REQUEST_INTERFACE, "Response"),
            move |(code, results): (u32, PropMap), _connection, message| {
                let path = message
                    .path()
                    .map(|path| path.to_string())
                    .unwrap_or_default();
                let uri = results
                    .get("uri")
                    .and_then(|value| value.0.as_str())
                    .map(str::to_string);
                if let Ok(mut list) = sink.lock() {
                    list.push(PortalResponse { path, code, uri });
                }
                true
            },
        )
        .map_err(unavailable)?;

    let mut options = PropMap::new();
    options.insert("handle_token".into(), Variant(Box::new(request_token())));
    options.insert("interactive".into(), Variant(Box::new(true)));
    let proxy = connection.with_proxy(PORTAL_DESTINATION, PORTAL_PATH, PORTAL_CALL_TIMEOUT);
    let (handle,): (dbus::Path<'static>,) = proxy
        .method_call(SCREENSHOT_INTERFACE, "Screenshot", ("", options))
        .map_err(unavailable)?;
    let handle = handle.to_string();

    let deadline = Instant::now() + PORTAL_PICK_TIMEOUT;
    loop {
        if let Some(response) = take_response(&responses, &handle) {
            return read_portal_response(response);
        }
        if Instant::now() >= deadline {
            return Err(PortalError::Failed(
                "screenshot portal did not answer".into(),
            ));
        }
        connection
            .process(Duration::from_millis(250))
            .map_err(|error| PortalError::Failed(error.to_string()))?;
    }
}

fn take_response(responses: &Mutex<Vec<PortalResponse>>, handle: &str) -> Option<PortalResponse> {
    let mut list = responses.lock().ok()?;
    let index = list.iter().position(|response| response.path == handle)?;
    Some(list.swap_remove(index))
}

/// Portal codes: 0 success, 1 cancelled by the user, 2 other failure.
fn read_portal_response(response: PortalResponse) -> Result<Option<Vec<u8>>, PortalError> {
    match response.code {
        0 => {
            let path = response
                .uri
                .as_deref()
                .and_then(file_uri_to_path)
                .ok_or_else(|| PortalError::Failed("portal reply has no file uri".into()))?;
            let bytes = std::fs::read(&path)
                .map_err(|error| PortalError::Failed(format!("{}: {error}", path.display())))?;
            Ok(if bytes.is_empty() { None } else { Some(bytes) })
        }
        1 => Ok(None),
        code => Err(PortalError::Failed(format!(
            "screenshot portal returned {code}"
        ))),
    }
}

fn request_token() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    format!("piwin_{}_{millis}", std::process::id())
}

fn capture_with_region_tool(output: &Path) -> Result<Option<Vec<u8>>, CaptureError> {
    let failed = |error: std::io::Error| CaptureError::Failed(error.to_string());
    if let (Some(slurp), Some(grim)) = (find_program("slurp"), find_program("grim")) {
        let selection = Command::new(slurp).output().map_err(failed)?;
        let geometry = String::from_utf8_lossy(&selection.stdout)
            .trim()
            .to_string();
        // slurp exits non-zero on Esc.
        if !selection.status.success() || geometry.is_empty() {
            return Ok(None);
        }
        Command::new(grim)
            .arg("-g")
            .arg(&geometry)
            .arg(output)
            .status()
            .map_err(failed)?;
        return collect_capture_file(output).map_err(failed);
    }
    for (program, arguments) in REGION_TOOLS {
        if let Some(path) = find_program(program) {
            Command::new(path)
                .args(*arguments)
                .arg(output)
                .status()
                .map_err(failed)?;
            return collect_capture_file(output).map_err(failed);
        }
    }
    Err(CaptureError::Unsupported)
}

fn find_program(name: &str) -> Option<PathBuf> {
    let search_path = std::env::var_os("PATH")?;
    std::env::split_paths(&search_path)
        .map(|directory| directory.join(name))
        .find(|candidate| candidate.is_file())
}
