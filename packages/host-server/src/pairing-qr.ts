import { HOST_PROTOCOL_VERSION } from '@piwin/contracts';
import { isWildcardHostBind } from './host-hello-auth.js';

export type PairingQrPayload = {
  v: 1;
  endpoint: string;
  pairingToken: string;
  hostInstanceId: string;
  protocolVersion: typeof HOST_PROTOCOL_VERSION;
  expiresAt: number;
};

export function createPairingQrPayload(input: {
  advertisedEndpoint: string;
  pairingToken: string;
  hostInstanceId: string;
  expiresAt: number;
}): PairingQrPayload {
  const endpoint = input.advertisedEndpoint.trim();
  if (endpoint.length === 0) {
    throw new Error('Pairing QR requires an advertised endpoint');
  }
  assertPairingEndpointIsDialable(endpoint);
  return {
    v: 1,
    endpoint,
    pairingToken: input.pairingToken,
    hostInstanceId: input.hostInstanceId,
    protocolVersion: HOST_PROTOCOL_VERSION,
    expiresAt: input.expiresAt,
  };
}

export function pairingQrUri(payload: PairingQrPayload): string {
  const params = new URLSearchParams({
    endpoint: payload.endpoint,
    pairingToken: payload.pairingToken,
    hostInstanceId: payload.hostInstanceId,
    expiresAt: String(payload.expiresAt),
  });
  return `piwin://pair?${params.toString()}`;
}

/**
 * A listener may bind a wildcard address (the bundled app listens on all
 * interfaces), but the QR must name an address a phone can dial.
 */
export function assertPairingEndpointIsDialable(endpoint: string): void {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname;
  } catch {
    throw new Error(`Pairing endpoint is not a valid URL: ${endpoint}`);
  }
  if (isWildcardHostBind(hostname)) {
    throw new Error(
      'Refusing to print a pairing QR for a wildcard address; advertise a LAN or tailnet address instead',
    );
  }
}
