/** GAP-001: model-driven real SDK + spawned worker JSONL, not captured customTools. */
import { describe, expect, it } from 'vitest';
import { normalizeGenerationToolCallId } from '@piwin/agent-host';
import {
  FILLER, GENERATION, MODEL, RAW_PARENT, RUN, SESSION, openCodemodeBackend,
} from './codemode-backend-test-harness.js';

type Harness = Awaited<ReturnType<typeof openCodemodeBackend>>;
const identity = { sessionId: SESSION, runtimeGenerationId: GENERATION };
const parentId = normalizeGenerationToolCallId(identity, RAW_PARENT);
const filterCode = `
  const rows = await tools.fixture_rows({});
  if (typeof rows === 'string') throw new Error('structured result lost');
  const again = await tools.fixture_rows({});
  return rows.filter(row => row.tag === 'even' && row.id >= 1990)
    .sort((a, b) => b.id - a.id).slice(0, 3).map(row => again[row.id].id);
`;

function assertManifest(h: Harness, enabled: boolean) {
  const names = h.compiled.backendBlueprint.capabilitySnapshot.tools.hostTools.map((tool) => tool.name);
  expect(names.includes('piwin_codemode')).toBe(enabled);
  expect(h.compiled.backendBlueprint.capabilitySnapshot.tools.enabledFamilies.includes('codemode')).toBe(enabled);
  expect(h.compiled.sessionBlueprint.hostToolDescriptors.map((tool) => tool.name)).toEqual(names);
  expect(h.compiled.blueprint.tools.hostTools.map((tool) => tool.name)).toEqual(names);
  expect(h.model.errors).toEqual([]);
  expect(h.model.requests.length).toBeGreaterThan(0);
  for (const request of h.model.requests) {
    expect(request.model).toBe(MODEL.modelId);
    const advertised = request.tools?.map((tool) => tool.function.name) ?? [];
    expect(advertised.includes('piwin_codemode')).toBe(enabled);
    if (enabled) {
      const descriptor = names.indexOf('piwin_codemode');
      expect(request.tools?.find((tool) => tool.function.name === 'piwin_codemode')?.function.parameters)
        .toEqual(h.compiled.backendBlueprint.capabilitySnapshot.tools.hostTools[descriptor]?.parameters);
    }
    // Neither model request nor transcript/protocol event receives nested payloads.
    expect(JSON.stringify(request)).not.toContain(FILLER);
  }
  expect(JSON.stringify(h.events)).not.toContain(FILLER);
}

function assertProvenance(h: Harness, nestedCount: number) {
  const parent = h.inputs.filter((input) => input.toolName === 'piwin_codemode');
  expect(parent).toHaveLength(1);
  expect(parent[0]).toMatchObject({ ...identity, runId: RUN, toolCallId: parentId });
  expect(parent[0]).not.toHaveProperty('scriptInvocation');
  const nested = h.inputs.filter((input) => input.scriptInvocation);
  expect(nested).toHaveLength(nestedCount);
  expect(h.contexts).toHaveLength(nestedCount);
  for (const [index, input] of nested.entries()) {
    const nestedId = normalizeGenerationToolCallId(identity, `${parentId}\u0000codemode\u0000${index + 1}`);
    expect(input).toMatchObject({ ...identity, runId: RUN, toolCallId: nestedId,
      scriptInvocation: { kind: 'script-readonly', parentToolCallId: parentId } });
    expect(input.scriptInvocation?.admittedToolNames).toContain(input.toolName);
    expect(h.contexts[index]).toMatchObject({ ...identity, runId: RUN, toolCallId: nestedId,
      scriptInvocation: input.scriptInvocation });
    const result = h.results.find((item) => item.input.toolName === 'piwin_codemode')?.result;
    if (result?.details) {
      expect(result.details.calls).toContainEqual(expect.objectContaining({
        toolCallId: nestedId, parentToolCallId: parentId, name: input.toolName,
      }));
    }
  }
  expect(new Set(h.inputs.map((input) => input.toolCallId)).size).toBe(nestedCount + 1);
  const starts = h.events.filter((event) => event.type === 'tool/start');
  expect(starts).toContainEqual(expect.objectContaining({ toolName: 'piwin_codemode', toolCallId: parentId, runId: RUN }));
}

async function close(h: Harness) {
  await h.close();
  expect(h.supervisor.getStatus()).toMatchObject({ activeWorkers: 0, startingWorkers: 0 });
  expect(h.model.isListening()).toBe(false);
}

describe.each(['sdk', 'rpc'] as const)('model-driven Codemode (%s)', (mode) => {
  it('compiles enabled config, advertises the tool and filters >120k structured data', async () => {
    const h = await openCodemodeBackend(mode, filterCode);
    try {
      expect(h.supervisor.getStatus().activeWorkers).toBe(mode === 'rpc' ? 1 : 0);
      expect(h.serialized.length).toBeGreaterThan(120_000);
      const outcome = await h.handle.prompt({ text: 'Run the fixture script.', runId: RUN, model: MODEL });
      expect(outcome).toEqual({ status: 'completed', stopReason: 'stop' });
      assertManifest(h, true);
      assertProvenance(h, 2);
      expect(h.model.requests).toHaveLength(2);
      const result = h.results.find((item) => item.input.toolName === 'piwin_codemode')?.result;
      expect(result).toMatchObject({ ok: true, details: { calls: [
        { name: 'fixture_rows', parentToolCallId: parentId, status: 'ok' },
        { name: 'fixture_rows', parentToolCallId: parentId, status: 'ok' },
      ] } });
      if (!result?.ok) throw new Error('missing successful codemode result');
      expect(JSON.parse(result.output)).toEqual([1998, 1996, 1994]);
      expect(JSON.stringify(result)).not.toContain(FILLER);
      const toolMessage = h.model.requests[1]?.messages.find((message) => message.role === 'tool');
      expect(toolMessage?.tool_call_id).toBe(RAW_PARENT);
      expect(JSON.parse(String(toolMessage?.content))).toEqual([1998, 1996, 1994]);
      expect(h.events).toContainEqual(expect.objectContaining({ type: 'tool/end', toolCallId: parentId, runId: RUN, isError: false }));
    } finally { await close(h); }
  }, 60_000);

  it.each([
    { label: 'script error', code: `throw new Error('fixture script failed');`, message: 'fixture script failed', nested: 0 },
    { label: 'nested structured tool error', code: `return await tools.fixture_error({});`, message: 'fixture upstream failed', nested: 1 },
    { label: 'nested failed tool result', code: `return await tools.fixture_failure({});`, message: 'fixture read failed', nested: 1 },
  ])('propagates $label as a real session tool error', async ({ code, message, nested }) => {
    const h = await openCodemodeBackend(mode, code);
    try {
      expect(await h.handle.prompt({ text: 'Run failing fixture.', runId: RUN, model: MODEL }))
        .toEqual({ status: 'completed', stopReason: 'stop' });
      assertManifest(h, true);
      assertProvenance(h, nested);
      const result = h.results.find((item) => item.input.toolName === 'piwin_codemode')?.result;
      expect(result).toMatchObject({ ok: false, code: 'execution-failed', message: expect.stringContaining(message) });
      expect(h.events).toContainEqual(expect.objectContaining({ type: 'tool/end', toolCallId: parentId, runId: RUN, isError: true }));
      expect(h.model.requests).toHaveLength(2);
      const toolMessage = h.model.requests[1]?.messages.find((item) => item.role === 'tool');
      expect(toolMessage?.tool_call_id).toBe(RAW_PARENT);
      expect(String(toolMessage?.content)).toContain(message);
    } finally { await close(h); }
  }, 60_000);

  it('aborts a long nested Host read, without starting the queued read', async () => {
    const h = await openCodemodeBackend(mode,
      `return await Promise.all([tools.fixture_wait({}), tools.fixture_wait({})]);`);
    const pending = h.handle.prompt({ text: 'Run waiting fixture.', runId: RUN, model: MODEL });
    try {
      await expect.poll(() => h.contexts.some((context) => context.toolName === 'fixture_wait'),
        { timeout: 5_000 }).toBe(true);
      await h.started;
      await h.handle.abort();
      // Must reach Host promptly, not only via the 15s sandbox deadline or disposal.
      await expect.poll(() => h.results.find((item) => item.input.toolName === 'fixture_wait')?.result,
        { timeout: 2_000 }).toMatchObject({ ok: false, code: 'aborted' });
      await h.aborted;
      const outcome = await pending;
      // Pi 0.84.2 reports an abort during tool execution as a failed prompt
      // ("This operation was aborted"); this slice verifies Host cancellation.
      expect(outcome).toMatchObject({ status: 'failed', failure: { message: expect.stringContaining('aborted') } });
      assertManifest(h, true);
      assertProvenance(h, 1);
      expect(h.contexts.filter((context) => context.toolName === 'fixture_wait')).toHaveLength(1);
      expect(h.results.find((item) => item.input.toolName === 'fixture_wait')?.result)
        .toMatchObject({ ok: false, code: 'aborted' });
      expect(h.results.find((item) => item.input.toolName === 'piwin_codemode')?.result)
        .toMatchObject({ ok: false, code: 'aborted' });
    } finally {
      await close(h);
      await pending.catch(() => undefined);
    }
  }, 60_000);

  it('compiles disabled config out of the final manifest and real model request', async () => {
    const h = await openCodemodeBackend(mode, filterCode, false);
    try {
      expect(await h.handle.prompt({ text: 'No codemode enabled.', runId: RUN, model: MODEL }))
        .toEqual({ status: 'completed', stopReason: 'stop' });
      assertManifest(h, false);
      expect(h.model.requests).toHaveLength(1);
      expect(h.inputs).toEqual([]);
    } finally { await close(h); }
  }, 60_000);
});
