use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

pub(super) const MAX_STREAMS: usize = 32;
pub(super) const MAX_QUEUED_BYTES: usize = 32 * 1024 * 1024;
pub(super) const MAX_PACKET_BYTES: usize = 12 * 1024 * 1024;

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceReady {
    pub stream_id: String,
    pub delivery_id: u64,
}

#[derive(Clone)]
struct Delivery {
    id: u64,
    packet: Arc<[u8]>,
    served: bool,
}

struct Stream {
    session_id: Option<String>,
    inflight: Option<Delivery>,
    pending: Option<Arc<[u8]>>,
    paused: bool,
}

#[derive(Default)]
struct BrokerInner {
    streams: HashMap<String, Stream>,
    queued_bytes: usize,
}

#[derive(Default)]
pub(super) struct FrameBroker {
    inner: Mutex<BrokerInner>,
    next_stream_id: AtomicU64,
    next_delivery_id: AtomicU64,
}

impl FrameBroker {
    pub fn open(&self, session_id: Option<String>) -> Result<String, &'static str> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| "browser frame broker poisoned")?;
        if inner.streams.len() >= MAX_STREAMS {
            return Err("too many active browser frame streams");
        }
        let stream_number = self.next_stream_id.fetch_add(1, Ordering::Relaxed) + 1;
        let stream_id = format!("s{stream_number:x}");
        inner.streams.insert(
            stream_id.clone(),
            Stream {
                session_id,
                inflight: None,
                pending: None,
                paused: false,
            },
        );
        Ok(stream_id)
    }

    pub fn close(&self, stream_id: &str) {
        let Ok(mut inner) = self.inner.lock() else {
            return;
        };
        if let Some(stream) = inner.streams.remove(stream_id) {
            inner.queued_bytes = inner.queued_bytes.saturating_sub(stream_bytes(&stream));
        }
    }

    pub fn has_interest(&self, session_id: Option<&str>) -> bool {
        let Ok(inner) = self.inner.lock() else {
            return false;
        };
        inner
            .streams
            .values()
            .any(|stream| !stream.paused && stream.session_id.as_deref() == session_id)
    }

    pub fn publish(
        &self,
        session_id: Option<&str>,
        packet: Arc<[u8]>,
    ) -> (bool, Vec<ResourceReady>) {
        if packet.len() > MAX_PACKET_BYTES {
            return (false, Vec::new());
        }
        let Ok(mut inner) = self.inner.lock() else {
            return (false, Vec::new());
        };
        let stream_ids = inner
            .streams
            .iter()
            .filter(|(_, stream)| !stream.paused && stream.session_id.as_deref() == session_id)
            .map(|(stream_id, _)| stream_id.clone())
            .collect::<Vec<_>>();
        let mut accepted = false;
        let mut ready = Vec::new();
        for stream_id in stream_ids {
            let slot_bytes = inner
                .streams
                .get(&stream_id)
                .map(|stream| stream.pending.as_ref().map_or(0, |pending| pending.len()))
                .unwrap_or(0);
            if slot_bytes > 0 {
                if let Some(stream) = inner.streams.get_mut(&stream_id) {
                    stream.pending = None;
                }
                inner.queued_bytes = inner.queued_bytes.saturating_sub(slot_bytes);
            }
            if inner.queued_bytes.saturating_add(packet.len()) > MAX_QUEUED_BYTES {
                continue;
            }
            let delivery_id = self.next_delivery_id.fetch_add(1, Ordering::Relaxed) + 1;
            let Some(stream) = inner.streams.get_mut(&stream_id) else {
                continue;
            };
            if stream.inflight.is_none() {
                stream.inflight = Some(Delivery {
                    id: delivery_id,
                    packet: Arc::clone(&packet),
                    served: false,
                });
                ready.push(ResourceReady {
                    stream_id,
                    delivery_id,
                });
            } else {
                stream.pending = Some(Arc::clone(&packet));
            }
            inner.queued_bytes += packet.len();
            accepted = true;
        }
        (accepted, ready)
    }

    pub fn read(&self, stream_id: &str, delivery_id: u64) -> Result<Vec<u8>, ResourceFailure> {
        let mut inner = self
            .inner
            .lock()
            .map_err(|_| ResourceFailure::Unavailable)?;
        let stream = inner
            .streams
            .get_mut(stream_id)
            .ok_or(ResourceFailure::NotFound)?;
        let delivery = stream.inflight.as_mut().ok_or(ResourceFailure::NotFound)?;
        if delivery.id != delivery_id || delivery.served {
            return Err(ResourceFailure::NotFound);
        }
        delivery.served = true;
        Ok(delivery.packet.to_vec())
    }

    pub fn acknowledge(
        &self,
        stream_id: &str,
        delivery_id: u64,
        received: bool,
    ) -> Option<ResourceReady> {
        let Ok(mut inner) = self.inner.lock() else {
            return None;
        };
        let Some(stream) = inner.streams.get_mut(stream_id) else {
            return None;
        };
        let Some(delivery) = stream.inflight.as_ref() else {
            return None;
        };
        if delivery.id != delivery_id {
            return None;
        }
        let released = stream_bytes(stream);
        stream.inflight = None;
        let next = if received {
            stream.pending.take().map(|packet| {
                let next_id = self.next_delivery_id.fetch_add(1, Ordering::Relaxed) + 1;
                stream.inflight = Some(Delivery {
                    id: next_id,
                    packet,
                    served: false,
                });
                ResourceReady {
                    stream_id: stream_id.to_string(),
                    delivery_id: next_id,
                }
            })
        } else {
            stream.paused = true;
            stream.pending = None;
            stream.inflight = None;
            None
        };
        let remaining = stream_bytes(stream);
        inner.queued_bytes = inner
            .queued_bytes
            .saturating_sub(released)
            .saturating_add(remaining);
        next
    }

    #[cfg(test)]
    fn queued_bytes(&self) -> usize {
        self.inner
            .lock()
            .map(|inner| inner.queued_bytes)
            .unwrap_or_default()
    }
}

fn stream_bytes(stream: &Stream) -> usize {
    stream
        .inflight
        .as_ref()
        .map_or(0, |delivery| delivery.packet.len())
        + stream.pending.as_ref().map_or(0, |packet| packet.len())
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum ResourceFailure {
    NotFound,
    Unavailable,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_one_inflight_and_only_the_latest_pending_packet() {
        let broker = FrameBroker::default();
        let stream_id = broker.open(Some("session-a".into())).expect("stream opens");
        let (accepted, first) = broker.publish(Some("session-a"), Arc::from([1_u8, 2]));
        assert!(accepted);
        assert_eq!(first.len(), 1);
        let first_id = first[0].delivery_id;
        assert!(broker.publish(Some("session-a"), Arc::from([3_u8, 4, 5])).0);
        assert!(broker.publish(Some("session-a"), Arc::from([6_u8])).0);
        assert_eq!(broker.queued_bytes(), 3);

        assert_eq!(broker.read(&stream_id, first_id).expect("one read"), [1, 2]);
        assert_eq!(
            broker.read(&stream_id, first_id),
            Err(ResourceFailure::NotFound)
        );
        let next = broker
            .acknowledge(&stream_id, first_id, true)
            .expect("latest is promoted");
        assert_eq!(
            broker
                .read(&stream_id, next.delivery_id)
                .expect("latest packet"),
            [6]
        );
        assert_eq!(broker.queued_bytes(), 1);
    }

    #[test]
    fn failure_pauses_and_releases_the_entire_stream() {
        let broker = FrameBroker::default();
        let stream_id = broker.open(Some("session-a".into())).expect("stream opens");
        let (_, first) = broker.publish(Some("session-a"), Arc::from([1_u8, 2]));
        broker.publish(Some("session-a"), Arc::from([3_u8, 4]));
        broker.acknowledge(&stream_id, first[0].delivery_id, false);
        assert_eq!(broker.queued_bytes(), 0);
        assert!(!broker.has_interest(Some("session-a")));
        assert!(!broker.publish(Some("session-a"), Arc::from([5_u8])).0);
    }

    #[test]
    fn successful_ack_releases_the_last_packet_and_allows_the_next_publish() {
        let broker = FrameBroker::default();
        let stream_id = broker.open(None).expect("stream opens");
        let (_, first) = broker.publish(None, Arc::from([1_u8]));
        assert_eq!(
            broker
                .read(&stream_id, first[0].delivery_id)
                .expect("one read"),
            [1]
        );
        assert_eq!(
            broker.acknowledge(&stream_id, first[0].delivery_id, true),
            None
        );
        assert_eq!(broker.queued_bytes(), 0);
        let (accepted, next) = broker.publish(None, Arc::from([2_u8]));
        assert!(accepted);
        assert_eq!(next.len(), 1);
        assert_eq!(
            broker
                .read(&stream_id, next[0].delivery_id)
                .expect("next read"),
            [2]
        );
    }

    #[test]
    fn caps_queued_bytes_globally_and_releases_them_on_close() {
        let broker = FrameBroker::default();
        let first_stream = broker.open(None).expect("first stream opens");
        let second_stream = broker.open(None).expect("second stream opens");
        let packet = Arc::<[u8]>::from(vec![0_u8; MAX_PACKET_BYTES]);
        assert!(broker.publish(None, Arc::clone(&packet)).0);
        assert_eq!(broker.queued_bytes(), 2 * MAX_PACKET_BYTES);
        assert!(!broker.publish(None, packet).0);
        assert!(broker.queued_bytes() <= MAX_QUEUED_BYTES);
        broker.close(&first_stream);
        broker.close(&second_stream);
        assert_eq!(broker.queued_bytes(), 0);
    }

    #[test]
    fn stale_ack_cannot_release_the_current_delivery() {
        let broker = FrameBroker::default();
        let stream_id = broker.open(Some("session-a".into())).expect("stream opens");
        let (_, first) = broker.publish(Some("session-a"), Arc::from([1_u8]));
        assert_eq!(
            broker.acknowledge(&stream_id, first[0].delivery_id + 1, true),
            None
        );
        assert_eq!(broker.queued_bytes(), 1);
    }
}
