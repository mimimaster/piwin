# Studio workspace override

This page family uses the persisted Piwin Studio master for spacing, low
motion, accessibility, and responsive behavior. It overrides the generated
marketing palette, editorial Swiss layout, and display typography so the
workspaces stay a native part of the Piwin appearance system.

## Direction

These pages are a **quiet utility library**, not a marketing surface.

- Clicking 资料库 or 闪卡 is a **full-window jump**. The workbench sidebar,
  titleband, inspector, and chat stage disappear. Back (or Escape) returns
  to the session. Do not keep a second Library / Flashcards switcher on the
  page itself.
- Library chrome copies the reference page: large title left, pill search
  center, New right. Type tabs sit on the second row with sort / grid /
  list. Flashcards keeps the compact toolbar. Back is an icon beside the
  title. Type tabs and deck chips never sit in the scroll body.
- Artwork and card questions are the visual weight. Metadata stays compact
  in the tile and expands in the inspector (lightbox / study) when needed.

## Overrides

- Use existing semantic theme tokens only: `surface-*`, `text-*`, `line-*`,
  `iris`, `mint`, and `coral`. Do not hardcode generated palettes.
- Use the configured Piwin system font. Do not fetch Google Fonts.
- Studio is two destinations: Library and Flashcards. Library opens on
  Images, with text tabs for Images / Videos. Grid tiles are large, square,
  and rounded (image only at rest). List is name / modified / size. Delete
  stays on the tile. Prompt and model live in the in-page preview. Library
  has no composer; New returns to chat to generate.
- Flashcards: question-only cards; deck chips; produce is a page jump into
  the existing Knowledge Center folder loop (project list + index + generate).
  Study is a full-window flip, not a boxed dialog. Flashcards has no composer.
- Secondary text uses `text-2`. `text-3` is labels and metadata. `text-4` is
  nonessential decoration only.
- Keep destructive actions visible in document flow. Do not rely on hover.
- Media and study details trap focus and restore it on close.
- No emoji as icons. No inspiration-prompt chips. No glow empty states.
