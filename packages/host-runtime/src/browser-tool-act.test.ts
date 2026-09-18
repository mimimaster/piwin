import { describe, expect, it, vi } from 'vitest';
import type { BrowserSnapshotNode, HostToolExecutionContext, ToolResult } from '@piwin/contracts';
import type { BrowserSession } from '@piwin/browser';
import { createBrowserActDefinition } from './browser-tool-act.js';
import {
  collectActCandidates,
  parseRunParallel,
  type FastDecider,
  type FastDeciderChoice,
} from './browser-fast-decider.js';
import { normalizeBrowserFastDeciderConfig } from './config-store-browser.js';

const TREE: BrowserSnapshotNode[] = [
  {
    role: 'main',
    children: [
      { role: 'heading', name: 'Appearance', ref: 'e1', children: [] },
      { role: 'radio', name: 'Light', ref: 'e2', checked: true, children: [] },
      { role: 'radio', name: 'Dark', ref: 'e3', children: [] },
      { role: 'textbox', name: 'Email', ref: 'e4', children: [] },
      { role: 'button', name: '', ref: 'e5', children: [] },
    ],
  },
];

function mockSession() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const session = {
    snapshot: async () => TREE,
    click: async (...args: unknown[]) => void calls.push({ method: 'click', args }),
    type: async (...args: unknown[]) => void calls.push({ method: 'type', args }),
    fillForm: async (...args: unknown[]) => void calls.push({ method: 'fillForm', args }),
    currentState: () => ({ url: 'http://localhost:3000/settings', title: 'Settings' }),
    status: () => ({ generation: 1 }),
    pendingDialog: () => undefined,
  } as unknown as BrowserSession;
  return { session, calls };
}

function decider(result: Partial<FastDeciderChoice> | Error, minConfidence = 0.7): FastDecider {
  return {
    minConfidence,
    choose: vi.fn(async () => {
      if (result instanceof Error) throw result;
      return { value: '', probability: 0, ranked: [], elapsedMs: 90, ...result };
    }),
  };
}

const context = { runId: 'run-1' } as HostToolExecutionContext;

async function run(tool: ReturnType<typeof createBrowserActDefinition>, args: Record<string, unknown>) {
  const result = (await tool.execute(args, new AbortController().signal, context)) as ToolResult;
  if (!result.ok) throw new Error(`browser_act failed: ${result.message}`);
  return { result, output: JSON.parse(String(result.output)) as Record<string, unknown> };
}

describe('collectActCandidates', () => {
  it('keeps named, ref-bearing interactive nodes and marks checked state', () => {
    expect(collectActCandidates(TREE).map((c) => c.label)).toEqual([
      'e2: radio "Light" (checked)',
      'e3: radio "Dark"',
      'e4: textbox "Email"',
    ]);
  });
});

describe('browser_act', () => {
  it('acts on the decided ref when confidence clears the bar', async () => {
    const { session, calls } = mockSession();
    const tool = createBrowserActDefinition(
      session,
      decider({ value: 'e3: radio "Dark"', probability: 0.91 }),
    );
    const { result, output } = await run(tool, { intent: 'dark mode' });
    expect(result.ok).toBe(true);
    expect(output).toMatchObject({ status: 'acted', ref: 'e3', decidedBy: 'fast-decider' });
    expect(calls).toEqual([{ method: 'click', args: ['e3', expect.objectContaining({ actor: 'agent' })] }]);
  });

  it('hands ranked candidates back without acting when unsure', async () => {
    const { session, calls } = mockSession();
    const tool = createBrowserActDefinition(
      session,
      decider({
        value: 'e2: radio "Light" (checked)',
        probability: 0.55,
        ranked: [
          { choice: 'e2: radio "Light" (checked)', probability: 0.55 },
          { choice: 'e3: radio "Dark"', probability: 0.4 },
        ],
      }),
    );
    const { output } = await run(tool, { intent: 'dark mode' });
    expect(calls).toEqual([]);
    expect(output).toMatchObject({ status: 'needs-decision', reason: 'low-confidence', acted: false });
    expect((output.candidates as Array<{ ref: string }>).map((c) => c.ref)).toEqual(['e2', 'e3']);
  });

  it('degrades to a candidate list when the decider is unreachable', async () => {
    const { session, calls } = mockSession();
    const tool = createBrowserActDefinition(session, decider(new Error('ECONNREFUSED')));
    const { output } = await run(tool, { intent: 'dark mode' });
    expect(calls).toEqual([]);
    expect(output).toMatchObject({ status: 'needs-decision', reason: 'decider-unavailable' });
  });

  it('scopes type/fill to text inputs and never guesses a lone candidate', async () => {
    const { session, calls } = mockSession();
    const choose = decider({ value: 'x', probability: 1 });
    const tool = createBrowserActDefinition(session, choose);
    const { output } = await run(tool, { intent: 'email', action: 'fill', text: 'a@b.c' });
    expect(choose.choose).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
    expect(output).toMatchObject({ reason: 'single-candidate', candidates: [{ ref: 'e4' }] });
  });

  it('rejects type/fill without text at preparation', () => {
    const tool = createBrowserActDefinition(mockSession().session, decider({}));
    const prepared = tool.prepareArgs?.(
      { intent: 'email', action: 'type' },
      context,
      new AbortController().signal,
    );
    expect(prepared).toMatchObject({ ok: false });
  });
});

describe('parseRunParallel', () => {
  it('reads the enum choice and ranked telemetry', () => {
    expect(
      parseRunParallel(
        {
          elapsed_ms: 93.3,
          parsed_json: { choice: { value: 'a', prob: 0.87 } },
          field_telemetry: {
            choice: { top_choices: [{ choice: 'a', probability: 0.87 }, { choice: 'b', probability: 0.13 }] },
          },
        },
        500,
      ),
    ).toEqual({
      value: 'a',
      probability: 0.87,
      elapsedMs: 93.3,
      ranked: [
        { choice: 'a', probability: 0.87 },
        { choice: 'b', probability: 0.13 },
      ],
    });
  });

  it('throws when the engine returns no choice', () => {
    expect(() => parseRunParallel({ parsed_json: {} }, 1)).toThrow(/no enum choice/);
  });
});

describe('normalizeBrowserFastDeciderConfig', () => {
  it('accepts loopback URLs and clamps options', () => {
    expect(
      normalizeBrowserFastDeciderConfig({ url: 'http://127.0.0.1:8000/', minConfidence: 0.8, timeoutMs: 99_999 }),
    ).toEqual({ url: 'http://127.0.0.1:8000', minConfidence: 0.8, timeoutMs: 30_000 });
  });

  it('drops non-loopback endpoints so page text stays on this machine', () => {
    expect(normalizeBrowserFastDeciderConfig({ url: 'https://decider.example.com' })).toBeUndefined();
    expect(normalizeBrowserFastDeciderConfig({ url: 'file:///tmp/x' })).toBeUndefined();
  });
});
