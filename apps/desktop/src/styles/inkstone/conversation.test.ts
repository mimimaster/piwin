import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const conversation = readFileSync(join(here, 'conversation.css'), 'utf8');
const userCard = readFileSync(join(here, 'user-card.css'), 'utf8');

describe('Inkstone user-card surface', () => {
  it('paints the ink-face user card from the ink composer slab without a rim', () => {
    expect(userCard).toMatch(
      /\[data-theme-id='piwin-inkstone-ink'\]:not\(\[data-slab='paper'\]\) :is\(\.ucard, \.user-message-collapsible\) \{[\s\S]*?--ucard-fill: var\(--slab\);[\s\S]*?--ucard-shadow: 0 0 #0000;/,
    );
  });

  it('paints the ink-face agent-mode prompt bubble from the composer slab', () => {
    expect(userCard).toMatch(
      /\[data-theme-id='piwin-inkstone-ink'\]:not\(\[data-slab='paper'\]\)\s+\.bubble\.role-user:not\(\.is-conversation-bubble\) \{[\s\S]*?background: var\(--slab\);[\s\S]*?box-shadow: none;/,
    );
    expect(userCard).toMatch(
      /\.user-message-actions \{\s*--user-card-actions-fade: var\(--slab\);/,
    );
  });

  it('reads the conversation bubble fill and fades from the shared card fill', () => {
    expect(conversation).toMatch(
      /\.user-message-bubble \{[\s\S]*?background: var\(--ucard-fill\);[\s\S]*?box-shadow: var\(--ucard-shadow\);/,
    );
    expect(conversation).toContain('--user-message-mask: var(--ucard-fill);');
    expect(conversation).not.toMatch(/var\(--s3\) 36px/);
  });
});

describe('Inkstone conversation user-card footer', () => {
  it('keeps one-line copy/edit on the same grid row', () => {
    expect(conversation).toMatch(
      /\.user-message-wrapper\.is-conversation \.user-message-footer \{[\s\S]*?position: static;[\s\S]*?grid-column: 2;/,
    );
  });

  it('overlays multiline copy/edit at the bottom-right of the paper card', () => {
    expect(conversation).toMatch(
      /\.user-message-bubble\.is-multiline\s+\.user-message-footer \{[\s\S]*?position: absolute;[\s\S]*?bottom: 8px;/,
    );
  });

  it('keeps the branch counter on one line when the fork foot wraps', () => {
    expect(conversation).toMatch(
      /\.message-branch-switcher \{[\s\S]*?flex: 0 0 auto;[\s\S]*?white-space: nowrap;/,
    );
    expect(conversation).toMatch(
      /\.message-branch-switcher-label \{[\s\S]*?white-space: nowrap;/,
    );
  });
});
