/**
 * claude.ai selectors.
 *
 * Evidence status: **not probed live** — claude.ai redirects to `/claude/login`
 * without an account, and the spike deliberately stopped at the login wall (see
 * `docs/research/web-model-provider-spike.md`). Every entry here is a candidate
 * from the public app shell; treat the first live run as the real inventory and
 * fix this list, not the driver.
 */

import type { SiteDefinition } from '../site-adapter.ts';

export const claudeSite: SiteDefinition = {
  id: 'claude-web',
  label: 'Claude (web)',
  homeUrl: 'https://claude.ai/new',
  hosts: ['claude.ai'],
  selectors: {
    composer: [
      'div[contenteditable="true"].ProseMirror',
      'div[aria-label*="prompt" i][contenteditable="true"]',
      'div[contenteditable="true"]',
      'fieldset textarea',
    ],
    assistant: [
      '[data-testid="assistant-message"]',
      '.font-claude-message',
      'div[data-is-streaming] .font-claude-message',
    ],
    user: ['[data-testid="user-message"]', 'div[data-testid="human-turn"]'],
    generating: [
      'button[aria-label="Stop response"]',
      'button[aria-label="停止响应"]',
      '[data-testid="stop-button"]',
    ],
  },
};
