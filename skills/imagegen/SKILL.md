---
name: imagegen
description: Generate or edit raster images when the task benefits from AI-created bitmap visuals such as photos, illustrations, textures, sprites, mockups, or transparent-background cutouts. Use when the agent should create a brand-new image or derive visual variants from references, and the output should be a bitmap asset rather than repo-native code or vector. Do not use when the task is better handled by editing existing SVG/vector/code-native assets, extending an established icon or logo system, or building the visual directly in HTML/CSS/canvas.
hidden: true
---

# Image Generation Skill

Generate raster images for the current project (website assets, game assets, UI
mockups, product shots, wireframes, logo drafts, photorealistic images,
infographics, or transparent-background cutouts).

## When to use

Use the `image_gen` tool when a deliverable benefits from AI-created bitmap
visuals. Examples:

- A hero image or cover for a web page
- Game sprites or textures
- UI mockups and product mockups
- Icon drafts (then refine to a final SVG/icon system if the project needs it)
- Concept art for a feature

Do **not** use it for:

- Editing existing SVG / vector / code-native assets
- Extending an established icon or logo system
- Visuals that are better expressed in HTML/CSS/canvas or inline SVG

## How to use `image_gen`

Call the host tool `image_gen` with a detailed `prompt`. The tool:

1. Routes by `model` name (optional) to the configured provider; without it,
   uses the configured default model. Image-capable models are managed under
   Settings → Image Generation; per-model image request paths and timeouts can
   be configured there, with protocol defaults used when they are unset.
2. Saves the generated image under the piwin media store and returns an
   **absolute path** — never a base64 blob.
3. Returns `{ "paths": [ ... ], "mimeType", "byteSize" }`.

### Prompting guidance

- Be specific about subject, style, composition, and palette.
- State dimensions or aspect ratio when it matters (e.g. `1024x1024`, `1:1`).
- For transparent-background cutouts, ask the model to render the subject on a
  flat solid chroma-key background and note that true native transparency is
  not guaranteed — validate the alpha channel after generation.

## When the tool is unavailable

If `image_gen` is missing or errors with "no default image model configured":

- Tell the user: image generation is enabled but no image-capable model is
  configured. They should add an image model in Settings → Image Generation
  (e.g. an OpenAI-compatible provider with a `gpt-image-*` model, or Google
  Gemini with an `imagen-*` model).
- Do not fall back to ad-hoc curl scripts or base64-in-context workarounds.

## Known limitations

- Image editing (reference-image workflows) is a documented follow-up and is
  not yet available; `image_gen` currently supports prompt-based generation
  only.
- Anthropic-compatible providers do not expose an image-generation endpoint.
