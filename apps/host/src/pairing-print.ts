import {
  assertPairingBindIsAdvertisable,
  createPairingQrPayload,
  pairingQrUri,
  type PairingQrPayload,
} from '@piwin/host-server';

export function resolveAdvertisedEndpoint(
  advertisedUrl: string | undefined,
  bindUrl: string,
): string {
  const advertised = advertisedUrl?.trim();
  return advertised !== undefined && advertised.length > 0 ? advertised : bindUrl;
}

export function createHostPairingAnnouncement(input: {
  bindHost: string;
  advertisedEndpoint: string;
  pairingToken: string;
  hostInstanceId: string;
  expiresAt: number;
}): { payload: PairingQrPayload; text: string } {
  assertPairingBindIsAdvertisable(input.bindHost);
  const payload = createPairingQrPayload({
    advertisedEndpoint: input.advertisedEndpoint,
    pairingToken: input.pairingToken,
    hostInstanceId: input.hostInstanceId,
    expiresAt: input.expiresAt,
  });
  return {
    payload,
    text: [
      '[piwin-host] pairing (one-time, ~10 min). Scan from the same Host process.',
      JSON.stringify(payload),
      pairingQrUri(payload),
    ].join('\n'),
  };
}
