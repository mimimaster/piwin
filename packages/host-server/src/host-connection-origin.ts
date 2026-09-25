import type { IncomingMessage } from 'node:http';

/**
 * Headers an HTTP reverse proxy or tunnel adds when it relays a request.
 * A proxy on this machine connects from 127.0.0.1, so the peer address alone
 * cannot tell "the operator's own Desktop" from "anyone on the internet
 * behind Caddy / nginx / Tailscale Serve / Cloudflare Tunnel".
 */
const PROXY_HEADERS = [
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'cf-connecting-ip',
  'true-client-ip',
  'tailscale-user-login',
] as const;

/**
 * True only for a WebSocket opened by a process on this machine that was not
 * relaying someone else's request. Only such connections may skip auth on a
 * loopback-bound Host. TCP forwarders (frp, ngrok tcp, socat) add no headers;
 * the Host entry refuses to advertise a remote URL without a token for that.
 */
export function isDirectLoopbackRequest(
  request: Pick<IncomingMessage, 'headers'> & { socket: { remoteAddress?: string | undefined } },
): boolean {
  if (!isLoopbackAddress(request.socket.remoteAddress)) {
    return false;
  }
  return PROXY_HEADERS.every((header) => request.headers[header] === undefined);
}

export function isLoopbackAddress(address: string | undefined): boolean {
  if (address === undefined) {
    return false;
  }
  const normalized = address.startsWith('::ffff:') ? address.slice('::ffff:'.length) : address;
  return normalized === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(normalized);
}
