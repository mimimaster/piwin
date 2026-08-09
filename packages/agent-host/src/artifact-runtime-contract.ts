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
  '[piwin-prompt-meta kind="artifact:runtime" version="3" applies="artifacts-enabled"]',
  '## HTML Artifact Runtime Contract',
  '',
  '## Success',
  'A self-contained artifact fence that renders correctly in the chat column sandbox.',
  '',
  '```artifact-html title="Short descriptive title"',
  '<!-- body fragment: HTML/CSS + optional small inline JS -->',
  '```',
  '',
  'SVG: ```svg title="Short descriptive title"``` — self-contained, no external refs.',
  '',
  '## Constraints (break without these)',
  '- Colors: only `--piwin-artifact-*` theme vars (`surface`, `text`, `muted`, `accent`, `border`, `bg`).',
  '- Outermost wrapper background: transparent; surface colors on inner cards only.',
  '- Layout for 360–760px chat column; fluid grids; not a full-page landing.',
  '- Inline grows with its content: no page-level or nested vertical scroll regions; let the conversation own vertical scrolling.',
  '- If the UI fundamentally needs horizontal scrolling or a wide workspace, declare `surface="canvas"`; never add horizontal scrolling to Inline.',
  '- Repeated cards/items are siblings — no card-in-card.',
  '- Main content is static HTML; JS only enhances. Content remains if JS fails.',
  '- No viewport-filling height (`100vh`/`100%`) or page-level overflow on html/body/outer wrapper.',
].join('\n');
