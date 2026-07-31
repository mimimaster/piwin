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
3. **Host tool** `image_gen` in `@piwin/agent-host`:
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
   - The chat default (`defaultProviderId`/`defaultModelId`) remains a last-resort
     fallback for backward compatibility.
   - Permission-gated as a network action (`network:image-gen`), default `ask`.
   - Saves decoded bytes via `@piwin/media` to `~/.piwin/media/<session>/` and
     returns absolute path(s) only (AGENTS.md §3.6: no base64 in context).
4. **Switch = `config.skills.disabledIds`.** Adding `imagegen` disables both the
   skill and the `image_gen` tool.
5. **Hidden from UI/CLI.** `SkillSummary.hidden` (frontmatter `hidden: true`) is
   filtered from the Desktop Skills panel and CLI skill lists, but the skill is
   still loadable by Pi when enabled.

## Consequences

- System skills can opt out of the Skills panel via `hidden` frontmatter.
- Image generation requires a configured image-capable model (openai-compatible
  or google-gemini) in Settings → Providers.
- Anthropic-compatible providers cannot generate images (clear error).
- Image editing via `/images/edits` is a documented follow-up, not shipped here.
- CLI and Desktop share the same host tool and switch; no CLI degradation.
