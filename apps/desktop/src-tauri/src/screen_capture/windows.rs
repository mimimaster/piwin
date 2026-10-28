//! Windows capture (spec SC-D03): a GDI copy of the whole monitor under the
//! cursor. The region is picked afterwards on the capture overlay, which
//! covers that same monitor.
//!
//! Tauri marks the process per-monitor DPI aware, so monitor rectangles and
//! the copied bitmap are both in physical pixels.

use std::ffi::c_void;

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleBitmap, CreateCompatibleDC, DeleteDC, DeleteObject, GetDC, GetDIBits,
    GetMonitorInfoW, MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HBITMAP, HDC, HGDIOBJ, MONITORINFO,
    MONITOR_DEFAULTTOPRIMARY, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetForegroundWindow, SetForegroundWindow,
};

use super::overlay::{MonitorShot, OverlayBounds};
use super::raster::encode_bgra_png;

struct ScreenRect {
    left: i32,
    top: i32,
    width: i32,
    height: i32,
}

/// PNG of the monitor the pointer is on (the primary one if that fails).
pub(super) fn capture_cursor_monitor() -> Result<MonitorShot, String> {
    let rect = cursor_monitor_rect()?;
    let bgra = copy_screen_rect(&rect)?;
    let png = encode_bgra_png(rect.width as u32, rect.height as u32, &bgra)?;
    Ok(MonitorShot {
        png,
        bounds: OverlayBounds::Physical {
            x: rect.left,
            y: rect.top,
            width: rect.width as u32,
            height: rect.height as u32,
        },
    })
}

/// The window in front before the capture, as a raw handle value (HWND is
/// not `Send`). Zero when there is none.
pub(super) fn foreground_window() -> isize {
    // SAFETY: argument-less query.
    unsafe { GetForegroundWindow() }.0 as isize
}

/// Hands focus back after the overlay took it. piwin is the foreground
/// process at this point, so Windows allows the switch.
pub(super) fn restore_foreground_window(handle: isize) {
    if handle == 0 {
        return;
    }
    // SAFETY: a stale handle is rejected by the call, not undefined behaviour.
    let _ = unsafe { SetForegroundWindow(HWND(handle as *mut c_void)) };
}

fn cursor_monitor_rect() -> Result<ScreenRect, String> {
    let mut cursor = POINT::default();
    // SAFETY: GetCursorPos writes one POINT into a valid local.
    if unsafe { GetCursorPos(&mut cursor) }.is_err() {
        cursor = POINT::default();
    }
    // SAFETY: MonitorFromPoint takes the point by value; with
    // MONITOR_DEFAULTTOPRIMARY it always returns a monitor handle.
    let monitor = unsafe { MonitorFromPoint(cursor, MONITOR_DEFAULTTOPRIMARY) };
    let mut info = MONITORINFO {
        cbSize: std::mem::size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    // SAFETY: `info.cbSize` is set as the API requires; the struct outlives the call.
    if !unsafe { GetMonitorInfoW(monitor, &mut info) }.as_bool() {
        return Err("GetMonitorInfoW failed".to_string());
    }
    let bounds = info.rcMonitor;
    let width = bounds.right - bounds.left;
    let height = bounds.bottom - bounds.top;
    if width <= 0 || height <= 0 {
        return Err(format!("monitor has an empty rectangle {width}x{height}"));
    }
    Ok(ScreenRect {
        left: bounds.left,
        top: bounds.top,
        width,
        height,
    })
}

/// Releases the GDI objects of one copy in reverse order, on every path.
struct GdiCopy {
    screen: HDC,
    memory: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
}

impl Drop for GdiCopy {
    fn drop(&mut self) {
        // SAFETY: each handle was created by `copy_screen_rect` and is released once.
        unsafe {
            if !self.previous.is_invalid() {
                SelectObject(self.memory, self.previous);
            }
            if !self.bitmap.is_invalid() {
                let _ = DeleteObject(self.bitmap.into());
            }
            if !self.memory.is_invalid() {
                let _ = DeleteDC(self.memory);
            }
            ReleaseDC(None, self.screen);
        }
    }
}

/// Top-down BGRA pixels of a rectangle in virtual-screen coordinates.
fn copy_screen_rect(rect: &ScreenRect) -> Result<Vec<u8>, String> {
    // SAFETY: GDI calls on handles owned by `copy`, which releases them on drop.
    unsafe {
        let screen = GetDC(None);
        if screen.is_invalid() {
            return Err("GetDC failed".to_string());
        }
        let mut copy = GdiCopy {
            screen,
            memory: HDC::default(),
            bitmap: HBITMAP::default(),
            previous: HGDIOBJ::default(),
        };
        copy.memory = CreateCompatibleDC(Some(screen));
        copy.bitmap = CreateCompatibleBitmap(screen, rect.width, rect.height);
        if copy.memory.is_invalid() || copy.bitmap.is_invalid() {
            return Err("could not allocate a GDI bitmap".to_string());
        }
        copy.previous = SelectObject(copy.memory, copy.bitmap.into());
        // CAPTUREBLT includes layered (translucent) windows in the copy.
        BitBlt(
            copy.memory,
            0,
            0,
            rect.width,
            rect.height,
            Some(screen),
            rect.left,
            rect.top,
            SRCCOPY | CAPTUREBLT,
        )
        .map_err(|error| format!("BitBlt failed: {error}"))?;
        // GetDIBits requires the bitmap not to be selected into any DC.
        SelectObject(copy.memory, copy.previous);
        copy.previous = HGDIOBJ::default();

        let mut info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: rect.width,
                // Negative height asks for top-down rows.
                biHeight: -rect.height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut pixels = vec![0u8; rect.width as usize * rect.height as usize * 4];
        let lines = GetDIBits(
            copy.screen,
            copy.bitmap,
            0,
            rect.height as u32,
            Some(pixels.as_mut_ptr().cast::<c_void>()),
            &mut info,
            DIB_RGB_COLORS,
        );
        if lines != rect.height {
            return Err(format!("GetDIBits copied {lines} of {} rows", rect.height));
        }
        Ok(pixels)
    }
}
