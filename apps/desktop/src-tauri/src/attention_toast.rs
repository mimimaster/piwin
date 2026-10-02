//! Pure toast payload helpers shared by the Windows bridge.
//!
//! Kept free of WinRT so the XML, launch token, and tag rules can be tested
//! on any host. The Windows module is the only caller that shows a toast.

use crate::attention_notifications::{parse_attention_user_info, truncate_utf8_bytes, AttentionAuthorization, TITLE_BODY_MAX_BYTES};

/// WinRT `ToastNotification.Tag` / `Group` limit.
pub const TOAST_TAG_MAX_CHARS: usize = 64;

/// Stable group so removal can target this app's toasts without clearing others.
pub const TOAST_GROUP: &str = "piwin";

/// `NotificationSetting::Enabled`.
const WINDOWS_NOTIFICATION_ENABLED: i32 = 0;
/// Application, user, group-policy, and manifest disables.
const WINDOWS_NOTIFICATION_DISABLED: &[i32] = &[1, 2, 3, 4];

pub fn windows_aumid(bundle_id: &str, dev: bool) -> String {
    let base = bundle_id.trim();
    let base = if base.is_empty() {
        "app.piwinwin.desktop"
    } else {
        base
    };
    if dev {
        format!("{base}.dev")
    } else {
        base.to_string()
    }
}

/// `tauri dev` and local `cargo build` binaries live under `target/`.
/// Those must not overwrite the installed Start Menu shortcut.
pub fn is_windows_dev_exe(path: &str) -> bool {
    let normalized = path.replace('/', "\\").to_ascii_lowercase();
    normalized.contains("\\target\\debug\\") || normalized.contains("\\target\\release\\")
}

pub fn windows_shortcut_file_name(product_name: &str, dev: bool) -> String {
    let base = sanitize_shortcut_name(product_name);
    if dev {
        format!("{base} (dev).lnk")
    } else {
        format!("{base}.lnk")
    }
}

pub fn toast_tag(identifier: &str) -> String {
    let chars: Vec<char> = identifier.chars().filter(|ch| !ch.is_control()).collect();
    if !chars.is_empty() && chars.len() <= TOAST_TAG_MAX_CHARS {
        return chars.into_iter().collect();
    }
    format!("piwin-{:016x}", fnv1a64(identifier))
}

pub fn encode_attention_launch(session_id: &str, attention_key: &str) -> Option<String> {
    let activation = parse_attention_user_info(Some(session_id), Some(attention_key))?;
    Some(format!("{}|{}", activation.session_id, activation.attention_key))
}

pub fn decode_attention_launch(launch: &str) -> Option<(String, String)> {
    let (session_id, attention_key) = launch.split_once('|')?;
    parse_attention_user_info(Some(session_id), Some(attention_key)).map(|activation| {
        (activation.session_id, activation.attention_key)
    })
}

pub fn windows_toast_xml(title: &str, body: &str, launch: &str, sound: bool) -> String {
    let title = escape_xml(truncate_utf8_bytes(title, TITLE_BODY_MAX_BYTES));
    let body = escape_xml(truncate_utf8_bytes(body, TITLE_BODY_MAX_BYTES));
    let launch = escape_xml(launch);
    let audio = if sound {
        r#"<audio src="ms-winsoundevent:Notification.Default"/>"#
    } else {
        r#"<audio silent="true"/>"#
    };
    format!(
        r#"<toast launch="{launch}" activationType="foreground"><visual><binding template="ToastGeneric"><text>{title}</text><text>{body}</text></binding></visual>{audio}</toast>"#
    )
}

pub fn map_windows_notification_setting(value: i32) -> AttentionAuthorization {
    if value == WINDOWS_NOTIFICATION_ENABLED {
        AttentionAuthorization::Granted
    } else if WINDOWS_NOTIFICATION_DISABLED.contains(&value) {
        AttentionAuthorization::Denied
    } else {
        AttentionAuthorization::Unsupported
    }
}

fn sanitize_shortcut_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => ' ',
            ch if ch.is_control() => ' ',
            ch => ch,
        })
        .collect();
    let trimmed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    if trimmed.is_empty() {
        "piwin".to_string()
    } else {
        trimmed
    }
}

fn escape_xml(value: &str) -> String {
    let mut escaped = String::with_capacity(value.len());
    for ch in value.chars() {
        match ch {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&apos;"),
            ch if ch.is_control() && ch != '\t' => {}
            ch => escaped.push(ch),
        }
    }
    escaped
}

fn fnv1a64(value: &str) -> u64 {
    let mut hash: u64 = 0xcbf29ce484222325;
    for byte in value.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::{
        decode_attention_launch, encode_attention_launch, is_windows_dev_exe,
        map_windows_notification_setting, toast_tag, windows_aumid, windows_shortcut_file_name,
        windows_toast_xml, TOAST_GROUP, TOAST_TAG_MAX_CHARS,
    };
    use crate::attention_notifications::AttentionAuthorization;

    #[test]
    fn launch_roundtrip_rejects_unsafe_tokens() {
        let launch = encode_attention_launch("sess_1", "run:abc-2").expect("launch");
        assert_eq!(
            decode_attention_launch(&launch),
            Some(("sess_1".to_string(), "run:abc-2".to_string()))
        );
        assert!(encode_attention_launch("sess.1", "run:1").is_none());
        assert!(decode_attention_launch("sess_1").is_none());
        assert!(decode_attention_launch("sess 1|run:1").is_none());
    }

    #[test]
    fn toast_xml_escapes_text_and_honors_sound() {
        let xml = windows_toast_xml("A & B <C>", "line", "sess_1|run:1", false);
        assert!(xml.contains("&amp;"));
        assert!(xml.contains("&lt;C&gt;"));
        assert!(xml.contains(r#"<audio silent="true"/>"#));
        assert!(!xml.contains("ms-winsoundevent"));
        assert!(windows_toast_xml("ok", "ok", "sess_1|run:1", true).contains("Notification.Default"));
    }

    #[test]
    fn tag_and_identity_stay_stable() {
        assert_eq!(toast_tag("piwin.attention.summary"), "piwin.attention.summary");
        assert_eq!(TOAST_GROUP, "piwin");
        let long = "x".repeat(TOAST_TAG_MAX_CHARS + 8);
        let tag = toast_tag(&long);
        assert!(tag.chars().count() <= TOAST_TAG_MAX_CHARS);
        assert_eq!(tag, toast_tag(&long));
        assert_eq!(windows_aumid("app.piwinwin.desktop", false), "app.piwinwin.desktop");
        assert_eq!(windows_aumid("app.piwinwin.desktop", true), "app.piwinwin.desktop.dev");
        assert_eq!(windows_shortcut_file_name("piwin", false), "piwin.lnk");
        assert_eq!(windows_shortcut_file_name("piwin shell", true), "piwin shell (dev).lnk");
        assert!(is_windows_dev_exe(r"C:\src\target\debug\piwin-desktop.exe"));
        assert!(!is_windows_dev_exe(r"C:\Program Files\piwin\piwin.exe"));
    }

    #[test]
    fn windows_setting_maps_to_authorization() {
        assert_eq!(map_windows_notification_setting(0), AttentionAuthorization::Granted);
        assert_eq!(map_windows_notification_setting(1), AttentionAuthorization::Denied);
        assert_eq!(map_windows_notification_setting(4), AttentionAuthorization::Denied);
        assert_eq!(map_windows_notification_setting(9), AttentionAuthorization::Unsupported);
    }
}
