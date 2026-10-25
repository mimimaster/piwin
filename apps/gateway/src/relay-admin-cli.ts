import { isRemoteId } from '@piwin/contracts';
import { parseRelayEnrollmentLine } from '@piwin/host-transport';
import { readIntegerFlag, type ParsedRelayArgs } from './relay-cli-args.js';
import { loadRelayRegistry, saveRelayRegistry } from './relay-registry-store.js';
import { RelayUserRegistry, type RelayUserLimits } from './relay-user-registry.js';

export const RELAY_ADMIN_USAGE = `Usage:
  piwin-gateway user add '<piwin-user:v1:…>' [--max-hosts N] [--max-peers N]
  piwin-gateway user list
  piwin-gateway user disable|enable|remove <userId>
  piwin-gateway host deny|allow <hostId>

All commands take --users <path> (default ./users.json or $PIWIN_RELAY_USERS).
A running relay picks changes up within a few seconds.`;

/**
 * `user …` / `host …` admin commands. They edit users.json; the running relay
 * reloads it (see relay-registry-watch.ts). Returns the process exit code.
 */
export async function runRelayAdminCommand(
  args: ParsedRelayArgs,
  input: { usersPath: string; out: (line: string) => void },
): Promise<number> {
  const [scope, action, target] = args.positionals;
  const registry = new RelayUserRegistry(await loadRelayRegistry(input.usersPath));
  const save = () => saveRelayRegistry(input.usersPath, registry.snapshot());

  if (scope === 'user' && action === 'list') {
    const users = registry.list();
    if (users.length === 0) {
      input.out('No relay users.');
    }
    for (const user of users) {
      const limits = user.limits ? ` limits=${JSON.stringify(user.limits)}` : '';
      input.out(
        `${user.userId}  ${user.disabled ? 'disabled' : 'enabled '}  ${user.name}${limits}`,
      );
    }
    return 0;
  }

  if (scope === 'user' && action === 'add') {
    const user = target === undefined ? undefined : parseRelayEnrollmentLine(target);
    if (user === undefined) {
      input.out('Not a relay enrollment line (expected piwin-user:v1:<key>:<name>).');
      return 1;
    }
    const limits: Partial<RelayUserLimits> = {};
    const maxHosts = readIntegerFlag(args.flags, 'max-hosts', { min: 1, max: 1_000 });
    const maxPeers = readIntegerFlag(args.flags, 'max-peers', { min: 1, max: 1_000 });
    if (maxHosts !== undefined) limits.maxHosts = maxHosts;
    if (maxPeers !== undefined) limits.maxPeersPerHost = maxPeers;
    const result = registry.addUser(user, Object.keys(limits).length > 0 ? limits : undefined);
    if (result === 'exists') {
      input.out(`User ${user.userId} is already registered.`);
      return 0;
    }
    await save();
    input.out(`Added ${user.name} (${user.userId}).`);
    return 0;
  }

  if (scope === 'user' && (action === 'disable' || action === 'enable' || action === 'remove')) {
    if (!isRemoteId(target)) {
      input.out('Expected a user id.');
      return 1;
    }
    const changed =
      action === 'remove'
        ? registry.removeUser(target)
        : registry.setDisabled(target, action === 'disable');
    if (!changed) {
      input.out(`No user ${target}.`);
      return 1;
    }
    await save();
    input.out(`User ${target} ${action === 'remove' ? 'removed' : `${action}d`}.`);
    return 0;
  }

  if (scope === 'host' && (action === 'deny' || action === 'allow')) {
    if (!isRemoteId(target)) {
      input.out('Expected a host id.');
      return 1;
    }
    registry.setHostDenied(target, action === 'deny');
    await save();
    input.out(`Host ${target} ${action === 'deny' ? 'denied' : 'allowed'}.`);
    return 0;
  }

  input.out(RELAY_ADMIN_USAGE);
  return 1;
}
