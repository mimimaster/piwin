# ADR 0005: Markdown default + HTML artifact port + path-based images

## Status

Accepted (2026-07-19)

## Context

Need Claude-like artifacts and Codex-like image UX without unsafe ad-hoc iframes. Local `openwebui_m` already has a rigorous HTML artifact stack.

## Decision

1. Default chat rendering = **Markdown**
2. HTML artifact runtime = **port pure logic** from `openwebui_m` into `@piwin/artifact`
3. Images: preview in chat; paste saves under `~/.piwin/media/...`; text models receive **absolute path** by default
4. **Coding-agent phase policy (2026-07-25 amendment):**
   - While an assistant message is **streaming**, render safe Markdown only: incomplete fences stay source, Mermaid does not execute, and Artifact iframes are not mounted.
   - When a message is **completed**, normal code fences remain source-first with copy affordances.
   - An HTML/UI Artifact is **source-first** and only mounts an iframe after an explicit user **Preview artifact** action (or an explicit-artifact-review mode), and only when security classification allows it.
   - Thinking/tool work uses timeline/cards, not Artifacts.

## Consequences

- Extra package boundary (`artifact`, `media`)
- Must invest in tests for security classifier
- Vision multipart is optional later, not default
- Ordinary coding turns stay legible and cheap to stream; Artifacts remain deliberate interactive deliverables

## Amendment (2026-07-30): Artifact preview opt-in on Desktop

- Desktop chat now defaults to **Markdown + ordinary code fences**. The heavy
  HTML Artifact path (sandbox iframe + bridge) is **opt-in** via a single
  Appearance preference `artifactPreviewEnabled` (default `false`,
  localStorage `piwin.desktop.artifactPreviewEnabled`).
- When the preference is off, `evaluateCodeFence` still runs with
  `htmlUiModeEnabled: false` so language/source normalization stays
  byte-stable; native `html`/`htm` fences fall through to `code`. No Preview
  button, no iframe.
- When the preference is on, the existing source-first + per-fence
  `Preview artifact` behavior is preserved. Streaming remains source-only.
- **Flashcard exception:** a fence whose source contains `data-card-id="..."`
  gets a one-click **Preview card** even when the global preference is off,
  so interactive rating stays usable without hunting settings. This does
  not flip the global preference.
- Host config `artifact.htmlUiModeDefault` default lowered from `true` to
  `false` for consistency. Desktop v1 ignores it (R1); the field remains as
  a backward-compat seed for non-Desktop clients.
- `artifact.maxBytes` is now wired from `PiwinConfig.artifact` into
  `evaluateCodeFence` on Desktop.
- Future Cherry-style **light** fence renderers (svg, html-preview, …) are
  reserved for a separate fence registry and are NOT gated by this switch.
- See `docs/superpowers/specs/2026-07-30-artifact-preview-opt-in-design.md`
  for the full design.

## Amendment (2026-07-31): SVG fences use the heavy Artifact path

- Desktop recognizes valid-root `svg` fences as `SvgArtifactDescriptor` values when `artifactPreviewEnabled` is on.
- SVG preview reuses the existing sandbox iframe, strict CSP, external-resource classifier, theme contract, height bridge, and init queue; it is not inserted into the parent chat document.
- Capability-off and streaming behavior remain source-only.
- A separate light/native SVG renderer with pan/zoom is still deferred and must not share the heavy Artifact switch implicitly.
