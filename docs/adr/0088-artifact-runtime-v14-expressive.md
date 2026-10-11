# ADR 0088: Artifact runtime v14 — extended tokens, style modes, artifact kit

- **Status**: Accepted
- **Date**: 2026-10-12
- **Scope**: `@piwin/contracts`, `@piwin/artifact`, `@piwin/host-runtime`, `apps/desktop`
- **Consults**: ADR 0005, ADR 0029
- **Design**: `~/piwin-artifact-design/design.md` (product owner approved, 2026-10-11)

## Context

Artifacts under runtime contract v13 had seven theme variables and a strict
"flat, quiet" tone. Results looked uniform and grey, and the model had no
sanctioned way to draw status, charts or depth. Fences carry no marker of
which rules they were written for, so any rendering change would repaint old
sessions.

## Decision

1. **Rules marker.** Runtime v14 requires `style="host" | "expressive"` on
   every fence. A fence with `style` renders under v14 rules; a fence without
   it is `legacy` and keeps v13 rendering (`resolveArtifactRules`). Old
   sessions never repaint.
2. **Vocabulary.** v14 adds `surface-2 subtle border-strong ok warn risk info
   accent-2 series-1…6 shadow-1/2 radius-sm/lg font-mono`. Desktop maps them
   from the active theme's Deck ramp (`artifact-theme-map.ts`); a theme may
   override each under `ThemeManifest.artifact`. Any caller that supplies only
   the base seven gets derived fallbacks (`theme-tokens.ts`), so a token is
   never undefined. No serif/display font token.
3. **on-accent.** v14 artifacts get the theme-authored ink
   (`artifact.onAccent ?? deck.onIris`); legacy keeps the luminance-derived
   ink. The host-only input `--piwin-artifact-on-accent-themed` is never
   emitted as CSS.
4. **Report kit v2.** For v14 fences only: tones read the status tokens,
   `info` tone, stat tiles take `shadow-1`, titles gain weight.
5. **Prompts.** Runtime prompt v14, decision prompt v11. Net resident cost is
   neutral (conversation static estimate 2572 → 2570 tokens).
6. **Capability gate.** The resident prompt is compiled once per runtime
   generation and shared by every shell, so it cannot be versioned per
   client. Instead the shell advertises `PromptInput.artifactKit`
   (`ARTIFACT_KIT_VERSION = 1`). When a turn carries an artifact rendering
   hint (width or host theme) but no `artifactKit >= 1`, Host prefixes a
   `[piwin-artifact-legacy-client]` turn block telling the model to keep to
   the v13 vocabulary, omit `style`, and draw charts as inline SVG. CLI/TUI
   turns carry no hint and get nothing. The flag is stripped before the
   input is persisted.

## Consequences

- An expressive fence renders under host guard CSS until the per-mode guard
  lands (later phase of the same design).
- The conversation token-budget test (CHT-803, limit 2500) was already red on
  `main` (2572); v14 does not change that and does not raise the limit.
- Theme packages need no change; overrides are optional.

## Viewer (P2)

7. **Fullscreen, no pop-out.** Inline and Canvas artifacts open in a fixed
   overlay portaled into the main window (`ArtifactFullscreenOverlay`). The
   frame remounts in Canvas mode on its own bridge channel
   (`<id>:fullscreen`); Esc always exits and focus returns to the opener.
8. **Inline → Canvas.** “Open in Canvas” promotes the same fence (same target
   id) to the Canvas surface; the Inline copy stays, so the Canvas frame uses
   channel `<id>:canvas`.
9. **32px Canvas toolbar**, always visible: title + `Canvas · <style>`, width
   presets (fit/760/390, fullscreen adds 1200), preview theme
   (follow/paper/ink; repaints only that frame, never persisted), fullscreen,
   code, download (moved from the floating button). Keys: F, Esc, 1–4, T;
   ⌘⇧O on an Inline artifact's actions. The mobile shell shows fullscreen only.

## Kit v1 (P3)

10. **Primitives.** `<i data-piwin-icon>` (59 line icons generated from
    `@piwin/ui-kit` plus a few drawn on the same grid) and
    `<figure data-piwin-chart="bar|line|donut|spark">` with a JSON spec, plus
    `piwin.chart/icon/hydrate/version`. Labels are text nodes; colors accept
    only `var(--piwin-artifact-*)`; no eval, fetch or `parent`. `window.piwin`
    is frozen. Charts redraw on container resize; streamed markup hydrates via
    a MutationObserver. 21.5 KB raw / 6.6 KB gzip.
11. **Delivery.** Packaged shells: `piwin-artifact://localhost/lib/v1/kit.js`
    (Windows `http://piwin-artifact.localhost/...`), compiled into the binary
    with `include_bytes!`, fixed allowlist, GET only, main webview only,
    `immutable` cache. The document CSP gains only
    `script-src … <origin>/lib/v1/`; `connect-src 'none'` is unchanged.
    Browser/e2e builds inline the same bytes. Injected only when the source
    uses the kit (and for v14 stream previews). Kit CSS is always inline.
    Kit artifacts always take the sandbox renderer.
12. **Prompt.** The resident contract carries one pointer line (+~80 tokens
    on the conversation estimate, 2570 → 2650; CHT-803 was already red). The
    full reference (icon names, chart options, API) is returned by
    `artifact_instructions`, whose description now says to call it only for
    that reference.
13. **Deviations from the design.** Icons are embedded in `kit.js` (a separate
    `icons.json` would need `connect-src`); kit CSS is inline (no `style-src`
    change); the kit major version follows the rules version (v14 → kit v1)
    rather than a separate descriptor field. WebKit verification that
    subresource loads from the scheme grant the frame no IPC is still owed on
    a packaged build.
