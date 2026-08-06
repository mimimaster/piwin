/**
 * Desktop UI preferences (localStorage). Cursor-like tool density etc.
 * Not product config under ~/.piwin — pure presentation.
 */

export type ToolCallDensity = 'compact' | 'comfortable' | 'detailed';

export type AssistantTextSize = 'small' | 'default' | 'large';
export type CodeTextSize = 'small' | 'default' | 'large';
export type WorkDetailsExpanded = 'auto' | 'always' | 'collapsed';
export type ConversationWidth = 'default' | 'narrow' | 'wide';
export type AppearanceMode = 'system' | 'light' | 'dark';

const CONVERSATION_WIDTH_VALUES: Record<ConversationWidth, string> = {
  narrow: '620px',
  default: '780px',
  wide: '1040px',
};

/** Returns the selected readable measure for transcript and Composer content. */
export function resolveConversationWidth(width: ConversationWidth): string {
  return CONVERSATION_WIDTH_VALUES[width];
}

export type AppearanceThemeSettings = {
  preset: 'default';
  background: string;
  foreground: string;
  accent: string;
};

/** Appearance values mirror the reference settings screen. */
export const DEFAULT_LIGHT_THEME_SETTINGS: AppearanceThemeSettings = {
  preset: 'default',
  background: '#EEEEEE',
  foreground: '#101010',
  accent: '#007ACC',
};

export const DEFAULT_DARK_THEME_SETTINGS: AppearanceThemeSettings = {
  preset: 'default',
  background: '#101010',
  foreground: '#CCCCCC',
  accent: '#007ACC',
};

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
  /** Keep intermediate Agent thinking in the transcript. */
  verboseAgentChat: boolean;
  /** Maximum conversation content measure. */
  conversationWidth: ConversationWidth;
  /** Theme mode selected in Settings → Appearance. */
  appearanceMode: AppearanceMode;
  /** Theme token settings used when the light mode is active. */
  lightTheme: AppearanceThemeSettings;
  /** Theme token settings used when the dark mode is active. */
  darkTheme: AppearanceThemeSettings;
  /** Last terminal working directory (remembered across sessions). */
  terminalLastCwd?: string;
  /** Recent terminal directories (most recent first, max 5). */
  terminalRecentDirs?: string[];
  /** Keep the sidebar project section folded when the user chooses to fold it. */
  projectsSectionCollapsed?: boolean;
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
const VERBOSE_AGENT_CHAT_KEY = 'piwin.desktop.verboseAgentChat';
const CONVERSATION_WIDTH_KEY = 'piwin.desktop.conversationWidth';
const APPEARANCE_MODE_KEY = 'piwin.desktop.appearanceMode';
const LIGHT_THEME_KEY = 'piwin.desktop.lightTheme';
const DARK_THEME_KEY = 'piwin.desktop.darkTheme';
const TERMINAL_LAST_CWD_KEY = 'piwin.desktop.terminalLastCwd';
const TERMINAL_RECENT_DIRS_KEY = 'piwin.desktop.terminalRecentDirs';
const PROJECTS_SECTION_COLLAPSED_KEY = 'piwin.desktop.projectsSectionCollapsed';
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

function parseConversationWidth(raw: string | null): ConversationWidth {
  if (raw === 'default' || raw === 'narrow' || raw === 'wide') {
    return raw;
  }
  return 'default';
}

function parseAppearanceMode(raw: string | null): AppearanceMode {
  if (raw === 'system' || raw === 'light' || raw === 'dark') {
    return raw;
  }
  return 'system';
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

function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value);
}

function parseAppearanceTheme(
  raw: string | null,
  fallback: AppearanceThemeSettings,
): AppearanceThemeSettings {
  if (!raw) {
    return { ...fallback };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'background' in parsed &&
      'foreground' in parsed &&
      'accent' in parsed &&
      isHexColor(parsed.background) &&
      isHexColor(parsed.foreground) &&
      isHexColor(parsed.accent)
    ) {
      return {
        preset: 'default',
        background: parsed.background.toUpperCase(),
        foreground: parsed.foreground.toUpperCase(),
        accent: parsed.accent.toUpperCase(),
      };
    }
  } catch {
    // Ignore malformed preference data and restore the built-in appearance.
  }
  return { ...fallback };
}

export function loadDesktopPreferences(): DesktopPreferences {
  const lastCwd = readString(TERMINAL_LAST_CWD_KEY);
  const recentDirsRaw = readString(TERMINAL_RECENT_DIRS_KEY);
  const projectsSectionCollapsedRaw = readString(PROJECTS_SECTION_COLLAPSED_KEY);
  return {
    assistantTextSize: parseSizeOption(readString(ASSISTANT_TEXT_SIZE_KEY), 'default'),
    codeTextSize: parseSizeOption(readString(CODE_TEXT_SIZE_KEY), 'default'),
    codeWrap: readString(CODE_WRAP_KEY) === 'true',
    toolDensity: parseToolCallDensity(readString(TOOL_DENSITY_KEY)),
    workDetailsExpanded: parseWorkDetails(readString(WORK_DETAILS_EXPANDED_KEY)),
    artifactPreviewEnabled: true,
    artifactCodeFirst: parseBoolean(readString(ARTIFACT_CODE_FIRST_KEY), false),
    verboseAgentChat: parseBoolean(readString(VERBOSE_AGENT_CHAT_KEY), true),
    conversationWidth: parseConversationWidth(readString(CONVERSATION_WIDTH_KEY)),
    appearanceMode: parseAppearanceMode(readString(APPEARANCE_MODE_KEY)),
    lightTheme: parseAppearanceTheme(readString(LIGHT_THEME_KEY), DEFAULT_LIGHT_THEME_SETTINGS),
    darkTheme: parseAppearanceTheme(readString(DARK_THEME_KEY), DEFAULT_DARK_THEME_SETTINGS),
    dontAskRevertConfirm: parseBoolean(readString(DONT_ASK_REVERT_CONFIRM_KEY), false),
    ...(lastCwd ? { terminalLastCwd: lastCwd } : {}),
    ...(recentDirsRaw ? { terminalRecentDirs: parseStringArray(recentDirsRaw) ?? [] } : {}),
    ...(projectsSectionCollapsedRaw !== null
      ? { projectsSectionCollapsed: parseBoolean(projectsSectionCollapsedRaw, false) }
      : {}),
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
  writeString(VERBOSE_AGENT_CHAT_KEY, String(prefs.verboseAgentChat));
  writeString(CONVERSATION_WIDTH_KEY, prefs.conversationWidth);
  writeString(APPEARANCE_MODE_KEY, prefs.appearanceMode);
  writeString(LIGHT_THEME_KEY, JSON.stringify(prefs.lightTheme));
  writeString(DARK_THEME_KEY, JSON.stringify(prefs.darkTheme));
  writeString(DONT_ASK_REVERT_CONFIRM_KEY, String(prefs.dontAskRevertConfirm ?? false));
  if (prefs.terminalLastCwd) {
    writeString(TERMINAL_LAST_CWD_KEY, prefs.terminalLastCwd);
  }
  if (prefs.terminalRecentDirs) {
    writeString(TERMINAL_RECENT_DIRS_KEY, JSON.stringify(prefs.terminalRecentDirs));
  }
  if (prefs.projectsSectionCollapsed !== undefined) {
    writeString(PROJECTS_SECTION_COLLAPSED_KEY, String(prefs.projectsSectionCollapsed));
  }
}

// ---- Backward-compat helpers (used by existing callers and the old tests) ----

export function loadToolCallDensity(): ToolCallDensity {
  return parseToolCallDensity(readString(TOOL_DENSITY_KEY));
}

export function saveToolCallDensity(density: ToolCallDensity): void {
  writeString(TOOL_DENSITY_KEY, density);
}
