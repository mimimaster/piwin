import type {
  HostBookEntry,
  HostClientHello,
  HostHello,
  PairingLinkV3,
  TrustedDeviceCredential,
} from '@piwin/contracts';
import {
  createRelaySecureWebSocketFactory,
  decodeBase64Url,
  HostHandshakeError,
  parsePairingLinkV3,
  WebSocketHostTransport,
  type NoiseKeyPair,
  type RelayInnerSocketFactory,
} from '@piwin/host-transport';
import { parsePairingString, type ParsedPairingData } from '../pairing-code.js';
import type { HostBook } from './host-book.js';
import { HostDialPlan, type DialChoice } from './host-dial-plan.js';
import { RemoteHostVault } from './remote-host-vault.js';

export type PairingInput =
  { kind: 'channel'; link: PairingLinkV3 } | { kind: 'legacy'; data: ParsedPairingData };

/**
 * A scanned QR or pasted link: ADR 0101 v3 first, then the older formats a
 * Host still issues during the migration window. Throws the same localized
 * errors as `parsePairingString` for anything unrecognized or expired.
 */
export function classifyPairingInput(raw: string, now: number = Date.now()): PairingInput {
  const link = parsePairingLinkV3(raw);
  if (link !== undefined) {
    if (link.expiresAt <= now) {
      throw new Error('配对码已过期，请在 Host 上重新生成。');
    }
    return { kind: 'channel', link };
  }
  return { kind: 'legacy', data: parsePairingString(raw) };
}

export type ChannelDialer = (input: {
  choice: DialChoice;
  target: Pick<HostBookEntry, 'userId' | 'hostId' | 'hostKey'>;
  clientKeyPair: NoiseKeyPair;
  hello: HostClientHello;
}) => Promise<{ hello: HostHello; close: () => Promise<void> }>;

/** Dials one path with a one-shot `WebSocketHostTransport` over the channel. */
export function createChannelDialer(createInnerSocket: RelayInnerSocketFactory): ChannelDialer {
  return async ({ choice, target, clientKeyPair, hello }) => {
    const transport = new WebSocketHostTransport({
      endpoint: choice.url,
      autoReconnect: false,
      createHello: (lastSeq) => ({ ...hello, lastSeq }),
      webSocketFactory: createRelaySecureWebSocketFactory({
        userId: target.userId,
        hostId: target.hostId,
        hostKey: decodeBase64Url(target.hostKey) ?? new Uint8Array(),
        clientStaticKeyPair: clientKeyPair,
        createInnerSocket,
      }),
    });
    return { hello: await transport.connect(), close: () => transport.close() };
  };
}

/**
 * Tries the plan's paths in order (relay, then direct). A Host refusal
 * (`HostHandshakeError`) is final; a path that could not be reached moves on.
 */
export async function dialFirstReachable(
  plan: HostDialPlan,
  dial: (choice: DialChoice) => Promise<{ hello: HostHello; close: () => Promise<void> }>,
): Promise<{ hello: HostHello; close: () => Promise<void>; choice: DialChoice }> {
  let lastError: unknown = new Error('This Host has no relay or direct address');
  for (const choice of plan.candidates()) {
    try {
      return { ...(await dial(choice)), choice };
    } catch (error) {
      if (error instanceof HostHandshakeError) throw error;
      lastError = error;
    }
  }
  throw lastError;
}

/**
 * Pairs this shell with the Host behind a v3 link: fresh client key, hello
 * with the one-time token over the first reachable path, then the entry goes
 * into the host book and the key + credential into the vault.
 */
export async function pairRemoteHost(input: {
  link: PairingLinkV3;
  hostBook: HostBook;
  vault: RemoteHostVault;
  dial: ChannelDialer;
  hello: Omit<HostClientHello, 'pairingToken' | 'deviceCredential' | 'authToken' | 'lastSeq'>;
  alias?: string;
  now?: () => Date;
}): Promise<HostBookEntry> {
  const { link } = input;
  const clientKeyPair = RemoteHostVault.generateClientKeyPair();
  const plan = new HostDialPlan(link);
  const hello: HostClientHello = { ...input.hello, lastSeq: 0, pairingToken: link.pairingToken };
  const result = await dialFirstReachable(plan, (choice) =>
    input.dial({ choice, target: link, clientKeyPair, hello }),
  );
  await result.close();
  const credential = issuedCredential(result.hello);
  const entry: HostBookEntry = {
    userId: result.hello.endpoints?.userId ?? link.userId,
    userName: result.hello.endpoints?.userName ?? link.userName,
    hostId: link.hostId,
    hostName: result.hello.endpoints?.hostName ?? link.hostName,
    hostKey: link.hostKey,
    ...(link.relayUrl === undefined ? {} : { relayUrl: link.relayUrl }),
    ...(link.directUrl === undefined ? {} : { directUrl: link.directUrl }),
    role: link.role,
    ...(input.alias === undefined ? {} : { alias: input.alias }),
    pairedAt: (input.now?.() ?? new Date()).toISOString(),
  };
  // Secret first: an entry without a credential would be unusable.
  await input.vault.write(link.hostId, { clientKeyPair, credential });
  const stored = await input.hostBook.upsert(entry);
  if (result.hello.endpoints !== undefined) {
    return (await input.hostBook.applyEndpoints(link.hostId, result.hello.endpoints)) ?? stored;
  }
  return stored;
}

function issuedCredential(hello: HostHello): TrustedDeviceCredential {
  if (hello.deviceId === undefined || hello.deviceSecret === undefined) {
    throw new Error('The Host did not issue a device credential');
  }
  return { deviceId: hello.deviceId, deviceSecret: hello.deviceSecret };
}
