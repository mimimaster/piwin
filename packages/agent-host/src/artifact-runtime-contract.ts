/**
 * Fixed artifact runtime contract injected alongside the configurable
 * decision prompt. This covers output format, theme variables, layout
 * constraints, and sandbox rules that must always be present regardless
 * of the user's custom decision prompt.
 *
 * See: docs/guides/artifact-prompt.md (canonical source)
 * See: ADR 0029 (artifact surface routing)
 */

/**
 * The runtime contract is always injected when artifacts are enabled.
 * It is NOT configurable through settings — only the decision policy
 * (when to use artifacts, inline vs canvas) is configurable.
 */
export const ARTIFACT_RUNTIME_CONTRACT = [
  '## HTML Artifact Runtime Contract',
  '',
  'When producing an artifact, output a fenced code block:',
  '',
  '```artifact-html title="Short descriptive title"',
  '<!-- self-contained HTML/CSS and optional small inline JS, body fragment only -->',
  '```',
  '',
  'Rules:',
  '',
  '1. **Theme variables**: Use theme CSS variables (prefix `--piwin-artifact-`) for all colors.',
  '   Example: `background: var(--piwin-artifact-surface); color: var(--piwin-artifact-text);`',
  '   Common roles: `surface` (cards/panels), `text` (text), `muted` (secondary text),',
  '   `accent` (buttons/links), `border` (borders), `bg` (background).',
  '',
  '2. **Transparent root container**: The outermost wrapper (`.piwin-artifact-root`)',
  '   background must be transparent. Only inner cards/panels use',
  '   `var(--piwin-artifact-surface)` or `var(--piwin-artifact-bg)`.',
  '',
  '3. **Narrow column layout**: Design for 360-760px chat column width, not browser viewport.',
  '   Use fluid grids (e.g. `repeat(auto-fit, minmax(min(100%, 10rem), 1fr))`),',
  '   not fixed column counts or pixel widths. Do not output full-page landing pages.',
  '',
  '4. **Nesting defense**: Repeated cards/items must be sibling elements.',
  '   Never nest a card inside another card.',
  '',
  '5. **Static HTML before JS**: Main content must be static HTML.',
  '   JS only enhances (filter/collapse/copy/count). If JS fails, content must remain visible.',
  '',
  '6. **Embedded layout**: Artifacts display in the chat column, not as standalone web pages.',
  '   - Do not use `height/min-height: 100vh/100dvh/100svh/100lvh` on `html`, `body`, or outermost wrapper.',
  '   - Do not use fixed height or `height: 100%` on `html`, `body`, or outermost wrapper.',
  '   - Do not use `overflow: hidden/auto/scroll` on `html`, `body`, or outermost wrapper.',
  '   - Let main content use normal document flow; `overflow` only for local collapsible panels.',
  '',
  '7. **SVG artifacts**: Output SVG using a fenced code block:',
  '   ```svg title="Short descriptive title"',
  '   <!-- self-contained SVG markup -->',
  '   ```',
  '   SVG must be self-contained with no external references.',
  '',
].join('\n');
