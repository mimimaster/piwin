//! Embedded TUI launch on Desktop's active Host. PTY lifecycle stays in pty_host.
use std::ffi::OsString;
use std::sync::Arc;

use serde::Deserialize;
use serde_json::json;
use tauri::{AppHandle, State, Url};

use crate::host_bridge::{host_request, resolve_cli_invocation, HostBridgeState};
use crate::pty_host::{pty_open_blocking, PtyHostState, PtyLaunch, PtyOpenResult};

// Mirrors @piwin/contracts HostAttachTarget. Never derive Debug for credentials.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TuiRemoteTarget {
    endpoint: String,
    auth_token: Option<String>,
    device_credential: Option<TuiDeviceCredential>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TuiDeviceCredential {
    device_id: String,
    device_secret: String,
}

fn is_safe_cli_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && !value.starts_with('-')
        && value.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '-' | '_' | '.' | ':')
        })
}

fn tui_subcommand(
    session_id: Option<&str>,
    project_path: Option<&str>,
    project_id: Option<&str>,
) -> Result<Vec<String>, String> {
    let mut subcommand = vec!["tui".to_string(), "--embedded".to_string()];
    let non_empty = |value: Option<&str>| {
        value
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    };
    if let Some(session_id) = non_empty(session_id) {
        if !is_safe_cli_id(&session_id) {
            return Err("invalid session id".to_string());
        }
        subcommand.extend(["--session".to_string(), session_id]);
        return Ok(subcommand);
    }
    if let Some(project_id) = non_empty(project_id) {
        if !is_safe_cli_id(&project_id) {
            return Err("invalid project id".to_string());
        }
        subcommand.extend(["--project".to_string(), project_id]);
    } else if let Some(project_path) = non_empty(project_path) {
        if !std::path::Path::new(&project_path).is_absolute() {
            return Err("project path must be absolute".to_string());
        }
        subcommand.extend(["--project-path".to_string(), project_path]);
    }
    Ok(subcommand)
}

fn tui_host_environment(target: TuiRemoteTarget) -> Result<Vec<(String, OsString)>, String> {
    let endpoint = target.endpoint.trim();
    let url = Url::parse(endpoint).map_err(|_| "invalid TUI Host endpoint".to_string())?;
    if !matches!(url.scheme(), "ws" | "wss") || url.host_str().is_none() {
        return Err("TUI Host endpoint must use ws:// or wss://".to_string());
    }
    if target.auth_token.is_some() && target.device_credential.is_some() {
        return Err("TUI Host requires exactly one admission key".to_string());
    }
    let auth_token = target.auth_token.unwrap_or_default();
    let (device_id, device_secret) = match target.device_credential {
        Some(credential) => {
            if credential.device_id.trim().is_empty() || credential.device_secret.trim().is_empty()
            {
                return Err("incomplete TUI device credential".to_string());
            }
            (credential.device_id, credential.device_secret)
        }
        None => (String::new(), String::new()),
    };
    if [endpoint, &auth_token, &device_id, &device_secret]
        .iter()
        .any(|value| value.contains('\0'))
    {
        return Err("invalid TUI Host attachment".to_string());
    }
    // Clear unused inherited admission fields. A remote selection must never
    // accidentally authenticate with the launcher's local or different-Host key.
    Ok(vec![
        ("PIWIN_HOST_URL".to_string(), endpoint.into()),
        ("PIWIN_HOST_TOKEN".to_string(), auth_token.into()),
        ("PIWIN_HOST_DEVICE_ID".to_string(), device_id.into()),
        ("PIWIN_HOST_DEVICE_SECRET".to_string(), device_secret.into()),
    ])
}

/// Desktop's xterm.js surface loads `@xterm/addon-image`, which decodes the
/// iTerm2 inline-image protocol (not kitty). pi-tui cannot detect that from
/// inside a PTY, so the embedded CLI is told explicitly. A value the user
/// already exported (for example `off`) wins. TERM_PROGRAM is left alone: other
/// programs key unrelated behaviour off it.
fn tui_image_environment(inherited: Option<OsString>) -> Vec<(String, OsString)> {
    match inherited {
        Some(value) if !value.is_empty() => Vec::new(),
        _ => vec![("PIWIN_IMAGES".to_string(), OsString::from("iterm2"))],
    }
}

/// A remote target bypasses the sidecar entirely. The local entrance token
/// remains native-only; remote admission is already held by Desktop's client.
async fn open_tui_pty(
    app: AppHandle,
    state: State<'_, PtyHostState>,
    host: State<'_, HostBridgeState>,
    session_id: Option<String>,
    project_path: Option<String>,
    project_id: Option<String>,
    remote_target: Option<TuiRemoteTarget>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyOpenResult, String> {
    let subcommand = tui_subcommand(
        session_id.as_deref(),
        project_path.as_deref(),
        project_id.as_deref(),
    )?;
    let target = match remote_target {
        Some(target) => {
            if project_path.is_some() {
                return Err("remote TUI scope requires a project id".to_string());
            }
            target
        }
        None => {
            let response = host_request(
                host,
                json!({ "type": "local-shell-access/open" }),
                Some(8_000),
            )
            .await?;
            let data = response
                .get("success")
                .and_then(|value| value.as_bool())
                .filter(|success| *success)
                .and_then(|_| response.get("data"));
            let read = |key: &str| {
                data.and_then(|data| data.get(key))
                    .and_then(|value| value.as_str())
                    .map(str::to_string)
            };
            let (Some(endpoint), Some(auth_token)) = (read("endpoint"), read("authToken")) else {
                return Err(response
                    .get("error")
                    .and_then(|value| value.as_str())
                    .unwrap_or("local shell entrance unavailable")
                    .to_string());
            };
            TuiRemoteTarget {
                endpoint,
                auth_token: Some(auth_token),
                device_credential: None,
            }
        }
    };
    let host_environment = tui_host_environment(target)?;
    let invocation = resolve_cli_invocation(&app, &subcommand)?;
    let mut environment: Vec<(String, OsString)> = invocation
        .environment
        .into_iter()
        .map(|(key, value)| (key.to_string(), value))
        .collect();
    environment.extend(host_environment);
    environment.extend(tui_image_environment(std::env::var_os("PIWIN_IMAGES")));
    let launch = PtyLaunch {
        program: invocation.program,
        args: invocation.args,
        cwd: invocation.cwd,
        environment,
    };
    let sessions = Arc::clone(&state.sessions);
    tauri::async_runtime::spawn_blocking(move || {
        pty_open_blocking(
            app,
            sessions,
            launch,
            cols.unwrap_or(80).max(20),
            rows.unwrap_or(24).max(5),
        )
    })
    .await
    .map_err(|error| format!("pty_open_tui worker failed: {error}"))?
}

/// Keep local and remote command names distinct: an older running native build
/// must reject a remote launch rather than ignore its target and open a sidecar.
#[tauri::command]
pub async fn pty_open_tui(
    app: AppHandle,
    state: State<'_, PtyHostState>,
    host: State<'_, HostBridgeState>,
    session_id: Option<String>,
    project_path: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyOpenResult, String> {
    open_tui_pty(
        app,
        state,
        host,
        session_id,
        project_path,
        None,
        None,
        cols,
        rows,
    )
    .await
}

#[tauri::command]
pub async fn pty_open_remote_tui(
    app: AppHandle,
    state: State<'_, PtyHostState>,
    host: State<'_, HostBridgeState>,
    session_id: Option<String>,
    project_id: Option<String>,
    remote_target: TuiRemoteTarget,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyOpenResult, String> {
    open_tui_pty(
        app,
        state,
        host,
        session_id,
        None,
        project_id,
        Some(remote_target),
        cols,
        rows,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_tui_draws_images_with_the_iterm2_protocol_unless_the_user_chose() {
        assert_eq!(
            tui_image_environment(None),
            vec![("PIWIN_IMAGES".to_string(), OsString::from("iterm2"))]
        );
        assert_eq!(
            tui_image_environment(Some(OsString::new())),
            vec![("PIWIN_IMAGES".to_string(), OsString::from("iterm2"))]
        );
        assert!(tui_image_environment(Some(OsString::from("off"))).is_empty());
    }

    #[test]
    fn launch_arguments_follow_session_then_project() {
        assert_eq!(
            tui_subcommand(None, None, None).unwrap(),
            vec!["tui", "--embedded"]
        );
        assert_eq!(
            tui_subcommand(Some(" session-1 "), Some("/unused"), Some("project-1")).unwrap(),
            vec!["tui", "--embedded", "--session", "session-1"]
        );
        assert_eq!(
            tui_subcommand(None, None, Some("project-1")).unwrap(),
            vec!["tui", "--embedded", "--project", "project-1"]
        );
        let path = if cfg!(windows) {
            "C:\\work\\app"
        } else {
            "/work/app"
        };
        assert_eq!(
            tui_subcommand(None, Some(path), None).unwrap(),
            vec!["tui", "--embedded", "--project-path", path]
        );
    }

    #[test]
    fn hostile_ids_and_relative_paths_are_refused() {
        for hostile in ["--mock", "a b", "../x", "a;b", "a/b"] {
            assert!(tui_subcommand(Some(hostile), None, None).is_err());
            assert!(tui_subcommand(None, None, Some(hostile)).is_err());
        }
        for hostile in ["--mock", "relative/dir", "-x"] {
            assert!(tui_subcommand(None, Some(hostile), None).is_err());
        }
    }

    fn target(value: serde_json::Value) -> TuiRemoteTarget {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn remote_admission_uses_environment_and_clears_inherited_alternatives() {
        let token = tui_host_environment(target(
            json!({"endpoint":"wss://remote.example/ws", "authToken":"secret"}),
        ))
        .unwrap();
        assert_eq!(token[0].1, "wss://remote.example/ws");
        assert_eq!(token[1].1, "secret");
        assert_eq!(token[2].1, "");
        assert_eq!(token[3].1, "");
        let device = tui_host_environment(target(
            json!({"endpoint":"ws://remote.example", "deviceCredential":{
                "deviceId":"device-1", "deviceSecret":"device-secret"
            }}),
        ))
        .unwrap();
        assert_eq!(device[1].1, "");
        assert_eq!(device[2].1, "device-1");
        assert_eq!(device[3].1, "device-secret");
        let anonymous =
            tui_host_environment(target(json!({"endpoint":"ws://remote.example"}))).unwrap();
        assert!(anonymous[1..].iter().all(|(_, value)| value.is_empty()));
    }

    #[test]
    fn malformed_attachment_never_falls_back_to_the_local_host() {
        for endpoint in ["http://remote.example", "garbage", "file:///tmp/host"] {
            assert!(tui_host_environment(target(json!({"endpoint":endpoint}))).is_err());
        }
        assert!(tui_host_environment(target(
            json!({"endpoint":"ws://remote.example", "authToken":"secret",
                "deviceCredential":{"deviceId":"device-1","deviceSecret":"secret"}
            })
        ))
        .is_err());
        assert!(
            tui_host_environment(target(json!({"endpoint":"ws://remote.example",
                "deviceCredential":{"deviceId":"device-1","deviceSecret":""}
            })))
            .is_err()
        );
    }
}
