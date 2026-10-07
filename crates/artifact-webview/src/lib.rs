//! Artifact hosting shared by the piwin Tauri shells (Desktop and iOS).
//!
//! Both shells load the same front end under `tauri://`, where Tauri appends
//! script hashes to the page CSP. An Artifact iframe therefore needs the same
//! two native pieces on every shell: an isolated document scheme (`protocol`)
//! and the WKWebView return channel for size/action messages (`bridge`).

pub mod bridge;
pub mod protocol;

pub use bridge::install_artifact_bridge;
pub use protocol::artifact_document_put;

use tauri::Manager;

/// Bounce the main frame off `piwin-artifact:` / `*.piwin-artifact.localhost`.
/// wry `on_navigation` also sees iframe loads, so it cannot deny this scheme.
/// `on_page_load` is main-frame only on WKWebView.
fn artifact_scheme_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("artifact-scheme-guard")
        .on_page_load(|webview, payload| {
            if webview.label() != protocol::ARTIFACT_WEBVIEW_LABEL {
                return;
            }
            if payload.event() != tauri::webview::PageLoadEvent::Started {
                return;
            }
            if !protocol::is_artifact_document_url(payload.url()) {
                return;
            }
            let dev_url = if tauri::is_dev() {
                webview.config().build.dev_url.clone()
            } else {
                None
            };
            let home = protocol::app_home_url(payload.url(), dev_url.as_ref());
            let _ = webview.navigate(home);
        })
        .build()
}

/// Registers the document scheme, its store and the main-frame guard.
///
/// The shell still lists `artifact_document_put` in its invoke handler and
/// calls `install_artifact_bridge` from `setup`, once the main webview exists.
pub fn register_artifact_documents<R: tauri::Runtime>(
    builder: tauri::Builder<R>,
) -> tauri::Builder<R> {
    builder
        .plugin(artifact_scheme_guard())
        .register_asynchronous_uri_scheme_protocol(
            protocol::ARTIFACT_SCHEME,
            |context, request, responder| {
                let application = context.app_handle().clone();
                let webview_label = context.webview_label().to_owned();
                // The document put can race the iframe request; waiting must
                // never block the WebKit main thread.
                tauri::async_runtime::spawn_blocking(move || {
                    let store = application.state::<protocol::ArtifactDocumentStore>();
                    responder.respond(protocol::handle_artifact_request(
                        &store,
                        &webview_label,
                        &request,
                        protocol::ARTIFACT_DOCUMENT_WAIT,
                    ));
                });
            },
        )
        .manage(protocol::ArtifactDocumentStore::default())
}
