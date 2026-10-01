/**
 * DeepSeek Cache Optimization Extension
 * @piwin-bundled-extension
 *
 * Multi-layered prefix cache optimization for DeepSeek models in pi:
 *
 *   P0 — Date/CWD freeze: replaces dynamic system prompt elements with
 *        frozen values captured at session start. This is the root-cause fix
 *        that prevents daily and per-directory cache busting.
 *
 *   P1 — Hit-rate telemetry: accumulates cacheRead/input/cacheWrite/turns
 *        from every assistant message. Per-session stats are stored in
 *        stats-{sessionId}.json / history-{sessionId}.json files so concurrent
 *        pi sessions never race on the same file. The status line shows THIS
 *        session's hit rate only. /cache-stats shows both this session and
 *        an aggregate across all sessions.
 *
 *   P2 — Cache shape guard: SHA-256 hashes the prompt prefix each turn and
 *        warns when it changes — diagnosing what busted the cache.
 *
 *   P3 — Cache-friendly compaction: intercepts session_before_compact,
 *        summarizes with deepseek-v4-flash at temperature 0, and caches
 *        summaries by SHA-256 hash for deterministic, cache-stable replays.
 *
 *   P4 — TUI overlays: /cache-stats and /cache-graph display hit-rate
 *        data, cost estimates, and ASCII trend charts as overlay popups.
 *
 * Works with any provider serving DeepSeek models — detected by model ID
 * prefix (deepseek-*) or provider name (deepseek). No provider names are
 * hardcoded. Non-DeepSeek models pass through unchanged.
 *
 * Install: pi install npm:@rohaquinlop/pi-deepseek-cache
 */

import { complete } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  convertToLlm,
  serializeConversation,
} from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import {
  isDeepSeekModel,
  todayISO,
  calcHitRate,
  isDateFrozen,
  isCwdFrozen,
  applyDateFreeze,
  applyCwdFreeze,
} from "./lib/helpers.ts";
import type { CachedMessage, HistoryPoint, PersistedStats } from "./lib/types.ts";
import {
  STATS_DIR,
  SUMMARY_CACHE_FILE,
  SUMMARY_MAX_TOKENS,
  MAX_HISTORY_POINTS,
  loadSummaryCache,
  saveSummaryCacheSync,
  evictSummaryCacheIfNeeded,
  maybeCleanupOldSessions,
  aggregateAllSessionsAsync,
  scheduleSaveStats,
  scheduleSaveHistory,
  flushPendingWrites,
  setExtensionCtx,
  clearPendingStats,
  clearPendingHistory,
  clearStatsTimer,
  clearHistoryTimer,
} from "./lib/persistence.ts";
import { CacheStatsOverlay, CacheGraphOverlay } from "./lib/overlays.ts";

export default function (pi: ExtensionAPI) {
  // ────── P1: Per-session runtime state (counters start at 0) ──────
  let sessionId = "";
  let cacheRead = 0;
  let input = 0;
  let cacheWrite = 0;
  let turns = 0;

  const hitRateHistory: HistoryPoint[] = [];
  let lastHitRate = 0;

  // ────── P0: Session fingerprint ──────
  let sessionDate = todayISO();
  let sessionCwd = "";

  // ────── P2: Prefix guard state ──────
  let lastPrefixHash: string | undefined;
  let warnedThisTurn = false;
  let prefixBreaks = 0;

  // ────── P3: Summary cache ──────
  const summaryCache = loadSummaryCache();

  // ────── Helper: set ctx for persistence error reporting ──────
  const setCtx = (ctx: ExtensionContext) => {
    setExtensionCtx(ctx);
  };

  // ═══════════════════════════════════════════════════════════════════════
  // session_start
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("session_start", async (_event, ctx) => {
    setCtx(ctx);

    // Get per-session ID
    sessionId = ctx.sessionManager?.getSessionId?.() ?? "";

    // Reset all counters for fresh session
    cacheRead = 0;
    input = 0;
    cacheWrite = 0;
    turns = 0;
    hitRateHistory.length = 0;
    lastHitRate = 0;

    // P0
    sessionDate = todayISO();
    sessionCwd = ctx.cwd;
    lastPrefixHash = undefined;
    warnedThisTurn = false;
    prefixBreaks = 0;

    // Cleanup old session files
    maybeCleanupOldSessions();
  });

  // ═══════════════════════════════════════════════════════════════════════
  // session_shutdown — flush writes, clear status
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("session_shutdown", async (_event, ctx) => {
    flushPendingWrites(sessionId);
    if (ctx.hasUI) ctx.ui.setStatus("cache", undefined);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P0: before_agent_start — freeze date and CWD
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("before_agent_start", async (event, ctx) => {
    setCtx(ctx);
    if (!isDeepSeekModel(ctx.model)) return;

    let prompt = event.systemPrompt;
    let changed = false;

    if (!isDateFrozen(prompt, sessionDate)) {
      prompt = applyDateFreeze(prompt, sessionDate);
      changed = true;
    }
    if (!isCwdFrozen(prompt, sessionCwd)) {
      prompt = applyCwdFreeze(prompt, sessionCwd);
      changed = true;
    }

    if (changed) return { systemPrompt: prompt };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P1: message_end — accumulate cache stats (per-session)
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("message_end", async (event, ctx) => {
    setCtx(ctx);
    if (event.message.role !== "assistant") return;
    const u = (event.message as any).usage;
    if (!u) return;

    cacheRead += u.cacheRead ?? 0;
    input += u.input ?? 0;
    cacheWrite += u.cacheWrite ?? 0;
    turns += 1;

    const stats: PersistedStats = { cacheRead, input, cacheWrite, turns };
    scheduleSaveStats(stats, sessionId);

    // Use total prompt tokens as denominator for accurate hit rate.
    // For DeepSeek: cacheWrite=0, input=miss_tokens → total=prompt_tokens.
    // For Anthropic: cacheWrite holds actual writes, included in total.
    const rate = calcHitRate(cacheRead, input, cacheWrite);

    // piwin patch 1: no composer status chip for the hit rate; /cache-stats
    // still reports it on demand.

    // Track history on rate change
    const rateKey = rate.toFixed(2);
    const lastKey = lastHitRate.toFixed(2);
    if (rateKey !== lastKey) {
      hitRateHistory.push({
        turn: turns,
        hitRate: rate,
        timestamp: Date.now(),
      });
      if (hitRateHistory.length > MAX_HISTORY_POINTS) {
        hitRateHistory.splice(0, hitRateHistory.length - MAX_HISTORY_POINTS);
      }
      lastHitRate = rate;
      scheduleSaveHistory(hitRateHistory, sessionId);
    }
  });

  // ═══════════════════════════════════════════════════════════════════════
  // turn_end — reset prefix guard for the next turn
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("turn_end", (_event, _ctx) => {
    warnedThisTurn = false;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P2: before_provider_request — prefix hash diagnostics
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("before_provider_request", (event, ctx) => {
    setCtx(ctx);
    if (!isDeepSeekModel(ctx.model)) return;

    const payload = event.payload as { messages?: CachedMessage[] };
    const msgs = payload.messages ?? [];
    if (msgs.length === 0) return;

    // P2: Prefix guard — detect cache-breaking mutations
    // DeepSeek's prefix cache matches from byte position 0 in the prompt.
    // The prefix is everything BEFORE the new user turn (the current last message).
    // We hash msgs.slice(0, -1) to check if the prefix (all prior messages)
    // has changed since last turn. If the hash differs, the cache is broken
    // and we warn the user.
    let currentHash: string;
    try {
      currentHash = createHash("sha256")
        .update(JSON.stringify(msgs.slice(0, -1)))
        .digest("hex");
    } catch {
      return;
    }

    if (
      lastPrefixHash !== undefined &&
      currentHash !== lastPrefixHash &&
      !warnedThisTurn
    ) {
      warnedThisTurn = true;
      prefixBreaks++;
    }
    lastPrefixHash = currentHash;
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P3: session_before_compact — cache-friendly deterministic compaction
  // ═══════════════════════════════════════════════════════════════════════

  pi.on("session_before_compact", async (event, ctx) => {
    setCtx(ctx);

    // Only intercept if we're on a DeepSeek model
    if (!isDeepSeekModel(ctx.model)) return;

    const { preparation, signal } = event;
    if (!preparation) return; // fall back to default compaction
    const { messagesToSummarize, previousSummary, firstKeptEntryId, tokensBefore } = preparation;

    flushPendingWrites(sessionId);

    const history = serializeConversation(convertToLlm(messagesToSummarize));
    const text = previousSummary
      ? `[Previous summary]\n${previousSummary}\n\n[New history]\n${history}`
      : history;

    const key = createHash("sha256").update(text).digest("hex");
    let summary = summaryCache.get(key);

    if (!summary) {
      summary = await summarizeWithFlash(text, ctx, signal);
      if (!summary) return; // fall back to default compaction
      summaryCache.set(key, summary);
      evictSummaryCacheIfNeeded(summaryCache);
      saveSummaryCacheSync(summaryCache);
    }

    return {
      compaction: {
        summary,
        firstKeptEntryId,
        tokensBefore,
        details: { summarizer: "deepseek-v4-flash" },
      },
    };
  });

  // ═══════════════════════════════════════════════════════════════════════
  // P4: Commands — /cache-stats, /cache-graph, /cache-reset
  // ═══════════════════════════════════════════════════════════════════════

  pi.registerCommand("cache-stats", {
    description: "DeepSeek cache hit rate statistics",
    handler: async (_args, ctx) => {
      setCtx(ctx);
      const agg = await aggregateAllSessionsAsync();
      await ctx.ui.custom(
        (_tui, theme, _kb, done) =>
          new CacheStatsOverlay(
            theme,
            { cacheRead, input, cacheWrite, turns },
            done,
            agg,
            prefixBreaks,
            ctx.model?.id,
          ),
        { overlay: true },
      );
    },
  });

  pi.registerCommand("cache-graph", {
    description: "DeepSeek cache hit rate trend chart",
    handler: async (_args, ctx) => {
      setCtx(ctx);
      await ctx.ui.custom(
        (_tui, theme, _kb, done) =>
          new CacheGraphOverlay(theme, hitRateHistory, done),
        { overlay: true },
      );
    },
  });

  pi.registerCommand("cache-reset", {
    description: "Reset DeepSeek cache statistics",
    handler: async (_args, ctx) => {
      setCtx(ctx);
      // Reset in-memory counters
      cacheRead = 0;
      input = 0;
      cacheWrite = 0;
      turns = 0;
      hitRateHistory.length = 0;
      lastHitRate = 0;
      lastPrefixHash = undefined;
      warnedThisTurn = false;
      prefixBreaks = 0;
      summaryCache.clear();

      // Clear pending writes without flushing to disk (files get deleted below)
      clearStatsTimer();
      clearPendingStats();
      clearHistoryTimer();
      clearPendingHistory();

      // Delete ALL session files
      try {
        if (existsSync(STATS_DIR)) {
          const files = readdirSync(STATS_DIR);
          for (const file of files) {
            if (
              (file.startsWith("stats-") && file.endsWith(".json")) ||
              (file.startsWith("history-") && file.endsWith(".json"))
            ) {
              try {
                unlinkSync(join(STATS_DIR, file));
              } catch {
                /* best-effort */
              }
            }
          }
        }
        if (existsSync(SUMMARY_CACHE_FILE)) unlinkSync(SUMMARY_CACHE_FILE);
      } catch {
        /* best-effort */
      }
      ctx.ui.notify("Cache stats reset", "info");
      if (ctx.hasUI) ctx.ui.setStatus("cache", undefined);
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// P3 helper: summarize with deepseek-v4-flash at temperature 0
// ═══════════════════════════════════════════════════════════════════════════

async function summarizeWithFlash(
  text: string,
  ctx: ExtensionContext,
  signal: AbortSignal,
): Promise<string | undefined> {
  // Use the active model's provider — it already serves DeepSeek models.
  // No hardcoded provider names. Works for NaN Builders, OpenRouter,
  // direct DeepSeek API, and custom providers.
  const currentProvider = ctx.model?.provider;
  let model = currentProvider
    ? ctx.modelRegistry.find(currentProvider, "deepseek-v4-flash")
    : undefined;

  // Last resort: search any provider
  if (!model) {
    for (const prov of ctx.modelRegistry.listProviders()) {
      model = ctx.modelRegistry.find(prov, "deepseek-v4-flash");
      if (model) break;
    }
  }

  if (!model) {
    ctx.ui.notify(
      "deepseek-cache: flash model not found, skipping cache-friendly compaction",
      "warning",
    );
    return;
  }

  const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok || !auth.apiKey) {
    ctx.ui.notify(
      "deepseek-cache: flash auth failed, falling back to default compaction",
      "warning",
    );
    return;
  }

  try {
    const response = await complete(
      model,
      {
        messages: [
          {
            role: "user" as const,
            content: [
              {
                type: "text" as const,
                text:
                  "Summarize this conversation history into structured markdown. " +
                  "Cover: ① goal ② key decisions & rationale ③ code/file changes " +
                  "④ current progress ⑤ blockers & open questions ⑥ next steps. " +
                  "Be thorough — this summary replaces the original history.\n\n" +
                  text,
              },
            ],
            timestamp: Date.now(),
          },
        ],
        temperature: 0,
      },
      {
        apiKey: auth.apiKey,
        headers: auth.headers,
        maxTokens: SUMMARY_MAX_TOKENS,
        signal,
      },
    );

    const summary = response.content
      .filter((c): c is { type: "text"; text: string } => c.type === "text")
      .map((c) => c.text)
      .join("\n");

    return summary.trim() || undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.ui.notify(
      `deepseek-cache: flash summarization failed (${msg}), falling back to default compaction`,
      "error",
    );
    return;
  }
}
