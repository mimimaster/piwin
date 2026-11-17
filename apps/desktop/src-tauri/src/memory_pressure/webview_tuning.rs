//! macOS WKWebView memory policy tuning (tile retention & BFCache pruning).
//!
//! By default on macOS, `WKWebView` sets `_aggressiveTileRetentionEnabled = YES`,
//! preventing `WebCore::TileGrid` from evicting off-screen 512x512 scroll tiles.
//! While the window remains visible (`Visible: 1`), those cold off-screen tiles
//! stay live in `m_liveBackingStore` and are swapped rather than reclaimed,
//! inflating `phys_footprint` by >1 GiB in long sessions. Disabling aggressive
//! tile retention lets WebCore age off-screen tile cohorts out after ~2s.

#[cfg(target_os = "macos")]
pub(crate) unsafe fn tune_wkwebview_memory_preferences(webview: &objc2::runtime::AnyObject) {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};

    let has_config: bool = msg_send![webview, respondsToSelector: sel!(configuration)];
    if !has_config {
        return;
    }
    let config: *mut AnyObject = msg_send![webview, configuration];
    let Some(config) = config.as_ref() else {
        return;
    };
    let has_prefs: bool = msg_send![config, respondsToSelector: sel!(preferences)];
    if !has_prefs {
        return;
    }
    let prefs: *mut AnyObject = msg_send![config, preferences];
    let Some(prefs) = prefs.as_ref() else {
        return;
    };
    let supports_tile_pref: bool =
        msg_send![prefs, respondsToSelector: sel!(_setAggressiveTileRetentionEnabled:)];
    if supports_tile_pref {
        let _: () = msg_send![prefs, _setAggressiveTileRetentionEnabled: false];
    }
}

#[cfg(target_os = "macos")]
pub(crate) unsafe fn purge_wkwebview_transient_state(webview: &objc2::runtime::AnyObject) {
    use objc2::{msg_send, sel};

    tune_wkwebview_memory_preferences(webview);
    let supports_bf_clear: bool =
        msg_send![webview, respondsToSelector: sel!(_clearBackForwardCache)];
    if supports_bf_clear {
        let _: () = msg_send![webview, _clearBackForwardCache];
    }
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub(crate) unsafe fn tune_wkwebview_memory_preferences(_webview: &std::ffi::c_void) {}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub(crate) unsafe fn purge_wkwebview_transient_state(_webview: &std::ffi::c_void) {}

pub fn configure_all_webviews_memory_policy(app_handle: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        for window in app_handle.webview_windows().into_values() {
            let _ = window.with_webview(|platform_webview| {
                // SAFETY: `platform_webview.inner()` is the live `WKWebView*`
                // on the macOS main thread; every private SPI selector is guarded
                // with `respondsToSelector:` before sending.
                unsafe {
                    use objc2::runtime::AnyObject;
                    let pointer = platform_webview.inner().cast::<AnyObject>();
                    if let Some(webview) = pointer.as_ref() {
                        tune_wkwebview_memory_preferences(webview);
                    }
                }
            });
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app_handle;
    }
}
