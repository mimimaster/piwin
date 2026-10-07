import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ClientToolExecutionPort,
  CreateSessionInput,
  PiwinConfig,
  SessionToolFamily,
} from '@piwin/contracts';
import { compileToolPolicy } from './blueprint-agent-tool-policy.js';
import { HostRuntime } from './host-runtime.js';

const HEALTH_TOOL = 'health_read_context';

function devicePort(capable: boolean): ClientToolExecutionPort {
  return {
    execute: async () => ({ ok: false, reason: 'client-device-unavailable', retryable: true }),
    hasCapableDevice: () => capable,
  };
}

/** The tool names a model would actually be offered for one session. */
async function modelToolNames(input: {
  port: ClientToolExecutionPort | undefined;
  subagent?: CreateSessionInput['subagent'];
}): Promise<string[]> {
  const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-health-surface-'));
  const projectPath = join(piwinRoot, 'project');
  await mkdir(projectPath, { recursive: true });
  const runtime = new HostRuntime({
    mode: 'sdk',
    mock: false,
    piwinRoot,
    ...(input.port === undefined ? {} : { clientToolExecution: input.port }),
  });
  try {
    const tools = await runtime.buildSessionHostToolsForSession(
      'session-health',
      'generation-health',
      undefined,
      'active',
      projectPath,
    );
    const familyIndex = new Map<SessionToolFamily, string[]>();
    for (const tool of tools) {
      if (!tool.family) continue;
      familyIndex.set(tool.family, [...(familyIndex.get(tool.family) ?? []), tool.descriptor.name]);
    }
    return compileToolPolicy(
      {} as PiwinConfig,
      { projectPath, ...(input.subagent ? { subagent: input.subagent } : {}) } as CreateSessionInput,
      tools.map((tool) => tool.descriptor),
      tools.map((tool) => tool.descriptor.name),
      true,
      [],
      familyIndex,
    ).tools.hostTools.map((tool) => tool.name);
  } finally {
    await runtime.dispose();
    await rm(piwinRoot, { recursive: true, force: true });
  }
}

describe('health_read_context exposure', () => {
  it('reaches the model once a paired device offers Apple Health', async () => {
    expect(await modelToolNames({ port: devicePort(true) })).toContain(HEALTH_TOOL);
  });

  it('stays out of the prompt while no device offers Apple Health', async () => {
    expect(await modelToolNames({ port: devicePort(false) })).not.toContain(HEALTH_TOOL);
  });

  it('is absent on a Host composed without device tools', async () => {
    expect(await modelToolNames({ port: undefined })).not.toContain(HEALTH_TOOL);
  });

  it('is never handed to a capability-ceilinged subagent', async () => {
    const names = await modelToolNames({
      port: devicePort(true),
      subagent: { capabilities: ['read'] } as CreateSessionInput['subagent'],
    });
    expect(names).not.toContain(HEALTH_TOOL);
  });
});
