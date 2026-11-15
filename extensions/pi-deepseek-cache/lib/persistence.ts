import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HistoryPoint, PersistedStats } from "./types.ts";

export const STATS_DIR = join(
  homedir(),
  ".pi",
  "agent",
  "extensions",
  "deepseek-cache",
);
export const SUMMARY_CACHE_FILE = join(STATS_DIR, "summary-cache.json");

export const SUMMARY_MAX_TOKENS = 8192;
export const MAX_HISTORY_POINTS = 100;
export const WRITE_DEBOUNCE_MS = 1000;
export const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const SUMMARY_CACHE_MAX_ENTRIES = 500;

export let extensionCtx: ExtensionContext | undefined;
export function setExtensionCtx(ctx: ExtensionContext): void {
  extensionCtx = ctx;
}

export let pendingStats: PersistedStats | null = null;
export let statsTimer: ReturnType<typeof setTimeout> | null = null;
export let pendingHistory: HistoryPoint[] | null = null;
export let historyTimer: ReturnType<typeof setTimeout> | null = null;

export function clearPendingStats(): void {
  pendingStats = null;
}

export function clearPendingHistory(): void {
  pendingHistory = null;
}

export function clearStatsTimer(): void {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
}

export function clearHistoryTimer(): void {
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
}

function statsPath(sessionId: string): string {
  return join(STATS_DIR, `stats-${sessionId}.json`);
}

function historyPath(sessionId: string): string {
  return join(STATS_DIR, `history-${sessionId}.json`);
}

export function loadSummaryCache(): Map<string, string> {
  try {
    if (existsSync(SUMMARY_CACHE_FILE)) {
      return new Map(
        Object.entries(JSON.parse(readFileSync(SUMMARY_CACHE_FILE, "utf-8"))),
      );
    }
  } catch {
    // silent — summary cache is best-effort
  }
  return new Map();
}

export function saveSummaryCacheSync(cache: Map<string, string>) {
  try {
    if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
    const obj: Record<string, string> = {};
    for (const [k, v] of cache) obj[k] = v;
    writeFileSync(SUMMARY_CACHE_FILE, JSON.stringify(obj, null, 2));
  } catch {
    // best-effort
  }
}

export function evictSummaryCacheIfNeeded(cache: Map<string, string>): void {
  while (cache.size > SUMMARY_CACHE_MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    if (firstKey) cache.delete(firstKey);
  }
}

/**
 * Delete stats-*.json and history-*.json files older than 30 days.
 */
function cleanupOldSessions() {
  try {
    if (!existsSync(STATS_DIR)) return;
    const cutoff = Date.now() - MAX_SESSION_AGE_MS;
    const files = readdirSync(STATS_DIR);
    for (const file of files) {
      if (
        (file.startsWith("stats-") && file.endsWith(".json")) ||
        (file.startsWith("history-") && file.endsWith(".json"))
      ) {
        try {
          const filePath = join(STATS_DIR, file);
          const st = statSync(filePath);
          if (st.mtimeMs < cutoff) {
            unlinkSync(filePath);
          }
        } catch {
          // best-effort per file
        }
      }
    }
  } catch {
    // best-effort
  }
}

const CLEANUP_MARKER = ".last-cleanup";

export function maybeCleanupOldSessions(): void {
  try {
    const markerPath = join(STATS_DIR, CLEANUP_MARKER);
    const now = Date.now();
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;

    if (existsSync(markerPath)) {
      const lastCleanup = parseInt(readFileSync(markerPath, "utf8"), 10);
      if (now - lastCleanup < ONE_DAY_MS) return; // skip — cleaned up recently
    }

    cleanupOldSessions();
    writeFileSync(markerPath, String(now), "utf8");
  } catch {
    // If marker file fails, still run cleanup (best-effort throttling)
    cleanupOldSessions();
  }
}

/**
 * Read all stats-*.json files in STATS_DIR and return summed PersistedStats
 * plus the count of sessions.
 */
export function aggregateAllSessions(): PersistedStats & { sessionCount: number } {
  const agg: PersistedStats = {
    cacheRead: 0,
    input: 0,
    cacheWrite: 0,
    turns: 0,
  };
  let sessionCount = 0;
  try {
    if (!existsSync(STATS_DIR)) return { ...agg, sessionCount: 0 };
    const files = readdirSync(STATS_DIR);
    for (const file of files) {
      if (file.startsWith("stats-") && file.endsWith(".json")) {
        try {
          const data: PersistedStats = JSON.parse(
            readFileSync(join(STATS_DIR, file), "utf-8"),
          );
          agg.cacheRead += data.cacheRead ?? 0;
          agg.input += data.input ?? 0;
          agg.cacheWrite += data.cacheWrite ?? 0;
          agg.turns += data.turns ?? 0;
          sessionCount++;
        } catch {
          // skip corrupted files
        }
      }
    }
  } catch {
    // best-effort
  }
  return { ...agg, sessionCount };
}

export async function aggregateAllSessionsAsync(): Promise<PersistedStats & { sessionCount: number }> {
  const agg: PersistedStats = {
    cacheRead: 0,
    input: 0,
    cacheWrite: 0,
    turns: 0,
  };
  let sessionCount = 0;
  try {
    if (!existsSync(STATS_DIR)) return { ...agg, sessionCount: 0 };
    const files = readdirSync(STATS_DIR); // directory listing is fast — sync is fine

    const statsFiles = files.filter(f => f.startsWith("stats-") && f.endsWith(".json"));

    const results = await Promise.all(
      statsFiles.map(async (file) => {
        try {
          const raw = await readFile(join(STATS_DIR, file), "utf8");
          return JSON.parse(raw) as PersistedStats;
        } catch {
          return null;
        }
      })
    );

    const valid = results.filter((r): r is PersistedStats => r !== null);

    for (const data of valid) {
      agg.cacheRead += data.cacheRead ?? 0;
      agg.input += data.input ?? 0;
      agg.cacheWrite += data.cacheWrite ?? 0;
      agg.turns += data.turns ?? 0;
      sessionCount++;
    }
  } catch {
    // best-effort
  }
  return { ...agg, sessionCount };
}

export function scheduleSaveStats(s: PersistedStats, sid: string) {
  if (!sid) return;
  pendingStats = s;
  if (statsTimer) return;
  statsTimer = setTimeout(() => {
    statsTimer = null;
    const data = pendingStats;
    pendingStats = null;
    if (!data) return;
    (async () => {
      try {
        if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
        await writeFile(statsPath(sid), JSON.stringify(data, null, 2));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        extensionCtx?.ui.notify(
          `[deepseek-cache] stats save failed: ${msg}`,
          "error",
        );
      }
    })();
  }, WRITE_DEBOUNCE_MS);
}

export function scheduleSaveHistory(h: HistoryPoint[], sid: string) {
  if (!sid) return;
  pendingHistory = h;
  if (historyTimer) return;
  historyTimer = setTimeout(() => {
    historyTimer = null;
    const data = pendingHistory;
    pendingHistory = null;
    if (!data) return;
    (async () => {
      try {
        if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
        await writeFile(
          historyPath(sid),
          JSON.stringify(data.slice(-MAX_HISTORY_POINTS), null, 2),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        extensionCtx?.ui.notify(
          `[deepseek-cache] history save failed: ${msg}`,
          "error",
        );
      }
    })();
  }, WRITE_DEBOUNCE_MS);
}

export function flushPendingWrites(sid: string) {
  if (statsTimer) {
    clearTimeout(statsTimer);
    statsTimer = null;
  }
  if (pendingStats && sid) {
    try {
      if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
      writeFileSync(statsPath(sid), JSON.stringify(pendingStats, null, 2));
    } catch {
      /* best-effort */
    }
    pendingStats = null;
  }
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
  if (pendingHistory && sid) {
    try {
      if (!existsSync(STATS_DIR)) mkdirSync(STATS_DIR, { recursive: true });
      writeFileSync(
        historyPath(sid),
        JSON.stringify(pendingHistory.slice(-MAX_HISTORY_POINTS), null, 2),
      );
    } catch {
      /* best-effort */
    }
    pendingHistory = null;
  }
}

