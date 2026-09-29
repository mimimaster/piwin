import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyExtensionSource,
  detectExtensionCommands,
  detectExtensionHookEvents,
  readExtensionCompatibility,
  readExtensionHookEvents,
} from './detect-extension-hooks.js';

describe('detectExtensionHookEvents', () => {
  it('collects unique pi.on event names without executing source', () => {
    expect(
      detectExtensionHookEvents(`
        export default function (pi) {
          pi.on('tool_call', () => {});
          pi.on("session_start", () => {});
          pi.on('tool_call', () => {});
        }
      `),
    ).toEqual(['tool_call', 'session_start']);
  });

  it('ignores comments that are not pi.on calls', () => {
    expect(detectExtensionHookEvents("const name = 'tool_call';\n// pi.on later")).toEqual([]);
  });
});

describe('classifyExtensionSource', () => {
  it('marks tools and dialogs as compatible', () => {
    expect(
      classifyExtensionSource(`
        export default function (pi) {
          pi.registerTool({ name: 'hello', execute: () => {} });
          pi.on('tool_call', () => {});
        }
      `).tier,
    ).toBe('compatible');
    expect(
      classifyExtensionSource(`
        ctx.ui.confirm('ok');
        ctx.ui.select('pick', []);
        ctx.ui.input('name');
        ctx.ui.notify('done');
      `).tier,
    ).toBe('compatible');
  });


  it('marks registerProvider-only extensions as compatible', () => {
    expect(
      classifyExtensionSource(`
        export default function (pi) {
          pi.unregisterProvider("anthropic");
          pi.registerProvider("anthropic", { api: "anthropic-messages" });
          pi.registerCommand("anthropic-auth:status", { handler() {} });
        }
      `).tier,
    ).toBe('compatible');
  });

  it('marks mixed agent + TUI as degraded and TUI-only as incompatible', () => {
    expect(
      classifyExtensionSource(`
        pi.registerTool({ name: 'hello' });
        ctx.ui.custom({ render() {} });
      `).tier,
    ).toBe('degraded');
    expect(
      classifyExtensionSource(`
        pi.registerTheme({ name: 'dark' });
        ctx.setHeader('status');
      `).tier,
    ).toBe('incompatible');
  });

  it('degrades custom renderers but blocks extensions that require raw terminal mode', () => {
    expect(
      classifyExtensionSource(`
        pi.registerTool({
          name: 'hello',
          renderCall() {},
        });
      `).tier,
    ).toBe('degraded');
    expect(
      classifyExtensionSource(`
        pi.registerTool({ name: 'hello' });
        process.stdin.setRawMode(true);
      `),
    ).toEqual({
      tier: 'incompatible',
      incompatibilityReason: 'requires-terminal-tty',
    });
  });
});

describe('readExtensionCompatibility', () => {
  it('classifies fixture files without executing them', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-compat-scan-'));
    const compatiblePath = join(rootDir, 'tools.ts');
    const tuiPath = join(rootDir, 'theme.ts');
    const mixedDir = join(rootDir, 'mixed');
    await mkdir(mixedDir);
    await writeFile(
      compatiblePath,
      "pi.on('tool_call', () => {});\npi.registerTool({ name: 'ok' });\n",
      'utf8',
    );
    await writeFile(tuiPath, 'ctx.ui.custom({});\nregisterTheme();\n', 'utf8');
    await writeFile(
      join(mixedDir, 'index.ts'),
      "pi.registerTool({ name: 'x' });\nctx.reload();\n",
      'utf8',
    );
    expect(await readExtensionCompatibility(compatiblePath)).toEqual({
      tier: 'compatible',
      capabilities: { tools: ['ok'], hooks: ['tool_call'] },
    });
    expect(await readExtensionCompatibility(tuiPath)).toEqual({ tier: 'incompatible' });
    expect((await readExtensionCompatibility(mixedDir)).tier).toBe('degraded');
    expect(await readExtensionCompatibility(join(rootDir, 'missing.ts'))).toEqual({
      tier: 'unverified',
    });
  });
});

describe('readExtensionHookEvents', () => {
  it('reads a flat extension file and a package index', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-hook-scan-'));
    const filePath = join(rootDir, 'path-guard.ts');
    await writeFile(filePath, "pi.on('tool_call', (event) => event);\n", 'utf8');
    expect(await readExtensionHookEvents(filePath)).toEqual(['tool_call']);

    const packDir = join(rootDir, 'pack');
    await mkdir(packDir);
    await writeFile(join(packDir, 'index.ts'), "pi.on('agent_end', () => {});\n", 'utf8');
    expect(await readExtensionHookEvents(packDir)).toEqual(['agent_end']);
  });
});

describe('detectExtensionCommands', () => {
  it('finds commands in both registerCommand forms and exposes them as capabilities', () => {
    const source = `
      export default function (pi) {
        pi.registerCommand("cache-stats", { description: "Show cache", handler() {} });
        pi.registerCommand({ name: 'wiki:distill', handler() {} });
        pi.registerTool({ name: 'lookup', execute() {} });
        pi.on('session_start', (_event, ctx) => ctx.ui.setStatus('cache', 'warm'));
      }
    `;
    expect(detectExtensionCommands(source)).toEqual(['cache-stats', 'wiki:distill']);
    expect(classifyExtensionSource(source)).toEqual({
      tier: 'compatible',
      capabilities: {
        tools: ['lookup'],
        hooks: ['session_start'],
        commands: ['cache-stats', 'wiki:distill'],
      },
    });
  });
});

describe('setWidget classification', () => {
  it('treats text-line widgets as bridged and component factories as TUI', () => {
    const tools = "pi.registerTool({ name: 'x' });\n";
    expect(classifyExtensionSource(`${tools}ctx.ui.setWidget('todos', lines, { placement: 'belowEditor' });`).tier).toBe('compatible');
    expect(classifyExtensionSource(`${tools}ctx.ui.setWidget('todos', ['a', 'b']);`).tier).toBe('compatible');
    expect(classifyExtensionSource(`${tools}ctx.ui.setWidget('todos', undefined);`).tier).toBe('compatible');
    expect(classifyExtensionSource(`${tools}ctx.ui.setWidget('todos', (tui, theme) => new Panel(theme));`).tier).toBe('degraded');
    expect(classifyExtensionSource(`${tools}ctx.ui.setWidget("todos", function (tui) { return x; });`).tier).toBe('degraded');
    expect(classifyExtensionSource(`${tools}ctx.ui.setWidget('todos', new Panel());`).tier).toBe('degraded');
  });
});

