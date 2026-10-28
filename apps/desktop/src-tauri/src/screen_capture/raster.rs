//! Raw screen pixels to PNG, for backends that do not get a file from the OS
//! (Windows GDI), and PNG back to a clipboard DIB. Kept platform-neutral so
//! it is unit-tested everywhere.

const BITMAP_INFO_HEADER_SIZE: u32 = 40;

/// Top-down 32-bit BGRA rows (GDI `BI_RGB` layout, alpha ignored) to RGB PNG.
pub(super) fn encode_bgra_png(width: u32, height: u32, bgra: &[u8]) -> Result<Vec<u8>, String> {
    let expected = width as usize * height as usize * 4;
    if width == 0 || height == 0 || bgra.len() != expected {
        return Err(format!(
            "pixel buffer is {} bytes, expected {expected} for {width}x{height}",
            bgra.len()
        ));
    }
    let rgb: Vec<u8> = bgra
        .chunks_exact(4)
        .flat_map(|pixel| [pixel[2], pixel[1], pixel[0]])
        .collect();
    let mut png_bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut png_bytes, width, height);
        encoder.set_color(png::ColorType::Rgb);
        encoder.set_depth(png::BitDepth::Eight);
        // Screens are large and the composer recompresses anyway (SC-F01).
        encoder.set_compression(png::Compression::Fast);
        let mut writer = encoder.write_header().map_err(|error| error.to_string())?;
        writer
            .write_image_data(&rgb)
            .map_err(|error| error.to_string())?;
    }
    Ok(png_bytes)
}

/// PNG to a packed `CF_DIB` block: a `BITMAPINFOHEADER` followed by
/// bottom-up 32-bit BGRA rows (`BI_RGB`, so readers treat alpha as padding).
pub(super) fn png_to_dib(png_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut decoder = png::Decoder::new(std::io::Cursor::new(png_bytes));
    decoder.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = decoder.read_info().map_err(|error| error.to_string())?;
    let size = reader
        .output_buffer_size()
        .ok_or_else(|| "PNG is too large to decode".to_string())?;
    let mut pixels = vec![0; size];
    let info = reader
        .next_frame(&mut pixels)
        .map_err(|error| error.to_string())?;
    let channels = match info.color_type {
        png::ColorType::Grayscale => 1,
        png::ColorType::GrayscaleAlpha => 2,
        png::ColorType::Rgb => 3,
        png::ColorType::Rgba => 4,
        png::ColorType::Indexed => return Err("indexed PNG was not expanded".to_string()),
    };
    let width = info.width as usize;
    let height = info.height as usize;
    let image_size = width * height * 4;
    let mut dib = Vec::with_capacity(BITMAP_INFO_HEADER_SIZE as usize + image_size);
    dib.extend_from_slice(&BITMAP_INFO_HEADER_SIZE.to_le_bytes());
    dib.extend_from_slice(&(info.width as i32).to_le_bytes());
    // Positive height: rows are stored bottom-up, which every reader accepts.
    dib.extend_from_slice(&(info.height as i32).to_le_bytes());
    dib.extend_from_slice(&1u16.to_le_bytes()); // planes
    dib.extend_from_slice(&32u16.to_le_bytes()); // bits per pixel
    dib.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    dib.extend_from_slice(&(image_size as u32).to_le_bytes());
    dib.extend_from_slice(&[0; 16]); // resolution and palette counts
    for row in (0..height).rev() {
        let line = &pixels[row * info.line_size..row * info.line_size + width * channels];
        for pixel in line.chunks_exact(channels) {
            let (red, green, blue, alpha) = match channels {
                1 => (pixel[0], pixel[0], pixel[0], 255),
                2 => (pixel[0], pixel[0], pixel[0], pixel[1]),
                3 => (pixel[0], pixel[1], pixel[2], 255),
                _ => (pixel[0], pixel[1], pixel[2], pixel[3]),
            };
            dib.extend_from_slice(&[blue, green, red, alpha]);
        }
    }
    Ok(dib)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_bgra_as_rgb_png() {
        // One blue, one red pixel in BGRA order.
        let bgra = [255, 0, 0, 0, 0, 0, 255, 0];
        let bytes = encode_bgra_png(2, 1, &bgra).unwrap();
        let decoder = png::Decoder::new(std::io::Cursor::new(bytes));
        let mut reader = decoder.read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let info = reader.next_frame(&mut pixels).unwrap();
        assert_eq!((info.width, info.height), (2, 1));
        assert_eq!(info.color_type, png::ColorType::Rgb);
        assert_eq!(&pixels[..6], &[0, 0, 255, 255, 0, 0]);
    }

    #[test]
    fn png_becomes_a_bottom_up_bgra_dib() {
        // Top row blue, bottom row red (BGRA input to the encoder).
        let bgra = [255, 0, 0, 0, 0, 0, 255, 0];
        let png_bytes = encode_bgra_png(1, 2, &bgra).unwrap();
        let dib = png_to_dib(&png_bytes).unwrap();
        assert_eq!(&dib[0..4], &40u32.to_le_bytes());
        assert_eq!(&dib[4..8], &1i32.to_le_bytes());
        assert_eq!(&dib[8..12], &2i32.to_le_bytes());
        assert_eq!(&dib[14..16], &32u16.to_le_bytes());
        assert_eq!(dib.len(), 40 + 2 * 4);
        // First stored row is the bottom (red) one.
        assert_eq!(&dib[40..44], &[0, 0, 255, 255]);
        assert_eq!(&dib[44..48], &[255, 0, 0, 255]);
    }

    #[test]
    fn rejects_bytes_that_are_not_png() {
        assert!(png_to_dib(b"nope").is_err());
    }

    #[test]
    fn rejects_a_short_buffer() {
        assert!(encode_bgra_png(2, 2, &[0; 8]).is_err());
        assert!(encode_bgra_png(0, 1, &[]).is_err());
    }
}
