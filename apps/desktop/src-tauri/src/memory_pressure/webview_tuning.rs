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

#[cfg(target_os = "macos")]
pub(crate) unsafe fn kill_wkwebview_content_process(webview: &objc2::runtime::AnyObject) -> bool {
    use objc2::{msg_send, sel};

    let supports_kill: bool =
        msg_send![webview, respondsToSelector: sel!(_killWebContentProcess)];
    if !supports_kill {
        return false;
    }
    let _: () = msg_send![webview, _killWebContentProcess];
    true
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
pub(crate) unsafe fn kill_wkwebview_content_process(_webview: &std::ffi::c_void) -> bool {
    false
}

/// Force-recycle a WebView's backing OS renderer process (macOS `_killWebContentProcess`
/// + reload) so C++ bmalloc arenas, JIT regions, and retained IOSurfaces are returned to
/// the OS immediately, falling back to `reload()` when process termination is unavailable.
pub(crate) fn recycle_webview_window(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let window_for_kill = window.clone();
        let window_for_reload = window.clone();
        let result = window_for_kill.with_webview(move |platform_webview| {
            // SAFETY: `platform_webview.inner()` is the live `WKWebView*` on the main thread.
            // ObjC types stay on the main thread; only Rust `Option<String>` crosses threads.
            unsafe {
                use objc2::runtime::AnyObject;
                use objc2_foundation::{NSString, NSURLRequest, NSURL};
                use objc2_web_kit::WKWebView;

                let raw_webview = platform_webview.inner().cast::<AnyObject>();
                let Some(any_webview) = raw_webview.as_ref() else {
                    let _ = window_for_reload.reload();
                    return;
                };
                let typed_webview = platform_webview.inner().cast::<WKWebView>();
                let saved_url = typed_webview
                    .as_ref()
                    .and_then(|wv| wv.URL())
                    .and_then(|url| url.absoluteString())
                    .map(|value| value.to_string());

                if !kill_wkwebview_content_process(any_webview) {
                    if let Some(wv) = typed_webview.as_ref() {
                        if wv.reload().is_none() {
                            if let Some(ref url_str) = saved_url {
                                if let Some(nsurl) = NSURL::URLWithString(&NSString::from_str(url_str))
                                {
                                    let req = NSURLRequest::requestWithURL(&nsurl);
                                    let _ = wv.loadRequest(&req);
                                }
                            }
                        }
                    } else {
                        let _ = window_for_reload.reload();
                    }
                    return;
                }

                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(50));
                    let fallback_window = window_for_reload.clone();
                    let reload_res = window_for_reload.with_webview(move |reloaded_webview| {
                        let typed_webview = reloaded_webview.inner().cast::<WKWebView>();
                        if let Some(wv) = typed_webview.as_ref() {
                            if wv.reload().is_none() {
                                if let Some(ref url_str) = saved_url {
                                    if let Some(nsurl) =
                                        NSURL::URLWithString(&NSString::from_str(url_str))
                                    {
                                        let req = NSURLRequest::requestWithURL(&nsurl);
                                        let _ = wv.loadRequest(&req);
                                    }
                                }
                            }
                        }
                    });
                    if reload_res.is_err() {
                        let _ = fallback_window.reload();
                    }
                });
            }
        });
        if result.is_err() {
            let _ = window.reload();
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = window.reload();
    }
}

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
