/** Detailed authoring guidance, loaded on demand rather than on every turn. */
import { formatArtifactReportKit } from './artifact-report-kit.js';

export function formatArtifactRenderingReference(): string[] {
  return [
    '### Rendering reference',
    '- Style: default to `style="host"`. Use `style="expressive"` when the user asks for a look, prototype, game, or poster; reports and unprompted artifacts use `host`.',
    '- Colors: take every color from the `--piwin-artifact-*` vars, so the artifact follows the host theme in light and dark: `bg surface surface-2 text muted subtle accent accent-2 on-accent border border-strong`, status `ok warn info risk` (`risk` marks real problems), charts `series-1`…`series-6`. This list is the complete set. Literal hex/rgb belongs to expressive illustrations. Text uses `text`/`muted`/`subtle`/status, or `on-accent` on a solid fill; `bg` and `surface*` are backgrounds. Tint: `color-mix(in srgb, var(--piwin-artifact-<c>) 12%, transparent)`. Floating layers (sticky bar, toast, popover) use `surface`.',
    '- Inline code & tokens: neutral `color-mix(in srgb, var(--piwin-artifact-text) 8%, transparent)` background with `var(--piwin-artifact-text)` text; red tones are reserved for errors and diff deletions. Badges: muted for inactive/hidden, accent for ready/visible, amber for estimate/progress.',
    '- Host theme: follow the send-time `light`/`dark` hint in every style, expressive stages and cards included: a light host gets a light design and a dark host a dark one, unless the user asks for the opposite mode. Without a hint, theme vars cover both modes.',
    '- Host tone: flat and quiet. Whitespace and hairline `border` rules group content; a box (`surface`, `radius-sm`/`radius-lg`) is for the one thing that stands apart, and `shadow-1`/`shadow-2` belong to floating layers (sticky bar, popover, toast). Title hierarchy by size and weight in `--piwin-artifact-font`, the host font throughout; surfaces are solid and matte; labels are plain text.',
    '- Expressive: an inner stage may paint gradients, illustration, motion, large type; the outer page stays transparent; text keeps 4.5:1 and reads on light and dark hosts.',
    '- Outermost wrapper background: transparent on Inline and Canvas, because the host page shows through it; `surface` goes on inner cards. `pre`/`code` islands may keep their own dark contrast pair.',
    '- Inline layout: a fluid 360–760px chat column, sized like a message in the thread. Inline grows with its content and the conversation owns scrolling in both directions: height stays auto on html/body/outer wrapper and every block fits the column width.',
    '- Inline width: `width:100%`, `max-width:100%`, `min-width:0`, border-box sizing and container queries for stacking, readable at 360px and below. The advisory width hint describes the sending client; replay and other clients differ.',
    '- Built-ins (no network): `data-piwin-icon` icons; `data-piwin-chart="bar|hbar|line|donut|stack|spark"` charts. Icon names and chart options follow below.',
    '- Tables: wrap long data cells with `overflow-wrap: break-word`, the one wrapping property that keeps column min-content intact (`word-break` values and `overflow-wrap: anywhere` collapse a column to 1ch). Row/column labels may `white-space: nowrap` or `width: max-content`. `min-width: 0` belongs on the outer stage. Inline: stack with `@container` before wrapping labels. Canvas: dense comparisons keep label min-content and may use table `overflow-x: auto`. Dense wide comparisons belong on Canvas.',
    '- **Canvas Viewport**: the Canvas iframe is the design viewport. Root layout and the primary stage use `width: 100%` and `height: 100%` / `100dvh` of it, and extra panel width becomes scene/layout space, so the design fills the panel edge to edge. A UI that needs a wide workspace or horizontal scrolling declares `surface="canvas"`.',
    '- Repeated cards/items are siblings in one flat list.',
    '- Flex and grid rows: each direct child is one cell, and so is each bare text run. Wrap a whole sentence — its text together with its inline `code`, `b` and `a` — in a single child element (`<span>` or `<p>`), so the sentence stays on one line of flow beside the marker or icon.',
    '- Session vault images: `<img data-piwin-media="<mediaId>" alt="short label">` is the way to show them; the host resolves the id to the image.',
    '- When the user only needs to pick among generated images, the attachment cards already do that job.',
    '',
    ...formatArtifactReportKit(),
    '',
    '### Streaming & Progressive Enhancement',
    '- **CSS First**: when you write a `<style>` block, emit it complete before any visible HTML markup, so the preview has its styles from the first element.',
    '- **Incremental Streaming**: Close each visual block before starting siblings so live preview renders cleanly.',
    '- **Static First**: core content lives in static HTML and JS enhances it, so the content stays readable if JS fails.',
  ];
}
