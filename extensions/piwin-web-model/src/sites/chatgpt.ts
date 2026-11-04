/**
 * chatgpt.com selectors.
 *
 * Evidence status: the logged-out renderer was probed live (see
 * `docs/research/web-model-provider-spike.md`); the signed-in app was not
 * re-probed, so the app selectors below stay a candidate list and the probe
 * reports which one matched at runtime.
 *
 * The logged-out page serves `/uc/<id>` conversations rendered as
 * `li#uuid > div > section > p` with no message attributes at all, which is why
 * the `section` fallbacks exist.
 */

import type { SiteDefinition } from '../site-adapter.ts';

export const chatgptSite: SiteDefinition = {
  id: 'chatgpt-web',
  label: 'ChatGPT (web)',
  homeUrl: 'https://chatgpt.com/',
  hosts: ['chatgpt.com', 'chat.openai.com'],
  selectors: {
    composer: [
      'div#prompt-textarea[contenteditable="true"]',
      'textarea#mobile-composer-prompt',
      'form textarea',
      'form [contenteditable="true"]',
    ],
    assistant: [
      '[data-message-author-role="assistant"]',
      'article[data-testid^="conversation-turn"] [data-message-author-role]',
      // logged-out SSR renderer: assistant body lives in a plain section
      'main li section',
    ],
    user: [
      '[data-message-author-role="user"]',
      'article[data-testid^="conversation-turn"]:nth-of-type(odd)',
      'main li:has(> div > h5)',
    ],
    generating: [
      '[data-testid="stop-button"]',
      'button[aria-label="停止生成"]',
      'button[aria-label="Stop generating"]',
      'button[aria-label="Stop streaming"]',
    ],
  },
};
