# ADR 0090: Emoji rendered as Tabler icons (desktop surfaces)

- **Status**: Accepted
- **Date**: 2026-10-14
- **Scope**: `packages/artifact` (`src/emoji-icons/`, `srcdoc.ts`), `apps/desktop`
  (`MarkdownView.tsx`, `enhanced-markdown-streamdown.tsx`, `ArtifactStatic.tsx`,
  `rehype-emoji-icons.ts`, `scripts/emit-emoji-icon-glyphs.ts`)

## Context

Models use emoji as icons (🔑 🔒 🕵️ ✅ ⚠️). They are text, so the OS draws
them with its color emoji font (Apple Color Emoji, Segoe UI Emoji, Noto).
Those bitmap stickers clash with the thin `currentColor` line UI, cannot take
theme colors and look different on every platform. Prompting the model to
avoid emoji costs every turn, fails on other models and does not fix history.

## Decision

1. **Replace at render time, not in the prompt.** A static table
   (`emoji-icon-map.ts`, ~436 emoji → ~290 Tabler outline names) maps
   icon-like emoji. Emoji not in the table keep the system glyph; a wrong icon
   is worse than a colorful one.
2. **Only what would render as color emoji.** Lookup folds U+FE0F/FE0E,
   skin tones and ZWJ sequences (👩‍💻 → `user-code`), but only characters with
   emoji presentation (or explicit FE0F) are replaced: ↗ © ™ and bare ⚠ stay
   text; FE0E always stays text.
3. **Glyphs are generated, not fetched.** `emit-emoji-icon-glyphs.ts` exports
   only the mapped icons from `@tabler/icons` into
   `emoji-icon-glyphs.generated.ts` (~65 KB, structured nodes) and fails on
   unknown names. No network, CSP unchanged.
4. **One shape, three surfaces.** Each icon is
   `span.piwin-emoji-icon > svg[aria-hidden] + span.piwin-emoji-icon-text`:
   1em, `stroke: currentColor`, with the original emoji kept as invisible
   text so copy/paste and screen readers still get the character.
   - Chat/doc Markdown: `rehypeEmojiIcons` runs after Streamdown's default
     rehype plugins (after sanitize) and skips `code`, `pre`, `svg`, math and
     KaTeX. Its sizing sheet is a runtime `<style>` in the app head, so it
     carries the host style nonce (`readHostStyleNonce`): the packaged Tauri
     CSP adds a nonce to `style-src`, which disables `'unsafe-inline'`, and an
     unstamped sheet is dropped — every icon then fills the column width.
   - Static artifacts (Shadow DOM): one `replaceEmojiIconsInTree` pass after
     the sanitized `innerHTML`.
   - Sandboxed iframe artifacts: `srcdoc.ts` injects an inline style + script
     that replaces text nodes and keeps doing so via `MutationObserver`
     (covers stream updates). Finished artifacts inline only the glyphs their
     source uses; stream previews (`freezeSource: false`) ship the full table.
5. **CLI/TUI keep emoji.** The terminal renders cells of text; there is no
   inline vector graphics path in pi-tui / xterm that would stay aligned to
   the cell grid, and terminal emoji already follow the user's terminal font.
   Replacing them with ASCII or Nerd Font glyphs would change meaning and
   width calculations, so CLI output is left untouched.

## Consequences

- Icons follow theme color and text size; the color emoji look is gone for
  mapped emoji (intended).
- The map is data with unit tests; extending it means adding an entry and
  re-running the generator.
- Mobile Markdown is not wired yet.
