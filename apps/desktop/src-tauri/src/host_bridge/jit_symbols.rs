//! V8 JIT symbol map for Host hang diagnostics.
//!
//! The Host watchdog samples a blocked main thread with macOS `sample`, but
//! JIT-compiled JavaScript shows up there only as `???` addresses. V8 can write
//! an address → function map (`perf-<pid>.map`), and the watchdog uses it to
//! name the stuck function. V8 only records code compiled after the flag is
//! set, and the flag cannot be turned on at runtime, so it is a launch flag.

use std::path::{Path, PathBuf};

use super::HostCommandTier;

/// Must match `hostJitSymbolsDirectory` in `apps/cli/src/host-jit-symbols.ts`.
pub(super) fn jit_symbols_directory(piwin_root: &Path) -> PathBuf {
    piwin_root.join("diagnostics").join("jit-symbols")
}

/// Node flags that make V8 write the symbol map into `directory`.
pub(super) fn jit_symbol_node_args(directory: &Path) -> Option<Vec<String>> {
    // A lossy path would point V8 at a directory that does not exist.
    let directory = directory.to_str()?;
    Some(vec![
        "--perf-basic-prof-only-functions".to_string(),
        format!("--perf-basic-prof-path={directory}"),
        // Without this, interpreted (not yet optimized) functions all share one
        // trampoline address and cannot be told apart.
        "--interpreted-frames-native-stack".to_string(),
    ])
}

/// Prepend the symbol-map flags to a packaged macOS Host command. Node flags
/// must come before the script path. Other tiers and platforms are returned
/// unchanged: dev runs through pnpm/tsx, and only macOS has the sampler.
pub(super) fn with_jit_symbol_args(
    args: Vec<String>,
    tier: HostCommandTier,
    piwin_root: Option<&Path>,
) -> Vec<String> {
    if !cfg!(target_os = "macos") || tier != HostCommandTier::Packaged {
        return args;
    }
    let Some(root) = piwin_root else {
        return args;
    };
    let directory = jit_symbols_directory(root);
    // V8 silently writes nothing when the directory is missing.
    if std::fs::create_dir_all(&directory).is_err() {
        return args;
    }
    let Some(mut flags) = jit_symbol_node_args(&directory) else {
        return args;
    };
    flags.extend(args);
    flags
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbol_args_point_v8_at_the_diagnostics_directory() {
        let directory = jit_symbols_directory(Path::new("/Users/a/.piwin"));
        assert_eq!(
            directory,
            PathBuf::from("/Users/a/.piwin/diagnostics/jit-symbols")
        );
        assert_eq!(
            jit_symbol_node_args(&directory).unwrap(),
            vec![
                "--perf-basic-prof-only-functions".to_string(),
                "--perf-basic-prof-path=/Users/a/.piwin/diagnostics/jit-symbols".to_string(),
                "--interpreted-frames-native-stack".to_string(),
            ]
        );
    }

    #[test]
    fn dev_tier_and_missing_root_keep_the_command_unchanged() {
        let args = vec!["src/index.ts".to_string(), "host".to_string()];
        assert_eq!(
            with_jit_symbol_args(args.clone(), HostCommandTier::Dev, Some(Path::new("/tmp"))),
            args
        );
        assert_eq!(
            with_jit_symbol_args(args.clone(), HostCommandTier::Packaged, None),
            args
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn packaged_macos_host_gets_flags_before_the_script() {
        let root = std::env::temp_dir().join(format!("piwin-jit-symbols-{}", std::process::id()));
        let args = vec!["/app/host-serve.mjs".to_string(), "host".to_string()];
        let launched = with_jit_symbol_args(args, HostCommandTier::Packaged, Some(&root));
        assert_eq!(launched[0], "--perf-basic-prof-only-functions");
        assert_eq!(launched[3], "/app/host-serve.mjs");
        assert!(jit_symbols_directory(&root).is_dir());
        let _ = std::fs::remove_dir_all(&root);
    }
}
