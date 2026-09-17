//! Isolated `piwin-artifact:` documents so sandbox iframes do not inherit the
//! packaged app CSP. Tauri appends script hashes to `script-src`, which
//! disables `'unsafe-inline'` for WebKit `data:` frames.
//!
//! Documents are published over IPC (`artifact_document_put`) into a bounded
//! in-memory store and loaded as `piwin-artifact://localhost/<id>`. They cannot
//! travel in the URL: wry parses scheme requests into `http::Uri`, which rejects
//! anything over 65 534 bytes and answers 404 without calling this handler, and
//! a base64 srcdoc (theme CSS + bridge + source) routinely exceeds that.
//!
//! The iframe mounts in the same commit that publishes, so a request may arrive
//! before its document. The handler waits briefly for the matching put.
//!
//! Custom protocols are `Origin::Local` in Tauri 2.11: IPC is keyed off the
//! frame URL scheme, not the document origin. A response-header
//! `sandbox allow-scripts` does **not** deny that IPC, and it can block the
//! height-bridge bootstrap in WKWebView. Iframes cannot invoke commands without
//! the main-frame invoke key. wry's macOS `on_navigation` also fires for iframe
//! loads, so the main-window defense is `on_page_load` bouncing the main frame
//! home. iframe `sandbox="allow-scripts"` stays on the element.

use std::collections::{HashMap, VecDeque};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use tauri::http::{header, HeaderName, HeaderValue, Method, Request, Response, StatusCode};
use tauri::Url;

pub const ARTIFACT_SCHEME: &str = "piwin-artifact";
/// How long a scheme request waits for the IPC put racing the iframe mount.
pub const ARTIFACT_DOCUMENT_WAIT: Duration = Duration::from_secs(3);

const MAX_DOCUMENT_BYTES: usize = 2 * 1024 * 1024;
const MAX_STORE_BYTES: usize = 32 * 1024 * 1024;
const MAX_STORE_DOCUMENTS: usize = 256;
const MIN_DOCUMENT_ID_LEN: usize = 16;
const MAX_DOCUMENT_ID_LEN: usize = 64;
const ARTIFACT_WEBVIEW_LABEL: &str = "main";
const WINDOWS_ARTIFACT_HOST: &str = "piwin-artifact.localhost";
const HTML_CONTENT_TYPE: &str = "text/html; charset=utf-8";
const TEXT_CONTENT_TYPE: &str = "text/plain; charset=utf-8";
const INVALID_DOCUMENT_BODY: &[u8] = b"invalid artifact document";
const MISSING_DOCUMENT_BODY: &[u8] = b"artifact document not found";
const METHOD_NOT_ALLOWED_BODY: &[u8] = b"method not allowed";
const FORBIDDEN_BODY: &[u8] = b"forbidden";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ArtifactDocumentError {
    InvalidId,
    TooLarge,
}

impl std::fmt::Display for ArtifactDocumentError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidId => formatter.write_str("invalid artifact document id"),
            Self::TooLarge => formatter.write_str("artifact document too large"),
        }
    }
}

fn is_valid_document_id(id: &str) -> bool {
    (MIN_DOCUMENT_ID_LEN..=MAX_DOCUMENT_ID_LEN).contains(&id.len())
        && id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[derive(Default)]
struct StoreInner {
    documents: HashMap<String, Arc<[u8]>>,
    /// Least recently used first.
    order: VecDeque<String>,
    bytes: usize,
}

impl StoreInner {
    fn touch(&mut self, id: &str) {
        if let Some(position) = self.order.iter().position(|entry| entry == id) {
            if let Some(entry) = self.order.remove(position) {
                self.order.push_back(entry);
            }
        }
    }

    fn remove(&mut self, id: &str) {
        if let Some(previous) = self.documents.remove(id) {
            self.bytes -= previous.len();
            self.order.retain(|entry| entry != id);
        }
    }

    fn evict_to_fit(&mut self) {
        while self.documents.len() > MAX_STORE_DOCUMENTS || self.bytes > MAX_STORE_BYTES {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(document) = self.documents.remove(&oldest) {
                self.bytes -= document.len();
            }
        }
    }
}

/// Bounded LRU of published artifact documents keyed by random frontend ids.
#[derive(Default)]
pub struct ArtifactDocumentStore {
    inner: Mutex<StoreInner>,
    published: Condvar,
}

impl ArtifactDocumentStore {
    pub fn put(&self, id: &str, html: String) -> Result<(), ArtifactDocumentError> {
        if !is_valid_document_id(id) {
            return Err(ArtifactDocumentError::InvalidId);
        }
        if html.len() > MAX_DOCUMENT_BYTES {
            return Err(ArtifactDocumentError::TooLarge);
        }
        let document: Arc<[u8]> = Arc::from(html.into_bytes());
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        inner.remove(id);
        inner.bytes += document.len();
        inner.documents.insert(id.to_owned(), document);
        inner.order.push_back(id.to_owned());
        inner.evict_to_fit();
        drop(inner);
        self.published.notify_all();
        Ok(())
    }

    /// Returns the document, waiting up to `wait` for a racing put.
    pub fn get_or_wait(&self, id: &str, wait: Duration) -> Option<Arc<[u8]>> {
        let deadline = Instant::now() + wait;
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        loop {
            if let Some(document) = inner.documents.get(id).cloned() {
                inner.touch(id);
                return Some(document);
            }
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return None;
            }
            inner = self
                .published
                .wait_timeout(inner, remaining)
                .unwrap_or_else(|error| error.into_inner())
                .0;
        }
    }
}

#[tauri::command]
pub fn artifact_document_put(
    store: tauri::State<'_, ArtifactDocumentStore>,
    id: String,
    html: String,
) -> Result<(), String> {
    store.put(&id, html).map_err(|error| error.to_string())
}

/// True when `url` is an artifact document (custom scheme or Windows host).
pub fn is_artifact_document_url(url: &Url) -> bool {
    if url.scheme() == ARTIFACT_SCHEME {
        return true;
    }
    matches!(url.scheme(), "http" | "https") && url.host_str() == Some(WINDOWS_ARTIFACT_HOST)
}

/// App home to restore after a main-frame artifact navigation.
///
/// `dev_url` is Some only for `tauri dev` (`tauri::is_dev()`). Packaged
/// builds map the artifact URL shape back to the matching tauri protocol.
pub fn app_home_url(artifact_url: &Url, dev_url: Option<&Url>) -> Url {
    if let Some(dev_url) = dev_url {
        return dev_url.clone();
    }
    let home = match artifact_url.scheme() {
        "https" => "https://tauri.localhost/",
        "http" => "http://tauri.localhost/",
        _ => "tauri://localhost/",
    };
    Url::parse(home).expect("static app home URL")
}

fn protocol_response(
    status: StatusCode,
    content_type: &'static str,
    body: impl Into<Vec<u8>>,
) -> Response<Vec<u8>> {
    let mut response = Response::new(body.into());
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        HeaderName::from_static("x-content-type-options"),
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        HeaderName::from_static("referrer-policy"),
        HeaderValue::from_static("no-referrer"),
    );
    response
}

/// Blocking: may wait up to `wait` for the document. Run off the main thread.
pub fn handle_artifact_request(
    store: &ArtifactDocumentStore,
    webview_label: &str,
    request: &Request<Vec<u8>>,
    wait: Duration,
) -> Response<Vec<u8>> {
    if webview_label != ARTIFACT_WEBVIEW_LABEL {
        return protocol_response(StatusCode::FORBIDDEN, TEXT_CONTENT_TYPE, FORBIDDEN_BODY);
    }
    if request.method() != Method::GET {
        return protocol_response(
            StatusCode::METHOD_NOT_ALLOWED,
            TEXT_CONTENT_TYPE,
            METHOD_NOT_ALLOWED_BODY,
        );
    }
    // Query/fragment are not part of the load URL we mint.
    if request.uri().query().is_some() {
        return protocol_response(
            StatusCode::BAD_REQUEST,
            TEXT_CONTENT_TYPE,
            INVALID_DOCUMENT_BODY,
        );
    }
    let id = request.uri().path().strip_prefix('/').unwrap_or_default();
    if !is_valid_document_id(id) {
        return protocol_response(
            StatusCode::BAD_REQUEST,
            TEXT_CONTENT_TYPE,
            INVALID_DOCUMENT_BODY,
        );
    }
    match store.get_or_wait(id, wait) {
        Some(document) => protocol_response(StatusCode::OK, HTML_CONTENT_TYPE, document.to_vec()),
        None => protocol_response(
            StatusCode::NOT_FOUND,
            TEXT_CONTENT_TYPE,
            MISSING_DOCUMENT_BODY,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ID: &str = "0f8b6c1e-9d7a-4c55-8a41-2d3e4f5a6b7c";
    const NO_WAIT: Duration = Duration::from_millis(0);

    fn id(index: usize) -> String {
        format!("doc-{index:016}")
    }

    fn request(method: &str, uri: &str) -> Request<Vec<u8>> {
        Request::builder()
            .method(method)
            .uri(uri)
            .body(Vec::new())
            .expect("artifact protocol test request")
    }

    fn get(store: &ArtifactDocumentStore, uri: &str) -> Response<Vec<u8>> {
        handle_artifact_request(store, "main", &request("GET", uri), NO_WAIT)
    }

    #[test]
    fn put_rejects_invalid_ids_and_oversized_documents() {
        let store = ArtifactDocumentStore::default();
        assert_eq!(
            store.put("short", "<p>x</p>".into()),
            Err(ArtifactDocumentError::InvalidId)
        );
        assert_eq!(
            store.put("../../etc/passwd-0000", "<p>x</p>".into()),
            Err(ArtifactDocumentError::InvalidId)
        );
        assert_eq!(
            store.put(&"a".repeat(MAX_DOCUMENT_ID_LEN + 1), "<p>x</p>".into()),
            Err(ArtifactDocumentError::InvalidId)
        );
        assert_eq!(
            store.put(ID, "x".repeat(MAX_DOCUMENT_BYTES + 1)),
            Err(ArtifactDocumentError::TooLarge)
        );
    }

    #[test]
    fn serves_published_unicode_html_larger_than_the_uri_limit() {
        let store = ArtifactDocumentStore::default();
        let document = format!("<title>鹈鹕</title>{}", "<p>自然撑开</p>".repeat(8_000));
        assert!(document.len() > 65_534);
        store.put(ID, document.clone()).expect("put");
        let response = get(&store, &format!("piwin-artifact://localhost/{ID}"));
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers().get(header::CONTENT_TYPE).map(|value| value.as_bytes()),
            Some(HTML_CONTENT_TYPE.as_bytes())
        );
        assert_eq!(
            response.headers().get(header::CACHE_CONTROL).map(|value| value.as_bytes()),
            Some("no-store".as_bytes())
        );
        assert!(response.headers().get(header::CONTENT_SECURITY_POLICY).is_none());
        assert_eq!(response.body().as_slice(), document.as_bytes());

        let windows = get(&store, &format!("http://piwin-artifact.localhost/{ID}"));
        assert_eq!(windows.status(), StatusCode::OK);
    }

    #[test]
    fn republishing_an_id_replaces_the_document() {
        let store = ArtifactDocumentStore::default();
        store.put(ID, "<p>old</p>".into()).expect("put");
        store.put(ID, "<p>new</p>".into()).expect("put");
        let response = get(&store, &format!("piwin-artifact://localhost/{ID}"));
        assert_eq!(response.body().as_slice(), b"<p>new</p>");
        let inner = store.inner.lock().expect("lock");
        assert_eq!(inner.documents.len(), 1);
        assert_eq!(inner.order.len(), 1);
        assert_eq!(inner.bytes, "<p>new</p>".len());
    }

    #[test]
    fn evicts_least_recently_used_documents_by_count() {
        let store = ArtifactDocumentStore::default();
        for index in 0..MAX_STORE_DOCUMENTS {
            store.put(&id(index), "<p>x</p>".into()).expect("put");
        }
        // Reading the oldest makes it recent, so the next put evicts id(1).
        assert!(store.get_or_wait(&id(0), NO_WAIT).is_some());
        store.put(&id(MAX_STORE_DOCUMENTS), "<p>x</p>".into()).expect("put");
        assert!(store.get_or_wait(&id(0), NO_WAIT).is_some());
        assert!(store.get_or_wait(&id(1), NO_WAIT).is_none());
        assert_eq!(store.inner.lock().expect("lock").documents.len(), MAX_STORE_DOCUMENTS);
    }

    #[test]
    fn evicts_least_recently_used_documents_by_bytes() {
        let store = ArtifactDocumentStore::default();
        let large = "x".repeat(MAX_DOCUMENT_BYTES);
        let fits = MAX_STORE_BYTES / MAX_DOCUMENT_BYTES;
        for index in 0..=fits {
            store.put(&id(index), large.clone()).expect("put");
        }
        let inner = store.inner.lock().expect("lock");
        assert!(inner.bytes <= MAX_STORE_BYTES);
        assert!(!inner.documents.contains_key(&id(0)));
        assert!(inner.documents.contains_key(&id(fits)));
    }

    #[test]
    fn a_request_waits_for_a_racing_put() {
        let store = Arc::new(ArtifactDocumentStore::default());
        let publisher = Arc::clone(&store);
        let handle = std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(50));
            publisher.put(ID, "<p>late</p>".into()).expect("put");
        });
        let response = handle_artifact_request(
            &store,
            "main",
            &request("GET", &format!("piwin-artifact://localhost/{ID}")),
            Duration::from_secs(2),
        );
        handle.join().expect("publisher");
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.body().as_slice(), b"<p>late</p>");
    }

    #[test]
    fn missing_documents_404_after_the_wait() {
        let store = ArtifactDocumentStore::default();
        let started = Instant::now();
        let response = handle_artifact_request(
            &store,
            "main",
            &request("GET", &format!("piwin-artifact://localhost/{ID}")),
            Duration::from_millis(30),
        );
        assert!(started.elapsed() >= Duration::from_millis(30));
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
    }

    #[test]
    fn rejects_other_webviews_methods_queries_and_bad_ids_without_echo() {
        let store = ArtifactDocumentStore::default();
        store.put(ID, "<p>ok</p>".into()).expect("put");
        let uri = format!("piwin-artifact://localhost/{ID}");

        let overlay = handle_artifact_request(&store, "pet-overlay", &request("GET", &uri), NO_WAIT);
        assert_eq!(overlay.status(), StatusCode::FORBIDDEN);

        let post = handle_artifact_request(&store, "main", &request("POST", &uri), NO_WAIT);
        assert_eq!(post.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(post.body().as_slice(), METHOD_NOT_ALLOWED_BODY);

        assert_eq!(get(&store, &format!("{uri}?cache=1")).status(), StatusCode::BAD_REQUEST);

        let invalid = get(&store, "piwin-artifact://localhost/not-valid!!!");
        assert_eq!(invalid.status(), StatusCode::BAD_REQUEST);
        let body = String::from_utf8_lossy(invalid.body());
        assert_eq!(body.as_ref(), "invalid artifact document");
        assert!(!body.contains("not-valid"));
    }

    #[test]
    fn artifact_document_urls_are_detected_on_both_platform_shapes() {
        assert!(is_artifact_document_url(
            &Url::parse("piwin-artifact://localhost/abc").expect("url")
        ));
        assert!(is_artifact_document_url(
            &Url::parse("http://piwin-artifact.localhost/abc").expect("url")
        ));
        assert!(is_artifact_document_url(
            &Url::parse("https://piwin-artifact.localhost/abc").expect("url")
        ));
        assert!(!is_artifact_document_url(
            &Url::parse("tauri://localhost/index.html").expect("url")
        ));
        assert!(!is_artifact_document_url(
            &Url::parse("http://localhost/abc").expect("url")
        ));
        assert!(!is_artifact_document_url(
            &Url::parse("http://evil.piwin-artifact.localhost/abc").expect("url")
        ));
    }

    #[test]
    fn app_home_url_prefers_dev_url_then_matches_artifact_shape() {
        let dev = Url::parse("http://127.0.0.1:1420/").expect("dev");
        let artifact = Url::parse("piwin-artifact://localhost/abc").expect("artifact");
        assert_eq!(app_home_url(&artifact, Some(&dev)).as_str(), dev.as_str());
        assert_eq!(app_home_url(&artifact, None).as_str(), "tauri://localhost/");
        assert_eq!(
            app_home_url(
                &Url::parse("http://piwin-artifact.localhost/abc").expect("http"),
                None
            )
            .as_str(),
            "http://tauri.localhost/"
        );
        assert_eq!(
            app_home_url(
                &Url::parse("https://piwin-artifact.localhost/abc").expect("https"),
                None
            )
            .as_str(),
            "https://tauri.localhost/"
        );
    }
}
