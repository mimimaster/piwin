import type { PendingComposerAttachment } from '../media-utils.js';
import type { SessionComposerSnapshot } from './composer-session-snapshot.js';

/** True when another holder still owns this chip's File / object URLs. */
export function isComposerAttachmentRetained(input: {
  localId: string;
  liveAttachments: readonly PendingComposerAttachment[];
  sessionSnapshots: ReadonlyMap<string, SessionComposerSnapshot>;
  draftSnapshots: ReadonlyMap<string, SessionComposerSnapshot>;
}): boolean {
  if (input.liveAttachments.some((item) => item.localId === input.localId)) {
    return true;
  }
  for (const snapshot of input.sessionSnapshots.values()) {
    if (snapshot.attachments.some((item) => item.localId === input.localId)) {
      return true;
    }
  }
  for (const snapshot of input.draftSnapshots.values()) {
    if (snapshot.attachments.some((item) => item.localId === input.localId)) {
      return true;
    }
  }
  return false;
}
