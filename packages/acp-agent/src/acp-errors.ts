export class AcpRpcError extends Error {
  override readonly name = 'AcpRpcError';
  readonly code: number;
  readonly rpcMessage: string;
  readonly data: unknown;
  readonly method: string;

  constructor(options: {
    method: string;
    code: number;
    rpcMessage: string;
    data?: unknown;
  }) {
    super(`ACP RPC error ${options.code} for method ${options.method}: ${options.rpcMessage}`);
    this.name = 'AcpRpcError';
    this.method = options.method;
    this.code = options.code;
    this.rpcMessage = options.rpcMessage;
    this.data = options.data;
  }
}

export class AcpRequestTimeoutError extends Error {
  override readonly name = 'AcpRequestTimeoutError';
  readonly method: string;
  readonly timeoutMs: number;

  constructor(method: string, timeoutMs: number) {
    super(`ACP request timed out for method ${method} after ${timeoutMs}ms`);
    this.name = 'AcpRequestTimeoutError';
    this.method = method;
    this.timeoutMs = timeoutMs;
  }
}

export class AcpConnectionClosedError extends Error {
  override readonly name = 'AcpConnectionClosedError';
  readonly method?: string;
  readonly reason?: string;

  constructor(options?: { method?: string; reason?: string }) {
    const method = options?.method;
    const reason = options?.reason;
    super(formatClosedMessage(method, reason));
    this.name = 'AcpConnectionClosedError';
    if (method !== undefined) {
      this.method = method;
    }
    if (reason !== undefined) {
      this.reason = reason;
    }
  }
}

export class AcpProtocolShapeError extends Error {
  override readonly name = 'AcpProtocolShapeError';
  readonly method: string;
  readonly reason: string;

  constructor(method: string, reason: string) {
    super(`ACP protocol shape error for method ${method}: ${reason}`);
    this.name = 'AcpProtocolShapeError';
    this.method = method;
    this.reason = reason;
  }
}

function formatClosedMessage(method: string | undefined, reason: string | undefined): string {
  const parts = ['ACP connection closed'];
  if (method !== undefined) {
    parts.push(`during method ${method}`);
  }
  if (reason !== undefined) {
    parts.push(`(${reason})`);
  }
  return parts.join(' ');
}
