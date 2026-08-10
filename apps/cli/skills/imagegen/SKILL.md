---
name: imagegen
description: Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when the agent should create a brand-new image or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.
hidden: true
version: 3
---

# Image Generation

## Goal
Bitmap image asset(s) on disk under the piwin media store that match the user’s visual intent.

## Done means
- `image_gen` called with a specific prompt (subject, style, composition, palette; size/aspect when it matters).
- Use the configured image default. Pass both `provider` and `model` only when the user asks for a particular route or model ids overlap.
- Tool returns every generated image as absolute `paths`, per-image metadata, and media attachments — never base64-in-context.
- For cutouts: chroma-key/solid background noted; alpha validated when transparency matters.

## Stop when
- Deliverable is better as SVG/vector, existing icon system, or HTML/CSS/canvas — do not use this skill.
- `image_gen` missing or “no default image model” — tell user to configure Settings → Image Generation; no curl/base64 workarounds.
- User needed image **editing** from references — not available yet; say so.

## Constraints
- `n` is optional and limited to 1–4. Do not request variants the user did not ask for because each image may incur cost.
- Model optional; default comes only from Image Generation settings, never the chat default. Anthropic-compatible providers have no image-generation endpoint.

## Verify
- Every returned path exists as a media attachment; file extension and MIME metadata agree; content matches the stated brief at a glance.
