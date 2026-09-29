export type JsonRpcId = number | string;

export type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

export type JsonRpcErrorObject = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcSuccess = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result: unknown;
};

export type JsonRpcFailure = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  error: JsonRpcErrorObject;
};

export type JsonRpcInbound =
  | { kind: 'request'; message: JsonRpcRequest }
  | { kind: 'notification'; message: JsonRpcNotification }
  | { kind: 'response'; message: JsonRpcSuccess | JsonRpcFailure };

export type JsonRpcParseResult = JsonRpcInbound | { kind: 'invalid'; reason: string };

export function parseJsonRpcLine(line: string): JsonRpcParseResult {
  if (line.trim() === '') {
    return { kind: 'invalid', reason: 'empty' };
  }

  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return { kind: 'invalid', reason: 'malformed-json' };
  }

  if (!isPlainObject(value)) {
    return { kind: 'invalid', reason: 'not-an-object' };
  }
  if (value.jsonrpc !== '2.0') {
    return { kind: 'invalid', reason: 'invalid-jsonrpc-version' };
  }

  const hasMethod = typeof value.method === 'string';
  const hasId = isJsonRpcId(value.id);
  const hasResult = Object.prototype.hasOwnProperty.call(value, 'result');
  const hasError = Object.prototype.hasOwnProperty.call(value, 'error');

  if (hasResult && hasError) {
    return { kind: 'invalid', reason: 'result-and-error' };
  }

  if (hasResult || hasError) {
    return parseResponse(value, hasId, hasError);
  }

  if (hasMethod && hasId) {
    return parseRequest(value);
  }

  if (hasMethod && !Object.prototype.hasOwnProperty.call(value, 'id')) {
    return parseNotification(value);
  }

  return { kind: 'invalid', reason: 'unrecognized-shape' };
}

function parseResponse(
  value: Record<string, unknown>,
  hasId: boolean,
  hasError: boolean,
): JsonRpcParseResult {
  if (!hasId) {
    return { kind: 'invalid', reason: 'response-missing-id' };
  }
  const id = value.id;
  if (!isJsonRpcId(id)) {
    return { kind: 'invalid', reason: 'response-missing-id' };
  }
  if (hasError) {
    const error = parseErrorObject(value.error);
    if (error === undefined) {
      return { kind: 'invalid', reason: 'invalid-error' };
    }
    return { kind: 'response', message: { jsonrpc: '2.0', id, error } };
  }
  return { kind: 'response', message: { jsonrpc: '2.0', id, result: value.result } };
}

function parseRequest(value: Record<string, unknown>): JsonRpcParseResult {
  const id = value.id;
  const method = value.method;
  if (!isJsonRpcId(id) || typeof method !== 'string') {
    return { kind: 'invalid', reason: 'unrecognized-shape' };
  }
  const message: JsonRpcRequest = { jsonrpc: '2.0', id, method };
  if (Object.prototype.hasOwnProperty.call(value, 'params')) {
    message.params = value.params;
  }
  return { kind: 'request', message };
}

function parseNotification(value: Record<string, unknown>): JsonRpcParseResult {
  const method = value.method;
  if (typeof method !== 'string') {
    return { kind: 'invalid', reason: 'unrecognized-shape' };
  }
  const message: JsonRpcNotification = { jsonrpc: '2.0', method };
  if (Object.prototype.hasOwnProperty.call(value, 'params')) {
    message.params = value.params;
  }
  return { kind: 'notification', message };
}

function parseErrorObject(value: unknown): JsonRpcErrorObject | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  if (typeof value.code !== 'number' || typeof value.message !== 'string') {
    return undefined;
  }
  const error: JsonRpcErrorObject = {
    code: value.code,
    message: value.message,
  };
  if (Object.prototype.hasOwnProperty.call(value, 'data')) {
    error.data = value.data;
  }
  return error;
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
