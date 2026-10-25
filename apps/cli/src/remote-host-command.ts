import { randomUUID } from 'node:crypto';
import {
  classifyPairingInput,
  createChannelDialer,
  groupHostBookByUser,
  pairRemoteHost,
} from '@piwin/host-client';
import { getPiwinRoot } from '@piwin/host-runtime/paths';
import { collectPositionals, readOption } from './cli-args.js';
import { CLI_CLIENT_VERSION, createNodeRelayInnerSocket } from './cli-remote-attach.js';
import { openCliRemoteHosts, type CliRemoteHosts } from './cli-remote-hosts.js';

const PAIR_USAGE = "Usage: piwin pair '<piwin://pair?v=3…>' [--alias <name>]";
const HOSTS_USAGE = `Usage:
  piwin hosts list
  piwin hosts use <alias|hostId|name> | --local
  piwin hosts alias <alias|hostId|name> <alias>
  piwin hosts forget <alias|hostId|name>`;

export type RemoteHostCommandIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  piwinRoot?: string;
};

const defaultIo: RemoteHostCommandIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** `piwin pair '<link>'`: pairs this CLI with a Host over the ADR 0101 channel. */
export async function commandPair(
  argv: string[],
  io: RemoteHostCommandIo = defaultIo,
): Promise<number> {
  const [raw] = collectPositionals(argv.slice(1), ['--alias']);
  if (raw === undefined) {
    io.err(PAIR_USAGE);
    return 1;
  }
  const input = classifyPairingInput(raw);
  if (input.kind !== 'channel') {
    io.err(
      'This is an older pairing code. Generate a new one on an updated Host (it starts with piwin://pair?v=3).',
    );
    return 1;
  }
  const hosts = openCliRemoteHosts(io.piwinRoot ?? getPiwinRoot());
  const alias = readOption(argv, '--alias');
  const entry = await pairRemoteHost({
    link: input.link,
    hostBook: hosts.hostBook,
    vault: hosts.vault,
    dial: createChannelDialer(createNodeRelayInnerSocket),
    hello: {
      type: 'client/hello',
      protocolVersion: 1,
      clientType: 'cli',
      clientVersion: CLI_CLIENT_VERSION,
      clientId: `cli-${randomUUID()}`,
      deviceName: 'piwin CLI',
    },
    ...(alias === undefined ? {} : { alias }),
  });
  const selector = entry.alias ?? entry.hostId;
  io.out(`Paired with ${entry.hostName} (${entry.userName}) as ${entry.role}.`);
  io.out(`Use it once:  PIWIN_HOST=${selector} piwin status`);
  io.out(`Or by default: piwin hosts use ${selector}`);
  return 0;
}

/** `piwin hosts list | use | alias | forget`. */
export async function commandHosts(
  argv: string[],
  io: RemoteHostCommandIo = defaultIo,
): Promise<number> {
  const [action = 'list', selector, value] = collectPositionals(argv.slice(1), []);
  const hosts = openCliRemoteHosts(io.piwinRoot ?? getPiwinRoot());
  if (action === 'list') {
    return listHosts(hosts, io);
  }
  if (action === 'use' && argv.includes('--local')) {
    await hosts.writeDefaultHostId(undefined);
    io.out('Commands now run on a Host in this process unless PIWIN_HOST is set.');
    return 0;
  }
  if (selector === undefined) {
    io.err(HOSTS_USAGE);
    return 1;
  }
  const entry = await hosts.findHost(selector);
  if (entry === undefined) {
    io.err(`No paired Host matches "${selector}".`);
    return 1;
  }
  if (action === 'use') {
    await hosts.writeDefaultHostId(entry.hostId);
    io.out(`Commands now attach to ${entry.hostName}. \`piwin hosts use --local\` undoes this.`);
    return 0;
  }
  if (action === 'alias' && value !== undefined) {
    await hosts.hostBook.setAlias(entry.hostId, value);
    io.out(`${entry.hostName} is now "${value}".`);
    return 0;
  }
  if (action === 'forget') {
    await hosts.hostBook.remove(entry.hostId);
    await hosts.vault.clear(entry.hostId);
    if ((await hosts.readDefaultHostId()) === entry.hostId) {
      await hosts.writeDefaultHostId(undefined);
    }
    io.out(`Forgot ${entry.hostName}. Revoke this device on the Host to cut it off there too.`);
    return 0;
  }
  io.err(HOSTS_USAGE);
  return 1;
}

async function listHosts(hosts: CliRemoteHosts, io: RemoteHostCommandIo): Promise<number> {
  const entries = await hosts.hostBook.list();
  if (entries.length === 0) {
    io.out("No paired Hosts. Pair one with: piwin pair '<link>'");
    return 0;
  }
  const defaultHostId = await hosts.readDefaultHostId();
  for (const group of groupHostBookByUser(entries)) {
    io.out(`${group.userName} (${group.userId})`);
    for (const entry of group.entries) {
      const paths = [
        entry.relayUrl === undefined ? undefined : 'relay',
        entry.directUrl === undefined ? undefined : 'direct',
      ]
        .filter((path) => path !== undefined)
        .join('+');
      const mark = entry.hostId === defaultHostId ? '*' : ' ';
      const alias = entry.alias === undefined ? '' : ` "${entry.alias}"`;
      io.out(`  ${mark} ${entry.hostName}${alias}  ${entry.hostId}  ${entry.role}  ${paths}`);
    }
  }
  return 0;
}
