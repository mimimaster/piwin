/**
 * Parent-side validation for artifact iframe postMessage payloads.
 * Pure — no DOM. Desktop checks event.source separately.
 */
import {
  ARTIFACT_BRIDGE_READY_TYPE,
  ARTIFACT_BRIDGE_RESIZE_TYPE,
} from './constants.js';
import type {
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
