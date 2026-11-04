/**
 * Minimal Chrome DevTools Protocol client over Node's global WebSocket.
 *
 * Deliberately hand-rolled: the extension must stay installable with no
 * `npm install` (piwin cannot stage npm-dependent packages from a Git URL), and
 * the surface we need is three domains — Target, Runtime, Input.
 *
 * Invariants:
 * - Every request has a timeout. A wedged page must surface as an error, never
 *   as a silently hanging turn.
 * - One socket per session; `close()` is idempotent.
 */

export class CdpError extends Error {
  override readonly name = 'CdpError';
}

export interface CdpTarget {
  id: string;
  type: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;

function inspectorUrl(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

async function getJson<T>(port: number, path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(inspectorUrl(port, path), { signal: AbortSignal.timeout(2_000) });
  } catch (error) {
    throw new CdpError(`Chrome inspector is not answering on port ${port}: ${(error as Error).message}`);
  }
  if (!response.ok) throw new CdpError(`GET ${path} → HTTP ${response.status}`);
  return (await response.json()) as T;
}

export interface BrowserVersion {
  Browser: string;
  webSocketDebuggerUrl: string;
}

export function readBrowserVersion(port: number): Promise<BrowserVersion> {
  return getJson<BrowserVersion>(port, '/json/version');
}

export function listTargets(port: number): Promise<CdpTarget[]> {
  return getJson<CdpTarget[]>(port, '/json/list');
}

/** Page targets only, newest first as Chrome reports them. */
export async function listPageTargets(port: number): Promise<CdpTarget[]> {
  const targets = await listTargets(port);
  return targets.filter((target) => target.type === 'page');
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class CdpSession {
  #socket: WebSocket;
  #pending = new Map<number, PendingCall>();
  #nextId = 1;

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      this.#onMessage(typeof event.data === 'string' ? event.data : String(event.data));
    });
    socket.addEventListener('close', () => {
      this.#failAll(new CdpError('CDP socket closed'));
    });
  }

  static connect(webSocketUrl: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CdpSession> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(webSocketUrl);
      const timer = setTimeout(() => {
        socket.close();
        reject(new CdpError(`CDP connect timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve(new CdpSession(socket));
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(new CdpError('CDP socket failed to open'));
        },
        { once: true },
      );
    });
  }

  /** Attach to a page target by id, or the first page when no id is given. */
  static async attach(port: number, targetId?: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<CdpSession> {
    const pages = await listPageTargets(port);
    const target = targetId === undefined ? pages[0] : pages.find((page) => page.id === targetId);
    if (!target?.webSocketDebuggerUrl) {
      throw new CdpError(
        targetId === undefined
          ? 'no page target is open in Chrome'
          : `page target ${targetId} is gone (was the tab closed?)`,
      );
    }
    return CdpSession.connect(target.webSocketDebuggerUrl, timeoutMs);
  }

  #onMessage(raw: string): void {
    let payload: { id?: number; result?: unknown; error?: { message?: string; code?: number } };
    try {
      payload = JSON.parse(raw) as typeof payload;
    } catch {
      return;
    }
    if (typeof payload.id !== 'number') return;
    const call = this.#pending.get(payload.id);
    if (!call) return;
    this.#pending.delete(payload.id);
    clearTimeout(call.timer);
    if (payload.error) {
      call.reject(new CdpError(`${payload.error.message ?? 'CDP error'} (${payload.error.code ?? '?'})`));
    } else {
      call.resolve(payload.result);
    }
  }

  #failAll(error: Error): void {
    for (const [id, call] of this.#pending) {
      clearTimeout(call.timer);
      this.#pending.delete(id);
      call.reject(error);
    }
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new CdpError(`${method} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      this.#pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer,
      });
      try {
        this.#socket.send(JSON.stringify({ id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.#pending.delete(id);
        reject(new CdpError(`${method} could not be sent: ${(error as Error).message}`));
      }
    });
  }

  /** Run an expression in the page and return its JSON value. */
  async evaluate<T>(expression: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const result = await this.send<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true, userGesture: true },
      timeoutMs,
    );
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? 'evaluate threw';
      throw new CdpError(detail);
    }
    return result.result?.value as T;
  }

  close(): void {
    this.#failAll(new CdpError('CDP session closed by caller'));
    try {
      this.#socket.close();
    } catch {
      // close on an already-closed socket is not an error we can act on
    }
  }
}
