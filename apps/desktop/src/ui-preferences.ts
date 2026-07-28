/**
 * Desktop UI preferences (localStorage). Cursor-like tool density etc.
 * Not product config under ~/.piwin — pure presentation.
 */

export type ToolCallDensity = 'compact' | 'comfortable' | 'detailed';

export type AssistantTextSize = 'small' | 'default' | 'large';
export type CodeTextSize = 'small' | 'default' | 'large';
export type WorkDetailsExpanded = 'auto' | 'always' | 'collapsed';

export type DesktopPreferences = {
  assistantTextSize: AssistantTextSize;
  codeTextSize: CodeTextSize;
  codeWrap: boolean;
  toolDensity: ToolCallDensity;
  workDetailsExpanded: WorkDetailsExpanded;
};

const TOOL_DENSITY_KEY = 'piwin.desktop.toolCallDensity';
const ASSISTANT_TEXT_SIZE_KEY = 'piwin.desktop.assistantTextSize';
const CODE_TEXT_SIZE_KEY = 'piwin.desktop.codeTextSize';
const CODE_WRAP_KEY = 'piwin.desktop.codeWrap';
const WORK_DETAILS_EXPANDED_KEY = 'piwin.desktop.workDetailsExpanded';

function readString(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // private mode / SSR — ignore
  }
}

function parseSizeOption(raw: string | null, fallback: 'small' | 'default' | 'large'): 'small' | 'default' | 'large' {
  if (raw === 'small' || raw === 'default' || raw === 'large') {
    return raw;
  }
  return fallback;
}

function parseWorkDetails(raw: string | null): WorkDetailsExpanded {
  if (raw === 'auto' || raw === 'always' || raw === 'collapsed') {
    return raw;
  }
  return 'auto';
}

function parseToolCallDensity(raw: string | null): ToolCallDensity {
  if (raw === 'compact' || raw === 'comfortable' || raw === 'detailed') {
    return raw;
  }
  return 'comfortable';
}

export function loadDesktopPreferences(): DesktopPreferences {
  return {
    assistantTextSize: parseSizeOption(readString(ASSISTANT_TEXT_SIZE_KEY), 'default'),
    codeTextSize: parseSizeOption(readString(CODE_TEXT_SIZE_KEY), 'default'),
    codeWrap: readString(CODE_WRAP_KEY) === 'true',
    toolDensity: parseToolCallDensity(readString(TOOL_DENSITY_KEY)),
    workDetailsExpanded: parseWorkDetails(readString(WORK_DETAILS_EXPANDED_KEY)),
  };
}

export function saveDesktopPreferences(prefs: DesktopPreferences): void {
  writeString(TOOL_DENSITY_KEY, prefs.toolDensity);
  writeString(ASSISTANT_TEXT_SIZE_KEY, prefs.assistantTextSize);
  writeString(CODE_TEXT_SIZE_KEY, prefs.codeTextSize);
  writeString(CODE_WRAP_KEY, String(prefs.codeWrap));
  writeString(WORK_DETAILS_EXPANDED_KEY, prefs.workDetailsExpanded);
}

// ---- Backward-compat helpers (used by existing callers and the old tests) ----

export function loadToolCallDensity(): ToolCallDensity {
  return parseToolCallDensity(readString(TOOL_DENSITY_KEY));
}

export function saveToolCallDensity(density: ToolCallDensity): void {
  writeString(TOOL_DENSITY_KEY, density);
}

