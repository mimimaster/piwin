use std::path::Path;

fn user_path(path: &str) -> Result<&Path, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("invalid path".into());
    }
    Ok(Path::new(trimmed))
}

/// Copy an existing local file to the path the user picked in Save As.
#[tauri::command]
pub fn copy_local_file(source: String, destination: String) -> Result<(), String> {
    let from = user_path(&source)?;
    let to = user_path(&destination)?;
    if !from.is_file() {
        return Err("source is not a file".into());
    }
    std::fs::copy(from, to).map_err(|error| error.to_string())?;
    Ok(())
}

/// Write renderer-held bytes to the path the user picked in Save As.
#[tauri::command]
pub fn write_saved_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    let dest = user_path(&path)?;
    std::fs::write(dest, contents).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{copy_local_file, user_path, write_saved_file};
    use std::fs;

    #[test]
    fn rejects_empty_and_nul_paths() {
        assert!(user_path("").is_err());
        assert!(user_path("   ").is_err());
        assert!(user_path("a\0b").is_err());
    }

    #[test]
    fn copies_and_writes_under_temp() {
        let dir = std::env::temp_dir().join(format!("piwin-save-as-{}", std::process::id()));
        fs::create_dir_all(&dir).expect("temp dir");
        let source = dir.join("src.bin");
        let copied = dir.join("copy.bin");
        let written = dir.join("written.bin");
        fs::write(&source, b"hello").expect("source");

        copy_local_file(
            source.to_string_lossy().into_owned(),
            copied.to_string_lossy().into_owned(),
        )
        .expect("copy");
        assert_eq!(fs::read(&copied).expect("read copy"), b"hello");

        write_saved_file(written.to_string_lossy().into_owned(), b"pixels".to_vec()).expect("write");
        assert_eq!(fs::read(&written).expect("read write"), b"pixels");

        let _ = fs::remove_dir_all(&dir);
    }
}
