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
