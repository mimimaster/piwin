# Pet overlay transparency and visibility plan

Date: 2026-08-09

## Problem

- The active `null-signal` atlas has a real alpha channel and no blue cell
  background. The captured blue rectangle is exactly the rendered Canvas cell
  (72 × 78 CSS px at 2× capture scale) and tints the sprite itself, which is the
  WebKit drag-selection highlight rather than an atlas pixel.
- The native overlay already exposes `pet_overlay_show` and
  `pet_overlay_hide`, but the Desktop has no user-facing visibility control and
  startup always re-shows the window.

## Decision

1. Keep the existing Canvas renderer and source assets unchanged.
2. Prevent selection/drag highlighting at the dedicated overlay boundary with
   WebKit-compatible CSS and a cancelled default mouse-down on the sprite.
3. Add one close control over the sprite. It is invisible until hover or
   keyboard focus and invokes the existing native hide command.
4. Persist this Desktop-only presentation preference in localStorage. The Pets
   settings page uses the shared UI-kit `Switch` to hide or restore the overlay.
5. Create the native overlay hidden at process startup; its lightweight page
   applies the saved preference after loading. This avoids re-showing a pet the
   user hid and avoids a startup flash.

The close control remains a native button inside the dedicated cosmetic entry:
pulling Mantine/UI-kit into this otherwise minimal WebContent page would undo
the overlay memory isolation. Settings still uses the public UI-kit primitive.

## Verification

- Unit coverage for visibility preference parsing/events.
- Component coverage for the hover close action and overlay command wiring.
- Dedicated-entry boundary test keeps the overlay independent of the main
  Desktop composition root.
- Desktop typecheck/tests and Rust format/check/tests for touched boundaries.

## Landed status

- [x] Canvas selection highlighting is prevented in CSS and at the overlay
  mouse-down boundary.
- [x] A hover/focus close button hides the pet without raising the main window.
- [x] Settings → Pets exposes a shared UI-kit visibility switch.
- [x] Visibility persists across process restarts; the native window starts
  hidden and the ready overlay page restores the saved value.
- [x] Workspace typecheck and Desktop production build pass.
- [x] Focused Desktop tests pass: 5 files / 19 tests.
- [x] Rust format/check and all 14 Rust tests pass. The existing
  `pending_request_count` dead-code warning is unrelated.

The full Desktop suite passes 164 files / 1,026 tests and stops on the same four
pre-existing failures in unmodified `resolve-document-content.test.ts`. No pet,
overlay, icon-policy, or dedicated-entry test fails. The production overlay
remains small: 14.91 kB JS and 4.94 kB CSS, with a 1.09 kB visibility helper
shared with Settings.
