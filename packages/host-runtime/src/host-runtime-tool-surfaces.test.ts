import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { setProjectTrust } from '@piwin/project';
import { HostRuntime } from './host-runtime.js';
import { listModelToolSchemaDefects } from './model-tool-descriptor.js';
import { SUBAGENT_RESULT_APPLY_TOOL_NAME } from './subagent-result-apply-tool.js';
import { SUBAGENT_RESULT_DISCARD_TOOL_NAME } from './subagent-result-discard-tool.js';
import { SUBAGENT_RESULT_READ_TOOL_NAME } from './subagent-result-read-tool.js';
import { SUBAGENT_REVIEW_SUBMIT_TOOL_NAME } from './subagent-review-submit-tool.js';
import { SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME } from './subagent-verification-submit-tool.js';
import { evaluateFileWritePermission } from './permission-policy.js';
import { HostToolExecutionRouter } from './tools/host-tool-execution-router.js';
import { compileBlueprintForWorker } from './blueprint-compiler.js';
import { createDefaultPiwinConfig } from './config-store.js';
import { descriptorsFromTools } from './tools/build-session-host-tools.js';
import { toolFamilyIndex } from './tools/tool-family-index.js';
import { SessionHostToolExecutionPort } from './tools/session-host-tool-port.js';
import { createPermissiveToolAdmission } from './tools/tool-admission.js';

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

  it('exposes exactly ten delegate tools in sdk and rpc modes', async () => {
    const expected = [
      'piwin_subagent_run',
      'piwin_subagent_start',
      'piwin_subagent_continue',
      SUBAGENT_RESULT_APPLY_TOOL_NAME,
      // The lead's other exit for a candidate it will not apply.
      SUBAGENT_RESULT_DISCARD_TOOL_NAME,
      SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME,
      'piwin_subagent_wait',
      'piwin_subagent_cancel',
      // Lead review: Fusion's parent approves its own sidekick candidates.
      'piwin_subagent_review_submit',
      // Auto's per-role loops load on demand instead of riding every prompt.
      'piwin_scheme_playbook',
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

  it('scopes file writes to the live writable child lease and removes the exception for stale/readonly contexts', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-child-file-scope-'));
    const worktreePath = join(piwinRoot, 'worktrees', 'repo', 'slot-0');
    const projectPath = join(piwinRoot, 'project');
    await mkdir(worktreePath, { recursive: true });
    await mkdir(projectPath);
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    try {
      runtime.subagentSessionContexts.set('child', {
        parentSessionId: 'parent', runtimeGenerationId: 'g1', workingDirectory: worktreePath,
        parentRepoPath: projectPath, worktreePath,
      });
      const composed = await runtime.composeSessionHostToolsForSession('child', 'g1');
      const router = new HostToolExecutionRouter({ tools: composed.tools, admission: composed.permissionGate });
      const context = { sessionId: 'child', runtimeGenerationId: 'g1', runId: 'r1', toolName: 'write_file' };
      const signal = new AbortController().signal;
      expect(await router.execute('write_file', { path: 'probe.ts', content: 'export const probe = 1;\n' }, signal, context)).toMatchObject({ ok: true });
      expect(await router.execute('edit', { path: 'probe.ts', edits: [{ oldText: 'probe = 1', newText: 'probe = 2' }] }, signal, { ...context, toolName: 'edit' })).toMatchObject({ ok: true });
      expect(await router.execute('delete_file', { path: 'probe.ts' }, signal, { ...context, toolName: 'delete_file' })).toMatchObject({ ok: true });
      expect(await router.execute('write_file', { path: join(piwinRoot, 'config.json'), content: '{}' }, signal, context)).toMatchObject({ ok: false, code: 'permission-denied' });
      expect(await router.execute('write_file', { path: 'in.ts', content: 'test' }, signal, context)).toMatchObject({ ok: true });
      expect(await router.execute('move_file', { from: 'in.ts', to: join(piwinRoot, 'config.json') }, signal, { ...context, toolName: 'move_file' })).toMatchObject({ ok: false, code: 'permission-denied' });
      const stale = await runtime.composeSessionHostToolsForSession('child', 'g2');
      expect(evaluateFileWritePermission({ absPath: stale.permissionGate.projectRoot + '/src.ts', projectRoot: stale.permissionGate.projectRoot, mode: 'auto', rules: stale.permissionGate.rules })).toEqual({ decision: 'deny', reason: 'piwin-config' });
      runtime.subagentSessionContexts.delete('child');
      const dropped = await runtime.composeSessionHostToolsForSession('child', 'g1', undefined, worktreePath);
      expect(evaluateFileWritePermission({ absPath: dropped.permissionGate.projectRoot + '/src.ts', projectRoot: dropped.permissionGate.projectRoot, mode: 'auto', rules: dropped.permissionGate.rules })).toEqual({ decision: 'deny', reason: 'piwin-config' });
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
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
      expect(composed.permissionGate.getPermissionMode()).toBe('auto');

      runtime.subagentSessionContexts.set('readonly-child', {
        parentSessionId: 'parent-session',
        runtimeGenerationId: 'generation-readonly',
        workingDirectory: projectPath,
        parentRepoPath: projectPath,
      });
      const readonlyChild = await runtime.composeSessionHostToolsForSession(
        'readonly-child',
        'generation-readonly',
      );
      expect(readonlyChild.permissionGate.getPermissionMode()).toBe('ask-all');
    } finally {
      await runtime.dispose();
      await rm(piwinRoot, { recursive: true, force: true });
    }
  });

  it('lets a worktree child run a shell in its copy without trusting that directory', async () => {
    const piwinRoot = await mkdtemp(join(tmpdir(), 'piwin-tool-surface-worktree-cwd-'));
    const projectPath = join(piwinRoot, 'project');
    const worktreePath = join(piwinRoot, 'worktrees', 'subagent-1');
    const siblingPath = join(piwinRoot, 'worktrees', 'not-a-lease');
    const untrustedProject = join(piwinRoot, 'untrusted');
    const untrustedWorktree = join(piwinRoot, 'worktrees', 'untrusted-child');
    await mkdir(projectPath, { recursive: true });
    await mkdir(worktreePath, { recursive: true });
    await mkdir(siblingPath, { recursive: true });
    await mkdir(untrustedProject, { recursive: true });
    await mkdir(untrustedWorktree, { recursive: true });
    await setProjectTrust(join(piwinRoot, 'projects.json'), projectPath, 'trusted');
    const runtime = new HostRuntime({ mode: 'sdk', mock: false, piwinRoot });
    const jobs = runtime.jobController;
    if (!jobs) {
      throw new Error('job controller missing');
    }
    const shell = {
      kind: 'command' as const,
      lifetime: 'host' as const,
      command: process.execPath,
      argv: ['-e', 'process.exit(0)'],
    };
    try {
      await expect(jobs.start({ ...shell, cwd: worktreePath })).rejects.toThrow(/outside trusted/);

      runtime.subagentSessionContexts.set('worktree-child', {
        parentSessionId: 'parent-session',
        runtimeGenerationId: 'generation-child',
        workingDirectory: worktreePath,
        parentRepoPath: projectPath,
        worktreePath,
      });
      const job = await jobs.start({ ...shell, cwd: worktreePath });
      const finished = await jobs.wait(
        { jobId: job.jobId, timeoutMs: 15_000 },
        new AbortController().signal,
      );
      expect(finished.status).toBe('exited');

      await expect(jobs.start({ ...shell, cwd: siblingPath })).rejects.toThrow(/outside trusted/);

      runtime.subagentSessionContexts.delete('worktree-child');
      await expect(jobs.start({ ...shell, cwd: worktreePath })).rejects.toThrow(/outside trusted/);

      runtime.subagentSessionContexts.set('untrusted-child', {
        parentSessionId: 'parent-session',
        runtimeGenerationId: 'generation-untrusted',
        workingDirectory: untrustedWorktree,
        parentRepoPath: untrustedProject,
        worktreePath: untrustedWorktree,
      });
      const untrustedJob = await jobs.start({ ...shell, cwd: untrustedWorktree });
      const untrustedFinished = await jobs.wait(
        { jobId: untrustedJob.jobId, timeoutMs: 15_000 },
        new AbortController().signal,
      );
      expect(untrustedFinished.status).toBe('exited');
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
      expect(parentTools.some((tool) => tool.descriptor.name === SUBAGENT_RESULT_DISCARD_TOOL_NAME)).toBe(
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
      // A child cannot settle results: only the session that delegated owns them.
      expect(childTools.some((tool) => tool.descriptor.name === SUBAGENT_RESULT_DISCARD_TOOL_NAME)).toBe(
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
        const sessionId = `reviewer-${mode}`;
        const generationId = `generation-reviewer-${mode}`;
        const composed = await runtime.composeSessionHostToolsForSession(
          sessionId, generationId, undefined, projectPath,
        );
        const compile = (scoped: boolean) => compileBlueprintForWorker({
          scope: { kind: 'project', projectPath },
          subagent: { mode: 'readonly' },
        }, {
          config: createDefaultPiwinConfig(),
          piwinRoot, sessionId, runtimeGenerationId: generationId,
          mcpConfig: { mcpServers: {} },
          discoverResources: async () => ({ skillPaths: [], extensionPaths: [], promptPaths: [] }),
          hostToolDescriptors: descriptorsFromTools(composed.tools),
          hostToolFamilyIndex: toolFamilyIndex(composed.tools),
          ...(scoped ? { reviewScope } : {}),
        });
        const compiled = await compile(true);
        const toolNames = compiled.sessionBlueprint.capabilitySnapshot.tools.hostTools.map((tool) => tool.name);
        namesByMode[mode] = toolNames.filter((name) =>
          name === SUBAGENT_RESULT_READ_TOOL_NAME || name === SUBAGENT_REVIEW_SUBMIT_TOOL_NAME,
        );
        const forbidden = ['piwin_subagent_start', SUBAGENT_RESULT_APPLY_TOOL_NAME,
          SUBAGENT_RESULT_DISCARD_TOOL_NAME, SUBAGENT_VERIFICATION_SUBMIT_TOOL_NAME,
          'write_file', 'edit', 'delete_file', 'bash'];
        for (const name of forbidden) expect(toolNames).not.toContain(name);
        expect(compiled.sessionBlueprint.capabilitySnapshot.tools.enabledFamilies).not.toContain('delegate');
        const ordinary = await compile(false);
        const ordinaryNames = ordinary.sessionBlueprint.capabilitySnapshot.tools.hostTools.map((tool) => tool.name);
        expect(ordinaryNames).not.toContain(SUBAGENT_RESULT_READ_TOOL_NAME);
        expect(ordinaryNames).not.toContain(SUBAGENT_REVIEW_SUBMIT_TOOL_NAME);

        const port = new SessionHostToolExecutionPort({
          isSessionKnown: (requested) => requested === sessionId,
          getRuntimeGenerationId: () => generationId,
        });
        // Keep this registry test independent of interactive permission prompts;
        // exact candidate authorization still runs inside the real executors.
        port.registerActiveGeneration(sessionId, generationId, composed.tools, createPermissiveToolAdmission());
        expect(port.restrictGeneration(sessionId, generationId, toolNames,
          compiled.sessionBlueprint.hostToolboxTargetNames)).toBe(true);
        let toolCallSequence = 0;
        const execute = (toolName: string, argumentsValue: Record<string, unknown>) => port.execute({
          sessionId, runtimeGenerationId: generationId, runId: 'review-run',
          toolCallId: `review-call-${++toolCallSequence}`, toolName,
          arguments: argumentsValue,
        }, new AbortController().signal);
        expect(await execute(SUBAGENT_RESULT_READ_TOOL_NAME, {
          mode: 'summary', result: reviewScope.result,
        })).toMatchObject({ ok: false, code: 'review-target-not-found' });
        expect(await execute(SUBAGENT_RESULT_READ_TOOL_NAME, {
          mode: 'summary', result: { resultId: 'another-result', revision: 1 },
        })).toMatchObject({ ok: false, code: 'review-target-forbidden' });
        expect(await execute(SUBAGENT_REVIEW_SUBMIT_TOOL_NAME, {
          target: { resultId: 'another-result', revision: 1 }, decision: 'approved',
          findings: [], verification: [],
        })).toMatchObject({ ok: false, code: 'review-target-forbidden' });
        expect(await execute('write_file', { path: 'probe.txt', content: 'not allowed' }))
          .toMatchObject({ ok: false, code: 'tool-not-available' });
        expect(await port.execute({ sessionId, runtimeGenerationId: 'stale-generation',
          runId: 'review-run', toolName: SUBAGENT_RESULT_READ_TOOL_NAME,
          arguments: { mode: 'summary', result: reviewScope.result },
        }, new AbortController().signal)).toMatchObject({ ok: false, code: 'tool-not-available' });
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
