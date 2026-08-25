//! iOS WKWebView chrome: the page owns scrolling and safe-area.
//! Wry already disables rubber-band bounce; we still have to stop UIKit
//! from insetting the scroll view, or CSS `env(safe-area-inset-*)` doubles
//! with the native inset (or reports 0 while the bar still covers content).

pub fn install(app: &tauri::App) {
    #[cfg(target_os = "ios")]
    ios::install(app);
    #[cfg(not(target_os = "ios"))]
    let _ = app;
}

#[cfg(target_os = "ios")]
mod ios {
    use objc2::runtime::AnyObject;
    use tauri::Manager;

    /// `UIScrollViewContentInsetAdjustmentNever`
    const INSET_ADJUSTMENT_NEVER: i64 = 2;

    pub fn install(app: &tauri::App) {
        let Some(window) = app.get_webview_window("main") else {
            return;
        };
        let _ = window.with_webview(|platform_webview| unsafe {
            apply_chrome(platform_webview.inner());
        });
    }

    unsafe fn apply_chrome(webview: *mut std::ffi::c_void) {
        if webview.is_null() {
            return;
        }
        let webview = webview as *mut AnyObject;
        let scroll_view: *mut AnyObject = objc2::msg_send![webview, scrollView];
        if scroll_view.is_null() {
            return;
        }
        let _: () = objc2::msg_send![scroll_view, setBounces: false];
        let _: () = objc2::msg_send![scroll_view, setAlwaysBounceVertical: false];
        let _: () = objc2::msg_send![scroll_view, setContentInsetAdjustmentBehavior: INSET_ADJUSTMENT_NEVER];
    }
}
