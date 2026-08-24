/**
 * Parent-side validation for artifact iframe postMessage payloads.
 * Pure — no DOM. Desktop checks event.source separately.
 */
import { getUtf8ByteSize } from './security.js';
import {
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_SIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_FRAME_MODES,
  DEFAULT_MAX_ARTIFACT_BYTES,
} from './constants.js';
import type {
  ArtifactActionMessage,
  ArtifactBridgeMessage,
  ArtifactFrameMode,
  ArtifactRenderSnapshot,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Parse an unknown postMessage data payload into a typed bridge message.
 * Returns null when the payload is not a piwin artifact bridge event.
 */
export function parseArtifactBridgeMessage(data: unknown): ArtifactBridgeMessage | null {
  if (!isRecord(data)) {
    return null;
  }

  const type = data['type'];
  if (type !== ARTIFACT_BRIDGE_SIZE_TYPE) {
    return null;
  }

  const channelId = data['channelId'];
  if (typeof channelId !== 'string' || channelId.length === 0 || channelId.length > 200) {
    return null;
  }

  const rawHeight = data['height'];
  if (typeof rawHeight !== 'number' || !Number.isFinite(rawHeight)) {
    return null;
  }
  const rawViewportHeight = data['viewportHeight'];
  if (typeof rawViewportHeight !== 'number' || !Number.isFinite(rawViewportHeight)) {
    return null;
  }
  const revision = data['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return null;
  }

  return {
    type,
    channelId,
    height: Math.max(0, Math.ceil(rawHeight)),
    viewportHeight: Math.max(0, Math.ceil(rawViewportHeight)),
    revision,
  };
}

function isArtifactFrameMode(value: unknown): value is ArtifactFrameMode {
  return (ARTIFACT_FRAME_MODES as readonly string[]).includes(value as string);
}

/**
 * Parse a parent → iframe render snapshot. Strict size and enum checks.
 * Returns null when the payload is not a valid revisioned render command.
 */
export function parseArtifactRenderSnapshot(data: unknown): ArtifactRenderSnapshot | null {
  if (!isRecord(data)) {
    return null;
  }
  if (data['type'] !== ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE) {
    return null;
  }
  const channelId = data['channelId'];
  if (typeof channelId !== 'string' || channelId.length === 0 || channelId.length > 200) {
    return null;
  }
  const revision = data['revision'];
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
    return null;
  }
  const source = data['source'];
  if (typeof source !== 'string' || getUtf8ByteSize(source) > DEFAULT_MAX_ARTIFACT_BYTES) {
    return null;
  }
  const frameMode = data['frameMode'];
  if (!isArtifactFrameMode(frameMode)) {
    return null;
  }
  const final = data['final'];
  if (typeof final !== 'boolean') {
    return null;
  }
  return {
    type: ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
    channelId,
    revision,
    source,
    frameMode,
    final,
  };
}

const VALID_RATINGS = new Set(['again', 'hard', 'good', 'easy']);
/** Matches product card ids (card-<hex8>-<base36 time>); rejects anything else. */
const CARD_ID_PATTERN = /^card-[a-zA-Z0-9._-]{1,64}$/;

/**
 * Parse an artifact ACTION message (user intent from untrusted sandboxed UI).
 * Strict whitelist: unknown actions, malformed payloads, and oversized fields
 * all return null. The parent must additionally verify event.source and
 * channelId before acting.
 */
export function parseArtifactActionMessage(data: unknown): ArtifactActionMessage | null {
  if (!isRecord(data)) {
    return null;
  }
  if (data['type'] !== ARTIFACT_BRIDGE_ACTION_TYPE) {
    return null;
  }
  const channelId = data['channelId'];
  if (typeof channelId !== 'string' || channelId.length === 0 || channelId.length > 200) {
    return null;
  }
  const action = data['action'];
  if (
    action !== 'flashcard/rate' &&
    action !== 'flashcard/open-source' &&
    action !== 'composer/propose-text' &&
    action !== 'artifact/download-unsupported'
  ) {
    return null;
  }
  const payload = data['payload'];
  if (!isRecord(payload)) {
    return null;
  }
  if (action === 'artifact/download-unsupported') {
    const filename = payload['filename'];
    if (filename !== undefined && (typeof filename !== 'string' || filename.length > 256)) {
      return null;
    }
    return {
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId,
      action: 'artifact/download-unsupported',
      payload: {
        ...(typeof filename === 'string' && filename.length > 0 ? { filename } : {}),
      },
    };
  }
  // composer/propose-text does not require a cardId
  if (action === 'composer/propose-text') {
    const text = payload['text'];
    if (typeof text !== 'string' || text.length === 0 || text.length > 10000) {
      return null;
    }
    const label = payload['label'];
    return {
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId,
      action: 'composer/propose-text',
      payload: {
        text,
        ...(typeof label === 'string' ? { label } : {}),
      },
    };
  }
  const cardId = payload['cardId'];
  if (typeof cardId !== 'string' || !CARD_ID_PATTERN.test(cardId)) {
    return null;
  }
  if (data['action'] === 'flashcard/rate') {
    const rating = payload['rating'];
    if (typeof rating !== 'string' || !VALID_RATINGS.has(rating)) {
      return null;
    }
    return {
      type: ARTIFACT_BRIDGE_ACTION_TYPE,
      channelId,
      action: 'flashcard/rate',
      payload: { cardId, rating: rating as 'again' | 'hard' | 'good' | 'easy' },
    };
  }
  // flashcard/open-source
  const openFile = payload['openFile'];
  if (openFile !== undefined && typeof openFile !== 'boolean') {
    return null;
  }
  const sourceFile = payload['sourceFile'];
  if (sourceFile !== undefined) {
    if (typeof sourceFile !== 'string' || sourceFile.length > 512) {
      return null;
    }
    // UI hint only — reject absolute paths and traversal segments.
    if (sourceFile.startsWith('/') || sourceFile.includes('..')) {
      return null;
    }
  }
  const sourceLine = payload['sourceLine'];
  if (
    sourceLine !== undefined &&
    (typeof sourceLine !== 'number' || !Number.isInteger(sourceLine) || sourceLine < 1)
  ) {
    return null;
  }
  return {
    type: ARTIFACT_BRIDGE_ACTION_TYPE,
    channelId,
    action: 'flashcard/open-source',
    payload: {
      cardId,
      ...(openFile === undefined ? {} : { openFile }),
      ...(sourceFile === undefined ? {} : { sourceFile }),
      ...(sourceLine === undefined ? {} : { sourceLine }),
    },
  };
}
