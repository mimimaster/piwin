---
name: videogen
description: Generate short videos from text or an image reference with a configured video model.
hidden: true
---

# Video Generation Skill

Use the `video_gen` host tool when the user asks for a generated video, an
image to be animated, or a short text-to-video clip.

## How to use `video_gen`

Call `video_gen` with a detailed `prompt`. The tool routes by the optional
`model` id to a configured provider, creates the provider's asynchronous task,
polls it until it completes, downloads the result, and saves it under piwin's
media store. It returns an absolute local path and a media attachment, never a
base64 blob or an expiring provider URL.

Optional arguments include `durationSeconds`, `aspectRatio`, `size`,
`resolution`, and `inputImagePath`. When animating an existing generated or
uploaded image, pass its absolute media path through `inputImagePath`; do not
paste the path into the prompt text.

Video generation can take several minutes. While the task is running, the
conversation shows an animated waiting card. If the provider fails, report the
error and do not claim that a video was created.

## When unavailable

If `video_gen` is missing or reports that no video model is configured, tell the
user to add a video-capable model under Settings → Image & Video Generation.
