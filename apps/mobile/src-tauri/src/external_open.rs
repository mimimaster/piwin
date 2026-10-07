//! Hands a URL to the operating system: links in a reply go to the browser,
//! and `app-settings:` opens this app's page in Settings.
//!
//! The shell plugin's own JS `open` command is not used: on iOS it goes through
//! the `open` crate, which cannot launch anything there. Only the Rust API
//! reaches the plugin's native `UIApplication.open`, so the shell exposes this
//! one command and checks the target itself.

/// iOS resolves this to the calling app's page in the Settings app.
const APP_SETTINGS_URL: &str = "app-settings:";

const ALLOWED_PREFIXES: [&str; 4] = ["https://", "http://", "mailto:", "tel:"];

fn is_allowed_target(url: &str) -> bool {
    if url == APP_SETTINGS_URL {
        return true;
    }
    // No whitespace or control characters: the value is passed to the OS as a URL.
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    ALLOWED_PREFIXES
        .iter()
        .any(|prefix| url.len() > prefix.len() && url.starts_with(prefix))
}

#[tauri::command]
pub fn mobile_open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    let target = url.trim();
    if !is_allowed_target(target) {
        return Err("this link cannot be opened outside the app".into());
    }
    open_with_system(&app, target)
}

#[cfg(mobile)]
fn open_with_system(app: &tauri::AppHandle, target: &str) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    #[allow(deprecated)]
    app.shell()
        .open(target, None)
        .map_err(|error| error.to_string())
}

#[cfg(not(mobile))]
fn open_with_system(_app: &tauri::AppHandle, _target: &str) -> Result<(), String> {
    Err("external open is only available in the mobile shell".into())
}

#[cfg(test)]
mod tests {
    use super::is_allowed_target;

    #[test]
    fn allows_web_mail_phone_and_app_settings() {
        assert!(is_allowed_target("https://example.com/a?b=1"));
        assert!(is_allowed_target("http://192.168.1.2:8080"));
        assert!(is_allowed_target("mailto:someone@example.com"));
        assert!(is_allowed_target("tel:+8613800000000"));
        assert!(is_allowed_target("app-settings:"));
    }

    #[test]
    fn rejects_other_schemes_and_malformed_targets() {
        assert!(!is_allowed_target("file:///etc/passwd"));
        assert!(!is_allowed_target("javascript:alert(1)"));
        assert!(!is_allowed_target("app-settings:root=General"));
        assert!(!is_allowed_target("prefs:root=WIFI"));
        assert!(!is_allowed_target("https://"));
        assert!(!is_allowed_target("https://example.com/ a"));
        assert!(!is_allowed_target(""));
    }
}
