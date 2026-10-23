/**
 * Composer prompt history: last N unique sent texts, newest first.
 * In-memory stack is the source of truth while the dock is mounted;
 * optional localStorage keeps recall across app restarts.
 */

export const PROMPT_HISTORY_MAX = 10;

const STORAGE_KEY = 'piwin.desktop.composer-prompt-history';

export function pushPromptHistory(
  previous: readonly string[],
  text: string,
  max = PROMPT_HISTORY_MAX,
): string[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [...previous];
  }
  return [trimmed, ...previous.filter((item) => item !== trimmed)].slice(0, max);
}

/** Merge session user prompts under the live stack without changing order priority. */
export function mergePromptHistory(
  stack: readonly string[],
  sessionUserPrompts: readonly string[] | undefined,
  max = PROMPT_HISTORY_MAX,
): string[] {
  const merged = [...stack];
  for (const raw of sessionUserPrompts ?? []) {
    const text = raw.trim();
    if (!text || merged.includes(text)) {
      continue;
    }
    merged.push(text);
  }
  return merged.slice(0, max);
}

export function loadPromptHistoryFromStorage(max = PROMPT_HISTORY_MAX): string[] {
  if (typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const items: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== 'string') {
        continue;
      }
      const text = entry.trim();
      if (!text || items.includes(text)) {
        continue;
      }
      items.push(text);
      if (items.length >= max) {
        break;
      }
    }
    return items;
  } catch {
    return [];
  }
}

export function savePromptHistoryToStorage(stack: readonly string[]): void {
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(stack.slice(0, PROMPT_HISTORY_MAX)),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}
