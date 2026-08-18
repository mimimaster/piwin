use sha2::{Digest, Sha256};
use tauri_plugin_keyring_store::KeyringStore;

const SERVICE: &str = "app.piwin.mobile.credentials";
const ACCOUNT_PREFIX: &str = "device-credential.v1.";
const STORE_UNAVAILABLE: &str = "credential store unavailable";

fn store() -> KeyringStore {
    KeyringStore::new(SERVICE)
}

fn account_for_endpoint(endpoint: &str) -> Result<String, String> {
    let trimmed = endpoint.trim();
    if trimmed.is_empty() {
        return Err("endpoint is required".into());
    }
    let digest = Sha256::digest(trimmed.as_bytes());
    Ok(format!("{ACCOUNT_PREFIX}{digest:x}"))
}

fn map_store_error<E>(_: E) -> String {
    STORE_UNAVAILABLE.to_string()
}

#[tauri::command]
pub fn mobile_credential_read(endpoint: String) -> Result<Option<String>, String> {
    let account = account_for_endpoint(&endpoint)?;
    store().get_password(&account).map_err(map_store_error)
}

#[tauri::command]
pub fn mobile_credential_write(endpoint: String, payload: String) -> Result<(), String> {
    if payload.trim().is_empty() {
        return Err("credential payload is required".into());
    }
    let account = account_for_endpoint(&endpoint)?;
    store()
        .set_password(&account, &payload)
        .map_err(map_store_error)
}

#[tauri::command]
pub fn mobile_credential_clear(endpoint: String) -> Result<(), String> {
    let account = account_for_endpoint(&endpoint)?;
    store().delete(&account).map_err(map_store_error)
}
