//! `file://` URI to a local path, for the xdg-desktop-portal Screenshot reply.

use std::path::PathBuf;

/// Accepts `file:///abs/path` and `file://localhost/abs/path`; anything else
/// (another host, another scheme, broken escapes) is `None`.
pub(super) fn file_uri_to_path(uri: &str) -> Option<PathBuf> {
    let rest = uri.strip_prefix("file://")?;
    let rest = rest.strip_prefix("localhost").unwrap_or(rest);
    if !rest.starts_with('/') {
        return None;
    }
    let bytes = percent_decode(rest)?;
    Some(path_from_bytes(bytes))
}

fn percent_decode(text: &str) -> Option<Vec<u8>> {
    let raw = text.as_bytes();
    let mut decoded = Vec::with_capacity(raw.len());
    let mut index = 0;
    while index < raw.len() {
        if raw[index] == b'%' {
            let hex = raw.get(index + 1..index + 3)?;
            let value = u8::from_str_radix(std::str::from_utf8(hex).ok()?, 16).ok()?;
            decoded.push(value);
            index += 3;
        } else {
            decoded.push(raw[index]);
            index += 1;
        }
    }
    Some(decoded)
}

#[cfg(unix)]
fn path_from_bytes(bytes: Vec<u8>) -> PathBuf {
    use std::os::unix::ffi::OsStringExt;
    PathBuf::from(std::ffi::OsString::from_vec(bytes))
}

#[cfg(not(unix))]
fn path_from_bytes(bytes: Vec<u8>) -> PathBuf {
    PathBuf::from(String::from_utf8_lossy(&bytes).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_portal_uris() {
        assert_eq!(
            file_uri_to_path("file:///home/me/Pictures/Screenshot%20from%202026.png"),
            Some(PathBuf::from("/home/me/Pictures/Screenshot from 2026.png"))
        );
        assert_eq!(
            file_uri_to_path("file://localhost/tmp/a.png"),
            Some(PathBuf::from("/tmp/a.png"))
        );
        assert_eq!(
            file_uri_to_path("file:///tmp/%E6%88%AA%E5%9B%BE.png"),
            Some(PathBuf::from("/tmp/截图.png"))
        );
    }

    #[test]
    fn rejects_other_uris() {
        assert_eq!(file_uri_to_path("https://example.com/a.png"), None);
        assert_eq!(file_uri_to_path("file://otherhost/a.png"), None);
        assert_eq!(file_uri_to_path("file:///bad%2"), None);
        assert_eq!(file_uri_to_path("file:///bad%zz"), None);
    }
}
