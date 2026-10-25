import { readFile } from 'node:fs/promises';
import type {
  HostCommand,
  HostResponse,
  MobileAccessPairingCodeData,
  RemoteAccessStatusData,
} from '@piwin/contracts';
import { isLegacyAccessMode, readHostPairingStatusData } from '@piwin/contracts';
import type { HostClient } from '@piwin/host-client';
import { collectPositionals, readOption } from './cli-args.js';
import {
  connectCliAttachedHost,
  describeCliHostTarget,
  resolveCliHostAttachTarget,
} from './attach-existing-host.js';

const RELAY_USAGE = `Usage (runs on the attached Host; you must be its operator):
  piwin host pair [--operator]
  piwin relay status
  piwin relay configure --url <wss://…> [--enroll-token <token>] | --off
  piwin relay legacy full|migrate-only|off
  piwin relay user create <name> | rename <name> | enrollment-line
  piwin relay user export [--passphrase-file <path>]
  piwin relay user import <bundle|@file> [--passphrase-file <path>]

Attach with PIWIN_HOST=<alias> (an operator device) or, on the Host's machine,
PIWIN_HOST_URL=ws://127.0.0.1:<port>. Passphrases come from
--passphrase-file or PIWIN_RELAY_PASSPHRASE.`;

export type RelayCommandIo = {
  out: (line: string) => void;
  err: (line: string) => void;
  env?: NodeJS.ProcessEnv;
  piwinRoot?: string;
};

const defaultIo: RelayCommandIo = {
  out: (line) => console.log(line),
  err: (line) => console.error(line),
};

/** `piwin host pair` and `piwin relay …`: Host-owned ADR 0101 commands. */
export async function commandRelay(
  argv: string[],
  io: RelayCommandIo = defaultIo,
): Promise<number> {
  const plan = parseRelayCommand(argv, io.env ?? process.env);
  if (plan === undefined) {
    io.err(RELAY_USAGE);
    return 1;
  }
  const target = await resolveCliHostAttachTarget(io.env ?? process.env, io.piwinRoot);
  if (target === undefined) {
    io.err('No Host is attached. Pairing and relay settings live in a running Host.');
    io.err(RELAY_USAGE);
    return 1;
  }
  const client = await connectCliAttachedHost(target, io.piwinRoot);
  try {
    const command = await plan.command();
    const response = await client.request(command);
    if (!response.success) {
      io.err(`${describeCliHostTarget(target)}: ${response.error}`);
      return 1;
    }
    plan.print(response, io);
    return 0;
  } finally {
    await client.close();
  }
}

type RelayPlan = {
  command: () => Promise<HostCommand>;
  print: (response: Extract<HostResponse, { success: true }>, io: RelayCommandIo) => void;
};

function parseRelayCommand(argv: string[], env: NodeJS.ProcessEnv): RelayPlan | undefined {
  const [scope, action, sub, value] = argv;
  if (scope === 'host' && action === 'pair') {
    return {
      command: async () => ({
        type: 'host/pairing-create-code',
        role: argv.includes('--operator') ? 'operator' : 'member',
      }),
      print: (response, io) => printPairingCode(response.data as MobileAccessPairingCodeData, io),
    };
  }
  if (scope !== 'relay') return undefined;
  if (action === 'status') {
    return { command: async () => ({ type: 'host/pairing-status' }), print: printStatus };
  }
  if (action === 'configure') {
    const url = readOption(argv, '--url');
    const enrollToken = readOption(argv, '--enroll-token');
    const relay = argv.includes('--off')
      ? { enabled: false }
      : url === undefined
        ? undefined
        : { enabled: true, url, ...(enrollToken === undefined ? {} : { enrollToken }) };
    if (relay === undefined) return undefined;
    return {
      command: async () => ({ type: 'host/remote-access-configure', relay }),
      print: printRemoteStatus,
    };
  }
  if (action === 'legacy' && isLegacyAccessMode(sub)) {
    return {
      command: async () => ({ type: 'host/remote-access-configure', legacyAccess: sub }),
      print: printRemoteStatus,
    };
  }
  if (action !== 'user') return undefined;
  const name = collectPositionals(argv.slice(3), ['--passphrase-file']).join(' ').trim();
  switch (sub) {
    case 'create':
    case 'rename':
      if (name.length === 0) return undefined;
      return {
        command: async () => ({
          type: sub === 'create' ? 'host/relay-user-create' : 'host/relay-user-rename',
          name,
        }),
        print: printRemoteStatus,
      };
    case 'enrollment-line':
      return {
        command: async () => ({ type: 'host/relay-user-enrollment-line' }),
        print: (response, io) => io.out((response.data as { line: string }).line),
      };
    case 'export':
      return {
        command: async () => ({
          type: 'host/relay-user-export',
          passphrase: await readPassphrase(argv, env),
        }),
        print: (response, io) => io.out((response.data as { bundle: string }).bundle),
      };
    case 'import':
      if (value === undefined) return undefined;
      return {
        command: async () => ({
          type: 'host/relay-user-import',
          bundle: value.startsWith('@') ? (await readFile(value.slice(1), 'utf8')).trim() : value,
          passphrase: await readPassphrase(argv, env),
        }),
        print: printRemoteStatus,
      };
    default:
      return undefined;
  }
}

async function readPassphrase(argv: string[], env: NodeJS.ProcessEnv): Promise<string> {
  const file = readOption(argv, '--passphrase-file');
  const passphrase =
    file !== undefined
      ? (await readFile(file, 'utf8')).replace(/\r?\n$/, '')
      : env.PIWIN_RELAY_PASSPHRASE;
  if (passphrase === undefined || passphrase.length === 0) {
    throw new Error('A passphrase is required: --passphrase-file <path> or PIWIN_RELAY_PASSPHRASE');
  }
  return passphrase;
}

function printPairingCode(code: MobileAccessPairingCodeData, io: RelayCommandIo): void {
  if (code.channelUri === undefined) {
    io.out(`Pairing code (legacy, this Host has no channel path yet): ${code.uri}`);
    return;
  }
  io.out('Pairing link (one-time, ~10 min):');
  io.out(code.channelUri);
  if (code.webUri !== undefined) io.out(`Browser: ${code.webUri}`);
}

function printStatus(response: Extract<HostResponse, { success: true }>, io: RelayCommandIo): void {
  const status = readHostPairingStatusData(response.data);
  if (status?.remote === undefined) {
    io.out('This Host has no ADR 0101 remote access.');
    return;
  }
  printRemote(status.remote, io);
}

function printRemoteStatus(
  response: Extract<HostResponse, { success: true }>,
  io: RelayCommandIo,
): void {
  printRemote(response.data as RemoteAccessStatusData, io);
}

function printRemote(remote: RemoteAccessStatusData, io: RelayCommandIo): void {
  io.out(`Host:   ${remote.hostName} (${remote.hostId})`);
  if (remote.user !== undefined) io.out(`User:   ${remote.user.name} (${remote.user.userId})`);
  const relay = remote.relay;
  io.out(
    `Relay:  ${relay.enabled ? `${relay.url ?? '?'} — ${relay.state}` : 'off'}` +
      (relay.lastCloseCode === undefined ? '' : ` (last close ${relay.lastCloseCode})`),
  );
  io.out(`Direct: ${remote.direct.enabled ? (remote.direct.url ?? 'on') : 'off'}`);
  io.out(`Legacy: ${remote.legacyAccess}`);
}
