# ADR 0021: Image generation as a skill (deprecates imagegen-MCP)

## Status

Accepted (2026-07-31)

## Context

The earlier imagegen-MCP approach (an MCP server exposing image generation) had
a poor design fit: it split configuration between an MCP server and piwin's
provider model, could not reuse piwin's permission/media/path-injection
discipline, and duplicated the `imagegen` skill already shipped by Codex/Claude
as a skill. We want image generation as a first-class piwin skill: feature-gated,
reusing `config.providers` (routed by model name), hidden from the UI skill list,
and saving outputs through `@piwin/media`.

## Decision

1. **Deprecate imagegen-MCP.** No `mcp.json` entry, no MCP server dependency.
   The capability is delivered as a bundled skill + host tool.
2. **Bundled skill** `skills/imagegen/SKILL.md` with frontmatter `hidden: true`.
   It guides when/how to use the `image_gen` host tool.
3. **Host tool** `image_gen` in `@piwin/host-runtime` (exposed to Pi through the
   injected Host tool port; `@piwin/agent-host` remains the Pi-only boundary):
   - Routes by **model name**; `ModelConfigEntry` has `capabilities` (including
     `'image-generation'`) and `routes` for per-capability request paths and
     timeouts.
   - `callImageEndpoint` reads `model.routes['image-generation'].path`, using
     protocol defaults as the fallback (`openai-compatible` →
     `POST {baseUrl}/images/generations`; `google-gemini` (imagen) →
     `{baseUrl}/models/{model}:predict`; `anthropic-compatible` → unsupported
     error). The configured `timeoutMs` is also used when present.
   - `PiwinConfig.imageGeneration.defaultModel` is the image-generation default,
     independent from the chat default.
   - The Desktop provides an `image-generation` settings section for configuring
     image-capable models, the image-generation default, and route settings.
   - The chat default (`defaultProviderId`/`defaultModelId`) is not an image
     fallback. When no image default exists, Host uses the first enabled image
     model in provider/config order so `image_gen` stays callable. An explicit
     image default still wins when set.
   - Permission-gated as a network action (`network:image-gen`), default `ask`.
   - Normalizes every provider output item, detects PNG/JPEG/WebP/GIF from magic
     bytes, and saves every image via `@piwin/media` to
     `~/.piwin/media/<session>/`. It returns absolute path(s), per-image metadata,
     and structured `MediaAttachmentRef` values for the product transcript/UI.
     The model-facing output is a delivery receipt (`status`, counts, media ids,
     notice) without filesystem paths. Absolute paths stay in `details` for the
     Host/UI. Base64 is never placed in context (AGENTS.md §3.6).
   - Settings exposes a real endpoint smoke test (`models/image-test`) that uses
     the same adapter as `image_gen` and discards the returned bytes.
4. **`image_gen` is not skill-toggled.** Registration follows configured
   image-capable models, not `config.skills.disabledIds`.
5. **Listed as built-in.** Bundled skills (including `imagegen`) appear on the
   Skills page / CLI list as 应用内置. They cannot be disabled or uninstalled.
   Only `source: user` skills can be toggled or deleted.

## Consequences

- System skills can opt out of the Skills panel via `hidden` frontmatter.
- Image generation requires a configured image-capable model (openai-compatible
  or google-gemini) in Settings → Image Generation.
- Anthropic-compatible providers cannot generate images (clear error).
- Image editing via `/images/edits` is a documented follow-up, not shipped here.
- CLI and Desktop share the same host tool; no CLI degradation.

## 2026-08-10 amendment

The detailed selection, response-normalization, multi-image, MIME-detection, and
Settings smoke-test behavior is specified in
`docs/specs/image-generation-call-flow-v3.md`.

## 2026-08-18 amendment

Model-facing `output` no longer includes absolute media paths. The product UI
owns generated-image presentation via `details.attachments`. The earlier
"path-based output" wording meant "do not put bytes in context", not "the
model must re-deliver the file path to the user".

## 2026-09-12 amendment

`image_gen` is registered whenever at least one enabled image-capable model
exists. A missing image default no longer hides the tool. Resolution order is
explicit `provider`/`model` args, then `imageGeneration.defaultModel`, then the
first enabled image model. Chat defaults are still not an image fallback.
Bundled skills stay listed as 应用内置 with no enable switch; leftover
`disabledIds` entries for those ids are ignored.
