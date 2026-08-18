---
name: imagegen
description: Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when the agent should create a brand-new image or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.
hidden: true
version: 2
---

# Image Generation

## Goal
Bitmap image asset(s) on disk under the piwin media store that match the user’s visual intent.

## Done means
- `image_gen` called with a specific prompt (subject, style, composition, palette; size/aspect when it matters).
- Tool returns media attachments the client already previews. Do not embed markdown images or local file paths in the follow-up text.
- For cutouts: chroma-key/solid background noted; alpha validated when transparency matters.

## Stop when
- Deliverable is better as SVG/vector, existing icon system, or HTML/CSS/canvas — do not use this skill.
- `image_gen` missing or “no default image model” — tell user to configure Settings → Image Generation; no curl/base64 workarounds.
- User needed image **editing** from references — not available yet; say so.

## Constraints
- Model optional; default from config. Anthropic-compatible providers have no image-generation endpoint.

## Verify
- Returned paths exist as media attachments; content matches the stated brief at a glance.
