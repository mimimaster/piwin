import type { ToolResult } from '@piwin/contracts';

const MAX_CANONICAL_ARGUMENT_DEPTH = 64;

export type CanonicalArgumentValidation =
  | { ok: true }
  | { ok: false; result: ToolResult };

export function validateCanonicalArguments(
  value: unknown,
  depth = 0,
): CanonicalArgumentValidation {
  if (depth > MAX_CANONICAL_ARGUMENT_DEPTH) {
    return invalidCanonical('canonical argument tree too deep');
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return { ok: true };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return invalidCanonical('canonical arguments must use finite numbers');
    }
    return { ok: true };
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.hasOwn(value, index)) {
        return invalidCanonical('canonical argument arrays cannot be sparse');
      }
      const nested = validateCanonicalArguments(value[index], depth + 1);
      if (!nested.ok) {
        return nested;
      }
    }
    return { ok: true };
  }
  if (isPlainObject(value)) {
    const symbolKeys = Object.getOwnPropertySymbols(value);
    if (symbolKeys.length > 0) {
      return invalidCanonical('canonical arguments cannot include symbol keys');
    }
    for (const key of Object.keys(value)) {
      const field = value[key];
      if (field === undefined) {
        continue;
      }
      const nested = validateCanonicalArguments(field, depth + 1);
      if (!nested.ok) {
        return nested;
      }
    }
    return { ok: true };
  }
  return invalidCanonical('canonical arguments must be JSON-compatible plain data');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidCanonical(message: string): CanonicalArgumentValidation {
  return {
    ok: false,
    result: { ok: false, code: 'invalid-input', message },
  };
}
