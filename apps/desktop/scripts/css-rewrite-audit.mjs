/**
 * Guards the two ways a Deck stylesheet rewrite fails silently.
 *
 * A restyle must not become a re-scope: if a selector disappears, the markup
 * that used it loses its styling and nothing in review says so. And a
 * `var(--x)` naming a token that is defined nowhere simply does nothing — it
 * looks like a rule but has no effect.
 *
 * Neither shows up in a screenshot, so check them mechanically.
 *
 *   node scripts/css-rewrite-audit.mjs              # whole styles tree vs HEAD
 *   node scripts/css-rewrite-audit.mjs settings-\*  # only matching files
 *
 * Exits non-zero when a selector vanished or a token is undefined. Deliberate
 * drops (mode-specific patches the Deck token ramp now handles) belong in
 * DELIBERATE_SELECTOR_DROPS below with the reason.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const desktopRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const stylesDir = join(desktopRoot, 'src/styles');
const uiKitSrc = join(repoRoot, 'packages/ui-kit/src');
const TURN_TELEMETRY_REMOVAL_REASON =
  'per-turn metrics rail removed; detailed usage remains in Settings';

/**
 * Selectors intentionally removed by the Deck migration. Each is a
 * `data-theme-mode` / `data-theme-visual-style` patch or a hand-rolled control
 * that the mode-aware token ramp or a ui-kit primitive now covers, so
 * reinstating it would re-introduce the hardcoded color it replaced.
 */
const DELIBERATE_SELECTOR_DROPS = new Map([
  // The session row's right-hand reserve is now one constant padding instead
  // of a hover-time swap. The timestamp and the action cluster are both
  // absolutely positioned, so the hover rules only widened the padding that
  // bounds the title -- which re-truncated the title in the same frame the
  // actions faded in. The resting rule covers both states now.
  ['.session-row:hover .session-item', 'right-hand reserve is constant; no hover padding swap'],
  [
    '.session-row:focus-within .session-item',
    'right-hand reserve is constant; no hover padding swap',
  ],
  ['.search-field', 'inline sidebar search replaced by the session search dialog'],
  ['.sidebar-search-field', 'inline sidebar search replaced by the session search dialog'],
  ['.search-field:focus-within', 'inline sidebar search replaced by the session search dialog'],
  ['.search-field input', 'inline sidebar search replaced by the session search dialog'],
  [
    '.search-field input::placeholder',
    'inline sidebar search replaced by the session search dialog',
  ],
  ['.search-field .kbd', 'inline sidebar search replaced by the session search dialog'],
  [
    "html[data-theme-mode='dark'] .bubble.role-user:not(.is-conversation-bubble)",
    'token ramp is mode-aware',
  ],
  ["html[data-theme-mode='dark'] .composer-card-v2", 'token ramp is mode-aware'],
  ["html[data-theme-mode='dark'] .composer-card-v2.drop-active", 'token ramp is mode-aware'],
  ["html[data-theme-mode='light'] .repository-row.active > svg", 'unified on iris in both modes'],
  ["html[data-theme-mode='light'] .permission-detail", 'token ramp is mode-aware'],
  ["[data-theme='dark'] .permission-mode-pill.is-active", 'token ramp is mode-aware'],
  ["[data-theme='dark'] .shortcut-keycap", 'token ramp is mode-aware'],
  // The rendered-Markdown document used hard-coded slate/rose hexes plus a
  // per-face block to undo each one. The Deck ink ramp resolves per mode, so
  // the base rule now covers both and the patches would only fight it.
  ["[data-theme='dark'] .enhanced-markdown-root", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-heading.level-1", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-heading.level-2", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-heading.level-3", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-paragraph", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-hr", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-list-item", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-sub-item", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-inline-code", 'pre-Deck palette patch'],
  ["[data-theme='dark'] .enhanced-strong", 'pre-Deck palette patch'],
  ["[data-theme='light'] .enhanced-code-header", 'pre-Deck palette patch'],
  ["[data-theme='light'] .enhanced-code-block", 'pre-Deck palette patch'],
  ["[data-theme='light'] .md-doc-chip", 'pre-Deck palette patch'],
  ["[data-theme='light'] .md-doc-chip:hover", 'pre-Deck palette patch'],
  [
    "[data-theme='light'] .enhanced-line-wrapper.has-hover-highlight:hover",
    'pre-Deck palette patch',
  ],
  ["[data-theme='light'] .enhanced-line-wrapper.popover-open", 'pre-Deck palette patch'],
  ["[data-theme='light'] .enhanced-line-wrapper.has-comment", 'pre-Deck palette patch'],
  ["[data-theme='light'] .enhanced-line-wrapper.has-comment:hover", 'pre-Deck palette patch'],
  [
    "[data-theme='light'] .enhanced-line-wrapper.has-comment.popover-open",
    'pre-Deck palette patch',
  ],
  ["[data-theme-mode='light'] .line-comment-btn", 'pre-Deck palette patch'],
  [
    "html[data-theme-id='piwin-orange-white'] .knowledge-workspace-metric",
    'pre-Deck palette patch',
  ],
  ["html[data-theme-id='piwin-orange-white'] .knowledge-tab-panel", 'pre-Deck palette patch'],
  ["html[data-theme-id='piwin-orange-white'] .knowledge-workspace-nav", 'pre-Deck palette patch'],
  [
    "html[data-theme-id='piwin-orange-white'] .knowledge-workspace-nav-item.is-active",
    'pre-Deck palette patch',
  ],
  ["html[data-theme-id='piwin-light'] .knowledge-workspace-metric", 'pre-Deck palette patch'],
  ["html[data-theme-id='piwin-light'] .knowledge-tab-panel", 'pre-Deck palette patch'],
  ["html[data-theme-id='piwin-light'] .knowledge-workspace-nav", 'pre-Deck palette patch'],
  ["html[data-theme-id='piwin-dark'] .knowledge-workspace-metric", 'pre-Deck palette patch'],
  ["html[data-theme-id='piwin-dark'] .knowledge-tab-panel", 'pre-Deck palette patch'],
  ["html[data-theme-id='piwin-dark'] .knowledge-workspace-nav", 'pre-Deck palette patch'],
  [".right-panel[data-view='home']", 'Deck panel has one uniform surface'],
  ['.orchestration-scheme-chevron::before', 'glyph chevron replaced by CSS triangle'],
  ['.orchestration-scheme-popover', 'covered by .ui-popover-content.orchestration-scheme-popover'],
  ['.run-mode-control.is-warning .run-mode-trigger', 'tints .run-mode-value instead'],
  ['.thinking-effort-trigger:hover .thinking-effort-chevron', 'old rotated-box chevron is gone'],
  [
    '.assistant-response-actions .fork-count-badge span',
    'flat Deck icons no longer need a drop-shadow legibility hack',
  ],
  [
    ".md-code-block[data-is-shell='true']",
    'shell and non-shell fences share one void background now',
  ],
  ['.md-code-header:hover', 'was already a no-op (background/box-shadow unchanged)'],
  ['.md-code-block:hover .md-code-header', 'was already a no-op (background/box-shadow unchanged)'],
  ['.md-callout-note', 'note is the .md-callout base tone (iris), no override needed'],
  [
    "html[data-theme-mode='light'] .agent-interruption",
    'token ramp is mode-aware; interruption uses surface-3 + elev-2 in both faces',
  ],
  [
    "[data-theme='light'] .composer-attachment-shelf",
    'token ramp is mode-aware; shelf divider is --line-1 in both faces',
  ],
  [
    "[data-theme='light'] .composer-v2-attachment-chip",
    'token ramp is mode-aware; chips use surface-3 + elev-1 in both faces',
  ],
  [
    "[data-theme='light'] .composer-v2-doc-comment-chip",
    'token ramp is mode-aware; doc chips use iris-wash in both faces',
  ],
  [
    '.composer-dock .composer-card',
    'orphaned quiet-workbench selector; markup uses .composer-card-v2',
  ],
  [
    '.composer-dock .composer-v2-card',
    'orphaned quiet-workbench selector; markup uses .composer-card-v2',
  ],
  ['.composer-shell', 'orphaned quiet-workbench selector; never rendered'],
  [
    "[data-theme='light'] .user-message-wrapper.is-conversation .user-message-bubble",
    'token ramp is mode-aware; bubble uses surface-3 in both faces',
  ],
  [
    "[data-theme='light'] .user-message-wrapper.is-conversation .user-message-collapsible",
    'token ramp is mode-aware',
  ],
  [
    "html[data-theme-mode='dark'] .user-message-wrapper.is-conversation .user-message-bubble",
    'token ramp is mode-aware',
  ],
  [
    "html[data-theme-mode='dark'] .user-message-wrapper.is-conversation .user-message-collapsible",
    'token ramp is mode-aware',
  ],
  // The full status/metrics rail was removed from the conversation stage.
  // Keep every retired selector explicit so future unrelated drops still fail.
  ['.status-bar-left', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-right', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-dot', 'run state now uses shared outline icons'],
  ['.status-bar-agent.state-running', 'tone now targets the state icon and label'],
  [
    '.status-bar-agent.has-terminal-attention .status-bar-dot',
    'terminal attention now uses IconTerminal',
  ],
  ['.status-bar-agent.state-error', 'tone now targets the state icon'],
  ['.status-bar-agent.state-error .status-bar-dot', 'error now uses IconAlertCircle'],
  ['.status-bar-branch', 'branch is not turn telemetry'],
  ['.status-bar-model', 'model already lives in the Composer'],
  ['.status-bar-context', 'context already lives in the Composer'],
  ['button.status-bar-context', 'context already lives in the Composer'],
  ['.status-bar-context.tone-ok', 'context already lives in the Composer'],
  ['.status-bar-context.tone-warn', 'context already lives in the Composer'],
  ['.status-bar-context.tone-critical', 'context already lives in the Composer'],
  ['.status-bar-chip', 'Skills and MCP are not turn telemetry'],
  ['.status-bar-chip img', 'Skills and MCP are not turn telemetry'],
  ['.status-bar-chip:hover', 'turn metrics are static labels, not controls'],
  ['.status-bar-agent .status-bar-dot', 'run state now uses shared outline icons'],
  ['.chat-stage > .composer-dock:has(+ .status-bar)', TURN_TELEMETRY_REMOVAL_REASON],
  [
    '.chat-column-empty .chat-stage > .composer-dock.layout-centered:has(+ .status-bar)',
    TURN_TELEMETRY_REMOVAL_REASON,
  ],
  ['.status-bar', TURN_TELEMETRY_REMOVAL_REASON],
  ['.chat-column-empty .status-bar', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-rail', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-rail:hover', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent-icon', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent-icon svg', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metric-icon svg', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent-label', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-running .status-bar-agent-icon', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-running .status-bar-agent-label', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-idle .status-bar-agent-icon', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-idle .status-bar-agent-label', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-error .status-bar-agent-icon', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-error .status-bar-agent-label', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-attention .status-bar-agent-icon', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-agent.state-attention .status-bar-agent-label', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-divider', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metrics', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metric', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metric + .status-bar-metric::before', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metric-icon', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metric-label', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-metric-value', TURN_TELEMETRY_REMOVAL_REASON],
  ['.status-bar-rail:hover .status-bar-metric-value', TURN_TELEMETRY_REMOVAL_REASON],
  [".status-bar-metric[data-kind='input']", TURN_TELEMETRY_REMOVAL_REASON],
  [".status-bar-metric[data-kind='output']", TURN_TELEMETRY_REMOVAL_REASON],
]);

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Reduce a selector to the form prettier cannot change.
 *
 * Two rewrites of the same selector must compare equal no matter how the
 * formatter laid them out: `[type="text"]` and `[type='text']` are the same
 * selector, and prettier wraps a long `:not(…)` chain across lines, which would
 * otherwise leave stray spaces inside the parens and read as a dropped rule.
 */
function normalizeSelector(selector) {
  return (
    selector
      .replace(/"/g, "'")
      // Only *inside* the brackets: a space before `(` is a descendant
      // combinator (`.a :not(.b)` is not `.a:not(.b)`), so it has to survive.
      .replace(/([([])\s+/g, '$1')
      .replace(/\s+([)\]])/g, '$1')
      .trim()
  );
}

function selectorsOf(css) {
  const found = new Set();
  for (const match of stripComments(css).matchAll(/([^{}]+)\{/g)) {
    const raw = match[1].trim();
    if (raw.startsWith('@') || raw === 'from' || raw === 'to') continue;
    if (/^[\d%,\s]+$/.test(raw)) continue;
    for (const part of raw.split(',')) {
      const selector = normalizeSelector(part.split(/\s+/).filter(Boolean).join(' '));
      if (selector) found.add(selector);
    }
  }
  return found;
}

function cssFilesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return cssFilesIn(full);
    return entry.name.endsWith('.css') ? [full] : [];
  });
}

function gitShow(repoPath) {
  try {
    return execFileSync('git', ['show', `HEAD:${repoPath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return '';
  }
}

function headStyleFiles() {
  const listed = execFileSync(
    'git',
    ['ls-tree', '--name-only', '-r', 'HEAD', 'apps/desktop/src/styles/'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
    },
  );
  return listed.split('\n').filter((line) => line.endsWith('.css'));
}

/** Tokens come from static CSS, the runtime emitter, and ui-kit. */
function definedTokens() {
  const defined = new Set();
  const addDeclarations = (text) => {
    for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)) defined.add(m[1]);
  };
  for (const file of cssFilesIn(stylesDir)) addDeclarations(readFileSync(file, 'utf8'));
  addDeclarations(readFileSync(join(desktopRoot, 'src/styles.css'), 'utf8'));
  for (const file of cssFilesIn(uiKitSrc)) addDeclarations(readFileSync(file, 'utf8'));
  for (const rel of ['src/theme/apply-appearance.ts', 'src/appearance-tokens.ts']) {
    let text;
    try {
      text = readFileSync(join(desktopRoot, rel), 'utf8');
    } catch {
      continue;
    }
    for (const m of text.matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) defined.add(m[1]);
  }
  return defined;
}

function matchesFilter(name, filters) {
  if (filters.length === 0) return true;
  return filters.some((raw) => {
    const pattern = new RegExp(
      `^${raw.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`,
    );
    return pattern.test(name);
  });
}

const filters = process.argv.slice(2);
const problems = [];

// ── Check 1: no selector may vanish from the tree ──────────────────────────
const currentSelectors = new Set();
for (const file of cssFilesIn(stylesDir)) {
  for (const s of selectorsOf(readFileSync(file, 'utf8'))) currentSelectors.add(s);
}
for (const s of selectorsOf(readFileSync(join(uiKitSrc, 'primitives.css'), 'utf8'))) {
  currentSelectors.add(s);
}

let headSelectorCount = 0;
const vanished = new Map();
for (const repoPath of [...headStyleFiles(), 'packages/ui-kit/src/primitives.css']) {
  const name = repoPath.split('/').pop();
  if (!matchesFilter(name, filters)) continue;
  for (const selector of selectorsOf(gitShow(repoPath))) {
    headSelectorCount += 1;
    if (currentSelectors.has(selector)) continue;
    if (DELIBERATE_SELECTOR_DROPS.has(selector)) continue;
    if (!vanished.has(selector)) vanished.set(selector, name);
  }
}
if (vanished.size > 0) {
  problems.push(`${vanished.size} selector(s) present in HEAD but styled nowhere now:`);
  for (const [selector, origin] of vanished) problems.push(`    ${selector}   (was in ${origin})`);
}

// ── Check 2: every token referenced without a fallback must exist ──────────
const tokens = definedTokens();
const undefinedTokens = new Map();
for (const file of cssFilesIn(stylesDir)) {
  const name = file.split('/').pop();
  if (!matchesFilter(name, filters)) continue;
  for (const m of readFileSync(file, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)\s*\)/g)) {
    if (tokens.has(m[1])) continue;
    if (!undefinedTokens.has(m[1])) undefinedTokens.set(m[1], new Set());
    undefinedTokens.get(m[1]).add(name);
  }
}
if (undefinedTokens.size > 0) {
  problems.push(`${undefinedTokens.size} token(s) referenced with no fallback and never defined:`);
  for (const [token, files] of undefinedTokens) {
    problems.push(`    ${token}   <- ${[...files].join(', ')}`);
  }
}

const scope = filters.length > 0 ? filters.join(' ') : 'all stylesheets';
if (problems.length > 0) {
  console.error(`css-rewrite-audit FAILED (${scope})\n`);
  for (const line of problems) console.error(line);
  process.exit(1);
}
console.log(
  `css-rewrite-audit OK (${scope}) — ${headSelectorCount} HEAD selectors accounted for, ` +
    `${tokens.size} tokens defined, ${DELIBERATE_SELECTOR_DROPS.size} deliberate drops.`,
);
