//! Host command resolution (ADR 0017 two-tier spawn): packaged sidecar
//! first, pnpm/tsx against the workspace checkout otherwise.

use super::*;

/// How the host process was resolved (ADR 0017 two-tier spawn).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum HostCommandTier {
    /// Packaged sidecar: bundled Node + host-serve.mjs under resources.
    Packaged,
    /// Dev: pnpm/tsx against the workspace checkout (unchanged).
    Dev,
}

/// Optional filesystem layout for the packaged tier (unit-testable without Tauri).
#[derive(Debug, Clone)]
pub(super) struct PackagedHostPaths {
    pub node_bin: PathBuf,
    pub host_js: PathBuf,
    pub bundled_assets: PathBuf,
    pub cwd: PathBuf,
}

/// Pure resolution decision used by spawn and unit tests.
pub(super) fn resolve_host_command_tiered(
    mock: bool,
    packaged: Option<&PackagedHostPaths>,
) -> Result<(String, Vec<String>, HostCommandTier, Option<PathBuf>), String> {
    if let Some(paths) = packaged {
        if paths.node_bin.is_file() && paths.host_js.is_file() {
            let mut args = vec![
                paths.host_js.to_string_lossy().into_owned(),
                "host".to_string(),
                "serve".to_string(),
                "--mode".to_string(),
                "sdk".to_string(),
            ];
            if mock {
                args.push("--mock".to_string());
            }
            let assets = if paths.bundled_assets.is_dir() {
                Some(paths.bundled_assets.clone())
            } else {
                None
            };
            return Ok((
                paths.node_bin.to_string_lossy().into_owned(),
                args,
                HostCommandTier::Packaged,
                assets,
            ));
        }
    }

    let pnpm = which("pnpm").unwrap_or_else(|| "pnpm".to_string());
    let mut args = vec![
        "--filter".to_string(),
        "@piwin/cli".to_string(),
        "exec".to_string(),
        "tsx".to_string(),
        "src/index.ts".to_string(),
        "host".to_string(),
        "serve".to_string(),
        "--mode".to_string(),
        "sdk".to_string(),
    ];
    if mock {
        args.push("--mock".to_string());
    }

    Ok((pnpm, args, HostCommandTier::Dev, None))
}

pub(super) fn detect_host_triple() -> String {
    let arch = std::env::consts::ARCH;
    let os = std::env::consts::OS;
    match (os, arch) {
        ("macos", "aarch64") => "aarch64-apple-darwin".to_string(),
        ("macos", "x86_64") => "x86_64-apple-darwin".to_string(),
        ("linux", "x86_64") => "x86_64-unknown-linux-gnu".to_string(),
        ("linux", "aarch64") => "aarch64-unknown-linux-gnu".to_string(),
        ("windows", "x86_64") => "x86_64-pc-windows-msvc".to_string(),
        _ => format!("{arch}-unknown-{os}"),
    }
}

pub(super) fn find_sidecar_node(resource_dir: &std::path::Path) -> Option<PathBuf> {
    let triple = detect_host_triple();
    let exe_name = if cfg!(windows) {
        "piwin-host.exe"
    } else {
        "piwin-host"
    };
    let triple_name = if cfg!(windows) {
        format!("piwin-host-{triple}.exe")
    } else {
        format!("piwin-host-{triple}")
    };

    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(exe_name));
            candidates.push(dir.join(&triple_name));
        }
    }
    candidates.push(resource_dir.join(exe_name));
    candidates.push(resource_dir.join(&triple_name));
    // Dev packaging dry-run: binaries next to Cargo.toml.
    // `packaged_host_paths_from_resource_dir` guards against placeholder
    // host-serve.mjs stubs, so this candidate is safe in dev too.
    let manifest_binaries = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    candidates.push(manifest_binaries.join(&triple_name));
    candidates.push(manifest_binaries.join(exe_name));

    candidates.into_iter().find(|path| path.is_file())
}

pub(super) fn packaged_host_paths_from_resource_dir(
    resource_dir: &std::path::Path,
) -> Option<PackagedHostPaths> {
    let host_js = resource_dir.join("host").join("host-serve.mjs");
    let node_bin = find_sidecar_node(resource_dir)?;
    if !host_js.is_file() {
        return None;
    }
    // Reject placeholder stubs created by `ensure-packaging-placeholders`.
    // The real bundled host-serve.mjs is several KB; the placeholder is ~65
    // bytes. Without this guard, dev builds spawn Node on an empty file and
    // the sidecar exits immediately.
    if let Ok(metadata) = std::fs::metadata(&host_js) {
        if metadata.len() < 200 {
            return None;
        }
    }
    Some(PackagedHostPaths {
        node_bin,
        host_js: host_js.clone(),
        bundled_assets: resource_dir.join("host").join("bundled-assets"),
        cwd: resource_dir.join("host"),
    })
}

pub(super) fn resolve_host_command(
    mock: bool,
    resource_dir: Option<PathBuf>,
) -> Result<
    (
        String,
        Vec<String>,
        HostCommandTier,
        Option<PathBuf>,
        PathBuf,
    ),
    String,
> {
    // Development must execute the workspace Host source. Tauri copies resource
    // files into its debug target and those copies can outlive a source change;
    // preferring them here made real-provider E2E exercise a stale Host bundle.
    // Release builds continue to require and prefer the packaged sidecar.
    let packaged = if cfg!(debug_assertions) {
        None
    } else {
        resource_dir
            .as_ref()
            .and_then(|dir| packaged_host_paths_from_resource_dir(dir))
    };
    let (program, args, tier, assets) = resolve_host_command_tiered(mock, packaged.as_ref())?;

    let cwd = match (&tier, packaged) {
        (HostCommandTier::Packaged, Some(paths)) => paths.cwd,
        _ => {
            let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
            manifest_dir
                .join("../../..")
                .canonicalize()
                .map_err(|error| format!("resolve repo root: {error}"))?
        }
    };

    Ok((program, args, tier, assets, cwd))
}

pub(super) fn which(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    for candidate in [
        format!("/opt/homebrew/bin/{bin}"),
        format!("/usr/local/bin/{bin}"),
        format!(
            "{}/.local/share/pnpm/{bin}",
            std::env::var("HOME").unwrap_or_default()
        ),
    ] {
        if PathBuf::from(&candidate).is_file() {
            return Some(candidate);
        }
    }
    None
}
