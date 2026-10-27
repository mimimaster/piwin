//! Raw screen pixels to PNG, for backends that do not get a file from the OS
//! (Windows GDI). Kept platform-neutral so it is unit-tested everywhere.

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
    fn rejects_a_short_buffer() {
        assert!(encode_bgra_png(2, 2, &[0; 8]).is_err());
        assert!(encode_bgra_png(0, 1, &[]).is_err());
    }
}
