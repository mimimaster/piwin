import {
  decodeCompactToTokenLines,
  hashSource,
  type HighlightWorkerRequest,
  type HighlightWorkerResponse,
  type TokenLine,
} from './highlight-protocol.js';

export type HighlightWorkerPort = {
  postMessage: (request: HighlightWorkerRequest) => void;
  addEventListener: (
    type: string,
    listener: (event: MessageEvent<HighlightWorkerResponse>) => void,
  ) => void;
  removeEventListener: (
    type: string,
    listener: (event: MessageEvent<HighlightWorkerResponse>) => void,
  ) => void;
  terminate?: () => void;
  onerror?: ((event: Event) => void) | null;
  onmessageerror?: ((event: Event) => void) | null;
};

export type HighlightClientOptions = {
  createWorker?: () => HighlightWorkerPort;
  maxInFlight?: number;
};

export type HighlightRequestOptions = {
  code: string;
  language: string;
  theme: 'github-dark' | 'github-light';
  lineStart?: number;
  lineEnd?: number;
};

type PendingEntry = {
  request: HighlightWorkerRequest;
  resolve: (lines: TokenLine[]) => void;
  reject: (error: Error) => void;
};

export class HighlightClient {
  private worker: HighlightWorkerPort | null = null;
  private readonly createWorker: () => HighlightWorkerPort;
  private readonly maxInFlight: number;
  private inFlight = 0;
  private requestCounter = 0;
  private readonly queue: PendingEntry[] = [];
  private readonly pending = new Map<string, PendingEntry>();
  private readonly messageHandler = (event: MessageEvent<HighlightWorkerResponse>): void => {
    this.handleMessage(event.data);
  };

  constructor(options?: HighlightClientOptions) {
    this.createWorker =
      options?.createWorker ??
      (() =>
        new Worker(new URL('./highlight.worker.ts', import.meta.url), {
          type: 'module',
        }) as unknown as HighlightWorkerPort);
    this.maxInFlight = options?.maxInFlight ?? 4;
  }

  private ensureWorker(): HighlightWorkerPort {
    if (!this.worker) {
      this.worker = this.createWorker();
      this.worker.addEventListener('message', this.messageHandler);
      this.worker.onerror = this.handleWorkerError;
      this.worker.onmessageerror = this.handleWorkerError;
    }
    return this.worker;
  }

  public highlight(options: HighlightRequestOptions): Promise<TokenLine[]> {
    const requestId = `req-${++this.requestCounter}`;
    const sourceHash = hashSource(options.code);
    const request: HighlightWorkerRequest = {
      requestId,
      sourceHash,
      code: options.code,
      language: options.language,
      theme: options.theme,
      ...(options.lineStart !== undefined ? { lineStart: options.lineStart } : {}),
      ...(options.lineEnd !== undefined ? { lineEnd: options.lineEnd } : {}),
    };

    return new Promise<TokenLine[]>((resolve, reject) => {
      const entry: PendingEntry = { request, resolve, reject };
      if (this.inFlight >= this.maxInFlight) {
        this.queue.push(entry);
      } else {
        this.dispatchRequest(entry);
      }
    });
  }

  private dispatchRequest(entry: PendingEntry): void {
    this.inFlight += 1;
    this.pending.set(entry.request.requestId, entry);
    try {
      const worker = this.ensureWorker();
      worker.postMessage(entry.request);
    } catch (error: unknown) {
      this.pending.delete(entry.request.requestId);
      this.inFlight -= 1;
      entry.reject(error instanceof Error ? error : new Error(String(error)));
      this.drainQueue();
    }
  }

  private readonly handleWorkerError = (): void => {
    this.cancelAll(new Error('Syntax highlight worker failed'));
    this.releaseWorker();
  };

  private handleMessage(response: HighlightWorkerResponse): void {
    const entry = this.pending.get(response.requestId);
    if (!entry) return;
    this.pending.delete(response.requestId);
    this.inFlight = Math.max(0, this.inFlight - 1);

    try {
      const lines = decodeCompactToTokenLines(
        entry.request.code,
        response.palette,
        response.runs,
        response.lineStart,
        response.lineEnd,
      );
      entry.resolve(lines);
    } catch (err) {
      entry.reject(err instanceof Error ? err : new Error(String(err)));
    }

    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.inFlight < this.maxInFlight && this.queue.length > 0) {
      const next = this.queue.shift();
      if (next) {
        this.dispatchRequest(next);
      }
    }
  }

  public cancelAll(error = new Error('Highlight request cancelled')): void {
    for (const entry of this.queue) {
      entry.reject(error);
    }
    this.queue.length = 0;

    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
    this.inFlight = 0;
  }

  public dispose(): void {
    this.cancelAll();
    this.releaseWorker();
  }

  private releaseWorker(): void {
    if (this.worker) {
      this.worker.removeEventListener('message', this.messageHandler);
      this.worker.onerror = null;
      this.worker.onmessageerror = null;
      this.worker.terminate?.();
      this.worker = null;
    }
  }
}
