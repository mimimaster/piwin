import { createConnection } from 'node:net';
import type { JobReadinessProbe } from '@piwin/contracts';

/**
 * One readiness attempt. Resolves true once the service answers: a refused
 * connection or a 5xx response means "not ready yet", never a thrown error.
 * The caller owns retries and the overall timeout.
 */
export function probeReadiness(
  probe: JobReadinessProbe,
  host: string,
  signal: AbortSignal,
): Promise<boolean> {
  if (probe.type === 'tcp') return probeTcp(host, probe.port, signal);
  if (probe.type === 'http') return probeHttp(host, probe.port, probe.path ?? '/', signal);
  return Promise.resolve(false);
}

async function probeTcp(host: string, port: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    const conn = createConnection({ host, port }, () => {
      conn.destroy();
      resolve(true);
    });
    conn.on('error', () => resolve(false));
    signal.addEventListener(
      'abort',
      () => {
        conn.destroy();
        resolve(false);
      },
      { once: true },
    );
  });
}

async function probeHttp(
  host: string,
  port: number,
  path: string,
  signal: AbortSignal,
): Promise<boolean> {
  try {
    const url = `http://${host}:${port}${path}`;
    const response = await fetch(url, { signal });
    return response.ok || response.status < 500;
  } catch {
    return false;
  }
}
