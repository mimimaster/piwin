//! Renderer-held image bytes → OS clipboard.
//!
//! `navigator.clipboard.write` inside WKWebView needs a live user activation and
//! degrades to `NotAllowedError` once that window has passed, which a context
//! menu click can easily miss — the renderer then only sees a silent `false`.
//! The native pasteboard has no activation requirement, and the renderer already
//! holds the PNG bytes (fetch + canvas), so hand them over once and let the
//! platform write them.

/// Writes a base64-encoded PNG to the system clipboard.
///
/// Base64 keeps the IPC payload compact: a raw `Vec<u8>` crosses as a JSON
/// array of numbers and a 2MB screenshot becomes unreadable IPC traffic.
#[tauri::command]
pub fn image_write_clipboard(png_base64: String) -> Result<(), String> {
    use base64::Engine;

    let png = base64::engine::general_purpose::STANDARD
        .decode(png_base64.as_bytes())
        .map_err(|error| format!("invalid base64: {error}"))?;
    if png.is_empty() {
        return Err("empty image".to_string());
    }
    write_png_to_clipboard(&png)
}

#[cfg(target_os = "macos")]
fn write_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    crate::screen_capture::macos::copy_png_to_clipboard(png)
}

#[cfg(target_os = "windows")]
fn write_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    crate::screen_capture::windows_clipboard::copy_png_to_clipboard(png)
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn write_png_to_clipboard(_png: &[u8]) -> Result<(), String> {
    Err("clipboard image write is not implemented on this platform".to_string())
}

#[cfg(test)]
mod tests {
    use super::image_write_clipboard;

    #[test]
    fn rejects_non_base64_payloads() {
        assert!(image_write_clipboard("not base64 !!".into()).is_err());
    }

    #[test]
    fn rejects_empty_images() {
        assert!(image_write_clipboard(String::new()).is_err());
    }
}
