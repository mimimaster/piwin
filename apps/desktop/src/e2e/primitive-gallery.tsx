/**
 * E2E-only primitive gallery (plan: quiet-workbench P0-B).
 * Renders the deterministic ui-kit primitive state matrix for visual
 * regression capture. Reached only through the build-time gated fixture
 * route in DesktopThemeRoot (`VITE_PIWIN_E2E_FIXTURES` + `#/e2e/primitives`);
 * never part of product navigation.
 *
 * Theme changes must flow through the DesktopThemeRoot callback passed in
 * as `onApplyTheme` — this fixture never mutates document style/dataset and
 * never mounts its own PiwinUiProvider.
 */
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { ThemeManifest } from '@piwin/contracts';
import {
  Button,
  Field,
  FieldCheckbox,
  IconButton,
  ListRow,
  Popover,
  StatusBadge,
  Surface,
} from '@piwin/ui-kit';
import {
  PIWIN_APPEARANCE_DARK,
  PIWIN_APPEARANCE_INK_WASH,
  PIWIN_APPEARANCE_LIGHT,
} from '../appearance-tokens';

export type PrimitiveGalleryProps = {
  /** Root theme application callback owned by DesktopThemeRoot. */
  onApplyTheme: (theme: ThemeManifest) => void;
};

/** Fixture-local layout only; visual chrome stays in primitive CSS. */
const galleryRootStyle: CSSProperties = {
  minHeight: '100vh',
  padding: '24px',
  background: 'var(--canvas)',
  color: 'var(--text)',
  fontFamily: 'var(--font)',
};

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '12px',
  flexWrap: 'wrap',
};

/** Transcript cards stack rather than flow, and need the thread's column width. */
const stackStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px',
  width: '100%',
  maxWidth: '620px',
};

function GallerySection(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>{props.title}</h3>
      <div style={rowStyle}>{props.children}</div>
    </section>
  );
}

function GalleryStack(props: { title: string; children: ReactNode }): ReactElement {
  return (
    <section style={{ marginBottom: '20px' }}>
      <h3 style={{ margin: '0 0 8px', fontSize: '13px', color: 'var(--muted)' }}>{props.title}</h3>
      <div style={stackStyle}>{props.children}</div>
    </section>
  );
}

/**
 * Static transcript-card markup mirroring tool-call-card.tsx, diff-card.tsx,
 * plan-card.tsx, and gate-card.tsx. These states (expanded tool body, pending
 * diff verdict, blocked permission gate) depend on live agent traffic, so the
 * mock host cannot reach them — the fixture reproduces the DOM instead so the
 * Deck stylesheets stay under visual regression.
 */
function TranscriptCardStates(): ReactElement {
  return (
    <>
      <GalleryStack title="Tool call card">
        <div className="tool-call-card density-compact status-ok is-expanded">
          <button type="button" className="tool-call-summary">
            <span className="tool-call-action-verb">Read</span>
            <span className="tool-call-file-pill is-link">
              <span className="tool-call-file-name">src/host-runtime.ts</span>
              <span className="tool-call-line-range">1-120</span>
            </span>
            <span className="tool-call-ok" aria-label="done" />
            <span className="tool-call-duration">240ms</span>
          </button>
          <div className="tool-call-body">
            <pre className="tool-call-output">
              export function createHostRuntime() {'{'}…{'}'}
            </pre>
          </div>
        </div>

        <div className="tool-call-card density-compact status-running">
          <button type="button" className="tool-call-summary">
            <span className="tool-call-action-verb">Ran command</span>
            <span className="tool-call-preview is-query">pnpm typecheck</span>
            <span className="tool-status-dot status-running" />
            <span className="tool-call-duration tool-call-duration-live">…</span>
          </button>
        </div>

        <div className="tool-call-card density-compact status-error">
          <button type="button" className="tool-call-summary">
            <span className="tool-call-action-verb">Edited</span>
            <span className="tool-call-file-pill">
              <span className="tool-call-file-name">packages/contracts/src/theme.ts</span>
            </span>
            <span className="tool-call-diff-stats">
              <span className="add">+18</span>
              <span className="del">−4</span>
            </span>
            <span className="tool-call-err" aria-label="error" />
            <span className="tool-call-truncated-tag">truncated</span>
          </button>
        </div>
      </GalleryStack>

      <GalleryStack title="Diff card">
        <div className="diff-card" data-testid="gallery-diff-card">
          <div className="diff-head">
            <span className="file">apps/desktop/src/styles/tokens.css</span>
            <span className="stat num">
              <span className="add">+12</span>
              <span className="del">−3</span>
            </span>
            <div className="diff-actions">
              <button type="button" className="btn">
                Reject
              </button>
              <button type="button" className="btn primary">
                Accept
              </button>
            </div>
          </div>
          <div className="diff-body">
            <div className="ln ctx">
              <span className="g old">41</span>
              <span className="g new">41</span>
              <span className="ln-text">{'  --fs-chrome: 12.5px;'}</span>
            </div>
            <div className="ln add">
              <span className="g old" />
              <span className="g new">42</span>
              <span className="ln-text">{'  --fs-body: 13.5px;'}</span>
            </div>
            <div className="ln del">
              <span className="g old">43</span>
              <span className="g new" />
              <span className="ln-text">{'  --fs-legacy: 13px;'}</span>
            </div>
          </div>
        </div>

        <div className="diff-card accepted">
          <div className="diff-head">
            <span className="file">docs/adr/0061-deck-design-system.md</span>
            <span className="stat num">
              <span className="add">+64</span>
            </span>
            <span className="review-badge accepted">Accepted</span>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Permission gate">
        <div className="gate" data-kind="command">
          <div className="gate-head">
            <span className="gate-head-icon">⚠</span>
            Run a shell command?
          </div>
          <div className="gate-cmd">
            <div className="permission-detail">rm -rf ./dist</div>
          </div>
          <div className="gate-actions">
            <Button variant="secondary">Deny</Button>
            <Button variant="primary">Allow once</Button>
            <span className="gate-hint">Esc to deny</span>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Plan card">
        <div className="plan-card">
          <button type="button" className="plan-head">
            <span className="ic">◇</span>
            Session plan
            <span className="chev">›</span>
          </button>
          <div className="plan-steps">
            <div className="step done">
              <span className="step-icon">✓</span>
              Rewrite tool card stylesheet
            </div>
            <div className="step run">
              <span className="step-icon step-icon-run">
                <span className="pulse-dot">●</span>
              </span>
              Rewrite transcript cards
            </div>
            <div className="step">
              <span className="step-icon">○</span>
              Rewrite settings pages
            </div>
            <div className="step skipped">
              <span className="step-icon">−</span>
              Regenerate icon set
            </div>
          </div>
          <div className="plan-actions">
            <button type="button" className="plan-btn plan-btn-primary">
              Run
            </button>
            <button type="button" className="plan-btn plan-btn-recommended">
              Step
            </button>
            <button type="button" className="plan-btn plan-btn-danger">
              Abort
            </button>
            <span className="plan-running-label">3 of 4 complete</span>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Activity call chain">
        <div className="activity-call-chain has-items">
          <button type="button" className="activity-call-chain-summary">
            <span className="activity-call-chain-icon">◆</span>
            <span className="activity-call-chain-label">Explored</span>
            <span className="activity-call-chain-count">7 calls</span>
            <span className="activity-call-chain-failure">1 failed</span>
            <span className="activity-call-chain-chevron is-open">⌄</span>
          </button>
          <div className="activity-call-chain-items">
            <div className="activity-call-chain-item">
              <div className="tool-call-card density-compact">
                <button type="button" className="tool-call-summary">
                  <span className="tool-call-action-verb">Searched</span>
                  <span className="tool-call-preview is-query">backdrop-filter</span>
                </button>
              </div>
            </div>
            <div className="activity-call-chain-item status-error">
              <div className="tool-call-card density-compact">
                <button type="button" className="tool-call-summary">
                  <span className="tool-call-action-verb">Read</span>
                  <span className="tool-call-preview">missing-file.css</span>
                </button>
              </div>
            </div>
            <div className="activity-call-chain-item is-latest">
              <div className="tool-call-card density-compact">
                <button type="button" className="tool-call-summary">
                  <span className="tool-call-action-verb">Edited</span>
                  <span className="tool-call-preview">transcript-cards.css</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </GalleryStack>
    </>
  );
}

/**
 * Static markup mirroring files-changed-bar.tsx, WalkthroughCard.tsx, the
 * turn-level error card, and the shared Markdown renderer (table, callout,
 * fenced code). Same rationale as TranscriptCardStates: these need live
 * agent/tool traffic or a generated document to reach through the mock host.
 */
function TranscriptLeafStates(): ReactElement {
  return (
    <>
      <GalleryStack title="Files-changed bar">
        <div className="files-changed-bar" data-testid="gallery-files-changed-bar">
          <div className="files-changed-bar-head">
            <button type="button" className="files-changed-bar-toggle">
              <span className="files-changed-bar-summary">
                <span className="files-changed-bar-count">3 files changed</span>
                <span className="files-changed-bar-stat">
                  <span className="add">+42</span>
                  <span className="del">−11</span>
                </span>
              </span>
              <span className="files-changed-bar-chevron open">⌄</span>
            </button>
            <button type="button" className="files-changed-bar-review">
              Review
            </button>
          </div>
          <ul className="files-changed-bar-list">
            <li className="files-changed-bar-row">
              <span className="files-changed-bar-row-name">tokens.css</span>
              <span className="files-changed-bar-row-dir">apps/desktop/src/styles</span>
              <span className="files-changed-bar-row-stat">
                <span className="add">+18</span>
                <span className="del">−4</span>
              </span>
            </li>
            <li className="files-changed-bar-row">
              <span className="files-changed-bar-row-name">deck-derive.ts</span>
              <span className="files-changed-bar-row-dir">apps/desktop/src/theme</span>
              <span className="files-changed-bar-row-stat">
                <span className="add">+24</span>
                <span className="del">−7</span>
              </span>
            </li>
          </ul>
        </div>
      </GalleryStack>

      <GalleryStack title="Walkthrough artifact card">
        <div className="walkthrough-card" data-status="ready" data-testid="gallery-walkthrough-card">
          <div className="walkthrough-card-header">
            <span className="doc-artifact-icon">▤</span>
            <span className="walkthrough-card-title">Walkthrough</span>
            <span className="walkthrough-card-status">Ready</span>
            <span className="walkthrough-card-mode">turn</span>
          </div>
          <button type="button" className="doc-artifact-body is-openable">
            <div className="doc-artifact-excerpt-box">
              <span className="doc-artifact-excerpt-label">Summary</span>
              <p className="doc-artifact-excerpt-text">
                Rewrote four transcript leaf stylesheets onto Deck tokens, fixed the shell fence
                background and added a coral error-card treatment.
              </p>
            </div>
            <div className="doc-artifact-footer">
              <span>Open walkthrough</span>
              <span className="doc-artifact-footer-arrow">→</span>
            </div>
          </button>
        </div>

        <div
          className="walkthrough-card"
          data-status="generating"
          style={{ maxWidth: '420px' }}
        >
          <div className="walkthrough-card-header">
            <span className="doc-artifact-icon">▤</span>
            <span className="walkthrough-card-title">Walkthrough</span>
            <span className="walkthrough-card-status">Generating…</span>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Turn error card">
        <div className="turn-error-card">
          <div className="turn-error-card-inner">
            <div className="turn-error-header">
              <span className="turn-error-icon-badge">✕</span>
              <div className="turn-error-header-text">
                <span className="turn-error-title">Command failed</span>
                <span className="turn-error-category-tag">exit 1</span>
              </div>
            </div>
            <div className="turn-error-body">
              <p className="turn-error-message">pnpm typecheck exited with a non-zero status.</p>
            </div>
            <div className="turn-error-actions">
              <button type="button" className="msg-action-btn">
                Retry
              </button>
            </div>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Markdown: table, callouts, fenced code">
        <div className="markdown" style={{ maxWidth: '520px' }}>
          <div className="md-table-wrapper">
            <table className="md-table">
              <thead>
                <tr>
                  <th>Region</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Knowledge</td>
                  <td>Deck-native</td>
                </tr>
                <tr>
                  <td>Transcript</td>
                  <td>Deck-native</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="md-callout md-callout-tip">
            <div className="md-callout-header">
              <span className="md-callout-badge">Tip</span>
            </div>
            <p className="md-p">Code recesses to the void step; errors break out onto coral.</p>
          </div>

          <div className="md-callout md-callout-important">
            <div className="md-callout-header">
              <span className="md-callout-badge">Important</span>
            </div>
            <p className="md-p">Never hardcode a hex color in a rewritten stylesheet.</p>
          </div>

          <div className="md-code-block" data-is-shell="false">
            <div className="md-code-header">
              <div className="md-code-header-title">
                <span className="md-code-lang">ts</span>
              </div>
            </div>
            <pre className="md-code">
              <div className="md-code-line diff-line-add">
                <span className="md-code-line-num">42</span>
                <span className="md-code-line-text">{'  const void = tokens.bg;'}</span>
              </div>
              <div className="md-code-line diff-line-delete">
                <span className="md-code-line-num">41</span>
                <span className="md-code-line-text">{'  const surface1 = tokens.bg;'}</span>
              </div>
            </pre>
          </div>
        </div>
      </GalleryStack>
    </>
  );
}

/**
 * Static markup mirroring steer-queue, agent-interruption, and attachment
 * shelf states from composer-dock.tsx. These depend on live run/permission
 * traffic, so the fixture reproduces the DOM for visual regression.
 */
function ComposerLeafStates(): ReactElement {
  return (
    <>
      <GalleryStack title="Steer queue dock">
        <div className="steer-queue-dock" style={{ maxWidth: '520px' }}>
          <div className="steer-queue-header">
            <div className="steer-queue-heading">
              <span className="steer-queue-title">Queued</span>
              <span className="steer-queue-count">2</span>
              <span className="steer-queue-subtitle">Sent after current turn</span>
            </div>
          </div>
          <ul className="steer-queue-list">
            <li className="steer-queue-item">
              <span className="steer-queue-position">1</span>
              <div className="steer-queue-item-content">
                <span className="steer-queue-item-text">Continue with composer leaf files</span>
              </div>
            </li>
          </ul>
        </div>
      </GalleryStack>

      <GalleryStack title="Agent interruption (permission)">
        <div
          className="agent-interruption agent-interruption--warning"
          style={{ maxWidth: '520px' }}
        >
          <div className="agent-interruption-header">
            <div className="agent-interruption-title">Run a shell command?</div>
            <p className="agent-interruption-description">rm -rf ./dist</p>
          </div>
          <div className="agent-interruption-content">
            <div className="permission-bar-actions">
              <button type="button" className="permission-bar-btn-deny">
                Deny
              </button>
              <button type="button" className="permission-bar-btn-allow-once">
                Allow once
              </button>
              <button type="button" className="permission-bar-btn-allow-session">
                Allow session
              </button>
            </div>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Attachment shelf">
        <div
          style={{
            maxWidth: '520px',
            background: 'var(--surface-3)',
            borderRadius: 'var(--r-panel)',
            boxShadow: 'var(--elev-2)',
          }}
        >
          <div className="composer-attachment-shelf">
            <div className="composer-v2-attachments">
              <span className="composer-v2-attachment-chip composer-v2-doc-comment-chip composer-v2-context-chip">
                <span className="doc-comment-chip-icon">📄</span>
                <span className="chip-text">deck-design-system.md</span>
              </span>
              <span className="composer-v2-vision-warning" style={{ margin: 0 }}>
                <span className="composer-v2-vision-warning-text">
                  Model may not support images
                </span>
                <button type="button" className="composer-v2-vision-warning-action">
                  Switch model
                </button>
              </span>
            </div>
          </div>
        </div>
      </GalleryStack>
    </>
  );
}

/**
 * Static markup mirroring KnowledgeCenterPanel.tsx, DocCardItem.tsx,
 * FlashcardsPanel.tsx, and FlashcardView.tsx. The Knowledge Center needs a
 * mounted project + indexed files to reach these states through the mock
 * host, so the fixture reproduces the DOM instead — same rationale as
 * TranscriptCardStates above.
 */
function KnowledgeCardStates(): ReactElement {
  return (
    <>
      <GalleryStack title="Knowledge sidebar row">
        <div
          style={{
            width: '280px',
            background: 'var(--surface-2)',
            borderRadius: 'var(--r-card)',
            padding: '4px',
          }}
        >
          <div className="knowledge-project-row selected">
            <span className="knowledge-project-icon">◆</span>
            <div className="knowledge-project-info">
              <div className="knowledge-project-name-row">
                <span className="knowledge-project-name">piwin</span>
                <span className="knowledge-project-badge active">Active</span>
              </div>
              <div className="knowledge-project-meta meta-ready">1,204 chunks</div>
            </div>
          </div>
          <div className="knowledge-project-row">
            <span className="knowledge-project-icon">◆</span>
            <div className="knowledge-project-info">
              <div className="knowledge-project-name-row">
                <span className="knowledge-project-name">openwebui_m</span>
              </div>
              <div className="knowledge-project-meta meta-indexing">Indexing…</div>
            </div>
          </div>
        </div>
        <span className="knowledge-config-prompt-pill">
          <span className="config-prompt-dot" />
          <span className="config-prompt-text">Embeddings not configured</span>
          <span className="config-prompt-action">Set up</span>
        </span>
      </GalleryStack>

      <GalleryStack title="Wiki search hit">
        <div className="search-hit-card" style={{ maxWidth: '420px' }}>
          <div className="hit-card-title">
            <span className="hit-file-info">📄 deck-derive.ts</span>
            <span className="hit-score-badge">0.87</span>
          </div>
          <pre className="hit-snippet">{'export function deriveDeckTokens(manifest) {'}</pre>
        </div>
      </GalleryStack>

      <GalleryStack title="Doc card (generated)">
        <div
          className="doc-card-showcase-item"
          style={{ width: '260px' }}
          data-testid="gallery-doc-card"
        >
          <div className="doc-card-item-inner">
            <header className="doc-card-item-header">
              <span className="doc-card-item-tag">General</span>
              <span className="doc-card-item-type">cloze</span>
              <div className="doc-card-item-actions">
                <button type="button" className="doc-card-action-icon-btn">
                  📋
                </button>
                <span className="doc-card-item-flip-hint">Flip</span>
              </div>
            </header>
            <div className="doc-card-item-body">
              <div className="doc-card-item-front">
                <span className="doc-card-side-label">Q</span>
                <p className="doc-card-text">What does deck-derive.ts invert?</p>
              </div>
            </div>
            <footer className="doc-card-item-footer">
              <span className="doc-card-source-badge">
                📄 deck-palette.ts
                <span className="doc-card-source-open-hint">↗ open</span>
              </span>
            </footer>
          </div>
        </div>

        <div className="flashcards-grid-item" style={{ width: '260px' }}>
          <div className="flashcards-item-header">
            <span className="flashcards-item-deck">Deck design</span>
          </div>
          <div className="flashcards-item-body">
            <p className="flashcards-item-front">What is the field vs. panel rule?</p>
            <p className="flashcards-item-back">bg is the field; panel is surface1.</p>
          </div>
        </div>
      </GalleryStack>

      <GalleryStack title="Inline flip card (transcript)">
        <div className="fc-quiet-stack" style={{ maxWidth: '420px' }}>
          <div className="fc-quiet-nav">
            <span>Card 2 of 5</span>
            <div className="fc-quiet-nav-actions">
              <button type="button" className="fc-quiet-nav-btn">
                ‹
              </button>
              <button type="button" className="fc-quiet-nav-btn">
                ›
              </button>
            </div>
          </div>
          <div className="fc-quiet-card-container">
            <div className="fc-quiet-frame">
              <div className="fc-quiet-face fc-quiet-front is-active">
                <div className="fc-quiet-header">
                  <div className="fc-quiet-meta">
                    <span className="fc-quiet-deck">Deck design</span>
                    <span className="fc-quiet-tag">#tokens</span>
                  </div>
                  <div className="fc-quiet-tools">
                    <span className="fc-quiet-flip-badge">
                      <kbd>Space</kbd> flip
                    </span>
                  </div>
                </div>
                <div className="fc-quiet-body fc-quiet-question">
                  <p>Which token is the field every panel floats over?</p>
                </div>
                <div className="fc-quiet-footer">
                  <div className="fc-quiet-rating-bar">
                    <button type="button" className="fc-quiet-rate-btn">
                      Again <span className="fc-rate-key">1</span>
                    </button>
                    <button type="button" className="fc-quiet-rate-btn">
                      Good <span className="fc-rate-key">3</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </GalleryStack>
    </>
  );
}

export function PrimitiveGallery(props: PrimitiveGalleryProps): ReactElement {
  return (
    <div style={galleryRootStyle} data-testid="primitive-gallery">
      <GallerySection title="Theme (routes through DesktopThemeRoot)">
        <Button
          data-testid="gallery-theme-dark"
          onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_DARK)}
        >
          Obsidian
        </Button>
        <Button
          data-testid="gallery-theme-light"
          onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_LIGHT)}
        >
          Bone
        </Button>
        <Button
          data-testid="gallery-theme-ink-wash"
          onClick={() => props.onApplyTheme(PIWIN_APPEARANCE_INK_WASH)}
        >
          Ink wash
        </Button>
      </GallerySection>

      <GallerySection title="Button">
        <Button variant="primary" data-testid="gallery-button-primary">
          Primary
        </Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="secondary" disabled>
          Disabled
        </Button>
      </GallerySection>

      <GallerySection title="IconButton">
        <IconButton label="Default icon action">＋</IconButton>
        <IconButton label="Pressed icon action" aria-pressed>
          ◉
        </IconButton>
        <IconButton label="Disabled icon action" disabled>
          ✕
        </IconButton>
        {/* Page-load autofocus keeps the focus-visible ring deterministic
            for the dark capture without keyboard scripting. */}
        <IconButton label="Focused icon action" autoFocus data-testid="gallery-focus-target">
          ◎
        </IconButton>
      </GallerySection>

      <GallerySection title="Field">
        <Field label="Text input">
          <input defaultValue="Deterministic value" />
        </Field>
        <Field label="Invalid input" error="Value is required">
          <input defaultValue="" placeholder="Empty" />
        </Field>
        <Field label="Disabled input">
          <input defaultValue="Read only" disabled />
        </Field>
        <Field label="Select">
          <select defaultValue="two">
            <option value="one">Option one</option>
            <option value="two">Option two</option>
          </select>
        </Field>
      </GallerySection>

      <GallerySection title="Field checkbox">
        <FieldCheckbox label="Unchecked" checked={false} onCheckedChange={() => undefined} />
        <FieldCheckbox label="Checked" checked onCheckedChange={() => undefined} />
        <FieldCheckbox
          label="Disabled"
          checked={false}
          disabled
          onCheckedChange={() => undefined}
        />
      </GallerySection>

      <GallerySection title="ListRow">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '220px' }}>
          <ListRow>Default row</ListRow>
          <ListRow selected>Selected row</ListRow>
        </div>
      </GallerySection>

      <GallerySection title="Surface">
        <Surface tone="base" style={{ padding: '12px' }} data-testid="gallery-surface-base">
          Base
        </Surface>
        <Surface tone="inset" style={{ padding: '12px' }}>
          Inset
        </Surface>
        <Surface tone="raised" style={{ padding: '12px' }}>
          Raised
        </Surface>
        <Surface tone="selected" style={{ padding: '12px' }}>
          Selected
        </Surface>
      </GallerySection>

      <GallerySection title="StatusBadge">
        <StatusBadge tone="neutral" label="Neutral" />
        <StatusBadge tone="running" label="Running" />
        <StatusBadge tone="success" label="Success" />
        <StatusBadge tone="warning" label="Warning" />
        <StatusBadge tone="danger" label="Danger" />
      </GallerySection>

      <GallerySection title="Portal">
        <Popover
          trigger={
            <Button variant="secondary" data-testid="gallery-portal-trigger">
              Open popover
            </Button>
          }
          label="Gallery popover"
          testId="gallery-portal"
        >
          <div style={{ padding: '8px 12px' }} data-testid="gallery-portal-body">
            Portal content follows the active theme.
          </div>
        </Popover>
      </GallerySection>

      <TranscriptCardStates />
      <TranscriptLeafStates />
      <ComposerLeafStates />
      <KnowledgeCardStates />
    </div>
  );
}
