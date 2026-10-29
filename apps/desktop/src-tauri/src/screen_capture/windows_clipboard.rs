//! Windows clipboard write for the finished screenshot: `CF_DIB` for every
//! app, plus the registered "PNG" format that Office, browsers and chat apps
//! prefer because it keeps the exact pixels.

use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_DIB;

use super::raster::png_to_dib;

/// Closes the clipboard on every path once it is open.
struct OpenedClipboard;

impl Drop for OpenedClipboard {
    fn drop(&mut self) {
        // SAFETY: only constructed after OpenClipboard succeeded on this thread.
        let _ = unsafe { CloseClipboard() };
    }
}

pub(crate) fn copy_png_to_clipboard(png: &[u8]) -> Result<(), String> {
    let dib = png_to_dib(png)?;
    // SAFETY: clipboard calls run between a successful open and the guard's close.
    unsafe {
        OpenClipboard(None).map_err(|error| format!("OpenClipboard failed: {error}"))?;
        let _opened = OpenedClipboard;
        EmptyClipboard().map_err(|error| format!("EmptyClipboard failed: {error}"))?;
        set_clipboard_bytes(u32::from(CF_DIB.0), &dib)?;
        let png_format = RegisterClipboardFormatW(w!("PNG"));
        if png_format != 0 {
            if let Err(error) = set_clipboard_bytes(png_format, png) {
                eprintln!("[piwin] screenshot PNG clipboard format skipped: {error}");
            }
        }
    }
    Ok(())
}

/// Copies `bytes` into a movable global block and hands it to the clipboard,
/// which owns the block from then on.
///
/// # Safety
/// The clipboard must be open on this thread.
unsafe fn set_clipboard_bytes(format: u32, bytes: &[u8]) -> Result<(), String> {
    let block: HGLOBAL = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }
        .map_err(|error| format!("GlobalAlloc failed: {error}"))?;
    let target = unsafe { GlobalLock(block) };
    if target.is_null() {
        let _ = unsafe { GlobalFree(Some(block)) };
        return Err("GlobalLock failed".to_string());
    }
    // SAFETY: the block is at least `bytes.len()` long and locked for writing.
    unsafe { std::ptr::copy_nonoverlapping(bytes.as_ptr(), target.cast::<u8>(), bytes.len()) };
    // Unlock "fails" with NO_ERROR once the lock count reaches zero; not an error here.
    let _ = unsafe { GlobalUnlock(block) };
    if let Err(error) = unsafe { SetClipboardData(format, Some(HANDLE(block.0))) } {
        let _ = unsafe { GlobalFree(Some(block)) };
        return Err(format!("SetClipboardData failed: {error}"));
    }
    Ok(())
}
