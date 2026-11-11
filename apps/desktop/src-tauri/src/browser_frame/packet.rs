use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;

const MAGIC: [u8; 4] = *b"PBF1";
const VERSION: u16 = 1;
const PREFIX_BYTES: usize = 8;
const MAX_HEADER_BYTES: usize = 4 * 1024;
const MAX_PACKET_BYTES: usize = 12 * 1024 * 1024;
const MAX_DECODE_PIXELS: u64 = 16_000_000;
const JPEG_DATA_URL_PREFIX: &str = "data:image/jpeg;base64,";

#[derive(Debug, PartialEq, Eq)]
pub(super) enum PacketError {
    InvalidHeader,
    InvalidDataUrl,
    InvalidBase64,
    Oversized,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FrameHeader<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    session_id: Option<&'a str>,
    version: u16,
    frame_id: &'a str,
    generation: u64,
    page_id: &'a str,
    document_revision: u64,
    width: u64,
    height: u64,
    encoded_width: u64,
    encoded_height: u64,
    byte_length: usize,
    mime: &'static str,
    presentation: FramePresentation<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FramePresentation<'a> {
    ts: u64,
    source_dpr: f64,
    quality: u64,
    producer: &'a str,
}

fn read_u64(value: &Value, field: &str) -> Result<u64, PacketError> {
    value
        .get(field)
        .and_then(Value::as_u64)
        .filter(|number| *number > 0 || field == "generation" || field == "documentRevision")
        .ok_or(PacketError::InvalidHeader)
}

pub(super) fn encode_inline_frame(frame: &Value) -> Result<Vec<u8>, PacketError> {
    let session_id = frame
        .get("sessionId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty());
    if frame
        .get("sessionId")
        .is_some_and(|value| value.as_str().is_none_or(str::is_empty))
    {
        return Err(PacketError::InvalidHeader);
    }
    let frame_id = frame
        .get("frameId")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or(PacketError::InvalidHeader)?;
    let page_id = frame
        .get("pageId")
        .and_then(Value::as_str)
        .ok_or(PacketError::InvalidHeader)?;
    let payload = frame.get("payload").ok_or(PacketError::InvalidHeader)?;
    let data_url = payload
        .get("dataUrl")
        .and_then(Value::as_str)
        .ok_or(PacketError::InvalidDataUrl)?
        .trim();
    let base64 = data_url
        .strip_prefix(JPEG_DATA_URL_PREFIX)
        .filter(|value| !value.is_empty())
        .ok_or(PacketError::InvalidDataUrl)?;
    if base64.len() > ((MAX_PACKET_BYTES - PREFIX_BYTES - MAX_HEADER_BYTES) / 3) * 4 + 4 {
        return Err(PacketError::Oversized);
    }
    let jpeg = STANDARD
        .decode(base64)
        .map_err(|_| PacketError::InvalidBase64)?;
    let generation = read_u64(frame, "generation")?;
    let document_revision = read_u64(frame, "documentRevision")?;
    let width = read_u64(frame, "width")?;
    let height = read_u64(frame, "height")?;
    let encoded_width = read_u64(frame, "encodedWidth")?;
    let encoded_height = read_u64(frame, "encodedHeight")?;
    if encoded_width.saturating_mul(encoded_height) > MAX_DECODE_PIXELS {
        return Err(PacketError::Oversized);
    }
    let ts = frame
        .get("ts")
        .and_then(Value::as_u64)
        .ok_or(PacketError::InvalidHeader)?;
    let source_dpr = frame
        .get("sourceDpr")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value > 0.0)
        .ok_or(PacketError::InvalidHeader)?;
    let quality = frame
        .get("quality")
        .and_then(Value::as_u64)
        .filter(|value| *value <= 100)
        .ok_or(PacketError::InvalidHeader)?;
    let producer = frame
        .get("producer")
        .and_then(Value::as_str)
        .filter(|value| matches!(*value, "screencast" | "screenshot-fallback"))
        .ok_or(PacketError::InvalidHeader)?;

    let header = FrameHeader {
        session_id,
        version: VERSION,
        frame_id,
        generation,
        page_id,
        document_revision,
        width,
        height,
        encoded_width,
        encoded_height,
        byte_length: jpeg.len(),
        mime: "image/jpeg",
        presentation: FramePresentation {
            ts,
            source_dpr,
            quality,
            producer,
        },
    };
    let header = serde_json::to_vec(&header).map_err(|_| PacketError::InvalidHeader)?;
    if header.is_empty() || header.len() > MAX_HEADER_BYTES {
        return Err(PacketError::InvalidHeader);
    }
    let packet_length = PREFIX_BYTES + header.len() + jpeg.len();
    if packet_length > MAX_PACKET_BYTES {
        return Err(PacketError::Oversized);
    }

    let mut packet = Vec::with_capacity(packet_length);
    packet.extend_from_slice(&MAGIC);
    packet.extend_from_slice(&VERSION.to_be_bytes());
    packet.extend_from_slice(&(header.len() as u16).to_be_bytes());
    packet.extend_from_slice(&header);
    packet.extend_from_slice(&jpeg);
    Ok(packet)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn encodes_the_existing_pbf1_contract_from_inline_jpeg() {
        let frame = json!({
            "type": "browser/frame",
            "ts": 1, "sourceDpr": 2, "quality": 80, "producer": "screencast",
            "sessionId": "session-a",
            "frameId": "7",
            "generation": 2,
            "pageId": "page-current",
            "documentRevision": 5,
            "width": 1280,
            "height": 800,
            "encodedWidth": 1280,
            "encodedHeight": 800,
            "payload": { "kind": "inline", "dataUrl": "data:image/jpeg;base64,/9j/2Q==" }
        });

        let packet = encode_inline_frame(&frame).expect("valid local frame");
        assert_eq!(&packet[..4], b"PBF1");
        assert_eq!(u16::from_be_bytes([packet[4], packet[5]]), 1);
        let header_length = usize::from(u16::from_be_bytes([packet[6], packet[7]]));
        let header: Value =
            serde_json::from_slice(&packet[PREFIX_BYTES..PREFIX_BYTES + header_length])
                .expect("valid JSON header");
        assert_eq!(header["sessionId"], "session-a");
        assert_eq!(header["generation"], 2);
        assert_eq!(header["pageId"], "page-current");
        assert_eq!(header["documentRevision"], 5);
        assert_eq!(header["presentation"]["sourceDpr"], 2.0);
        assert_eq!(header["presentation"]["producer"], "screencast");
        assert_eq!(
            &packet[PREFIX_BYTES + header_length..],
            &[0xff, 0xd8, 0xff, 0xd9]
        );
    }

    #[test]
    fn rejects_invalid_data_urls_and_excessive_decode_dimensions() {
        let base = json!({
            "sessionId": "session-a", "frameId": "7", "generation": 2,
            "pageId": "page-current", "documentRevision": 5,
            "width": 1280, "height": 800, "encodedWidth": 1280,
            "encodedHeight": 800, "payload": { "kind": "inline", "dataUrl": "bad" }
        });
        assert_eq!(encode_inline_frame(&base), Err(PacketError::InvalidDataUrl));
        let huge = json!({
            "sessionId": "session-a", "frameId": "7", "generation": 2,
            "pageId": "page-current", "documentRevision": 5,
            "width": 1280, "height": 800, "encodedWidth": 16_000_001,
            "encodedHeight": 1, "payload": { "kind": "inline", "dataUrl": "data:image/jpeg;base64,/9j/2Q==" }
        });
        assert_eq!(encode_inline_frame(&huge), Err(PacketError::Oversized));
    }
}
