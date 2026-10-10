import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createDefaultCodemodeConfig, type HostToolRegistration } from '@piwin/contracts';
import { createMcpLifecycleManager } from '@piwin/mcp';
import { buildCodemodeTool } from './codemode-tool.js';
import { createSessionHostToolExecutionPort } from '../tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from '../tools/tool-admission.js';
import { createToolCatalogService } from '../tool-catalog/catalog-service.js';
import { buildHostToolboxRegistration } from '../tool-catalog/catalog-tool.js';

const fixturePath = fileURLToPath(
  new URL('../../../mcp/src/fixtures/codemode-readonly-mcp-server.mjs', import.meta.url),
);

describe('codemode local MCP harness', () => {
  const roots: string[] = [];
  afterAll(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it('keeps structured MCP results, isError, cancellation, and readOnlyHint', async () => {
    const root = await mkdtemp(join(tmpdir(), 'piwin-codemode-mcp-'));
    roots.push(root);
    await writeFile(
      join(root, 'mcp.json'),
      JSON.stringify({
        mcpServers: {
          local: { command: process.execPath, args: [fixturePath] },
        },
      }),
    );
    const manager = createMcpLifecycleManager(root);
    try {
      await manager.start('local');
      const catalog = createToolCatalogService({ lifecycleManager: manager });
      const port = createSessionHostToolExecutionPort({
        isSessionKnown: () => true,
        getRuntimeGenerationId: () => 'gen-1',
        isRunAdmitted: () => true,
      });
      const probe: HostToolRegistration = {
        descriptor: { name: 'probe', description: 'probe', parameters: { type: 'object', properties: {} } },
        family: 'filesystem-read',
        permissionSpec: { action: 'filesystem:read', risk: 'unknown', rememberable: false, readOnly: true },
        fileEffect: { kind: 'none' },
        execute: async () => ({ ok: true, output: 'probe' }),
      };
      const toolbox = buildHostToolboxRegistration([probe], { catalog });
      const codemode = buildCodemodeTool({
        config: { ...createDefaultCodemodeConfig(), enabled: true, timeoutMs: 10_000 },
        port,
      });
      port.registerActiveGeneration('session-1', 'gen-1', [codemode, probe, toolbox], createPermissiveToolAdmission());
      port.restrictGeneration('session-1', 'gen-1', ['piwin_codemode', 'piwin_toolbox'], ['probe'], true);

      const searched = await run(port, `return await tools.piwin_toolbox({ action: 'search', query: 'rows' });`);
      expect(searched.ok).toBe(true);
      if (searched.ok) {
        expect(searched.output).toContain('local.rows');
        expect(searched.output).not.toContain('local.mutate');
      }

      const called = await run(
        port,
        `const value = await tools.piwin_toolbox({ action: 'call', target: 'local.rows', arguments: {} }); return value.rows.map((row) => row.id).sort();`,
      );
      expect(called.ok, called.ok ? '' : called.message).toBe(true);
      if (called.ok) {
        expect(called.output).toContain('1');
        expect(called.output).toContain('2');
      }

      const broken = await run(
        port,
        `try { await tools.piwin_toolbox({ action: 'call', target: 'local.broken', arguments: {} }); return 'kept'; } catch (error) { return String(error && error.message); }`,
      );
      expect(broken.ok).toBe(true);
      if (broken.ok) {
        expect(broken.output).toContain('upstream failed');
      }

      const mutate = await run(
        port,
        `try { await tools.piwin_toolbox({ action: 'call', target: 'local.mutate', arguments: {} }); return 'called'; } catch (error) { return String(error && error.message); }`,
      );
      expect(mutate.ok).toBe(true);
      if (mutate.ok) {
        expect(mutate.output).toContain('readOnlyHint');
        expect(mutate.output).not.toContain('mutated');
      }

      const controller = new AbortController();
      const hanging = run(
        port,
        `await tools.piwin_toolbox({ action: 'call', target: 'local.hang', arguments: {} }); return 'done';`,
        controller.signal,
      );
      await new Promise((resolve) => setTimeout(resolve, 200));
      controller.abort();
      const cancelled = await hanging;
      expect(cancelled.ok).toBe(false);
    } finally {
      await manager.dispose();
    }
  }, 30_000);
});

let scriptOrdinal = 0;

function run(
  port: ReturnType<typeof createSessionHostToolExecutionPort>,
  code: string,
  signal = new AbortController().signal,
) {
  scriptOrdinal += 1;
  return port.execute(
    {
      sessionId: 'session-1',
      runtimeGenerationId: 'gen-1',
      runId: 'run-1',
      toolCallId: `parent-mcp-${scriptOrdinal}`,
      toolName: 'piwin_codemode',
      arguments: { code },
    },
    signal,
  );
}
