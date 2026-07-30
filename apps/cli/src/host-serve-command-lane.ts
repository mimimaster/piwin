/**
 * ADR 0015: classify host JSONL commands into lanes so control operations
 * are never serialized behind a long model turn.
 */
import type { HostCommand } from '@piwin/contracts';

export type HostServeCommandLane = 'control' | 'serialized' | 'concurrent';

const CONTROL_COMMAND_TYPES = new Set<HostCommand['type']>([
  'session/abort',
  'session/compact-abort',
  'session/steer',
  'session/follow_up',
  'permission/resolve',
  'extension/ui_resolve',
  'host/ping',
  'host/status',
  'project/authorize-terminal',
  'pet/cancel',
]);

const SERIALIZED_COMMAND_TYPES = new Set<HostCommand['type']>([
  'config/set',
  'mcp/save',
  'mcp/start',
  'mcp/stop',
  'skills/install',
  'skills/set_enabled',
  'extensions/install',
  'extensions/set_enabled',
  'prompts/set_enabled',
  'theme/set-active',
  'theme/install-local',
  'pet/set-active',
  'pet/install-local',
  'pet/install-registry',
  'session/rename',
  'session/archive',
  'session/unarchive',
  'session/delete',
  'session/duplicate',
  'session/pin',
  'session/unpin',
  'secrets/set',
  'hooks/set',
  'cron/upsert',
  'cron/delete',
]);

/**
 * Control lane: must bypass the serial queue (abort, permission resolve, health).
 * Serialized lane: durable mutations that need process-wide ordering.
 * Concurrent lane: queries and already-acknowledged run starts (session/prompt).
 */
export function classifyHostServeCommand(command: HostCommand): HostServeCommandLane {
  if (CONTROL_COMMAND_TYPES.has(command.type)) {
    return 'control';
  }
  if (SERIALIZED_COMMAND_TYPES.has(command.type)) {
    return 'serialized';
  }
  return 'concurrent';
}

export function isControlLaneCommand(command: HostCommand): boolean {
  return classifyHostServeCommand(command) === 'control';
}
