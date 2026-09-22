/**
 * Parent-side validation for artifact iframe postMessage payloads.
 * Pure — no DOM. Desktop checks event.source separately.
 */
import { getUtf8ByteSize } from './security.js';
import {
  ARTIFACT_BRIDGE_ACTION_TYPE,
  ARTIFACT_BRIDGE_ERROR_TYPE,
  ARTIFACT_BRIDGE_SIZE_TYPE,
  ARTIFACT_BRIDGE_STREAM_UPDATE_TYPE,
  ARTIFACT_ERROR_MESSAGE_MAX_CHARS,
  ARTIFACT_FRAME_MODES,
  DEFAULT_MAX_ARTIFACT_BYTES,
} from './constants.js';
import type {
  ArtifactActionMessage,
  ArtifactBridgeMessage,
  ArtifactErrorMessage,
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

  const epoch = data['epoch'];
  if (
    epoch !== undefined &&
    (typeof epoch !== 'number' || !Number.isSafeInteger(epoch) || epoch < 0)
  ) {
    return null;
  }

  return {
    type,
    channelId,
    height: Math.max(0, Math.ceil(rawHeight)),
    viewportHeight: Math.max(0, Math.ceil(rawViewportHeight)),
    revision,
    ...(epoch !== undefined ? { epoch } : {}),
  };
}

/**
 * Optional copy id stamped by the iframe `post()` helper. The same seq on
 * native + `parent.postMessage` is one logical event, not two.
 */
export function readArtifactPostSeq(data: unknown): number | null {
  if (!isRecord(data)) {
    return null;
  }
  const seq = data['seq'];
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0) {
    return null;
  }
  return seq;
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

/**
 * Parse an artifact ACTION message (user intent from untrusted sandboxed UI).
 * Strict whitelist: unknown actions, malformed payloads, and oversized fields
 * all return null. The parent must additionally verify event.source and
 * channelId before acting. Flashcard actions are structured UI only.
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
  if (action !== 'composer/propose-text' && action !== 'artifact/download-unsupported') {
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

function finiteLineNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined;
  return Math.floor(value);
}

/**
 * Parse a script-failure report from the sandbox. Diagnostic only: the payload
 * is untrusted text, clipped here as well as in the frame so a hostile
 * document cannot grow the parent's state with one huge string.
 */
export function parseArtifactErrorMessage(data: unknown): ArtifactErrorMessage | null {
  if (!isRecord(data)) return null;
  if (data['type'] !== ARTIFACT_BRIDGE_ERROR_TYPE) return null;

  const channelId = data['channelId'];
  if (typeof channelId !== 'string' || channelId.length === 0 || channelId.length > 200) {
    return null;
  }
  const kind = data['kind'];
  if (kind !== 'script' && kind !== 'rejection') return null;
  const rawMessage = data['message'];
  if (typeof rawMessage !== 'string' || rawMessage.trim().length === 0) return null;

  const clip = (value: string): string =>
    value.length > ARTIFACT_ERROR_MESSAGE_MAX_CHARS
      ? `${value.slice(0, ARTIFACT_ERROR_MESSAGE_MAX_CHARS)}…`
      : value;
  const rawName = data['name'];
  const line = finiteLineNumber(data['line']);
  const column = finiteLineNumber(data['column']);

  return {
    type: ARTIFACT_BRIDGE_ERROR_TYPE,
    channelId,
    kind,
    message: clip(rawMessage),
    ...(typeof rawName === 'string' && rawName.trim().length > 0
      ? { name: clip(rawName) }
      : {}),
    ...(line !== undefined ? { line } : {}),
    ...(column !== undefined ? { column } : {}),
  };
}
