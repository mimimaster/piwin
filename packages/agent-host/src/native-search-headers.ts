/**
 * Header policy for native-search sub-requests. Protocol defaults first,
 * configured provider headers afterwards (they may override ordinary
 * defaults), feature/beta headers token-merged rather than replaced. No
 * search-specific header is invented for OpenAI, xAI, or Gemini.
 */

/** Merge comma-separated tokens into one header, case-insensitive dedupe, preserving order. */
export function mergeHeaderTokens(
  headers: Readonly<Record<string, string>> | undefined,
  name: string,
  tokens: readonly string[],
): Record<string, string> {
  const next: Record<string, string> = { ...(headers ?? {}) };
  const existingKey = Object.keys(next).find((key) => key.toLowerCase() === name.toLowerCase());
  const existing = existingKey ? (next[existingKey] ?? '') : '';
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const token of [...existing.split(','), ...tokens]) {
    const trimmed = token.trim();
    if (!trimmed || seen.has(trimmed.toLowerCase())) continue;
    seen.add(trimmed.toLowerCase());
    merged.push(trimmed);
  }
  if (existingKey) delete next[existingKey];
  if (merged.length > 0) next[existingKey ?? name] = merged.join(',');
  return next;
}

/** Headers for an Anthropic sub-request: provider headers + optional merged compatibility beta. */
export function buildAnthropicSearchHeaders(
  providerHeaders: Readonly<Record<string, string>> | undefined,
  betaToken: string | undefined,
): Record<string, string> | undefined {
  const token = betaToken?.trim();
  if (!token) return providerHeaders ? { ...providerHeaders } : undefined;
  return mergeHeaderTokens(providerHeaders, 'anthropic-beta', [token]);
}

/** Gemini REST: protocol defaults, then provider headers (case-insensitive override). */
export function buildGeminiRestHeaders(
  apiKey: string,
  providerHeaders: Readonly<Record<string, string>> | undefined,
): Record<string, string> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-goog-api-key': apiKey,
  };
  for (const [name, value] of Object.entries(providerHeaders ?? {})) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === name.toLowerCase()) delete headers[key];
    }
    headers[name] = value;
  }
  return headers;
}
