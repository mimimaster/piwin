import type { BrowserFrameBinaryHeader, BrowserFramePush } from '@piwin/contracts';

export type BrowserFrameIdentity = Pick<
  BrowserFramePush,
  'sessionId' | 'frameId' | 'generation' | 'pageId' | 'documentRevision'
>;

export function browserFrameIdentity(identity: BrowserFrameIdentity): BrowserFrameIdentity {
  return {
    ...(identity.sessionId === undefined ? {} : { sessionId: identity.sessionId }),
    frameId: identity.frameId,
    generation: identity.generation,
    pageId: identity.pageId,
    documentRevision: identity.documentRevision,
  };
}

export function browserFrameIdentityKey(identity: BrowserFrameIdentity): string {
  return JSON.stringify([
    identity.sessionId ?? null,
    identity.generation,
    identity.pageId,
    identity.documentRevision,
    identity.frameId,
  ]);
}

export function browserFrameIdentityOrder(
  next: BrowserFrameIdentity,
  previous: BrowserFrameIdentity,
): number | undefined {
  if (
    next.sessionId !== previous.sessionId ||
    next.generation !== previous.generation ||
    next.pageId !== previous.pageId ||
    next.documentRevision !== previous.documentRevision
  ) return undefined;
  if (next.frameId === previous.frameId) return 0;
  const nextId = Number(next.frameId);
  const previousId = Number(previous.frameId);
  if (Number.isFinite(nextId) && Number.isFinite(previousId)) return nextId - previousId;
  return 1;
}

export function browserFrameIdentitiesMatch(
  push: BrowserFramePush,
  header: BrowserFrameBinaryHeader,
): boolean {
  return push.sessionId === header.sessionId &&
    push.frameId === header.frameId &&
    push.generation === header.generation &&
    push.pageId === header.pageId &&
    push.documentRevision === header.documentRevision &&
    push.width === header.width &&
    push.height === header.height &&
    push.encodedWidth === header.encodedWidth &&
    push.encodedHeight === header.encodedHeight &&
    push.byteLength === header.byteLength;
}
