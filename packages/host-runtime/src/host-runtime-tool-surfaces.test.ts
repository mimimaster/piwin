import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setProjectTrust } from '@piwin/project';
import { HostRuntime } from './host-runtime.js';
import { listModelToolSchemaDefects } from './model-tool-descriptor.js';
import { SUBAGENT_RESULT_APPLY_TOOL_NAME } from './subagent-result-apply-tool.js';
import { SUBAGENT_RESULT_READ_TOOL_NAME } from './subagent-result-read-tool.js';
import { SUBAGENT_REVIEW_SUBMIT_TOOL_NAME } from './subagent-review-submit-tool.js';
import { SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME } from './subagent-verification-submit-tool.js';

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
      ).toEqual(['piwin_plan_create', 'piwin_plan_present', 'piwin_plan_set_step']);
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('registers browser_* tools on cold composition without createSession', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-browser-'));
    const projectPath = join(piwinRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });

    try {
      const tools = await runtime.buildSessionHostToolsForSession(
        'session-cold-browser',
        'generation-cold-browser',
        undefined,
        'active',
        projectPath,
      );

      expect(tools.map((tool) => tool.descriptor.name)).toEqual(
        expect.arrayContaining(['browser_navigate', 'browser_click', 'browser_snapshot']),
      );
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('exposes exactly seven delegate tools in sdk and rpc modes', async () => {
    const expected = [
      'piwin_subagent_run',
      'piwin_subagent_start',
      'piwin_subagent_continue',
      SUBAGENT_RESULT_APPLY_TOOL_NAME,
      SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME,
      'piwin_subagent_wait',
      'piwin_subagent_cancel',
    ];
    for (const mode of ['sdk', 'rpc'] as const) {
      const piwinRoot = await mkdtemp(join(tmpdir(), `piwin-tool-surface-delegate-${mode}-`));
      const projectPath = join(piwinRoot, 'project');
      await mkdir(projectPath, { recursive: true });
      const runtime = new HostRuntime({ mode, mock: false, piwinRoot });
      try {
        const tools = await runtime.buildSessionHostToolsForSession(
          `session-delegate-${mode}`,
          `generation-delegate-${mode}`,
          undefined,
          'active',
          projectPath,
        );
        expect(
          tools.filter((tool) => tool.family === 'delegate').map((tool) => tool.descriptor.name),
        ).toEqual(expected);
      } finally {
        await runtime.dispose();
        await rm(piwinRoot, { recursive: true, force: true });
      }
    }
  });

  it('gives a worktree child the YOLO mode of its trusted source repository and parent', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-child-mode-'));
    const projectPath = join(piwinRoot, 'project');
    const worktreePath = join(piwinRoot, 'worktrees', 'subagent-1');
    await mkdir(projectPath, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await writeFile(
      join(piwinRoot, 'config.json'),
      JSON.stringify({ permissions: { mode: 'bypass' } }),
      'utf8',
    );
    await setProjectTrust(join(piwinRoot, 'projects.json'), projectPath, 'trusted');
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    try {
      runtime.subagentSessionContexts.set('worktree-child', {
        parentSessionId: 'parent-session',
        runtimeGenerationId: 'generation-child',
        workingDirectory: worktreePath,
        parentRepoPath: projectPath,
        worktreePath,
      });
      const composed = await runtime.composeSessionHostToolsForSession(
        'worktree-child',
        'generation-child',
      );
      expect(composed.permissionGate.getPermissionMode()).toBe('bypass');

      runtime.sessionPermissionOverrides.set('parent-session', 'ask-all');
      expect(composed.permissionGate.getPermissionMode()).toBe('ask-all');
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('does not give parent or ordinary child sessions reviewer-only tools', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-review-parent-'));
    const projectPath = join(piwinRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    try {
      runtime.subagentSessionContexts.set('ordinary-child', {
        parentSessionId: 'parent-session',
        runtimeGenerationId: 'generation-ordinary',
        workingDirectory: projectPath,
        parentRepoPath: projectPath,
      });
      const parentTools = await runtime.buildSessionHostToolsForSession(
        'parent-session',
        'generation-parent',
        undefined,
        'active',
        projectPath,
      );
      const childTools = await runtime.buildSessionHostToolsForSession(
        'ordinary-child',
        'generation-ordinary',
        undefined,
        'active',
        projectPath,
      );
      expect(parentTools.some((tool) => tool.descriptor.name === SUBAGENT_RESULT_READ_TOOL_NAME)).toBe(
        false,
      );
      expect(parentTools.some((tool) => tool.descriptor.name === SUBAGENT_RESULT_APPLY_TOOL_NAME)).toBe(
        true,
      );
      expect(
        parentTools.some((tool) => tool.descriptor.name === SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME),
      ).toBe(true);
      expect(childTools.some((tool) => tool.descriptor.name === SUBAGENT_RESULT_READ_TOOL_NAME)).toBe(
        false,
      );
      expect(childTools.some((tool) => tool.descriptor.name === SUBAGENT_RESULT_APPLY_TOOL_NAME)).toBe(
        false,
      );
      expect(
        childTools.some((tool) => tool.descriptor.name === SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME),
      ).toBe(false);
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('exposes the same scoped reviewer surface in sdk and worker modes', async () => {
    const reviewScope = {
      result: { resultId: 'result-1', revision: 1 },
      changes: { changeSetId: 'cs-child', revision: 1 },
    };
    const namesByMode: Record<string, string[]> = {};
    for (const mode of ['sdk', 'rpc'] as const) {
      const piwinRoot = await mkdtemp(join(tmpdir(), `piwin-tool-surface-reviewer-${mode}-`));
      const projectPath = join(piwinRoot, 'project');
      await mkdir(projectPath, { recursive: true });
      const runtime = new HostRuntime({ mode, mock: false, piwinRoot });
      try {
        runtime.subagentSessionContexts.set(`reviewer-${mode}`, {
          parentSessionId: 'parent-session',
          runtimeGenerationId: `generation-reviewer-${mode}`,
          workingDirectory: projectPath,
          parentRepoPath: projectPath,
          reviewScope,
        });
        const tools = await runtime.buildSessionHostToolsForSession(
          `reviewer-${mode}`,
          `generation-reviewer-${mode}`,
          undefined,
          'active',
          projectPath,
        );
        namesByMode[mode] = tools
          .filter((tool) => tool.family === 'delegate')
          .map((tool) => tool.descriptor.name);
      } finally {
        await runtime.dispose();
        await rm(piwinRoot, { recursive: true, force: true });
      }
    }
    const sdkNames = namesByMode.sdk ?? [];
    expect(sdkNames).toEqual([
      SUBAGENT_RESULT_READ_TOOL_NAME,
      SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
    ]);
    expect(sdkNames.includes(SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME)).toBe(false);
    expect(namesByMode.rpc).toEqual(sdkNames);
  });

  it('does not send array schemas without items to the model', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-schema-'));
    const projectPath = join(piwinRoot, 'project');
    await mkdir(projectPath, { recursive: true });
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });

    try {
      const tools = await runtime.buildSessionHostToolsForSession(
        'session-schema',
        'generation-schema',
        undefined,
        'active',
        projectPath,
      );
      const defects = tools.flatMap((tool) =>
        listModelToolSchemaDefects(tool.descriptor.parameters).map(
          (path) => `${tool.descriptor.name}: ${path}`,
        ),
      );
      expect(defects).toEqual([]);
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('omits browser_* tools on mock hosts', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-mock-'));
    const runtime = new HostRuntime({ mode: 'sdk', mock: true, piwinRoot });

    try {
      const tools = await runtime.buildSessionHostToolsForSession(
        'session-mock-browser',
        'generation-mock-browser',
      );

      expect(tools.some((tool) => tool.descriptor.name.startsWith('browser_'))).toBe(false);
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });
});
