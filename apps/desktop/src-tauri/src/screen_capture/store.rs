//! The screenshot waiting for the main webview to read it. Only the latest is
//! kept, and a read hands it out once and forgets it.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use super::unix_millis;

#[derive(Default)]
pub(super) struct CaptureStore {
    latest: Mutex<Option<StoredCapture>>,
    counter: AtomicU64,
}

struct StoredCapture {
    id: String,
    bytes: Vec<u8>,
}

impl CaptureStore {
    pub(super) fn put(&self, bytes: Vec<u8>) -> String {
        let sequence = self.counter.fetch_add(1, Ordering::SeqCst);
        let id = format!("capture-{}-{sequence}", unix_millis());
        if let Ok(mut latest) = self.latest.lock() {
            *latest = Some(StoredCapture {
                id: id.clone(),
                bytes,
            });
        }
        id
    }

    pub(super) fn take(&self, id: &str) -> Option<Vec<u8>> {
        let mut latest = self.latest.lock().ok()?;
        if latest.as_ref().map(|capture| capture.id.as_str()) != Some(id) {
            return None;
        }
        latest.take().map(|capture| capture.bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn store_reads_once_and_newest_wins() {
        let store = CaptureStore::default();
        let first = store.put(vec![1]);
        let second = store.put(vec![2]);
        assert_ne!(first, second);
        assert_eq!(store.take(&first), None);
        assert_eq!(store.take(&second), Some(vec![2]));
        assert_eq!(store.take(&second), None);
    }
}
