import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HostRuntime } from './host-runtime.js';
import { listProjects } from '@piwin/project';
import { getSessionRecord } from '@piwin/session';
import {
  getPiwinGeneralWorkspacePath,
  getPiwinProjectsPath,
  getPiwinSessionIndexPath,
} from './paths.js';

describe('No Repo project session', () => {
  it('creates and prompts without registering a ProjectRecord', async () => {
    const rootDir = await mkdtemp(join(tmpdir(), 'piwin-norepo-session-'));
    const runtime = new HostRuntime({
      mode: 'sdk',
      mock: true,
      piwinRoot: rootDir,
    });
    const workspace = getPiwinGeneralWorkspacePath(rootDir);
    const created = await runtime.handleCommand({
      type: 'session/create',
      input: { scope: { kind: 'project', projectPath: workspace } },
    });
    expect(created.success).toBe(true);
    if (!created.success) {
      throw new Error(created.error);
    }
    const sessionId = (created.data as { sessionId: string }).sessionId;
    const record = await getSessionRecord(getPiwinSessionIndexPath(rootDir), sessionId);
    expect(record?.scope).toEqual({ kind: 'project', projectPath: workspace });
    expect(await listProjects(getPiwinProjectsPath(rootDir))).toEqual([]);

    const prompted = await runtime.handleCommand({
      type: 'session/prompt',
      sessionId,
      input: { text: 'hello from no repo' },
    });
    expect(prompted, JSON.stringify(prompted)).toMatchObject({ success: true });
    await runtime.dispose();
  });
});
