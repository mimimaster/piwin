/** Lazy model surface family membership for low-frequency Host tools. */

import type { SessionToolFamily } from '@piwin/contracts';

export const HOST_TOOLBOX_NAME = 'piwin_toolbox';

const TOOLBOX_TARGET_FAMILIES: ReadonlySet<SessionToolFamily> = new Set([
  'process',
  'browser',
  'notes-read',
  'notes-write',
  'flashcards-read',
  'flashcards-write',
  'image-generation',
  'video-generation',
]);

export function isHostToolboxTargetFamily(family: SessionToolFamily): boolean {
  return TOOLBOX_TARGET_FAMILIES.has(family);
}
