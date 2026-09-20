import type { BrowserFastDeciderConfig, BrowserWorkbenchConfig } from '@piwin/contracts';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export function normalizeBrowserWorkbenchConfig(value: unknown): BrowserWorkbenchConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const config: BrowserWorkbenchConfig = {};
  if (typeof record.headless === 'boolean') {
    config.headless = record.headless;
  }
  if (typeof record.cdpEndpoint === 'string' && record.cdpEndpoint.trim() !== '') {
    config.cdpEndpoint = record.cdpEndpoint.trim();
  }
  if (typeof record.deviceScaleFactor === 'number' && Number.isFinite(record.deviceScaleFactor)) {
    config.deviceScaleFactor = Math.max(1, Math.min(3, Math.round(record.deviceScaleFactor)));
  }
  if (typeof record.quality === 'number' && Number.isFinite(record.quality)) {
    config.quality = Math.max(50, Math.min(100, Math.round(record.quality)));
  }
  const fastDecider = normalizeBrowserFastDeciderConfig(record.fastDecider);
  if (fastDecider) {
    config.fastDecider = fastDecider;
  }
  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * The decider receives page text, so it must stay on this machine: anything
 * other than a loopback http(s) URL is dropped rather than trusted.
 */
export function normalizeBrowserFastDeciderConfig(
  value: unknown,
): BrowserFastDeciderConfig | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.url !== 'string') return undefined;
  let parsed: URL;
  try {
    parsed = new URL(record.url.trim());
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (!LOOPBACK_HOSTS.has(parsed.hostname)) return undefined;
  const config: BrowserFastDeciderConfig = { url: parsed.origin };
  if (
    typeof record.minConfidence === 'number' &&
    record.minConfidence > 0 &&
    record.minConfidence <= 1
  ) {
    config.minConfidence = record.minConfidence;
  }
  if (
    typeof record.timeoutMs === 'number' &&
    Number.isFinite(record.timeoutMs) &&
    record.timeoutMs > 0
  ) {
    config.timeoutMs = Math.min(record.timeoutMs, 30_000);
  }
  return config;
}
