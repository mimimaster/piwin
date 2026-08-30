import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  detectExtensionHookEvents,
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
