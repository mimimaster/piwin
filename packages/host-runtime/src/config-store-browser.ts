import type { BrowserWorkbenchConfig } from '@piwin/contracts';

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
  return config.headless !== undefined || config.cdpEndpoint !== undefined ? config : undefined;
}
