import type { HostServer, HostServerAddress } from './host-server.js';
import { isAddressInUseError } from './listen-busy.js';

/** How many ports past the preferred one the phone listener tries before giving up. */
export const MOBILE_ACCESS_PORT_SCAN_SPAN = 10;

/**
 * Start a fresh server on `preferredPort`, walking upward while the port is
 * taken (another app or a second piwin instance). Port 0 means "any port"
 * and is tried once. Each attempt gets a new server because a HostServer that
 * failed to listen has already torn itself down.
 */
export async function startWithPortFallback(
  createServer: (port: number) => HostServer,
  preferredPort: number,
): Promise<{ server: HostServer; address: HostServerAddress }> {
  const lastPort =
    preferredPort === 0 ? 0 : Math.min(65_535, preferredPort + MOBILE_ACCESS_PORT_SCAN_SPAN);
  for (let port = preferredPort; port <= lastPort; port += 1) {
    const server = createServer(port);
    try {
      const address = await server.start();
      return { server, address };
    } catch (error) {
      if (!isAddressInUseError(error)) {
        throw error;
      }
      // Busy: try the next port.
    }
  }
  const error = new Error(
    `Phone access found no free port in ${preferredPort}–${lastPort}; free one of them or quit the app holding them.`,
  );
  error.name = 'MobileAccessPortBusyError';
  throw error;
}
