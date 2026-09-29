import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CreateSessionInput, PiwinConfig, SessionToolFamily } from '@piwin/contracts';
import { compileToolPolicy } from './blueprint-agent-tool-policy.js';
import { HostRuntime } from './host-runtime.js';
import { listModelToolSchemaDefects } from './model-tool-descriptor.js';

/**
 * The Host `edit` must reach real sessions in both backends under Pi's own
 * tool name, stay a gated file write, and stay out of read-only reviewers.
 */
describe('Host edit tool surface', () => {
  it.each(['sdk', 'rpc'] as const)('ships the Host edit to a %s coding session', async (mode) => {
    const piwinRoot = await mkdtemp(join(tmpdir(), `piwin-edit-surface-${mode}-`));
    const projectPath = join(piwinRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    const runtime = new HostRuntime({ mode, mock: false, piwinRoot });
    try {
      const tools = await runtime.buildSessionHostToolsForSession(
        `session-${mode}`,
        `generation-${mode}`,
        undefined,
        'active',
        projectPath,
      );
      const edit = tools.find((tool) => tool.descriptor.name === 'edit');
      expect(edit?.family).toBe('filesystem-write');
      expect(edit?.fileEffect?.kind).toBe('exact-paths');
      expect(edit?.permissionSpec?.action).toBe('file-write');
      expect(Object.keys(edit?.descriptor.parameters.properties ?? {})).toEqual(['path', 'edits']);
      expect(tools.filter((tool) => tool.descriptor.name === 'edit')).toHaveLength(1);
      expect(listModelToolSchemaDefects(tools.map((tool) => tool.descriptor))).toEqual([]);
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('drops edit together with write_file for a read-only subagent policy', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-edit-surface-readonly-'));
    const projectPath = join(piwinRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    try {
      const tools = await runtime.buildSessionHostToolsForSession(
        'session-policy',
        'generation-policy',
        undefined,
        'active',
        projectPath,
      );
      const familyIndex = new Map<SessionToolFamily, string[]>();
      for (const tool of tools) {
        if (!tool.family) continue;
        familyIndex.set(tool.family, [...(familyIndex.get(tool.family) ?? []), tool.descriptor.name]);
      }
      const compile = (subagent: CreateSessionInput['subagent']) =>
        compileToolPolicy(
          {} as PiwinConfig,
          { projectPath, ...(subagent ? { subagent } : {}) } as CreateSessionInput,
          tools.map((tool) => tool.descriptor),
          tools.map((tool) => tool.descriptor.name),
          true,
          [],
          familyIndex,
        ).tools.hostTools.map((tool) => tool.name);

      const coding = compile(undefined);
      expect(coding).toContain('edit');
      expect(coding).toContain('write_file');

      const readonly = compile({ mode: 'readonly', capabilities: ['read'] });
      expect(readonly).not.toContain('edit');
      expect(readonly).not.toContain('write_file');
      expect(readonly).toContain('read_file');
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });
});
