/**
 * Parent-side validation for artifact iframe postMessage payloads.
 * Pure — no DOM. Desktop checks event.source separately.
 */
import {
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
} from './constants.js';
import type {
  ArtifactActionMessage,
  ArtifactBridgeMessage,
  ArtifactHeightMeasurementMode,
} from './types.js';

const VALID_MODES = new Set<ArtifactHeightMeasurementMode>([
  'normal',
  'interaction',
  'trim',
]);

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
  if (type !== ARTIFACT_BRIDGE_READY_TYPE && type !== ARTIFACT_BRIDGE_RESIZE_TYPE) {
    return null;
  }

  const channelId = data['channelId'];
  if (typeof channelId !== 'string' || channelId.length === 0) {
    return null;
  }

  const rawHeight = data['height'];
  if (typeof rawHeight !== 'number' || !Number.isFinite(rawHeight)) {
    return null;
  }

  const rawMode = data['mode'];
  let mode: ArtifactHeightMeasurementMode = 'normal';
  if (rawMode !== undefined) {
    if (typeof rawMode !== 'string' || !VALID_MODES.has(rawMode as ArtifactHeightMeasurementMode)) {
      return null;
    }
    mode = rawMode as ArtifactHeightMeasurementMode;
  }

  return {
    type,
    channelId,
    height: Math.max(0, Math.ceil(rawHeight)),
    mode,
  };
}

export function isArtifactBridgeReadyMessage(
  message: ArtifactBridgeMessage,
): boolean {
  return message.type === ARTIFACT_BRIDGE_READY_TYPE;
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
  if (action !== 'flashcard/rate' && action !== 'flashcard/open-source' && action !== 'composer/propose-text') {
    return null;
  }
  const payload = data['payload'];
  if (!isRecord(payload)) {
    return null;
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
  if (sourceLine !== undefined && (typeof sourceLine !== 'number' || !Number.isInteger(sourceLine) || sourceLine < 1)) {
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
