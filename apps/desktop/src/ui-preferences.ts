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
  /** Always enabled by default */
  artifactPreviewEnabled: boolean;
  /**
   * When true, artifact blocks display source code first with a preview toggle on hover.
   * When false (default), artifact blocks immediately render dynamic UI.
   */
  artifactCodeFirst: boolean;
  /** Last terminal working directory (remembered across sessions). */
  terminalLastCwd?: string;
  /** Recent terminal directories (most recent first, max 5). */
  terminalRecentDirs?: string[];
  /** When true, revert checkpoint confirmation modal is bypassed. */
  dontAskRevertConfirm?: boolean;
};

const TOOL_DENSITY_KEY = 'piwin.desktop.toolCallDensity';
const ASSISTANT_TEXT_SIZE_KEY = 'piwin.desktop.assistantTextSize';
const CODE_TEXT_SIZE_KEY = 'piwin.desktop.codeTextSize';
const CODE_WRAP_KEY = 'piwin.desktop.codeWrap';
const WORK_DETAILS_EXPANDED_KEY = 'piwin.desktop.workDetailsExpanded';
const ARTIFACT_PREVIEW_KEY = 'piwin.desktop.artifactPreviewEnabled';
const ARTIFACT_CODE_FIRST_KEY = 'piwin.desktop.artifactCodeFirst';
const TERMINAL_LAST_CWD_KEY = 'piwin.desktop.terminalLastCwd';
const TERMINAL_RECENT_DIRS_KEY = 'piwin.desktop.terminalRecentDirs';
const DONT_ASK_REVERT_CONFIRM_KEY = 'piwin.desktop.dontAskRevertConfirm';

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

function parseSizeOption(
  raw: string | null,
  fallback: 'small' | 'default' | 'large',
): 'small' | 'default' | 'large' {
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

function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return fallback;
}

function parseStringArray(raw: string | null): string[] | undefined {
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((item: unknown) => typeof item === 'string')) {
      return parsed as string[];
    }
  } catch {
    // ignore parse errors
  }
  return undefined;
}

export function loadDesktopPreferences(): DesktopPreferences {
  const lastCwd = readString(TERMINAL_LAST_CWD_KEY);
  const recentDirsRaw = readString(TERMINAL_RECENT_DIRS_KEY);
  return {
    assistantTextSize: parseSizeOption(readString(ASSISTANT_TEXT_SIZE_KEY), 'default'),
    codeTextSize: parseSizeOption(readString(CODE_TEXT_SIZE_KEY), 'default'),
    codeWrap: readString(CODE_WRAP_KEY) === 'true',
    toolDensity: parseToolCallDensity(readString(TOOL_DENSITY_KEY)),
    workDetailsExpanded: parseWorkDetails(readString(WORK_DETAILS_EXPANDED_KEY)),
    artifactPreviewEnabled: true,
    artifactCodeFirst: parseBoolean(readString(ARTIFACT_CODE_FIRST_KEY), false),
    dontAskRevertConfirm: parseBoolean(readString(DONT_ASK_REVERT_CONFIRM_KEY), false),
    ...(lastCwd ? { terminalLastCwd: lastCwd } : {}),
    ...(recentDirsRaw ? { terminalRecentDirs: parseStringArray(recentDirsRaw) ?? [] } : {}),
  };
}

export function saveDesktopPreferences(prefs: DesktopPreferences): void {
  writeString(TOOL_DENSITY_KEY, prefs.toolDensity);
  writeString(ASSISTANT_TEXT_SIZE_KEY, prefs.assistantTextSize);
  writeString(CODE_TEXT_SIZE_KEY, prefs.codeTextSize);
  writeString(CODE_WRAP_KEY, String(prefs.codeWrap));
  writeString(WORK_DETAILS_EXPANDED_KEY, prefs.workDetailsExpanded);
  writeString(ARTIFACT_PREVIEW_KEY, 'true');
  writeString(ARTIFACT_CODE_FIRST_KEY, String(prefs.artifactCodeFirst));
  writeString(DONT_ASK_REVERT_CONFIRM_KEY, String(prefs.dontAskRevertConfirm ?? false));
  if (prefs.terminalLastCwd) {
    writeString(TERMINAL_LAST_CWD_KEY, prefs.terminalLastCwd);
  }
  if (prefs.terminalRecentDirs) {
    writeString(TERMINAL_RECENT_DIRS_KEY, JSON.stringify(prefs.terminalRecentDirs));
  }
}

// ---- Backward-compat helpers (used by existing callers and the old tests) ----

export function loadToolCallDensity(): ToolCallDensity {
  return parseToolCallDensity(readString(TOOL_DENSITY_KEY));
}

export function saveToolCallDensity(density: ToolCallDensity): void {
  writeString(TOOL_DENSITY_KEY, density);
}
