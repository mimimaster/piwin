//! Windows toast bridge for the existing `attention_*` commands.
//!
//! Unpackaged Win32 toasts need an AppUserModelID that matches a Start Menu
//! shortcut. We register that ourselves so a dev binary is not attributed to
//! PowerShell, and so a click while this process is alive can open the session.
//! A click after the process has exited only launches the shortcut; it does not
//! deep-link. That cold-start COM activator is intentionally out of this slice.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter};

use crate::attention_notifications::{store_pending_activation, ACTIVATE_EVENT};
use crate::attention_toast::{
    decode_attention_launch, encode_attention_launch, is_windows_dev_exe, map_windows_notification_setting,
    toast_tag, windows_aumid, windows_shortcut_file_name, windows_toast_xml, TOAST_GROUP,
};
use crate::attention_notifications::{
    AttentionAuthorization, AttentionDeliverInput, AttentionDeliverResult,
};
use crate::pet_overlay::raise_main_window;

static READY: AtomicBool = AtomicBool::new(false);

struct ToastIdentity {
    aumid: String,
    shortcut_name: String,
    dev: bool,
}

pub fn install(app: &AppHandle) {
    READY.store(ensure_identity(app), Ordering::Release);
}

pub fn runtime_supported() -> bool {
    READY.load(Ordering::Acquire)
}

pub fn authorization_status(app: &AppHandle) -> AttentionAuthorization {
    if !ensure_ready(app) {
        return AttentionAuthorization::Unsupported;
    }
    read_setting(app).unwrap_or(AttentionAuthorization::Unsupported)
}

pub fn request_authorization(app: &AppHandle) -> AttentionAuthorization {
    let status = authorization_status(app);
    if status == AttentionAuthorization::Granted {
        return status;
    }
    open_system_settings();
    if !runtime_supported() {
        return AttentionAuthorization::Unsupported;
    }
    read_setting(app).unwrap_or(AttentionAuthorization::Unsupported)
}

pub fn deliver(app: &AppHandle, input: AttentionDeliverInput) -> AttentionDeliverResult {
    if input.identifier.is_empty() || !ensure_ready(app) {
        return AttentionDeliverResult::Unsupported;
    }
    match read_setting(app) {
        Some(AttentionAuthorization::Granted) => {}
        Some(AttentionAuthorization::Unsupported) | None => return AttentionDeliverResult::Unsupported,
        Some(_) => return AttentionDeliverResult::NotAuthorized,
    }
    let Some(identity) = identity(app) else {
        return AttentionDeliverResult::Unsupported;
    };
    let launch = encode_attention_launch(&input.session_id, &input.attention_key).unwrap_or_default();
    let xml = windows_toast_xml(&input.title, &input.body, &launch, input.sound);
    match show_toast(app, &identity.aumid, &input.identifier, &xml) {
        Ok(()) => AttentionDeliverResult::Delivered,
        Err(_) => AttentionDeliverResult::NotAuthorized,
    }
}

pub fn remove_delivered(app: &AppHandle, identifiers: &[String]) {
    if !runtime_supported() || identifiers.is_empty() {
        return;
    }
    let Some(identity) = identity(app) else {
        return;
    };
    let Ok(history) = windows::UI::Notifications::ToastNotificationManager::History() else {
        return;
    };
    let group = windows::core::HSTRING::from(TOAST_GROUP);
    let aumid = windows::core::HSTRING::from(identity.aumid);
    for identifier in identifiers {
        if identifier.is_empty() {
            continue;
        }
        let tag = windows::core::HSTRING::from(toast_tag(identifier));
        let _ = history.RemoveGroupedTagWithId(&tag, &group, &aumid);
    }
}

pub fn open_system_settings() {
    let _ = std::process::Command::new("cmd")
        .args(["/c", "start", "", "ms-settings:notifications"])
        .spawn();
}

fn ensure_ready(app: &AppHandle) -> bool {
    if runtime_supported() {
        return true;
    }
    let ready = ensure_identity(app);
    READY.store(ready, Ordering::Release);
    ready
}

fn identity(app: &AppHandle) -> Option<ToastIdentity> {
    let exe = std::env::current_exe().ok()?;
    let dev = is_windows_dev_exe(&exe.display().to_string());
    let bundle_id = app.config().identifier.clone();
    let product = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "piwin".to_string());
    Some(ToastIdentity {
        aumid: windows_aumid(&bundle_id, dev),
        shortcut_name: windows_shortcut_file_name(&product, dev),
        dev,
    })
}

fn ensure_identity(app: &AppHandle) -> bool {
    let Some(identity) = identity(app) else {
        return false;
    };
    advertise_aumid(&identity.aumid);
    install_shortcut(&identity).is_ok()
}

fn advertise_aumid(aumid: &str) {
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    let _ = unsafe { SetCurrentProcessExplicitAppUserModelID(&windows::core::HSTRING::from(aumid)) };
}

fn install_shortcut(identity: &ToastIdentity) -> windows::core::Result<()> {
    use windows::core::{Interface, PCWSTR};
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, IPersistFile, StructuredStorage::PROPVARIANT,
        CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::{PropertiesSystem::IPropertyStore, IShellLinkW, ShellLink};

    let appdata = std::env::var_os("APPDATA").ok_or_else(win_fail)?;
    let mut lnk = std::path::PathBuf::from(appdata);
    lnk.push(r"Microsoft\Windows\Start Menu\Programs");
    std::fs::create_dir_all(&lnk).map_err(|_| win_fail())?;
    lnk.push(&identity.shortcut_name);
    let exe = std::env::current_exe().map_err(|_| win_fail())?;
    let exe_wide = wide(&exe);
    let lnk_wide = wide(&lnk);
    let working_wide = exe
        .parent()
        .map(wide)
        .unwrap_or_else(|| wide(std::path::Path::new("")));

    // Do not CoUninitialize. Setup may already own the apartment; S_FALSE is
    // success and uninitializing it would tear down Tauri's COM.
    let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(PCWSTR(exe_wide.as_ptr()))?;
        link.SetWorkingDirectory(PCWSTR(working_wide.as_ptr()))?;
        link.SetIconLocation(PCWSTR(exe_wide.as_ptr()), 0)?;
        let store: IPropertyStore = link.cast()?;
        let value = PROPVARIANT::from(identity.aumid.as_str());
        store.SetValue(&PKEY_AppUserModel_ID, &value)?;
        store.Commit()?;
        let persist: IPersistFile = link.cast()?;
        persist.Save(PCWSTR(lnk_wide.as_ptr()), true)?;
    }
    Ok(())
}

fn show_toast(app: &AppHandle, aumid: &str, identifier: &str, xml: &str) -> windows::core::Result<()> {
    use windows::core::{IInspectable, HSTRING};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::Foundation::TypedEventHandler;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};

    let document = XmlDocument::new()?;
    document.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&document)?;
    toast.SetTag(&HSTRING::from(toast_tag(identifier)))?;
    toast.SetGroup(&HSTRING::from(TOAST_GROUP))?;

    let app_handle = app.clone();
    let handler = TypedEventHandler::<ToastNotification, IInspectable>::new(
        move |_sender, args| {
            let launch = activation_launch(args);
            if let Some((session_id, attention_key)) = decode_attention_launch(&launch) {
                activate(&app_handle, session_id, attention_key);
            } else {
                let raise = app_handle.clone();
                let _ = raise.clone().run_on_main_thread(move || {
                    let _ = raise_main_window(&raise);
                });
            }
            Ok(())
        },
    );
    // WinRT AddRefs the handler on Activated; no extra retain list needed.
    toast.Activated(&handler)?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(aumid))?.Show(&toast)?;
    Ok(())
}

fn activation_launch(
    args: windows::core::Ref<'_, windows::core::IInspectable>,
) -> String {
    use windows::core::Interface;
    use windows::UI::Notifications::ToastActivatedEventArgs;
    let Some(value) = args.as_ref() else {
        return String::new();
    };
    value
        .cast::<ToastActivatedEventArgs>()
        .ok()
        .and_then(|event| event.Arguments().ok())
        .map(|text| text.to_string())
        .unwrap_or_default()
}

fn activate(app: &AppHandle, session_id: String, attention_key: String) {
    let activation = crate::attention_notifications::AttentionActivation {
        session_id,
        attention_key,
    };
    store_pending_activation(app, activation.clone());
    let raise = app.clone();
    let _ = raise.clone().run_on_main_thread(move || {
        let _ = raise_main_window(&raise);
    });
    let _ = app.emit_to("main", ACTIVATE_EVENT, &activation);
}

fn read_setting(app: &AppHandle) -> Option<AttentionAuthorization> {
    use windows::core::HSTRING;
    use windows::UI::Notifications::ToastNotificationManager;
    let identity = identity(app)?;
    let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(identity.aumid)).ok()?;
    let setting = notifier.Setting().ok()?;
    Some(map_windows_notification_setting(setting.0))
}

fn win_fail() -> windows::core::Error {
    windows::core::Error::from_hresult(windows::core::HRESULT(0x8000_4005_u32 as i32))
}

fn wide(path: &std::path::Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().chain(std::iter::once(0)).collect()
}
