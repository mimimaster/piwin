/**
 * Resource admission (2026-09-12 incident). A single `bash` call running
 * `pnpm test` forked ten ~1 GiB vitest workers while every product quota
 * stayed green, because `maxConcurrentRuns` counts Runs and
 * `process.maxProcesses` counts Jobs. These tests pin the gate that measures
 * what neither of those can see.
 */
import { describe, expect, it } from 'vitest';
import type { HostToolExecutionContext, HostToolRegistration } from '@piwin/contracts';
import { createEmptyRuleSet } from '@piwin/contracts';
import { createToolResourceGate, type AvailableMemoryReading } from '../system-memory.js';
import { createHostToolAdmission, resolveHostToolAdmission } from './tool-admission.js';

const GIB = 1024;

function reading(availableMiB: number): AvailableMemoryReading {
  return { availableMiB, totalMiB: 24 * GIB, source: 'memorystatus', sampledAtMs: 0 };
}

function registration(name: string, action: string): HostToolRegistration {
  return {
    descriptor: { name, description: name, parameters: { type: 'object', properties: {} } },
    family: 'shell',
    permissionSpec: {
      action,
      risk: 'command',
      rememberable: true,
      // `bash` is a subject-required action; without this the evaluator stops
      // at invalid-input and the admitted path never reaches policy.
      subjectBuilder: (args: Record<string, unknown>) =>
        action === 'bash' ? { kind: 'bash' as const, command: String(args.command ?? '') } : undefined,
    },
    execute: async () => ({ ok: true, output: 'ran' }),
  };
}

const context: HostToolExecutionContext = {
  sessionId: 'session-1',
  runtimeGenerationId: 'generation-1',
  runId: 'run-1',
  toolName: 'bash',
};

async function admit(input: {
  action: string;
  floorMiB: number;
  available: AvailableMemoryReading | null;
}) {
  let prompted = 0;
  const decision = await resolveHostToolAdmission({
    admission: createHostToolAdmission({
      rules: createEmptyRuleSet(),
      // bypass so nothing but the resource gate can refuse.
      getPermissionMode: () => 'bypass',
      requestPermission: async () => {
        prompted += 1;
        return 'allow' as const;
      },
      projectRoot: '/tmp',
      resourceGate: createToolResourceGate({
        getMinAvailableMemoryMiB: () => input.floorMiB,
        getReading: () => input.available,
      }),
    }),
    registration: registration('bash', input.action),
    args: { command: 'pnpm --dir apps/desktop test' },
    context,
    signal: new AbortController().signal,
  });
  return { decision, prompted };
}

describe('tool admission resource gate', () => {
  it('refuses a bash call below the memory floor and tells the model how to retry', async () => {
    // 1280 MiB is what the kernel reported minutes before the panel appeared.
    const { decision } = await admit({ action: 'bash', floorMiB: 2048, available: reading(1280) });
    expect(decision.allowed).toBe(false);
    if (decision.allowed) {
      throw new Error('expected refusal');
    }
    expect(decision.result.ok).toBe(false);
    if (decision.result.ok) {
      throw new Error('expected error result');
    }
    expect(decision.result.code).toBe('execution-failed');
    expect(decision.result.retryable).toBe(true);
    expect(decision.result.details?.reason).toBe('low-memory');
    expect(decision.result.message).toContain('was not run');
    expect(decision.result.message).toContain('--workspace-concurrency=1');
  });

  it('does not raise a permission prompt for a command it will not run', async () => {
    const { prompted } = await admit({ action: 'bash', floorMiB: 2048, available: reading(512) });
    expect(prompted).toBe(0);
  });

  it('admits the same call once memory recovers', async () => {
    const { decision } = await admit({ action: 'bash', floorMiB: 2048, available: reading(8192) });
    expect(decision.allowed).toBe(true);
  });

  it('gates process:start, which forks the same way with a longer life', async () => {
    const { decision } = await admit({
      action: 'process:start',
      floorMiB: 2048,
      available: reading(256),
    });
    expect(decision.allowed).toBe(false);
  });

  it('never gates read-only tools — the model still needs to diagnose the pressure', () => {
    // Asserted on the gate itself: `filesystem:read` needs a path subject the
    // admission fixture does not build, and that unrelated policy detail would
    // otherwise mask what this test is about.
    const gate = createToolResourceGate({
      getMinAvailableMemoryMiB: () => 2048,
      getReading: () => reading(64),
    });
    expect(gate({ action: 'filesystem:read' })).toEqual({ refuse: false });
    expect(gate({ action: 'filesystem:list' })).toEqual({ refuse: false });
    expect(gate({ action: 'bash' }).refuse).toBe(true);
  });

  it('fails open when memory cannot be measured', async () => {
    const { decision } = await admit({ action: 'bash', floorMiB: 2048, available: null });
    expect(decision.allowed).toBe(true);
  });

  it('fails open when the floor is 0 (gate switched off in settings)', async () => {
    const { decision } = await admit({ action: 'bash', floorMiB: 0, available: reading(1) });
    expect(decision.allowed).toBe(true);
  });
});
