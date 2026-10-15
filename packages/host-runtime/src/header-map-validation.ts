/**
 * Validates a configured HTTP header map (provider- or model-level). Bounds
 * size and rejects CR/LF so a saved header can never split a request.
 */
import type { ProviderValidationIssue } from './provider-validation.js';

const MAX_HEADER_ENTRIES = 32;
const MAX_HEADER_NAME_LENGTH = 128;
const MAX_HEADER_VALUE_LENGTH = 4096;

export function validateHeaderMap(
  headers: unknown,
  path: string,
  issues: ProviderValidationIssue[],
): void {
  if (headers === undefined) return;
  if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
    issues.push({ path, message: 'headers must be an object of string pairs' });
    return;
  }
  const entries = Object.entries(headers);
  if (entries.length > MAX_HEADER_ENTRIES) {
    issues.push({ path, message: `headers supports at most ${MAX_HEADER_ENTRIES} entries` });
  }
  const seenNames = new Set<string>();
  for (const [headerName, headerValue] of entries) {
    const name = headerName.trim();
    if (!name) {
      issues.push({ path, message: 'header name is required' });
      continue;
    }
    if (name.length > MAX_HEADER_NAME_LENGTH || /[\r\n]/.test(name)) {
      issues.push({ path: `${path}.${name}`, message: 'header name is invalid' });
    }
    const lower = name.toLowerCase();
    if (seenNames.has(lower)) {
      issues.push({ path: `${path}.${name}`, message: 'duplicate header name' });
    }
    seenNames.add(lower);
    if (typeof headerValue !== 'string') {
      issues.push({ path: `${path}.${name}`, message: 'header value must be a string' });
    } else if (headerValue.length > MAX_HEADER_VALUE_LENGTH || /[\r\n]/.test(headerValue)) {
      issues.push({ path: `${path}.${name}`, message: 'header value is invalid or too long' });
    }
  }
}
