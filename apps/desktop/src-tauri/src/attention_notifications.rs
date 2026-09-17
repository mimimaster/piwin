//! macOS `UNUserNotificationCenter` bridge (AN-N1 / AN-I08).
//!
//! Commands are registered on every platform and never panic. The native
//! center is supported only for a packaged `.app` with a real bundle id
//! (AN-G13: a naked `tauri dev` binary reports `unsupported`).

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

const USER_INFO_SESSION_ID: &str = "piwin.sessionId";
const USER_INFO_ATTENTION_KEY: &str = "piwin.attentionKey";
const TITLE_BODY_MAX_BYTES: usize = 256;
const ATTENTION_TOKEN_MAX_BYTES: usize = 128;
const ACTIVATE_EVENT: &str = "attention://activate";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionOsCapabilities {
    native_center: bool,
    click_activation: bool,
    authorization_reliable: bool,
}

impl AttentionOsCapabilities {
    fn supported() -> Self {
        Self {
            native_center: true,
            click_activation: true,
            authorization_reliable: true,
        }
    }

    fn unsupported() -> Self {
        Self {
            native_center: false,
            click_activation: false,
            authorization_reliable: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttentionAuthorization {
    Granted,
    Denied,
    NotDetermined,
    Unsupported,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum AttentionDeliverResult {
    Delivered,
    NotAuthorized,
    Unsupported,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionActivation {
    session_id: String,
    attention_key: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AttentionDeliverInput {
    identifier: String,
    thread_id: String,
    title: String,
    body: String,
    session_id: String,
    attention_key: String,
    sound: bool,
}

#[derive(Default)]
pub struct AttentionNotificationState {
    pending: Mutex<Option<AttentionActivation>>,
}

pub fn install(app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    macos::install(app_handle);
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_handle;
    }
}

#[tauri::command]
pub fn attention_capabilities() -> AttentionOsCapabilities {
    if runtime_supported() {
        AttentionOsCapabilities::supported()
    } else {
        AttentionOsCapabilities::unsupported()
    }
}

#[tauri::command]
pub fn attention_authorization_status() -> AttentionAuthorization {
    #[cfg(target_os = "macos")]
    {
        macos::authorization_status()
    }
    #[cfg(not(target_os = "macos"))]
    {
        AttentionAuthorization::Unsupported
    }
}

#[tauri::command]
pub fn attention_request_authorization() -> AttentionAuthorization {
    #[cfg(target_os = "macos")]
    {
        macos::request_authorization()
    }
    #[cfg(not(target_os = "macos"))]
    {
        AttentionAuthorization::Unsupported
    }
}

#[tauri::command]
pub fn attention_deliver(input: AttentionDeliverInput) -> AttentionDeliverResult {
    #[cfg(target_os = "macos")]
    {
        macos::deliver(input)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = input;
        AttentionDeliverResult::Unsupported
    }
}

#[tauri::command]
pub fn attention_remove_delivered(identifiers: Vec<String>) {
    #[cfg(target_os = "macos")]
    {
        macos::remove_delivered(&identifiers);
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = identifiers;
    }
}

#[tauri::command]
pub fn attention_take_pending_activation(
    state: State<'_, AttentionNotificationState>,
) -> Option<AttentionActivation> {
    match state.pending.lock() {
        Ok(mut pending) => pending.take(),
        Err(poisoned) => poisoned.into_inner().take(),
    }
}

#[tauri::command]
pub fn attention_open_system_settings() {
    #[cfg(target_os = "macos")]
    {
        macos::open_system_settings();
    }
}

fn runtime_supported() -> bool {
    #[cfg(target_os = "macos")]
    {
        macos::runtime_supported()
    }
    #[cfg(not(target_os = "macos"))]
    {
        false
    }
}

fn is_supported_bundle(bundle_identifier: Option<&str>, bundle_path: &str) -> bool {
    match bundle_identifier {
        Some(identifier) if !identifier.is_empty() => bundle_path.ends_with(".app"),
        _ => false,
    }
}

fn is_valid_attention_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.is_empty() || bytes.len() > ATTENTION_TOKEN_MAX_BYTES {
        return false;
    }
    bytes.iter().all(|byte| {
        matches!(
            byte,
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b':' | b'_' | b'-'
        )
    })
}

fn parse_attention_user_info(
    session_id: Option<&str>,
    attention_key: Option<&str>,
) -> Option<AttentionActivation> {
    let session_id = session_id?;
    let attention_key = attention_key?;
    if !is_valid_attention_token(session_id) || !is_valid_attention_token(attention_key) {
        return None;
    }
    Some(AttentionActivation {
        session_id: session_id.to_string(),
        attention_key: attention_key.to_string(),
    })
}

fn truncate_utf8_bytes(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while end > 0 && !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

fn store_pending_activation(app_handle: &tauri::AppHandle, activation: AttentionActivation) {
    use tauri::Manager;
    let Some(state) = app_handle.try_state::<AttentionNotificationState>() else {
        return;
    };
    let mut pending = match state.pending.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    *pending = Some(activation);
}

#[cfg(target_os = "macos")]
mod macos {
    use super::{
        parse_attention_user_info, store_pending_activation, truncate_utf8_bytes,
        AttentionActivation, AttentionAuthorization, AttentionDeliverInput, AttentionDeliverResult,
        ACTIVATE_EVENT, TITLE_BODY_MAX_BYTES, USER_INFO_ATTENTION_KEY, USER_INFO_SESSION_ID,
    };
    use crate::pet_overlay::raise_main_window;
    use block2::{DynBlock, RcBlock};
    use objc2::rc::Retained;
    use objc2::runtime::{AnyObject, Bool, NSObject, ProtocolObject};
    use objc2::{define_class, msg_send, AllocAnyThread, DeclaredClass};
    use objc2_foundation::{NSArray, NSBundle, NSDictionary, NSError, NSObjectProtocol, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotification, UNNotificationPresentationOptions, UNNotificationRequest,
        UNNotificationResponse, UNNotificationSettings, UNNotificationSound,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
    use std::ptr::NonNull;
    use std::sync::mpsc;
    use std::sync::OnceLock;
    use std::time::Duration;
    use tauri::{AppHandle, Emitter};

    const SETTINGS_TIMEOUT: Duration = Duration::from_secs(8);
    const DELIVER_TIMEOUT: Duration = Duration::from_secs(8);

    static DELEGATE: OnceLock<Retained<AttentionNotificationDelegate>> = OnceLock::new();

    pub struct AttentionNotificationDelegateIvars {
        app_handle: AppHandle,
    }

    define_class!(
        #[unsafe(super(NSObject))]
        #[ivars = AttentionNotificationDelegateIvars]
        struct AttentionNotificationDelegate;

        unsafe impl NSObjectProtocol for AttentionNotificationDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for AttentionNotificationDelegate {
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                _this: &AttentionNotificationDelegate,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion_handler.call((UNNotificationPresentationOptions::empty(),));
            }

            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                this: &AttentionNotificationDelegate,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion_handler: &DynBlock<dyn Fn()>,
            ) {
                if let Some(activation) = activation_from_response(response) {
                    handle_activation(&this.ivars().app_handle, activation);
                }
                completion_handler.call(());
            }
        }
    );

    impl AttentionNotificationDelegate {
        fn create(app_handle: AppHandle) -> Retained<Self> {
            let allocated =
                Self::alloc().set_ivars(AttentionNotificationDelegateIvars { app_handle });
            unsafe { msg_send![super(allocated), init] }
        }
    }

    pub fn install(app_handle: &AppHandle) {
        if !runtime_supported() {
            return;
        }
        if DELEGATE.get().is_some() {
            return;
        }
        let delegate = AttentionNotificationDelegate::create(app_handle.clone());
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let protocol = ProtocolObject::from_ref(&*delegate);
        center.setDelegate(Some(protocol));
        let _ = DELEGATE.set(delegate);
    }

    pub fn runtime_supported() -> bool {
        let (identifier, path) = main_bundle_identity();
        super::is_supported_bundle(identifier.as_deref(), &path)
    }

    pub fn authorization_status() -> AttentionAuthorization {
        if !runtime_supported() {
            return AttentionAuthorization::Unsupported;
        }
        read_authorization_status().unwrap_or(AttentionAuthorization::Unsupported)
    }

    pub fn request_authorization() -> AttentionAuthorization {
        if !runtime_supported() {
            return AttentionAuthorization::Unsupported;
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |_granted: Bool, _error: *mut NSError| {
            let _ = tx.send(());
        });
        let options = UNAuthorizationOptions::Alert
            | UNAuthorizationOptions::Sound
            | UNAuthorizationOptions::Badge;
        center.requestAuthorizationWithOptions_completionHandler(options, &block);
        let _ = rx.recv();
        read_authorization_status().unwrap_or(AttentionAuthorization::Unsupported)
    }

    pub fn deliver(input: AttentionDeliverInput) -> AttentionDeliverResult {
        if !runtime_supported() {
            return AttentionDeliverResult::Unsupported;
        }
        if input.identifier.is_empty() {
            return AttentionDeliverResult::Unsupported;
        }
        match read_authorization_status() {
            Some(AttentionAuthorization::Granted) => {}
            Some(AttentionAuthorization::Unsupported) | None => {
                return AttentionDeliverResult::Unsupported;
            }
            Some(_) => return AttentionDeliverResult::NotAuthorized,
        }

        let identifier = NSString::from_str(&input.identifier);
        let title = NSString::from_str(truncate_utf8_bytes(&input.title, TITLE_BODY_MAX_BYTES));
        let body = NSString::from_str(truncate_utf8_bytes(&input.body, TITLE_BODY_MAX_BYTES));
        let thread_id = NSString::from_str(&input.thread_id);
        let content = UNMutableNotificationContent::new();
        content.setTitle(&title);
        content.setBody(&body);
        content.setThreadIdentifier(&thread_id);
        if input.sound {
            content.setSound(Some(&UNNotificationSound::defaultSound()));
        } else {
            content.setSound(None);
        }
        if let Some(activation) =
            parse_attention_user_info(Some(&input.session_id), Some(&input.attention_key))
        {
            let session_key = NSString::from_str(USER_INFO_SESSION_ID);
            let attention_key = NSString::from_str(USER_INFO_ATTENTION_KEY);
            let session_value = NSString::from_str(&activation.session_id);
            let attention_value = NSString::from_str(&activation.attention_key);
            let user_info = NSDictionary::from_slices(
                &[&*session_key, &*attention_key],
                &[&*session_value, &*attention_value],
            );
            unsafe {
                content.setUserInfo((&*user_info).cast_unchecked());
            }
        }

        let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
            &identifier,
            content.as_ref(),
            None,
        );
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |error: *mut NSError| {
            let _ = tx.send(error.is_null());
        });
        center.addNotificationRequest_withCompletionHandler(&request, Some(&block));
        match rx.recv_timeout(DELIVER_TIMEOUT) {
            Ok(true) => AttentionDeliverResult::Delivered,
            Ok(false) | Err(_) => AttentionDeliverResult::NotAuthorized,
        }
    }

    pub fn remove_delivered(identifiers: &[String]) {
        if !runtime_supported() || identifiers.is_empty() {
            return;
        }
        let ids: Vec<Retained<NSString>> = identifiers
            .iter()
            .filter(|id| !id.is_empty())
            .map(|id| NSString::from_str(id))
            .collect();
        if ids.is_empty() {
            return;
        }
        let array = NSArray::from_retained_slice(&ids);
        UNUserNotificationCenter::currentNotificationCenter()
            .removeDeliveredNotificationsWithIdentifiers(&array);
    }

    pub fn open_system_settings() {
        let Some(bundle_id) = main_bundle_identity().0 else {
            return;
        };
        let url = format!(
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension?id={bundle_id}"
        );
        let _ = std::process::Command::new("open").arg(url).spawn();
    }

    fn main_bundle_identity() -> (Option<String>, String) {
        let bundle = NSBundle::mainBundle();
        let path = bundle.bundlePath().to_string();
        let identifier = unsafe {
            let value: Option<Retained<NSString>> = msg_send![&*bundle, bundleIdentifier];
            value.map(|s| s.to_string()).filter(|s| !s.is_empty())
        };
        (identifier, path)
    }

    fn read_authorization_status() -> Option<AttentionAuthorization> {
        let center = UNUserNotificationCenter::currentNotificationCenter();
        let (tx, rx) = mpsc::channel();
        let block = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
            let settings = unsafe { settings.as_ref() };
            let _ = tx.send(map_authorization_status(settings.authorizationStatus()));
        });
        center.getNotificationSettingsWithCompletionHandler(&block);
        rx.recv_timeout(SETTINGS_TIMEOUT).ok()
    }

    fn map_authorization_status(status: UNAuthorizationStatus) -> AttentionAuthorization {
        if status == UNAuthorizationStatus::Authorized
            || status == UNAuthorizationStatus::Provisional
            || status == UNAuthorizationStatus::Ephemeral
        {
            AttentionAuthorization::Granted
        } else if status == UNAuthorizationStatus::Denied {
            AttentionAuthorization::Denied
        } else {
            AttentionAuthorization::NotDetermined
        }
    }

    fn activation_from_response(response: &UNNotificationResponse) -> Option<AttentionActivation> {
        let user_info = response.notification().request().content().userInfo();
        let session_id = dict_string(&user_info, USER_INFO_SESSION_ID);
        let attention_key = dict_string(&user_info, USER_INFO_ATTENTION_KEY);
        parse_attention_user_info(session_id.as_deref(), attention_key.as_deref())
    }

    fn dict_string(user_info: &NSDictionary, key: &str) -> Option<String> {
        let key = NSString::from_str(key);
        let typed: &NSDictionary<NSString, AnyObject> = unsafe { user_info.cast_unchecked() };
        let value = typed.objectForKey(&key)?;
        value.downcast_ref::<NSString>().map(|s| s.to_string())
    }

    fn handle_activation(app_handle: &AppHandle, activation: AttentionActivation) {
        store_pending_activation(app_handle, activation.clone());
        let raise = app_handle.clone();
        let _ = raise.clone().run_on_main_thread(move || {
            let _ = raise_main_window(&raise);
        });
        let _ = app_handle.emit_to("main", ACTIVATE_EVENT, &activation);
    }
}

#[cfg(test)]
mod tests {
    use super::{
        is_supported_bundle, is_valid_attention_token, parse_attention_user_info,
        truncate_utf8_bytes, TITLE_BODY_MAX_BYTES,
    };

    #[test]
    fn an_t40_user_info_validation() {
        assert!(parse_attention_user_info(Some("sess_1"), Some("run:abc-2")).is_some());
        assert!(is_valid_attention_token(&"a".repeat(128)));

        assert!(parse_attention_user_info(None, Some("run:1")).is_none());
        assert!(parse_attention_user_info(Some("sess_1"), None).is_none());
        assert!(parse_attention_user_info(Some(""), Some("run:1")).is_none());
        assert!(parse_attention_user_info(Some("sess 1"), Some("run:1")).is_none());
        assert!(parse_attention_user_info(Some("sess.1"), Some("run:1")).is_none());
        assert!(parse_attention_user_info(Some("sess@1"), Some("run:1")).is_none());
        assert!(parse_attention_user_info(Some(&"a".repeat(129)), Some("run:1")).is_none());
        assert!(parse_attention_user_info(Some("sess_1"), Some("run/1")).is_none());
    }

    #[test]
    fn an_t41_utf8_safe_256_byte_truncate() {
        let ascii = "a".repeat(255);
        let with_cjk = format!("{ascii}你");
        assert!(with_cjk.len() > TITLE_BODY_MAX_BYTES);
        let truncated = truncate_utf8_bytes(&with_cjk, TITLE_BODY_MAX_BYTES);
        assert_eq!(truncated, ascii);
        assert!(truncated.is_char_boundary(truncated.len()));

        let exact = format!("{}你", "b".repeat(253));
        assert_eq!(exact.len(), TITLE_BODY_MAX_BYTES);
        assert_eq!(truncate_utf8_bytes(&exact, TITLE_BODY_MAX_BYTES), exact);

        let short = "hello";
        assert_eq!(truncate_utf8_bytes(short, TITLE_BODY_MAX_BYTES), short);
    }

    #[test]
    fn an_t42_support_detection() {
        assert!(!is_supported_bundle(None, "/Applications/piwinwin.app"));
        assert!(!is_supported_bundle(Some(""), "/Applications/piwinwin.app"));
        assert!(!is_supported_bundle(
            Some("app.piwinwin.desktop"),
            "/path/to/target/debug/piwin-desktop"
        ));
        assert!(is_supported_bundle(
            Some("app.piwinwin.desktop"),
            "/Applications/piwinwin.app"
        ));
    }
}
