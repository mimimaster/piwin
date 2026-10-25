import type { HostWireMessage } from '@piwin/contracts';

/** What a `migrate-only` legacy connection may still send (ADR 0101 §10). */
const MIGRATE_ONLY_COMMANDS = new Set<string>(['host/ping', 'host/channel-migrate']);

export const SECURE_CHANNEL_REQUIRED_MESSAGE =
  'secure-channel-required: this Host only serves the end-to-end channel; migrate or re-pair';

export function isAllowedWhileMigrateOnly(message: HostWireMessage): boolean {
  return message.type === 'command' && MIGRATE_ONLY_COMMANDS.has(message.command.type);
}
