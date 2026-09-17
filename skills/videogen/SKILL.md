---
name: videogen
description: "Generate short videos from a text prompt or an image reference with the configured video model via video_gen. Use when the user asks to make, animate, or generate a video or clip (生成视频), including image-to-video."
hidden: true
version: 3
---

# Video Generation

## Goal
A short generated video saved in piwin media storage and attached locally for the user.

## Done means
- `video_gen` called with a clear prompt (scene, motion, camera, timing, style).
- Optional: `durationSeconds`, `aspectRatio`, `size`, `resolution`, `inputImagePath` (absolute media path for image-to-video — not pasted into prompt text).
- Tool finishes provider polling and returns a media attachment the client already previews. Do not embed markdown videos or local file paths in the follow-up text.

## Stop when
- Need is video editing or long-form production — out of scope.
- Tool missing / no video model — point user to Settings → Image & Video Generation.
- Provider errors — report failure; do not claim a video exists.

## Constraints
- Generation may take minutes; waiting UI is host-owned.

## Verify
- Local media path is present only when the provider task succeeded.
