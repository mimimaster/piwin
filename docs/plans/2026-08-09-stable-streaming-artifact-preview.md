# Stable streaming Artifact preview

## Goal

Render model-generated HTML/SVG progressively without reloading the sandboxed iframe for every token. Keep ordinary text streaming normally, reveal Artifact UI at structurally safe boundaries, and remove the permanent inline title bar.

## Design

1. Reuse `buildStreamableArtifactPreview` as the only stream sanitizer. It exposes only complete tags, complete `<style>` blocks, and safe trailing text; unfinished tags and scripts stay hidden.
2. A stream-preview decision carries the sanitized, theme/layout-repaired body snapshot in addition to the initial `srcdoc`.
3. Mount one sandboxed iframe for the streaming phase. Later snapshots use a small channel-scoped `postMessage`; the iframe reconciles attributes, child nodes, and text nodes in place. Existing nodes stay mounted, so normal text can grow without page reloads or whole-tree replacement.
4. Keep Streamdown's renderer registry stable across text deltas. Desktop theme mapping and Canvas message-origin props can create fresh but value-equivalent objects on each chat render; `MarkdownView` retains stable references while their values are equal so React does not remount the code-fence/iframe subtree for every token.
5. When generation completes, mount the normal interactive Artifact once. This is the only stream-to-final reload and restores permitted final scripts/actions.
6. Inline render frames have no permanent title/status/byte header. The existing `Show code` action becomes a top-right overlay shown only while the frame is hovered or contains keyboard focus. Activating it switches to source and expands the full code body in one action.
7. Artifact content has a host-owned no-motion policy after model styles. CSS animations/transitions and SVG declarative motion are disabled even when the model emits them. The assistant message container also skips the shell's opacity/translate entrance animation.
8. Inline Artifact frames grow to their measured content height and never own a document scrollport; the transcript remains the sole vertical scroller. A high defensive ceiling bounds forged resize messages. Content that fundamentally requires horizontal scrolling is declared as `surface="canvas"` and routed through the existing message-backed Canvas launcher instead of being squeezed into Inline.

## Constraints

- No new dependency or cross-layer service.
- Raw or unsanitized stream source is never posted into the iframe.
- Stream updates remain inside the existing sandbox/CSP and are accepted only for the iframe's channel id and parent window.
- Non-Artifact code fences, Mermaid, and math keep their existing streaming behavior.
- Surface routing remains semantic and explicit. Runtime dimensions never auto-open Canvas or rearrange the shell during generation.

## Verification

- Unit-test safe partial text/style snapshots and stream decision payloads.
- Component-test that stream rerenders reuse the same iframe/srcdoc while posting the latest snapshot.
- Component-test the real open-fence path with a newly allocated, value-equivalent theme on every delta and assert the same Artifact DOM node survives.
- Component-test that completed render chrome contains only the hover/focus action layer.
- Component-test Inline growth beyond the legacy 900px limit and surface-specific overflow policy.
- Component-test that fence metadata survives Streamdown and completed Canvas fences render a launcher while streaming Canvas remains source-only.
- Run Artifact/Desktop tests and Desktop typecheck.
