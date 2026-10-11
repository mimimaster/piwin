import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  createDefaultCodemodeConfig,
  type CodemodeConfig,
  type HostToolRegistration,
} from '@piwin/contracts';
import {
  buildSingleProxyTool,
  projectHostToolResultToPiContent,
  toPiBackendCustomTool,
} from '@piwin/agent-host';
import { buildCodemodeTool } from './codemode-tool.js';
import { createSessionHostToolExecutionPort } from '../tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from '../tools/tool-admission.js';
import { buildHostToolboxRegistration } from '../tool-catalog/catalog-tool.js';
import { buildSessionHostTools, descriptorsFromTools } from '../tools/build-session-host-tools.js';
import { createDefaultPiwinConfig } from '../config-store.js';

const SESSION = 'session-1';
const GENERATION = 'gen-1';
const RUN = 'run-1';

function limits(overrides: Partial<CodemodeConfig> = {}): CodemodeConfig {
  return { ...createDefaultCodemodeConfig(), enabled: true, timeoutMs: 10_000, ...overrides };
}

function readTool(
  name: string,
  execute: HostToolRegistration['execute'],
  family: HostToolRegistration['family'] = 'filesystem-read',
): HostToolRegistration {
  return {
    descriptor: { name, description: name, parameters: { type: 'object', properties: { path: { type: 'string' } } } },
    family,
    permissionSpec: {
      action: family === 'shell' ? 'bash' : 'filesystem:read',
      risk: 'unknown',
      rememberable: false,
      readOnly: true,
    },
    fileEffect: { kind: 'none' },
    ...(name === 'needs_path'
      ? {
          prepareArgs: (args: Record<string, unknown>) =>
            typeof args.path === 'string'
              ? { ok: true as const, arguments: args }
              : {
                  ok: false as const,
                  result: { ok: false as const, code: 'invalid-input' as const, message: 'path is required' },
                },
        }
      : {}),
    execute,
  };
}

function rows(count: number): Array<{ id: number; tag: string; filler: string }> {
  return Array.from({ length: count }, (_, id) => ({
    id,
    tag: id % 2 === 0 ? 'even' : 'odd',
    filler: 'x'.repeat(80),
  }));
}

describe('piwin_codemode execution', () => {
  it('registers by default, but respects explicit disable and a missing port', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-codemode-default-'));
    const port = createSessionHostToolExecutionPort({
      isSessionKnown: () => true,
      getRuntimeGenerationId: () => GENERATION,
    });
    try {
      const off = await buildSessionHostTools({
        sessionId: SESSION,
        piwinRoot: rootDir,
        config: { ...createDefaultPiwinConfig(), codemode: limits({ enabled: false }) },
        codemodePort: port,
      });
      expect(descriptorsFromTools(off).some((tool) => tool.name === 'piwin_codemode')).toBe(false);
      const onWithoutPort = await buildSessionHostTools({
        sessionId: SESSION,
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
      });
      expect(descriptorsFromTools(onWithoutPort).some((tool) => tool.name === 'piwin_codemode')).toBe(
        false,
      );
      const on = await buildSessionHostTools({
        sessionId: SESSION,
        piwinRoot: rootDir,
        config: createDefaultPiwinConfig(),
        codemodePort: port,
      });
      expect(descriptorsFromTools(on).some((tool) => tool.name === 'piwin_codemode')).toBe(true);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('filters a structured dataset through the real sandbox and Host port', async () => {
    const dataset = rows(2_000);
    const serialized = JSON.stringify(dataset);
    expect(serialized.length).toBeGreaterThan(120_000);
    const seen: Array<{ toolCallId?: string; parent?: string; toolName: string }> = [];
    let generation = GENERATION;
    let admitted = true;
    const port = createSessionHostToolExecutionPort({
      isSessionKnown: () => true,
      getRuntimeGenerationId: () => generation,
      isRunAdmitted: () => admitted,
      isToolDisabled: (registration) =>
        registration.descriptor.name === 'disabled_read'
          ? { domain: 'codemode', message: 'disabled for this generation' }
          : null,
    });
    const datasetTool = readTool('dataset', async (_args, _signal, context) => {
      seen.push({
        toolName: context.toolName,
        ...(context.toolCallId ? { toolCallId: context.toolCallId } : {}),
        ...(context.scriptInvocation
          ? { parent: context.scriptInvocation.parentToolCallId }
          : {}),
      });
      return { ok: true, output: 'see-structured', scriptPayload: { structuredContent: dataset } };
    });
    const needsPath = readTool('needs_path', async () => ({ ok: true, output: 'nope' }));
    const disabledRead = readTool('disabled_read', async () => ({ ok: true, output: 'nope' }));
    const shell = readTool('bash', async () => ({ ok: true, output: 'ran' }), 'shell');
    const denied = readTool('denied_read', async () => ({ ok: true, output: 'nope' }));
    const codemode = buildCodemodeTool({ config: limits(), port });
    const toolbox = buildHostToolboxRegistration([shell]);
    port.registerActiveGeneration(
      SESSION,
      GENERATION,
      [codemode, datasetTool, needsPath, disabledRead, denied, toolbox],
      {
        ...createPermissiveToolAdmission(),
        policyEvaluator: {
          evaluate: (input) =>
            input.registration.descriptor.name === 'denied_read'
              ? { kind: 'decision', policy: { decision: 'deny', reason: 'test-deny', action: 'filesystem:read', rememberable: false } }
              : { kind: 'decision', policy: { decision: 'allow', reason: 'test-allow', action: 'filesystem:read', rememberable: false } },
        },
      },
    );
    const projected = projectHostToolResultToPiContent({
      ok: true,
      output: serialized,
      scriptPayload: { structuredContent: dataset },
    });
    expect(projected.content[0]?.type === 'text' && projected.content[0].text.includes('…[truncated]')).toBe(true);
    expect(JSON.stringify(projected.details)).not.toContain(dataset[0]?.filler ?? 'missing');

    const code = `
      const rows = await tools.dataset({});
      if (typeof rows === 'string') return 'parsed-text';
      return rows.filter((row) => row.tag === 'even' && row.id >= 1990).sort((a, b) => b.id - a.id).slice(0, 3).map((row) => row.id);
    `;
    const result = await port.execute(
      {
        sessionId: SESSION,
        runtimeGenerationId: GENERATION,
        runId: RUN,
        toolCallId: 'parent-1',
        toolName: 'piwin_codemode',
        arguments: { code },
      },
      new AbortController().signal,
    );
    expect(result.ok, result.ok ? '' : result.message).toBe(true);
    if (!result.ok) return;
    expect(result.output).toContain('1998');
    expect(result.output).not.toContain(dataset[0]?.filler ?? 'missing');
    expect(seen[0]?.parent).toBe('parent-1');
    expect(seen[0]?.toolCallId).toBeTruthy();
    expect(seen[0]?.toolCallId).not.toBe('parent-1');
    const calls = result.details?.calls as Array<{ toolCallId: string; parentToolCallId: string }>;
    expect(new Set(calls.map((call) => call.toolCallId)).size).toBe(calls.length);
    expect(calls[0]?.parentToolCallId).toBe('parent-1');

    const sdk = toPiBackendCustomTool(
      codemode.descriptor,
      port,
      { sessionId: SESSION, runtimeGenerationId: GENERATION, getRunId: () => RUN },
    );
    const sdkResult = await sdk.execute('sdk-parent', { code }, new AbortController().signal, undefined, undefined);
    expect(sdkResult.content[0]).toMatchObject({ type: 'text' });

    const proxy = buildSingleProxyTool(codemode.descriptor, async (_sessionId, toolCallId, toolName, args, signal) =>
      port.execute(
        {
          sessionId: SESSION,
          runtimeGenerationId: GENERATION,
          runId: RUN,
          toolCallId,
          toolName,
          arguments: args,
        },
        signal ?? new AbortController().signal,
      ),
    SESSION);
    const rpcResult = await proxy.execute('rpc-parent', { code }, new AbortController().signal, undefined, undefined);
    expect(JSON.stringify(rpcResult.details)).not.toContain(dataset[0]?.filler ?? 'missing');

    await expect(runScript(port, 'return await tools.denied_read({ path: "a" })')).resolves.toMatchObject({
      ok: false,
    });
    await expect(runScript(port, 'return await tools.needs_path({})')).resolves.toMatchObject({ ok: false });
    await expect(runScript(port, 'return await tools.disabled_read({ path: "a" })')).resolves.toMatchObject({
      ok: false,
    });
    await expect(runScript(port, 'return await tools.missing({ path: "a" })')).resolves.toMatchObject({
      ok: false,
    });
    await expect(
      runScript(port, 'return await tools.piwin_toolbox({ action: "call", target: "bash", arguments: {} })'),
    ).resolves.toMatchObject({ ok: false });
    await expect(
      runScript(port, 'return await tools.piwin_codemode({ code: "return 1" })'),
    ).resolves.toMatchObject({ ok: false });

    generation = 'gen-2';
    await expect(runScript(port, 'return await tools.dataset({})')).resolves.toMatchObject({ ok: false });
    generation = GENERATION;
    admitted = false;
    await expect(runScript(port, 'return await tools.dataset({})')).resolves.toMatchObject({ ok: false });
  }, 30_000);
});

function runScript(
  port: ReturnType<typeof createSessionHostToolExecutionPort>,
  code: string,
) {
  return port.execute(
    {
      sessionId: SESSION,
      runtimeGenerationId: GENERATION,
      runId: RUN,
      toolCallId: `parent-${code.length}`,
      toolName: 'piwin_codemode',
      arguments: { code },
    },
    new AbortController().signal,
  );
}
