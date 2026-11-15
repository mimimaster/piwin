import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import piPurgeExtension from "./pi-purge/index.ts";
import {
  buildPurgedSystemPrompt,
  DEFAULT_BUILTIN_STRICT_PROMPT,
  formatPurgeMetaJson,
  loadPurgeConfig,
  parsePurgeCommandArgs,
  resolvePurgeSource,
  savePurgeConfig,
} from "./pi-purge/purge-core.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-purge-test-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("bundled pi-purge extension", () => {
  it("parses /purge commands including bare filepath shortcut", () => {
    expect(parsePurgeCommandArgs("")).toEqual({ kind: "menu" });
    expect(parsePurgeCommandArgs("on")).toEqual({ kind: "toggle", enabled: true });
    expect(parsePurgeCommandArgs("off")).toEqual({ kind: "toggle", enabled: false });
    expect(parsePurgeCommandArgs("mode replace")).toEqual({ kind: "mode", mode: "replace" });
    expect(parsePurgeCommandArgs("source auto")).toEqual({ kind: "source-auto" });
    expect(parsePurgeCommandArgs('source "/tmp/my prompt.md"')).toEqual({
      kind: "source-custom",
      path: "/tmp/my prompt.md",
    });
    expect(parsePurgeCommandArgs("./prompts/lean.md")).toEqual({
      kind: "source-custom",
      path: "./prompts/lean.md",
    });
  });

  it("discovers custom > project > global > builtin-strict sources cleanly", () => {
    const root = makeTempDir();
    const cwd = join(root, "proj");
    const runtimeAgentDir = join(root, "piwin-agent");
    const nativeAgentDir = join(root, "pi-agent");
    mkdirSync(join(cwd, ".pi"), { recursive: true });
    mkdirSync(runtimeAgentDir, { recursive: true });
    mkdirSync(nativeAgentDir, { recursive: true });

    const globalPrompt = join(nativeAgentDir, "SYSTEM.md");
    writeFileSync(globalPrompt, "GLOBAL SYSTEM");
    expect(
      resolvePurgeSource({ config: { enabled: true, mode: "replace" }, cwd, runtimeAgentDir, nativeAgentDir }),
    ).toMatchObject({ source: "global", absolutePath: globalPrompt, content: "GLOBAL SYSTEM" });

    const projPrompt = join(cwd, ".pi", "SYSTEM.md");
    writeFileSync(projPrompt, "PROJECT SYSTEM");
    expect(
      resolvePurgeSource({ config: { enabled: true, mode: "replace" }, cwd, runtimeAgentDir, nativeAgentDir }),
    ).toMatchObject({ source: "project", absolutePath: projPrompt, content: "PROJECT SYSTEM" });

    const customFile = join(root, "custom.md");
    writeFileSync(customFile, "CUSTOM SYSTEM");
    expect(
      resolvePurgeSource({
        config: { enabled: true, mode: "strict", customPath: customFile },
        cwd,
        runtimeAgentDir,
        nativeAgentDir,
      }),
    ).toMatchObject({ source: "custom", absolutePath: customFile, content: "CUSTOM SYSTEM" });

    const emptyCwd = join(root, "empty");
    const emptyRuntime = join(root, "empty-runtime");
    const emptyNative = join(root, "empty-native");
    expect(
      resolvePurgeSource({
        config: { enabled: true, mode: "strict" },
        cwd: emptyCwd,
        runtimeAgentDir: emptyRuntime,
        nativeAgentDir: emptyNative,
      }),
    ).toEqual({ source: "builtin-strict", content: DEFAULT_BUILTIN_STRICT_PROMPT });
  });

  it("strips or preserves Project Context by mode and persists round-trips", () => {
    const root = makeTempDir();
    const runtimeAgentDir = join(root, "pi-agent");
    const settingsPath = join(runtimeAgentDir, "settings.json");
    savePurgeConfig(settingsPath, { enabled: true, mode: "replace", customPath: "/tmp/foo.md" });
    expect(loadPurgeConfig({ cwd: root, runtimeAgentDir, nativeAgentDir: join(root, "none") })).toEqual({
      enabled: true,
      mode: "replace",
      customPath: "/tmp/foo.md",
    });

    const original = "Long Pi preamble\n\n# Project Context\nUse pnpm.\n\nCurrent working directory: /repo";
    expect(
      buildPurgedSystemPrompt({
        originalSystemPrompt: original,
        config: { enabled: true, mode: "strict" },
        resolved: { source: "custom", absolutePath: "/tmp/custom.md", content: "LEAN PROMPT" },
      }),
    ).toBe("LEAN PROMPT");

    expect(
      buildPurgedSystemPrompt({
        originalSystemPrompt: original,
        config: { enabled: true, mode: "replace" },
        resolved: { source: "custom", absolutePath: "/tmp/custom.md", content: "LEAN PROMPT" },
      }),
    ).toBe("LEAN PROMPT\n\n# Project Context\nUse pnpm.\n\nCurrent working directory: /repo");

    const meta = JSON.parse(
      formatPurgeMetaJson({
        config: { enabled: true, mode: "strict", customPath: "/tmp/custom.md" },
        resolved: { source: "custom", absolutePath: "/tmp/custom.md", content: "12345" },
      }),
    ) as Record<string, unknown>;
    expect(meta).toEqual({ on: true, mode: "strict", source: "custom", custom: true, chars: 5 });
  });

  it("registers /purge handler, handles /purge <filepath>, and emits meta statuses", async () => {
    const root = makeTempDir();
    const cwd = join(root, "workspace");
    const piwinAgent = join(root, "piwin-agent");
    mkdirSync(cwd, { recursive: true });
    mkdirSync(piwinAgent, { recursive: true });
    const prevEnv = process.env.PIWIN_PI_AGENT_DIR;
    process.env.PIWIN_PI_AGENT_DIR = piwinAgent;

    try {
      const promptPath = join(cwd, "my-prompt.md");
      writeFileSync(promptPath, "ONLY FOLLOW THIS PROMPT");

      const handlers = new Map<string, (...args: unknown[]) => Promise<unknown>>();
      let purgeCommand: { handler: (args: string, ctx: unknown) => Promise<void> } | undefined;
      const statuses = new Map<string, string | undefined>();
      const notifications: string[] = [];

      piPurgeExtension({
        on(name: string, fn: (...args: unknown[]) => Promise<unknown>) {
          handlers.set(name, fn);
        },
        registerCommand(name: string, spec: { handler: (args: string, ctx: unknown) => Promise<void> }) {
          if (name === "purge") purgeCommand = spec;
        },
      } as never);

      const ctx = {
        cwd,
        hasUI: true,
        ui: {
          setStatus(key: string, text?: string) {
            statuses.set(key, text);
          },
          notify(msg: string) {
            notifications.push(msg);
          },
          select: vi.fn(),
          input: vi.fn(),
        },
      };

      await handlers.get("session_start")?.({}, ctx);
      expect(statuses.get("pi-purge")).toBeUndefined();
      expect(JSON.parse(statuses.get("meta:pi-purge") ?? "{}")).toMatchObject({ on: false, source: "none" });

      await purgeCommand?.handler(promptPath, ctx);
      expect(statuses.get("pi-purge")).toBe("PURGE · strict");
      expect(statuses.get("meta:pi-purge-path")).toBe(promptPath);
      expect(JSON.parse(statuses.get("meta:pi-purge") ?? "{}")).toMatchObject({
        on: true,
        mode: "strict",
        source: "custom",
        custom: true,
      });
      expect(notifications.at(-1)).toContain(promptPath);

      const result = (await handlers.get("before_agent_start")?.({ systemPrompt: "ORIGINAL PI PROMPT" }, ctx)) as
        | { systemPrompt?: string }
        | undefined;
      expect(result?.systemPrompt).toBe("ONLY FOLLOW THIS PROMPT");
    } finally {
      if (prevEnv === undefined) delete process.env.PIWIN_PI_AGENT_DIR;
      else process.env.PIWIN_PI_AGENT_DIR = prevEnv;
    }
  });
});
