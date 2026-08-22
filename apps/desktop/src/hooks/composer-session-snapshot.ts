import type { PromptContextRef } from '@piwin/contracts';
import type { PendingComposerAttachment } from '../media-utils.js';

/**
 * Unsent composer state (text + chips + refs) parked per live session or
 * per local draft row. Shared between the drafts and attachments composer
 * hooks: drafts owns the Maps keyed by session/draft id, attachments only
 * reads them (to keep a just-pasted preview alive across a session hop).
 */
export type SessionComposerSnapshot = {
  text: string;
  attachments: PendingComposerAttachment[];
  contextRefs: PromptContextRef[];
};
