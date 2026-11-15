/**
 * Pure resolution, persistence, and prompt-shaping helpers for bundled `pi-purge`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";

export type PurgeMode = "strict" | "replace";
export type PurgeSourceKind = "custom" | "project" | "global" | "builtin-strict" | "none";

export interface PurgeConfig {
  enabled: boolean;
  mode: PurgeMode;
  customPath?: string;
}

export interface PurgeResolvedSource {
  source: PurgeSourceKind;
  absolutePath?: string;
  content?: string;
  error?: string;
}

export interface PurgeStatusPayload {
  on: boolean;
  mode: PurgeMode;
  source: PurgeSourceKind;
  custom: boolean;
  chars: number;
  err?: string;
}

export const PURGE_SETTINGS_KEY = "pi-purge";
export const PURGE_STATUS_KEY = "pi-purge";
export const PURGE_META_KEY = "meta:pi-purge";
export const PURGE_PATH_META_KEY = "meta:pi-purge-path";
export const DEFAULT_BUILTIN_STRICT_PROMPT =
  "You are a precise coding assistant. Follow the user's request directly, use available tools accurately, and cite only observed files and outputs.";

export function expandUserPath(rawPath: string, cwd: string, home = homedir()): string {
  const trimmed = rawPath.trim();
  if (trimmed === "~") return home;
  if (trimmed.startsWith("~/") || trimmed.startsWith("~\\")) {
    return join(home, trimmed.slice(2));
  }
  return isAbsolute(trimmed) ? trimmed : resolve(cwd, trimmed);
}

export function resolveRuntimeAgentDirs(options?: {
  env?: NodeJS.ProcessEnv;
  home?: string;
}): { runtimeAgentDir: string; nativeAgentDir: string } {
  const env = options?.env ?? process.env;
  const home = options?.home ?? homedir();
  const explicitPiAgent = env.PIWIN_PI_AGENT_DIR?.trim() || env.PI_CODING_AGENT_DIR?.trim();
  const piwinRoot = env.PIWIN_ROOT?.trim();
  const runtimeAgentDir = explicitPiAgent
    ? explicitPiAgent
    : piwinRoot
      ? join(piwinRoot, "pi-agent")
      : join(home, ".pi", "agent");
  return {
    runtimeAgentDir,
    nativeAgentDir: join(home, ".pi", "agent"),
  };
}

function readSettingsEntry(settingsPath: string): Partial<PurgeConfig> | undefined {
  if (!existsSync(settingsPath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as Record<string, unknown>;
    const raw = parsed[PURGE_SETTINGS_KEY];
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;
    const obj = raw as Record<string, unknown>;
    const result: Partial<PurgeConfig> = {};
    if (typeof obj.enabled === "boolean") result.enabled = obj.enabled;
    if (obj.mode === "strict" || obj.mode === "replace") result.mode = obj.mode;
    if (typeof obj.customPath === "string" && obj.customPath.trim().length > 0) {
      result.customPath = obj.customPath.trim();
    }
    return result;
  } catch {
    return undefined;
  }
}

export function loadPurgeConfig(input: {
  cwd: string;
  runtimeAgentDir: string;
  nativeAgentDir: string;
}): PurgeConfig {
  const candidates = [
    join(input.nativeAgentDir, "settings.json"),
    join(input.runtimeAgentDir, "settings.json"),
    join(input.cwd, ".pi", "settings.json"),
  ];
  let merged: PurgeConfig = { enabled: false, mode: "strict" };
  for (const path of candidates) {
    const entry = readSettingsEntry(path);
    if (!entry) continue;
    merged = {
      enabled: entry.enabled ?? merged.enabled,
      mode: entry.mode ?? merged.mode,
      ...(entry.customPath !== undefined ? { customPath: entry.customPath } : {}),
    };
  }
  return merged;
}

export function savePurgeConfig(
  settingsPath: string,
  config: PurgeConfig,
): void {
  let existing: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch {
      existing = {};
    }
  }
  const serialized: Record<string, unknown> = {
    enabled: config.enabled,
    mode: config.mode,
    ...(config.customPath ? { customPath: config.customPath } : {}),
  };
  existing[PURGE_SETTINGS_KEY] = serialized;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(existing, null, 2)}\n`, "utf8");
}

function readPromptFile(absolutePath: string): { content?: string; error?: string } {
  try {
    return { content: readFileSync(absolutePath, "utf8") };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

export function resolvePurgeSource(input: {
  config: PurgeConfig;
  cwd: string;
  runtimeAgentDir: string;
  nativeAgentDir: string;
  home?: string;
}): PurgeResolvedSource {
  if (input.config.customPath) {
    const absolutePath = expandUserPath(input.config.customPath, input.cwd, input.home);
    if (!existsSync(absolutePath)) {
      return { source: "custom", absolutePath, error: `Prompt file not found: ${absolutePath}` };
    }
    const read = readPromptFile(absolutePath);
    return {
      source: "custom",
      absolutePath,
      ...(read.content !== undefined ? { content: read.content } : {}),
      ...(read.error !== undefined ? { error: read.error } : {}),
    };
  }

  const projectSystem = join(input.cwd, ".pi", "SYSTEM.md");
  if (existsSync(projectSystem)) {
    const read = readPromptFile(projectSystem);
    return {
      source: "project",
      absolutePath: projectSystem,
      ...(read.content !== undefined ? { content: read.content } : {}),
      ...(read.error !== undefined ? { error: read.error } : {}),
    };
  }

  const globalCandidates = Array.from(
    new Set([join(input.runtimeAgentDir, "SYSTEM.md"), join(input.nativeAgentDir, "SYSTEM.md")]),
  );
  for (const candidate of globalCandidates) {
    if (!existsSync(candidate)) continue;
    const read = readPromptFile(candidate);
    return {
      source: "global",
      absolutePath: candidate,
      ...(read.content !== undefined ? { content: read.content } : {}),
      ...(read.error !== undefined ? { error: read.error } : {}),
    };
  }

  if (input.config.enabled && input.config.mode === "strict") {
    return {
      source: "builtin-strict",
      content: DEFAULT_BUILTIN_STRICT_PROMPT,
    };
  }

  return { source: "none" };
}

/**
 * Keep project context / AGENTS.md / runtime append tails intact in `replace`
 * mode while replacing Pi's default system identity preamble.
 */
export function buildPurgedSystemPrompt(input: {
  originalSystemPrompt: string;
  config: PurgeConfig;
  resolved: PurgeResolvedSource;
}): string | undefined {
  if (!input.config.enabled) return undefined;
  if (input.resolved.error !== undefined || input.resolved.content === undefined) {
    return undefined;
  }

  const replacement = input.resolved.content.trim();
  if (input.config.mode === "strict") {
    return replacement;
  }

  // `replace`: retain project context (`# Project Context`) and working-dir metadata if present.
  const projectContextIndex = input.originalSystemPrompt.indexOf("# Project Context");
  const dateIndex = input.originalSystemPrompt.indexOf("Current date:");
  const cwdIndex = input.originalSystemPrompt.indexOf("Current working directory:");
  const tailIndices = [projectContextIndex, dateIndex, cwdIndex].filter((idx) => idx >= 0);
  if (tailIndices.length === 0) {
    return replacement;
  }
  const earliestTail = Math.min(...tailIndices);
  const tail = input.originalSystemPrompt.slice(earliestTail).trim();
  return tail.length > 0 ? `${replacement}\n\n${tail}` : replacement;
}

export function formatPurgeMetaJson(input: {
  config: PurgeConfig;
  resolved: PurgeResolvedSource;
  effectiveChars?: number;
}): string {
  const payload: PurgeStatusPayload = {
    on: input.config.enabled,
    mode: input.config.mode,
    source: input.resolved.source,
    custom: Boolean(input.config.customPath),
    chars: input.effectiveChars ?? input.resolved.content?.length ?? 0,
    ...(input.resolved.error !== undefined ? { err: input.resolved.error.slice(0, 80) } : {}),
  };
  return JSON.stringify(payload);
}

export type ParsedPurgeArgs =
  | { kind: "menu" }
  | { kind: "toggle"; enabled: boolean }
  | { kind: "status" }
  | { kind: "mode"; mode: PurgeMode }
  | { kind: "source-auto" }
  | { kind: "source-custom"; path: string }
  | { kind: "prompt-source-pick" }
  | { kind: "help" };

export function parsePurgeCommandArgs(rawArgs: string): ParsedPurgeArgs {
  const trimmed = rawArgs.trim();
  if (!trimmed) return { kind: "menu" };

  const tokens = trimmed.split(/\s+/);
  const first = (tokens[0] ?? "").toLowerCase();
  const rest = trimmed.slice(tokens[0]?.length ?? 0).trim();

  if (first === "on" || first === "enable") return { kind: "toggle", enabled: true };
  if (first === "off" || first === "disable") return { kind: "toggle", enabled: false };
  if (first === "status") return { kind: "status" };
  if (first === "help" || first === "-h" || first === "--help") return { kind: "help" };
  if (first === "auto" || first === "clear" || first === "reset") return { kind: "source-auto" };

  if (first === "mode") {
    const mode = rest.toLowerCase();
    if (mode === "strict" || mode === "replace") {
      return { kind: "mode", mode };
    }
    return { kind: "help" };
  }

  if (first === "source") {
    if (!rest) return { kind: "prompt-source-pick" };
    if (rest.toLowerCase() === "auto" || rest.toLowerCase() === "clear") {
      return { kind: "source-auto" };
    }
    return { kind: "source-custom", path: stripQuotes(rest) };
  }

  // `/purge <filepath>` shortcut: any other path-like argument sets custom prompt and turns ON.
  return { kind: "source-custom", path: stripQuotes(trimmed) };
}

function stripQuotes(text: string): string {
  if (
    (text.startsWith('"') && text.endsWith('"') && text.length >= 2) ||
    (text.startsWith("'") && text.endsWith("'") && text.length >= 2)
  ) {
    return text.slice(1, -1).trim();
  }
  return text;
}
