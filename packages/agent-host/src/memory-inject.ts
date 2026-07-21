/**
 * Memory overview injection helpers (CE-MEM-03).
 * Host prepends overview to model prompt text when enabled + trusted project.
 */
import type { MemoryConfig } from '@piwin/contracts';
import type { MemoryStore } from '@piwin/memory';
import { MEMORY_OVERVIEW_HEADER } from '@piwin/memory';

export function shouldInjectMemoryOverview(input: {
  memoryConfig?: MemoryConfig;
  projectTrusted: boolean;
}): boolean {
  const enabled = input.memoryConfig?.enabled === true;
  if (!enabled) {
    return false;
  }
  if (input.memoryConfig?.injectOverview === false) {
    return false;
  }
  // injectOverview defaults true when memory enabled; require trusted project.
  return input.projectTrusted;
}

export async function buildMemoryOverviewInjection(input: {
  store: MemoryStore;
  projectKey?: string;
  maxChars?: number;
  writeCache?: boolean;
}): Promise<string> {
  const overviewOptions: { projectKey?: string; maxChars?: number } = {};
  if (input.projectKey) overviewOptions.projectKey = input.projectKey;
  if (typeof input.maxChars === 'number') overviewOptions.maxChars = input.maxChars;

  if (input.writeCache !== false) {
    const cached = await input.store.writeOverviewCache(overviewOptions);
    return cached.text.startsWith(MEMORY_OVERVIEW_HEADER)
      ? cached.text
      : `${MEMORY_OVERVIEW_HEADER}\n\n${cached.text}`;
  }
  const text = await input.store.buildOverview(overviewOptions);
  return text.startsWith(MEMORY_OVERVIEW_HEADER)
    ? text
    : `${MEMORY_OVERVIEW_HEADER}\n\n${text}`;
}

/**
 * Prepend memory overview to user prompt text for the model (not product transcript).
 */
export function prependMemoryOverview(promptText: string, overviewText: string): string {
  const overview = overviewText.trim();
  if (!overview) {
    return promptText;
  }
  return `${overview}\n\n${promptText}`;
}
