import { createHash } from 'node:crypto';
import type { HostCommand } from '@piwin/contracts';
export { remoteCommandRequiresIdempotencyKey } from '@piwin/contracts';

export function createRemoteCommandDigest(command: HostCommand): string {
  const { id: _id, ...canonical } = command;
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
