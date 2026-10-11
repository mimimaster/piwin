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
