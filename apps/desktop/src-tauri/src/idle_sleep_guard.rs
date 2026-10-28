//! Keeps the Mac awake while Piwin Desktop runs.
//!
//! Phones and other shells reach the local Host over LAN/Tailscale. Idle
//! system sleep stops the Host and drops those connections, so the desktop
//! holds a `PreventUserIdleSystemSleep` power assertion for its whole
//! lifetime (same mechanism remote-desktop tools use). Display sleep and the
//! lock screen are unaffected; manual sleep and lid close still sleep.
//!
//! powerd releases the assertion automatically when the process exits or
//! crashes, so there is no teardown path to get wrong.

/// Owns the assertion; dropping it releases the hold.
pub struct IdleSleepGuard {
    #[cfg(target_os = "macos")]
    assertion_id: u32,
}

#[cfg(target_os = "macos")]
mod iokit {
    use std::ffi::c_void;

    /// `kIOPMAssertionLevelOn`.
    pub const ASSERTION_LEVEL_ON: u32 = 255;
    pub const ASSERTION_TYPE: &str = "PreventUserIdleSystemSleep";
    /// Shown by `pmset -g assertions` so users can see who keeps the Mac awake.
    pub const ASSERTION_NAME: &str = "Piwin keeps the Host reachable from other devices";

    #[link(name = "IOKit", kind = "framework")]
    extern "C" {
        pub fn IOPMAssertionCreateWithName(
            assertion_type: *const c_void,
            assertion_level: u32,
            assertion_name: *const c_void,
            assertion_id: *mut u32,
        ) -> i32;
        pub fn IOPMAssertionRelease(assertion_id: u32) -> i32;
    }
}

impl IdleSleepGuard {
    /// Acquire the hold. Returns `None` (after logging) when the platform has
    /// no support or IOKit refuses; Piwin keeps working, it just may sleep.
    #[cfg(target_os = "macos")]
    pub fn acquire() -> Option<Self> {
        use objc2_foundation::NSString;

        // NSString is toll-free bridged to CFStringRef.
        let assertion_type = NSString::from_str(iokit::ASSERTION_TYPE);
        let assertion_name = NSString::from_str(iokit::ASSERTION_NAME);
        let mut assertion_id: u32 = 0;
        // SAFETY: both strings outlive the call; IOKit copies them.
        let status = unsafe {
            iokit::IOPMAssertionCreateWithName(
                (&*assertion_type as *const NSString).cast(),
                iokit::ASSERTION_LEVEL_ON,
                (&*assertion_name as *const NSString).cast(),
                &mut assertion_id,
            )
        };
        if status != 0 {
            eprintln!("[idle-sleep-guard] IOPMAssertionCreateWithName failed: {status:#x}");
            return None;
        }
        Some(Self { assertion_id })
    }

    #[cfg(not(target_os = "macos"))]
    pub fn acquire() -> Option<Self> {
        None
    }
}

impl Drop for IdleSleepGuard {
    fn drop(&mut self) {
        #[cfg(target_os = "macos")]
        {
            // SAFETY: the id came from a successful create and is released once.
            let status = unsafe { iokit::IOPMAssertionRelease(self.assertion_id) };
            if status != 0 {
                eprintln!("[idle-sleep-guard] IOPMAssertionRelease failed: {status:#x}");
            }
        }
    }
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::IdleSleepGuard;

    #[test]
    fn acquires_and_releases_a_power_assertion() {
        let guard = IdleSleepGuard::acquire().expect("IOKit should grant the assertion");
        assert_ne!(guard.assertion_id, 0);
        drop(guard);
    }
}
