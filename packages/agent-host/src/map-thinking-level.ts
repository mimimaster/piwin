/** Pi's canonical thinking levels; `ultra` is a Piwin-only alias. */
import { getSupportedThinkingLevels } from '@earendil-works/pi-ai';
import type { ModelRef, ThinkingLevel } from '@piwin/contracts';

export type PiThinkingLevel = Exclude<ThinkingLevel, 'ultra'>;

export type PiThinkingLevelMap = Partial<Record<PiThinkingLevel, string | null>>;

const PI_THINKING_LEVELS: readonly PiThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/**
 * Maps a Piwin product level to the canonical level accepted by Pi.
 *
 * This deliberately does not produce a Provider API value. Pi receives the
 * canonical level and applies the selected model's `thinkingLevelMap` when it
 * builds the request for the Provider.
 */
export function mapThinkingLevelToPi(
  level: ThinkingLevel,
  protocol: ModelRef['protocol'] | undefined,
): PiThinkingLevel {
  if (level !== 'ultra') {
    return level;
  }
  if (protocol === 'anthropic-compatible') {
    return 'max';
  }
  // OpenAI-compatible and Google Gemini product Ultra use Pi's xhigh level.
  return 'xhigh';
}

/**
 * Converts the configured Piwin model levels into Pi's model-level map.
 *
 * An explicit list is authoritative: configured levels map to their canonical
 * Provider values and every omitted level is marked unsupported. `ultra` is
 * represented by the protocol-appropriate Pi maximum because Pi has no
 * product-only ultra level of its own.
 */
export function buildThinkingLevelMap(
  levels: readonly ThinkingLevel[] | undefined,
  protocol: ModelRef['protocol'] | undefined,
): PiThinkingLevelMap | undefined {
  if (!levels || levels.length === 0) {
    return undefined;
  }

  const supportedLevels = new Set<PiThinkingLevel>();
  for (const level of levels) {
    supportedLevels.add(mapThinkingLevelToPi(level, protocol));
  }

  const thinkingLevelMap: PiThinkingLevelMap = {};
  for (const level of PI_THINKING_LEVELS) {
    thinkingLevelMap[level] = supportedLevels.has(level) ? level : null;
  }
  return thinkingLevelMap;
}

/**
 * Projects Pi's `thinkingLevelMap` into the UI option list using Pi's own
 * `getSupportedThinkingLevels`. Desktop never sees the map, so this has to
 * happen at the agent-host catalog boundary — Pi will not filter our chips.
 *
 * Catalog maps often list every canonical key, with `null` meaning
 * unsupported. Taking `Object.keys(map)` would surface those as chips.
 */
export function thinkingLevelsFromPiMap(
  map: Readonly<Record<string, string | null | undefined>> | undefined,
): readonly PiThinkingLevel[] | undefined {
  if (!map || typeof map !== 'object') {
    return undefined;
  }

  // Pi's helper is typed on a full Model; catalog projection only has the map.
  const catalogSlice = {
    reasoning: true,
    thinkingLevelMap: map,
  } as unknown as Parameters<typeof getSupportedThinkingLevels>[0];
  const allowedLevels = new Set<string>(PI_THINKING_LEVELS);
  const levels = getSupportedThinkingLevels(catalogSlice).filter(
    (level): level is PiThinkingLevel => allowedLevels.has(level),
  );
  return levels.length > 0 ? levels : undefined;
}

/**
 * Backward-compatible export name. The returned value is a Pi canonical level,
 * not a Provider API value; Provider conversion happens through Pi's map.
 */
export const mapThinkingLevelToApi = mapThinkingLevelToPi;
