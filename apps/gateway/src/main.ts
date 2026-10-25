#!/usr/bin/env node
import { resolve } from 'node:path';
import { RELAY_ADMIN_USAGE, runRelayAdminCommand } from './relay-admin-cli.js';
import { parseRelayArgs, readIntegerFlag, type ParsedRelayArgs } from './relay-cli-args.js';
import { RelayEnrollToken } from './relay-enroll-token.js';
import { createConsoleRelayLogger } from './relay-log.js';
import { loadRelayRegistry, saveRelayRegistry } from './relay-registry-store.js';
import { watchRelayRegistry } from './relay-registry-watch.js';
import { createRelayServer } from './relay-server.js';
import { RelayUserRegistry } from './relay-user-registry.js';

const SERVE_USAGE = `Usage:
  piwin-gateway serve [--port 7466] [--host 0.0.0.0] [--users ./users.json]
                      [--web-root <dir>] [--trust-proxy] [--log-ips]

Environment:
  PIWIN_RELAY_ENROLL_TOKEN  lets a Host register its user on first connect
  PIWIN_RELAY_USERS         default for --users
  PORT                      default for --port

The relay speaks plain ws://; put a TLS reverse proxy in front of it.`;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseRelayArgs(argv);
  const usersPath = resolve(
    args.flags.get('users') ?? process.env.PIWIN_RELAY_USERS ?? 'users.json',
  );
  const command = args.positionals[0];
  if (command === 'serve') {
    return serve(args, usersPath);
  }
  if (command === 'user' || command === 'host') {
    return runRelayAdminCommand(args, { usersPath, out: (line) => console.log(line) });
  }
  console.log(`${SERVE_USAGE}\n\n${RELAY_ADMIN_USAGE}`);
  return args.flags.has('help') || command === 'help' ? 0 : 1;
}

async function serve(args: ParsedRelayArgs, usersPath: string): Promise<number> {
  const port =
    readIntegerFlag(args.flags, 'port', { min: 0, max: 65_535 }) ??
    (process.env.PORT === undefined ? 7466 : Number(process.env.PORT));
  const host = args.flags.get('host') ?? '0.0.0.0';
  const webRoot = args.flags.get('web-root');
  const log = createConsoleRelayLogger({ logIps: args.flags.has('log-ips') });
  const registry = new RelayUserRegistry(await loadRelayRegistry(usersPath));
  const enrollToken = RelayEnrollToken.fromEnvironment(process.env.PIWIN_RELAY_ENROLL_TOKEN);

  const server = createRelayServer({
    registry,
    persistRegistry: () => saveRelayRegistry(usersPath, registry.snapshot()),
    ...(enrollToken === undefined ? {} : { enrollToken }),
    ...(webRoot === undefined ? {} : { webRoot: resolve(webRoot) }),
    trustProxy: args.flags.has('trust-proxy'),
    log,
  });
  const stopWatching = watchRelayRegistry({
    path: usersPath,
    registry,
    onReloaded: () => server.reconcileRegistry(),
    log,
  });
  await server.listen(port, host);
  console.log(
    `piwin-gateway: ${registry.list().length} user(s) from ${usersPath}` +
      (enrollToken === undefined ? '' : '; self-enrollment enabled'),
  );

  await new Promise<void>((resolveStop) => {
    const stop = (): void => resolveStop();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  stopWatching();
  await server.close();
  return 0;
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    console.error(`piwin-gateway: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  },
);
