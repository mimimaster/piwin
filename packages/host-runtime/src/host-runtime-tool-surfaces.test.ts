import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostRuntime } from './host-runtime.js';

describe('HostRuntime tool surfaces', () => {
  it('uses the explicit project path before session binding completes', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-'));
    const projectPath = join(piwinRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });

    try {
      const tools = await runtime.buildSessionHostToolsForSession(
        'session-before-bind',
        'generation-before-bind',
        undefined,
        'active',
        projectPath,
      );

      expect(
        tools.filter((tool) => tool.family === 'planning').map((tool) => tool.descriptor.name),
      ).toEqual(['piwin_plan_create', 'piwin_plan_set_step']);
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });
});
