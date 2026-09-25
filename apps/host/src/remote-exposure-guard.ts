/**
 * A Host that advertises an address other machines dial is exposed beyond
 * this computer. Without a door token its operator lane would rest on
 * "connections look local", which a TCP forwarder (frp, ngrok tcp, socat)
 * on this machine defeats: it adds no proxy headers and connects from
 * 127.0.0.1. Refuse that configuration instead of guessing.
 *
 * Returns the operator-facing error, or undefined when the config is safe.
 */
export function findRemoteExposureWithoutToken(input: {
  advertisedUrl: string | undefined;
  authToken: string | undefined;
}): string | undefined {
  const advertised = input.advertisedUrl?.trim();
  if (input.authToken !== undefined || advertised === undefined || advertised.length === 0) {
    return undefined;
  }
  let hostname: string;
  try {
    hostname = new URL(advertised).hostname;
  } catch {
    return `PIWIN_HOST_ADVERTISED_URL is not a valid URL: ${advertised}`;
  }
  if (hostname === 'localhost' || hostname === '[::1]' || /^127\./.test(hostname)) {
    return undefined;
  }
  return [
    `PIWIN_HOST_ADVERTISED_URL=${advertised} exposes this Host to other machines, but PIWIN_HOST_TOKEN is not set.`,
    'Anyone who reaches that address could operate the Host. Set PIWIN_HOST_TOKEN to a long random value',
    '(Desktop enters it in Settings → Remote Host → Token; phones keep pairing by QR without it).',
  ].join('\n');
}
