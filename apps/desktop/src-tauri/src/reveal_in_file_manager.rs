use std::path::Path;
use std::process::Command;

/// Reveal a path in Finder / Explorer / the system file manager.
///
/// `plugin-shell` `open` only allows http(s)/mailto/tel by default, so it
/// cannot open local folders. This stays desktop-local (not Host): a remote
/// Host must not open a file manager on the Host machine.
#[tauri::command]
pub fn reveal_in_file_manager(path: String) -> Result<(), String> {
    reveal_path(&path)
}

/// True when `path` exists on this Desktop machine (not the remote Host).
#[tauri::command]
pub fn path_exists_locally(path: String) -> bool {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return false;
    }
    Path::new(trimmed).exists()
}

/// Open a `.md` or `.txt` system prompt file in the user's default OS editor.
/// Refuses directories, missing files, and any non-`.md`/`.txt` extension.
#[tauri::command]
pub fn open_prompt_file_in_editor(path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("invalid path".into());
    }
    let target = Path::new(trimmed);
    let ext = target
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase());
    match ext.as_deref() {
        Some("md") | Some("txt") => {}
        _ => return Err("only .md and .txt files can be opened in editor".into()),
    }
    if !target.is_file() {
        return Err("prompt file does not exist".into());
    }

    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("open");
        command.arg(trimmed);
        return run(command);
    }

    #[cfg(target_os = "windows")]
    {
        let native = trimmed.replace('/', "\\");
        let _ = Command::new("explorer").arg(&native).status();
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let mut command = Command::new("xdg-open");
        command.arg(trimmed);
        return run(command);
    }
}

fn reveal_path(path: &str) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() || trimmed.contains('\0') {
        return Err("invalid path".into());
    }

    #[cfg(target_os = "macos")]
    {
        if Path::new(trimmed).exists() {
            let mut command = Command::new("open");
            command.arg("-R").arg(trimmed);
            return run(command);
        }
        let mut command = Command::new("open");
        command.arg(parent_directory_of(trimmed));
        return run(command);
    }

    #[cfg(target_os = "windows")]
    {
        let native = trimmed.replace('/', "\\");
        if Path::new(&native).exists() {
            // explorer returns a non-zero code even when the window opens.
            let _ = Command::new("explorer")
                .arg(format!("/select,{native}"))
                .status();
            return Ok(());
        }
        let _ = Command::new("explorer")
            .arg(parent_directory_of(&native))
            .status();
        return Ok(());
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let target = if Path::new(trimmed).is_dir() {
            trimmed.to_string()
        } else {
            parent_directory_of(trimmed)
        };
        let mut command = Command::new("xdg-open");
        command.arg(target);
        return run(command);
    }
}

fn parent_directory_of(path: &str) -> String {
    Path::new(path)
        .parent()
        .map(|parent| parent.to_string_lossy().into_owned())
        .filter(|parent| !parent.is_empty())
        .unwrap_or_else(|| path.to_string())
}

#[cfg(not(target_os = "windows"))]
fn run(mut command: Command) -> Result<(), String> {
    let status = command.status().map_err(|error| error.to_string())?;
    if status.success() {
        Ok(())
    } else {
        Err(format!("file manager exited with {status}"))
    }
}
