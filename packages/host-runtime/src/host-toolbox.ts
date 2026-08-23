/** Lazy model surface family membership for low-frequency Host tools.
 * Browser stays direct (ADR 0044 amendment): the workbench is high-frequency.
 */

import type { SessionToolFamily } from '@piwin/contracts';

export const HOST_TOOLBOX_NAME = 'piwin_toolbox';

const TOOLBOX_TARGET_FAMILIES: ReadonlySet<SessionToolFamily> = new Set([
  'process',
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
