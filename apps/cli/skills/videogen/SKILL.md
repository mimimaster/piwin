---
name: videogen
description: Generate short videos from text or an image reference with a configured video model.
hidden: true
version: 2
---

# Video Generation

## Goal
A short generated video saved in piwin media storage and attached locally for the user.

## Done means
- `video_gen` called with a clear prompt (scene, motion, camera, timing, style).
- Optional: `durationSeconds`, `aspectRatio`, `size`, `resolution`, `inputImagePath` (absolute media path for image-to-video — not pasted into prompt text).
- Tool finishes provider polling and returns a local absolute path / attachment (not base64 or expiring provider URL).

## Stop when
- Need is video editing or long-form production — out of scope.
- Tool missing / no video model — point user to Settings → Image & Video Generation.
- Provider errors — report failure; do not claim a video exists.

## Constraints
- Generation may take minutes; waiting UI is host-owned.

## Verify
- Local media path is present only when the provider task succeeded.
