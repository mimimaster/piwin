/** True when Desktop is talking to a Host on this machine. Loopback OAuth works. */
export function isLoopbackHostEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) {
    return false;
  }
  try {
    const host = new URL(endpoint).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === '127.0.0.1' || host === 'localhost' || host === '::1';
  } catch {
    return false;
  }
}
