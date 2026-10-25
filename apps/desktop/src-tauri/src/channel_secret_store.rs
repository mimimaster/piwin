//! OS credential store for ADR 0101 channel secrets (device key + credential
//! per paired Host): Keychain on macOS, Credential Manager on Windows, Secret
//! Service on Linux. The page sees three commands over opaque strings; the
//! keyring plugin's own JS commands are not registered.
//!
//! Argument names match the mobile shell's `mobile_credential_*` commands so
//! `@piwin/host-client`'s native secret storage drives both shells.

use tauri_plugin_keyring_store::KeyringStore;

const SERVICE: &str = "app.piwin.desktop.remote-hosts";
const ACCOUNT_PREFIX: &str = "remote-host.v1.";
const MAX_KEY_CHARS: usize = 256;
const STORE_UNAVAILABLE: &str = "credential store unavailable";

fn store() -> KeyringStore {
    KeyringStore::new(SERVICE)
}

fn account_for_key(key: &str) -> Result<String, String> {
    let trimmed = key.trim();
    if trimmed.is_empty() || trimmed.chars().count() > MAX_KEY_CHARS {
        return Err("secret key is required".into());
    }
    Ok(format!("{ACCOUNT_PREFIX}{trimmed}"))
}

// Keyring errors can echo account names; the page only needs to know it failed.
fn map_store_error<E: std::fmt::Display>(error: E) -> String {
    eprintln!("[piwin] channel secret store: {error}");
    STORE_UNAVAILABLE.to_string()
}

#[tauri::command]
pub fn desktop_secret_read(endpoint: String) -> Result<Option<String>, String> {
    let account = account_for_key(&endpoint)?;
    store().get_password(&account).map_err(map_store_error)
}

#[tauri::command]
pub fn desktop_secret_write(endpoint: String, payload: String) -> Result<(), String> {
    if payload.trim().is_empty() {
        return Err("secret payload is required".into());
    }
    let account = account_for_key(&endpoint)?;
    store()
        .set_password(&account, &payload)
        .map_err(map_store_error)
}

#[tauri::command]
pub fn desktop_secret_clear(endpoint: String) -> Result<(), String> {
    let account = account_for_key(&endpoint)?;
    store().delete(&account).map_err(map_store_error)
}

#[cfg(test)]
mod tests {
    use super::account_for_key;

    #[test]
    fn prefixes_and_trims_keys() {
        assert_eq!(
            account_for_key("  piwin.remote-host.abc ").as_deref(),
            Ok("remote-host.v1.piwin.remote-host.abc")
        );
    }

    #[test]
    fn rejects_empty_and_oversized_keys() {
        assert!(account_for_key("   ").is_err());
        assert!(account_for_key(&"k".repeat(257)).is_err());
    }
}
