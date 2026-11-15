/**
 * Bundled `pi-purge` extension for Piwin (@piwin-bundled-extension).
 * Preserves `/purge` semantics while adding `/purge <filepath>` shortcut and
 * emitting structured `meta:pi-purge` + `meta:pi-purge-path` for SessionStatusPanel.
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import {
  buildPurgedSystemPrompt,
  formatPurgeMetaJson,
  loadPurgeConfig,
  parsePurgeCommandArgs,
  PURGE_META_KEY,
  PURGE_PATH_META_KEY,
  PURGE_STATUS_KEY,
  resolvePurgeSource,
  resolveRuntimeAgentDirs,
  savePurgeConfig,
  type PurgeConfig,
  type PurgeMode,
  type PurgeResolvedSource,
} from "./purge-core.ts";

function getGlobalSettingsPath(cwd: string, mode: "project" | "global", runtimeAgentDir: string): string {
  return mode === "project" ? join(cwd, ".pi", "settings.json") : join(runtimeAgentDir, "settings.json");
}

function publishPurgeStatus(
  ctx: ExtensionContext,
  config: PurgeConfig,
  resolved: PurgeResolvedSource,
  effectiveChars?: number,
): void {
  if (!ctx.hasUI) return;
  ctx.ui.setStatus(
    PURGE_STATUS_KEY,
    config.enabled ? `PURGE · ${config.mode}` : undefined,
  );
  ctx.ui.setStatus(
    PURGE_META_KEY,
    formatPurgeMetaJson({
      config,
      resolved,
      ...(effectiveChars !== undefined ? { effectiveChars } : {}),
    }),
  );
  const pathText =
    resolved.absolutePath ??
    (resolved.source === "builtin-strict" ? "builtin:strict" : undefined);
  ctx.ui.setStatus(PURGE_PATH_META_KEY, pathText);
}

export default function piPurgeExtension(pi: ExtensionAPI): void {
  const resolveForCwd = (cwd: string): {
    config: PurgeConfig;
    resolved: PurgeResolvedSource;
    runtimeAgentDir: string;
    nativeAgentDir: string;
  } => {
    const dirs = resolveRuntimeAgentDirs();
    const config = loadPurgeConfig({
      cwd,
      runtimeAgentDir: dirs.runtimeAgentDir,
      nativeAgentDir: dirs.nativeAgentDir,
    });
    const resolved = resolvePurgeSource({
      config,
      cwd,
      runtimeAgentDir: dirs.runtimeAgentDir,
      nativeAgentDir: dirs.nativeAgentDir,
    });
    return { config, resolved, ...dirs };
  };

  pi.on("session_start", async (_event, ctx) => {
    const { config, resolved } = resolveForCwd(ctx.cwd);
    publishPurgeStatus(ctx, config, resolved);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    const { config, resolved } = resolveForCwd(ctx.cwd);
    const nextPrompt = buildPurgedSystemPrompt({
      originalSystemPrompt: event.systemPrompt,
      config,
      resolved,
    });
    publishPurgeStatus(ctx, config, resolved, nextPrompt?.length);
    if (config.enabled && resolved.error) {
      ctx.ui.notify(resolved.error, "warning");
    }
    if (nextPrompt !== undefined) {
      return { systemPrompt: nextPrompt };
    }
    return undefined;
  });

  pi.registerCommand("purge", {
    description: "Strip/replace Pi system prompt (/purge on|off|status|mode|source|<file>)",
    handler: async (args, ctx) => {
      const dirs = resolveRuntimeAgentDirs();
      let config = loadPurgeConfig({
        cwd: ctx.cwd,
        runtimeAgentDir: dirs.runtimeAgentDir,
        nativeAgentDir: dirs.nativeAgentDir,
      });
      const parsed = parsePurgeCommandArgs(args ?? "");
      const settingsPath = getGlobalSettingsPath(ctx.cwd, "global", dirs.runtimeAgentDir);

      const persistAndNotify = (next: PurgeConfig, headline: string, level: "info" | "warning" = "info"): void => {
        savePurgeConfig(settingsPath, next);
        const resolved = resolvePurgeSource({
          config: next,
          cwd: ctx.cwd,
          runtimeAgentDir: dirs.runtimeAgentDir,
          nativeAgentDir: dirs.nativeAgentDir,
        });
        publishPurgeStatus(ctx, next, resolved);
        const pathLabel = resolved.absolutePath ?? resolved.source;
        if (resolved.error) {
          ctx.ui.notify(`${headline}\n${resolved.error}`, "warning");
          return;
        }
        ctx.ui.notify(`${headline} · mode=${next.mode} · prompt=${pathLabel}`, level);
      };

      if (parsed.kind === "toggle") {
        config = { ...config, enabled: parsed.enabled };
        persistAndNotify(config, parsed.enabled ? "pi-purge ON" : "pi-purge OFF");
        return;
      }

      if (parsed.kind === "mode") {
        config = { ...config, mode: parsed.mode };
        persistAndNotify(config, `pi-purge mode -> ${parsed.mode}`);
        return;
      }

      if (parsed.kind === "source-auto") {
        const next: PurgeConfig = { enabled: config.enabled, mode: config.mode };
        persistAndNotify(next, "pi-purge source -> auto discovery");
        return;
      }

      if (parsed.kind === "source-custom") {
        const next: PurgeConfig = {
          enabled: true,
          mode: config.mode,
          customPath: parsed.path,
        };
        const resolved = resolvePurgeSource({
          config: next,
          cwd: ctx.cwd,
          runtimeAgentDir: dirs.runtimeAgentDir,
          nativeAgentDir: dirs.nativeAgentDir,
        });
        if (resolved.error) {
          ctx.ui.notify(resolved.error, "error");
          return;
        }
        persistAndNotify(next, `pi-purge ON (custom prompt)`);
        return;
      }

      if (parsed.kind === "status" || parsed.kind === "help") {
        const resolved = resolvePurgeSource({
          config,
          cwd: ctx.cwd,
          runtimeAgentDir: dirs.runtimeAgentDir,
          nativeAgentDir: dirs.nativeAgentDir,
        });
        publishPurgeStatus(ctx, config, resolved);
        const lines = [
          `pi-purge: ${config.enabled ? "ON" : "OFF"} (mode=${config.mode})`,
          `source: ${resolved.source}${resolved.absolutePath ? ` -> ${resolved.absolutePath}` : ""}`,
          ...(resolved.error ? [`error: ${resolved.error}`] : []),
          "usage: /purge on | off | status | mode <strict|replace> | source <path|auto> | <filepath>",
        ];
        ctx.ui.notify(lines.join("\n"), resolved.error ? "warning" : "info");
        return;
      }

      if (!ctx.hasUI) {
        const resolved = resolvePurgeSource({
          config,
          cwd: ctx.cwd,
          runtimeAgentDir: dirs.runtimeAgentDir,
          nativeAgentDir: dirs.nativeAgentDir,
        });
        publishPurgeStatus(ctx, config, resolved);
        return;
      }

      if (parsed.kind === "prompt-source-pick") {
        const entered = await ctx.ui.input(
          "Custom system prompt file path (blank for auto SYSTEM.md):",
          config.customPath ?? "",
        );
        if (entered === undefined) return;
        const trimmed = entered.trim();
        if (!trimmed) {
          persistAndNotify({ enabled: config.enabled, mode: config.mode }, "pi-purge source -> auto");
          return;
        }
        const next: PurgeConfig = { enabled: true, mode: config.mode, customPath: trimmed };
        const resolved = resolvePurgeSource({
          config: next,
          cwd: ctx.cwd,
          runtimeAgentDir: dirs.runtimeAgentDir,
          nativeAgentDir: dirs.nativeAgentDir,
        });
        if (resolved.error) {
          ctx.ui.notify(resolved.error, "error");
          return;
        }
        persistAndNotify(next, "pi-purge ON (custom prompt)");
        return;
      }

      const resolved = resolvePurgeSource({
        config,
        cwd: ctx.cwd,
        runtimeAgentDir: dirs.runtimeAgentDir,
        nativeAgentDir: dirs.nativeAgentDir,
      });
      const toggleLabel = config.enabled ? "Turn OFF (/purge off)" : "Turn ON (/purge on)";
      const nextMode: PurgeMode = config.mode === "strict" ? "replace" : "strict";
      const choice = await ctx.ui.select(
        `pi-purge (${config.enabled ? "ON" : "OFF"}, ${config.mode}, ${resolved.absolutePath ?? resolved.source})`,
        [
          toggleLabel,
          `Switch mode -> ${nextMode}`,
          "Set custom prompt file...",
          "Reset prompt source -> auto (SYSTEM.md)",
        ],
      );
      if (!choice) return;
      if (choice === toggleLabel) {
        persistAndNotify({ ...config, enabled: !config.enabled }, !config.enabled ? "pi-purge ON" : "pi-purge OFF");
      } else if (choice.startsWith("Switch mode")) {
        persistAndNotify({ ...config, mode: nextMode }, `pi-purge mode -> ${nextMode}`);
      } else if (choice.startsWith("Set custom prompt")) {
        const entered = await ctx.ui.input("Custom system prompt file path:", config.customPath ?? "");
        if (entered === undefined || !entered.trim()) return;
        const next: PurgeConfig = { enabled: true, mode: config.mode, customPath: entered.trim() };
        const customResolved = resolvePurgeSource({
          config: next,
          cwd: ctx.cwd,
          runtimeAgentDir: dirs.runtimeAgentDir,
          nativeAgentDir: dirs.nativeAgentDir,
        });
        if (customResolved.error) {
          ctx.ui.notify(customResolved.error, "error");
          return;
        }
        persistAndNotify(next, "pi-purge ON (custom prompt)");
      } else if (choice.startsWith("Reset prompt source")) {
        persistAndNotify({ enabled: config.enabled, mode: config.mode }, "pi-purge source -> auto");
      }
    },
  });
}
